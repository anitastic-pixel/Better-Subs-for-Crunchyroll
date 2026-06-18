/**
 * tools/test-buildsigns.mjs — lib/sign-track.js, the typeset-signs projection.
 *
 * Loads the REAL module (no copy-paste — it used to inline a verbatim copy of
 * interceptor.js's buildSignsAss) and checks that:
 *   - buildSignsAss keeps a fansub's embedded [Fonts] + \pos signs and drops
 *     dialogue, so libass renders signs (with their fonts) and nothing else;
 *   - extractSignTexts → rebuildSignsAss round-trips the sign text for MT.
 *
 * Run:  node tools/test-buildsigns.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// Indirect eval runs the IIFE in global scope, exactly as the browser loads it.
(0, eval)(read('extension/lib/sign-track.js'));
const { buildSignsAss, extractSignTexts, rebuildSignsAss, mergeSigns } = globalThis.CRSubFix.signTrack;

const fansub = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour
Style: Sign,CoolTypeface,60,&H00FFFFFF

[Fonts]
fontname: CoolTypeface_0.ttf
4AYRRAARAAAAdAAAm9heW91dCBkYXRhIGdvZXMgaGVyZSBhcyB1dWVuY29kZWQg
Ym9keSBzcGFubmluZyBtYW55IGxpbmVz

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Sign,,0,0,0,,{\\pos(960,200)}Forbidden Vault
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,Just regular dialogue here`;

const out = buildSignsAss(fansub);
const srt = buildSignsAss('1\n00:00:01,000 --> 00:00:03,000\nplain srt\n');
const noSign = buildSignsAss('[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,plain line\n');

// MT round-trip: pull the sign text out, "translate" it, put it back.
const parsed = extractSignTexts(out);
const round = rebuildSignsAss(extractSignTexts(out), parsed.texts.map((t) => `<${t}>`));
const kept  = rebuildSignsAss(extractSignTexts(out), [null]);

// Dual signs: merge a second locale's signs (same episode → same styles) into one.
const secondary = `[Script Info]
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour
Style: Sign,CoolTypeface,60,&H00FFFFFF

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Sign,,0,0,0,,{\\pos(960,200)}Caveau Interdit
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,Dialogue ordinaire`;
const secSigns = buildSignsAss(secondary);
const merged   = mergeSigns(out, secSigns);
// With a gap, the secondary sign's \pos.y is lifted above the primary's.
const mergedGap = mergeSigns(buildSignsAss(`[Script Info]\nPlayResY: 360\n[V4+ Styles]\nFormat: Name\nStyle: S\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,S,,0,0,0,,{\\pos(100,300)}A`),
  buildSignsAss(`[Script Info]\nPlayResY: 360\n[V4+ Styles]\nFormat: Name\nStyle: S\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,S,,0,0,0,,{\\pos(100,300)}B`),
  10);  // 10% of 360 = 36 → secondary y 300 → 264
// A \move sign must be lifted too (both its start AND end y), else a moving
// secondary sign keeps its original Y and overlaps the primary.
const mergedMove = mergeSigns(buildSignsAss(`[Script Info]\nPlayResY: 360\n[V4+ Styles]\nFormat: Name\nStyle: S\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,S,,0,0,0,,{\\pos(100,300)}A`),
  buildSignsAss(`[Script Info]\nPlayResY: 360\n[V4+ Styles]\nFormat: Name\nStyle: S\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,S,,0,0,0,,{\\move(100,300,200,320)}B`),
  10);  // both y's lifted by 36 → (100,264,200,284)

const checks = {
  'returns a string for .ass with signs':        typeof out === 'string',
  '[Fonts] header preserved':                    /\[Fonts\]/.test(out),
  'fontname: line preserved':                    /fontname: CoolTypeface_0\.ttf/.test(out),
  'embedded font DATA preserved (both lines)':   /4AYRRAARAAAAdAAA/.test(out) && /Ym9keSBzcGFubmluZyBtYW55IGxpbmVz/.test(out),
  'styles preserved (font-name reference)':      /Style: Sign,CoolTypeface,60/.test(out),
  'the \\pos sign kept':                         /Forbidden Vault/.test(out),
  'plain dialogue DROPPED (libass shows signs only)': !/Just regular dialogue/.test(out),
  'SRT (no signs) → null':                       srt === null,
  '.ass with no \\pos sign → null':              noSign === null,
  'extractSignTexts pulls the sign body':        parsed.texts.join('|') === 'Forbidden Vault',
  'rebuild reinserts text behind the \\pos tag': /\{\\pos\(960,200\)\}<Forbidden Vault>/.test(round),
  'rebuild keeps embedded [Fonts]':              /\[Fonts\]/.test(round),
  'null translation keeps the source text':      /Forbidden Vault/.test(kept),
  'merge keeps both locales\' signs':            /Forbidden Vault/.test(merged) && /Caveau Interdit/.test(merged),
  "merge drops the secondary's plain dialogue":  !/Dialogue ordinaire/.test(merged),
  'merge with a null side returns the other':    mergeSigns(null, secSigns) === secSigns && mergeSigns(out, null) === out,
  'merge gap lifts the secondary \\pos.y':       /\{\\pos\(100,264\)\}B/.test(mergedGap) && /\{\\pos\(100,300\)\}A/.test(mergedGap),
  'merge gap lifts BOTH \\move y coords':        /\{\\move\(100,264,200,284\)\}B/.test(mergedMove),
};
let ok = true;
for (const [k, v] of Object.entries(checks)) { if (!v) ok = false; console.log((v ? 'PASS' : 'FAIL') + '  ' + k); }
console.log('\n' + (ok ? 'ALL PASS' : 'SOME FAILED'));
process.exit(ok ? 0 : 1);
