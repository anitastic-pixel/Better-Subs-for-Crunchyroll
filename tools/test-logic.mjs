/**
 * tools/test-logic.mjs — dependency-free regression tests for the pure logic
 * behind the custom-source features (Phase 1 upload + sync, Phase 2 BYOK MT).
 *
 * These cover everything that does NOT need a live browser: parsers, the
 * Episode custom-source registry + persistence, the sync transforms, the
 * settings schema (incl. the rule that the MT key is never mirrored), and the
 * service worker's DeepL/Google request/response shaping.
 *
 * Run:  node tools/test-logic.mjs
 * The browser-only behaviours (file picker, menu DOM, overlay, permission
 * prompt, real provider round-trip) are covered by the manual QA checklist.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// Indirect eval runs in global scope (sloppy mode), so each lib's IIFE assigns
// to globalThis.CRSubFix exactly as it does in the browser.
const load = (code) => (0, eval)(code);

// ── Tiny test runner ───────────────────────────────────────────────────────
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { pass++; } else { fail++; fails.push(name); }
}
function eq(name, got, want) {
  ok(`${name} — got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(want));
}
function section(s) { console.log(`\n— ${s}`); }

// ── Mocks ──────────────────────────────────────────────────────────────────
function mkStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get _m() { return m; },
  };
}
globalThis.localStorage = mkStore();
globalThis.sessionStorage = mkStore();

// Load the pure libs (order matches manifest dependencies).
load(read('extension/lib/subtitle-parser.js'));
load(read('extension/lib/sign-track.js'));
load(read('extension/lib/custom-source.js'));
load(read('extension/lib/subtitle-catalog.js'));
load(read('extension/lib/storage.js'));
load(read('extension/lib/episode.js'));
load(read('extension/lib/remaster.js'));
load(read('extension/lib/sub-sync.js'));
load(read('extension/lib/settings-schema.js'));
const NS = globalThis.CRSubFix;
const P  = NS.parser;
const E  = NS.episode;
const R  = NS.remaster;
const S  = NS.settings;
const ST = NS.signTrack;
const CS = NS.customSource;
const SY = NS.subSync;

// ── 1. Parsers ─────────────────────────────────────────────────────────────
section('Parsers');
{
  const srt = '1\n00:00:01,000 --> 00:00:04,000\n<i>Hello</i> world\nline two\n\n' +
              '2\n00:00:05,500 --> 00:00:08,250\n{\\an8}Top sign\n';
  const c = P.parseSubtitles(srt, 'f.srt');
  eq('SRT cue count', c.length, 2);
  eq('SRT strips tags + joins lines', c[0].text, 'Hello world\nline two');
  eq('SRT comma-decimal timing', [c[1].start, c[1].end], [5.5, 8.25]);
  eq('SRT {ass} override stripped', c[1].text, 'Top sign');

  // Detected by signature even without a .srt extension (e.g. a blob upload).
  eq('SRT by signature (no ext)', P.parseSubtitles(srt, 'blob:x').length, 2);

  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nVtt line\n';
  eq('VTT still parses', P.parseSubtitles(vtt, 'x.vtt').length, 1);
  eq('VTT not misdetected as SRT', P.parseSubtitles(vtt, 'x.vtt')[0].text, 'Vtt line');

  const ass = '[Script Info]\nPlayResX: 1920\n[Events]\n' +
              'Format: Start, End, Style, Text\n' +
              'Dialogue: 0:00:02.00,0:00:04.00,Default,Hi there\n';
  const a = P.parseSubtitles(ass, 'x.ass');
  eq('ASS parses', [a.length, a[0].text], [1, 'Hi there']);

  // Numeric style fields: a legitimate 0 must survive (no outline / no margin),
  // and a blank/garbage field must fall back to its default — NOT become NaN
  // (which would render as `NaNpx` stroke/margin in the overlay).
  const fmt = 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, ' +
              'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, ' +
              'Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';
  const styleAss = ['[Script Info]', '[V4+ Styles]', fmt,
    'Style: Zero,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,10,10,0,1',
    'Style: Blank,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,,,2,10,10,,1',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.00,Zero,,0,0,0,,zero outline',
    'Dialogue: 0,0:00:04.00,0:00:06.00,Blank,,0,0,0,,blank outline'].join('\n');
  const sa = P.parseSubtitles(styleAss, 'x.ass');
  eq('ASS Outline/Shadow=0 preserved (not defaulted)', [sa[0].bord, sa[0].shad], [0, 0]);
  ok('ASS MarginV=0 preserved (not null)', sa[0].marginV === 0);
  ok('ASS blank Outline → default 2, not NaN', sa[1].bord === 2 && Number.isFinite(sa[1].bord));
  ok('ASS blank Shadow → default 0, not NaN', sa[1].shad === 0 && Number.isFinite(sa[1].shad));
  ok('ASS blank MarginV → null, not NaN', sa[1].marginV === null);

  // Malformed / zero-length spans are dropped: an end ≤ start cue never satisfies
  // the `end > t` window (silently invisible), and a NaN start corrupts the sort.
  const spanSrt = '1\n00:00:01,000 --> 00:00:01,000\nzero-span\n\n' +
                  '2\n00:00:02,000 --> 00:00:05,000\nkept\n\n' +
                  '3\nbad --> stamps\ngarbage\n';
  const ss = P.parseSubtitles(spanSrt, 'x.srt');
  eq('zero-span + malformed cues dropped', ss.length, 1);
  eq('valid cue survives the span filter', ss[0].text, 'kept');
}

// ── 2. Custom-source registry + persistence ────────────────────────────────
section('Custom-source registry');
{
  globalThis.localStorage = mkStore(); // fresh
  const ep = E.create('guidA');
  const cues = P.parseSubtitles('1\n00:00:10,000 --> 00:00:12,000\nA\n\n2\n00:01:00,000 --> 00:01:02,000\nB\n', 'f.srt');
  ep.addCustomSource({ id: 'custom:local', kind: 'local', label: 'My Fansub', lang: null, srcCues: cues, sync: { mode: 'none' } });
  eq('get by id', ep.getCustomSource('custom:local')?.label, 'My Fansub');
  eq('list length', ep.listCustomSources().length, 1);
  eq('persisted under guid key', [...globalThis.localStorage._m.keys()], ['crSubFix_custom_guidA']);

  // Reload: a fresh Episode for the same guid rehydrates from storage.
  const ep2 = E.create('guidA');
  const list = ep2.listCustomSources();
  eq('round-trips after reload', [list.length, list[0].srcCues.length], [1, 2]);

  ep2.setCustomSourceSync('custom:local', { mode: 'linear', scale: 1.04, offset: 2.6 });
  eq('sync persists', E.create('guidA').getCustomSource('custom:local').sync.mode, 'linear');

  ep2.removeCustomSource('custom:local');
  eq('remove clears storage', globalThis.localStorage._m.has('crSubFix_custom_guidA'), false);
  eq('remove empties list', E.create('guidA').listCustomSources().length, 0);
}

// ── 2b. Dual subtitles — secondary track scan (independent of primary) ───────
section('Dual subtitles (secondary track)');
{
  globalThis.localStorage = mkStore();
  const ep = E.create('guidD');
  ep.setOriginalCues([{ start: 0, end: 5, text: 'primary' }]);
  ep.setSecondaryCues([{ start: 1, end: 3, text: 'sec A' }, { start: 6, end: 8, text: 'sec B' }]);
  eq('secondary active at t=2', ep.secondaryCuesAt(2, 0).map((c) => c.text), ['sec A']);
  eq('secondary empty in the gap', ep.secondaryCuesAt(4, 0).map((c) => c.text), []);
  eq('secondary active at t=7', ep.secondaryCuesAt(7, 0).map((c) => c.text), ['sec B']);
  eq('primary scan unaffected by the secondary', ep.cuesAt(2, 0).map((c) => c.text), ['primary']);
  eq('secondary honours the display offset', ep.secondaryCuesAt(0.5, 0.6).map((c) => c.text), ['sec A']);
  ep.setSecondaryCues([]);
  eq('cleared secondary returns nothing', ep.secondaryCuesAt(2, 0).length, 0);
}

// ── 2c. Long-running cue scan (no fixed backward cap) ────────────────────────
section('Long-cue scan');
{
  globalThis.localStorage = mkStore();
  const ep = E.create('guidLong');
  // A whole-scene \pos sign that opens at t=0 and stays up, followed by 200
  // short dialogue lines.  At t=150 the sign starts ~150 cues earlier than the
  // current line — the old fixed 100-cue backward cap dropped it.
  const cues = [{ start: 0, end: 10000, text: 'WHOLE-SCENE SIGN', pos: { x: 1, y: 1 } }];
  for (let i = 1; i <= 200; i++) cues.push({ start: i, end: i + 0.5, text: 'd' + i });
  ep.setOriginalCues(cues);
  const at = ep.cuesAt(150.2, 0).map((c) => c.text);
  ok('long-running cue still shown 150 lines later', at.includes('WHOLE-SCENE SIGN'));
  ok('current short line shown too', at.includes('d150'));
  eq('nothing stale from far in the past', at.includes('d10'), false);
}

// ── 3. Sync transforms — subSync owns the model, the panel just wires it ─────
section('Sync transforms (lib/sub-sync.js)');
{
  const cues = [{ start: 10, end: 12 }, { start: 60, end: 62 }];
  const firstRaw = 10, lastRaw = 60;
  // Two-point: first line should hit 13s, last 65s → scale 1.04, offset 2.6.
  const sync = SY.computeLinearSync(13, 65, firstRaw, lastRaw);
  eq('two-point scale/offset', [sync.mode, +sync.scale.toFixed(3), +sync.offset.toFixed(3)], ['linear', 1.04, 2.6]);

  // applySync bakes the linear map onto the cues (the apply path's transform).
  const lin = SY.applySync({ srcCues: cues, sync }).map((c) => +c.start.toFixed(2));
  eq('linear maps endpoints', lin, [13, 65]);

  // One mark → offset-only; no marks → null (the panel leaves sync unchanged).
  eq('one mark = offset-only', SY.computeLinearSync(13, null, firstRaw, lastRaw), { mode: 'linear', scale: 1, offset: 3 });
  eq('no marks = null', SY.computeLinearSync(null, null, firstRaw, lastRaw), null);
  // Marks too close to separate offset from stretch → offset-only fallback.
  eq('sub-1s span = offset-only', SY.computeLinearSync(13, 14, 10, 10.5)?.scale, 1);

  // Anchor path (auto-sync) must agree with the two-point result.
  const anchors = [{ srcTime: 10, refTime: 13 }, { srcTime: 60, refTime: 65 }];
  const rm = SY.applySync({ srcCues: cues, sync: { mode: 'anchors', anchors } }).map((c) => +c.start.toFixed(2));
  eq('anchors map endpoints', rm, [13, 65]);

  // 'none' / malformed → passthrough, but a fresh copy (never the same array).
  const passthru = SY.applySync({ srcCues: cues, sync: { mode: 'none' } });
  eq('none = passthrough times', passthru.map((c) => c.start), [10, 60]);
  ok('passthrough is a copy, not the input array', passthru !== cues);
}

// ── 3b. Custom-source factory (lib/custom-source.js) ────────────────────────
section('Custom-source factory');
{
  const ass = '[Script Info]\nPlayResX: 1920\n[V4+ Styles]\nFormat: Name\nStyle: Sign\n[Fonts]\n' +
    'fontname: Cool_0.ttf\nAABBCCDDEE\n[Events]\n' +
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
    'Dialogue: 0,0:00:01.00,0:00:03.00,Sign,,0,0,0,,{\\pos(960,200)}Vault\n' +
    'Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,Plain line\n';
  const local = CS.makeLocalSource('My Fansub [grp].ass', ass);
  eq('local id/kind', [local.id, local.kind], ['custom:local', 'local']);
  eq('local label strips ext', local.label, 'My Fansub [grp]');
  eq('local lang null + sync none', [local.lang, local.sync.mode], [null, 'none']);
  eq('local keeps both dialogue cues', local.srcCues.length, 2);
  ok('local signRawAss keeps embedded [Fonts]', /\[Fonts\]/.test(local.signRawAss) && /Cool_0\.ttf/.test(local.signRawAss));
  ok('local signRawAss keeps the \\pos sign', /Vault/.test(local.signRawAss));
  ok('local signRawAss drops plain dialogue', !/Plain line/.test(local.signRawAss));

  eq('isCustomId', [CS.isCustomId('custom:local'), CS.isCustomId('ja-JP'), CS.isCustomId(null)], [true, false, false]);

  const srtLocal = CS.makeLocalSource('plain.srt', '1\n00:00:01,000 --> 00:00:02,000\nhi\n');
  eq('srt upload has no signs', srtLocal.signRawAss, null);
  eq('empty file → null record (caller toasts)', CS.makeLocalSource('empty.srt', '   '), null);

  const mt = CS.makeMtSource({ id: 'custom:mt:ja-JP:deepl', target: 'ja-JP', source: 'en-US', label: 'Japanese (DeepL)', srcCues: srtLocal.srcCues, signRawAss: null });
  eq('mt record shape', [mt.id, mt.kind, mt.lang, mt.mtSource, mt.sync.mode], ['custom:mt:ja-JP:deepl', 'mt', 'ja-JP', 'en-US', 'none']);
}

// ── 3c. Sign-track MT round-trip (lib/sign-track.js) ────────────────────────
section('Sign-track extract/rebuild');
{
  const signs = '[Script Info]\n[V4+ Styles]\nFormat: Name\nStyle: S\n[Events]\n' +
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
    'Dialogue: 0,0:00:01.00,0:00:03.00,S,,0,0,0,,{\\pos(10,20)}Forbidden Vault\n';
  const built = ST.buildSignsAss(signs);
  const parsed = ST.extractSignTexts(built);
  eq('extract pulls the sign body', parsed.texts, ['Forbidden Vault']);
  const round = ST.rebuildSignsAss(ST.extractSignTexts(built), ['立入禁止']);
  ok('rebuild reinserts translation behind the tags', /\{\\pos\(10,20\)\}立入禁止/.test(round));
  ok('null translation keeps the source text', /Forbidden Vault/.test(ST.rebuildSignsAss(ST.extractSignTexts(built), [null])));
}

// ── 4. Settings schema (MT selectors mirrored, key never is) ────────────────
section('Settings schema');
{
  const d = S.defaults();
  eq('mt defaults', [d.mtProvider, d.mtTarget, d.mtSource], ['deepl', 'ja-JP', '']);
  ok('mtApiKey NOT in schema (never mirrored to DOM)', !('mtApiKey' in d));
  ok('no data-cr-mt-key attribute exists', !S.ATTRS.some((a) => /key/i.test(a)));

  const el = { _a: {}, setAttribute(k, v) { this._a[k] = v; }, getAttribute(k) { return k in this._a ? this._a[k] : null; } };
  S.writeAttrs(el, { ...d, mtProvider: 'deepl', mtTarget: 'ko-KR', mtSource: 'en-US' });
  eq('mt round-trip', [S.read(el, 'mtProvider'), S.read(el, 'mtTarget'), S.read(el, 'mtSource')], ['deepl', 'ko-KR', 'en-US']);
}

// ── 5. Service-worker translate (DeepL-only since v1.7.1) ───────────────────
section('Service-worker translate (DeepL-only)');
{
  let lastReq = null;
  globalThis.self = globalThis;
  globalThis.CRSubFix.protocol = { MSG: { MT_TRANSLATE: 'MT_TRANSLATE' } };
  globalThis.fetch = async (url, opts) => {
    lastReq = { url, opts };
    return { ok: true, json: async () => ({ translations: [{ text: 'こんにちは' }, { text: '世界' }] }) };
  };
  globalThis.chrome = {
    commands: { onCommand: { addListener() {} } },
    tabs: {}, action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    runtime: { onMessage: { addListener() {} } },
    storage: { local: { get: async () => ({ mtApiKey: 'test-key:fx', mtProvider: 'deepl' }) } },
  };
  const bg = read('extension/background.js').replace(/importScripts\([^)]*\);/, '');
  load(bg + '\nglobalThis.__bg={handleTranslate,deeplTranslate,deeplTarget,deeplSource};');
  const BG = globalThis.__bg;

  const r1 = await BG.handleTranslate({ texts: ['Hello', 'World'], source: 'en-US', target: 'ja-JP' });
  eq('DeepL translations', r1.translations, ['こんにちは', '世界']);
  eq('DeepL free host (:fx key)', String(lastReq.url), 'https://api-free.deepl.com/v2/translate');
  eq('DeepL body shape', lastReq.opts.body, 'text=Hello&text=World&target_lang=JA&source_lang=EN');
  eq('DeepL auth header', lastReq.opts.headers.Authorization, 'DeepL-Auth-Key test-key:fx');

  // Count guard: fewer translations than texts must fail, not silently misalign.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ translations: [{ text: 'x' }] }) });
  const r3 = await BG.handleTranslate({ texts: ['a', 'b'], source: 'en', target: 'ja-JP' });
  eq('count-mismatch rejected', [r3.ok, r3.error], [false, 'count-mismatch']);

  eq('lang maps', [BG.deeplTarget('ja-JP'), BG.deeplSource('en-US'), BG.deeplTarget('pt-BR')], ['JA', 'EN', 'PT-BR']);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(40)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('All logic tests passed.');
