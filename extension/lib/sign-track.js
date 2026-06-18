/**
 * lib/sign-track.js — the typeset-signs projection of an ASS subtitle file.
 *
 * A fansub .ass mixes dialogue with positioned typeset "signs" (\pos / \move
 * cues — on-screen text, location cards, UI captions).  libass renders those
 * signs pixel-perfectly, including any fonts the file embeds in its [Fonts]
 * section, while the extension's CSS overlay draws the dialogue.  This module
 * is the seam between the two halves: it extracts the signs-only subset of an
 * .ass, and — for machine translation — pulls the translatable text out of
 * each sign so it can ride the dialogue batch, then puts the translations back.
 *
 * Pure string transforms — no DOM, no fetch, no global state.
 *
 * Public surface:
 *   CRSubFix.signTrack.buildSignsAss(rawAss)
 *     → an .ass containing only [Script Info]/[V4+ Styles]/[Fonts] plus the
 *       \pos/\move Dialogue lines, or null if the file carries no signs.
 *   CRSubFix.signTrack.extractSignTexts(signsAss)
 *     → { lines, texts, slots }: texts[i] is the translatable body of one sign,
 *       slots[i] = { lineIdx, head } maps it back to its source line (the
 *       leading override block is kept as `head`; mid-text override blocks are
 *       dropped — their formatting is lost but the text is translated).
 *   CRSubFix.signTrack.rebuildSignsAss(parsed, translations)
 *     → the signs .ass with each sign's text replaced by translations[i]
 *       (newlines re-encoded as \N); a null translation keeps the source text.
 */
(function () {
  'use strict';

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  if (!NS.CRSubFix) NS.CRSubFix = {};

  // Strip a raw .ass down to its typeset signs: keep everything before [Events]
  // ([Script Info]/[V4+ Styles]/[Fonts], so embedded fonts survive to libass),
  // the Events Format line, and only the \pos/\move Dialogue lines.
  //
  // Memoized on the raw string: the caller re-runs this on every settings change
  // and every sign push, almost always with the SAME raw .ass (a style-slider
  // drag doesn't change the subtitle file).  Reparsing a multi-KB file
  // line-by-line each time is pure waste; a tiny LRU-ish cache (primary +
  // secondary + slack) collapses it to one parse.  Pure → safe to cache.
  const _cache = new Map();
  function buildSignsAss(raw) {
    if (raw == null) return null;
    if (_cache.has(raw)) return _cache.get(raw);
    const out = buildSignsAssUncached(raw);
    if (_cache.size >= 6) _cache.delete(_cache.keys().next().value);
    _cache.set(raw, out);
    return out;
  }
  function buildSignsAssUncached(raw) {
    if (!raw || !/\[Events\]/i.test(raw)) return null;
    const lines = raw.replace(/\r/g, '').split('\n');
    const out = []; let inEvents = false, hasSign = false;
    for (const l of lines) {
      if (/^\[Events\]/i.test(l)) { inEvents = true; out.push(l); continue; }
      if (!inEvents) { out.push(l); continue; }            // [Script Info]/[V4+ Styles]/[Fonts]
      if (/^Format\s*:/i.test(l)) { out.push(l); continue; }
      if (/^Dialogue\s*:/i.test(l)) { if (/\\pos|\\move/i.test(l)) { out.push(l); hasSign = true; } continue; }
      out.push(l);                                          // comments etc.
    }
    return hasSign ? out.join('\n') : null;
  }

  // Pull the translatable text out of each \pos sign line so it can ride the
  // dialogue MT batch, then (with rebuildSignsAss) put the translations back.
  // Returns { lines, texts, slots } where slots[i] maps texts[i] to its source
  // line; the tags before the text are preserved, mid-text override blocks are
  // dropped (rare in typeset; their formatting is lost but the text is kept).
  function extractSignTexts(signsAss) {
    const lines = (signsAss || '').split('\n');
    const texts = [], slots = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^Dialogue\s*:/i.test(lines[i])) continue;
      const m = lines[i].match(/^(Dialogue\s*:(?:[^,]*,){9})(.*)$/i);
      if (!m) continue;
      const lead = (m[2].match(/^(?:\{[^}]*\})*/) || [''])[0];   // leading override block(s)
      const body = m[2].slice(lead.length)
        .replace(/\{[^}]*\}/g, '')                               // drop mid-text tags
        .replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');          // decode line breaks
      if (!/[^\s]/.test(body)) continue;                         // nothing to translate
      slots.push({ lineIdx: i, head: m[1] + lead });
      texts.push(body.trim());
    }
    return { lines, texts, slots };
  }

  function rebuildSignsAss(parsed, translations) {
    const { lines, slots } = parsed;
    for (let i = 0; i < slots.length; i++) {
      if (translations[i] == null) continue;
      lines[slots[i].lineIdx] = slots[i].head + String(translations[i]).replace(/\n/g, '\\N');
    }
    return lines.join('\n');
  }

  // Merge two signs-only .ass into one libass layer (dual signs, "Both" mode).
  // Both come from the SAME episode (different locales), so their [Script Info]/
  // [V4+ Styles]/[Fonts] match and b's \pos Dialogue lines can simply be appended
  // into a's [Events] (which sits last) — b's events reference the same style
  // names, no renaming needed.  Note: signs sharing a \pos position (the usual
  // case for translated signs) will overlap; that's the caller's accepted choice.
  function mergeSigns(a, b, gapPct) {
    if (!a) return b || null;
    if (!b) return a;
    let bDialogue = b.split('\n').filter(l => /^Dialogue\s*:/i.test(l) && /\\pos|\\move/i.test(l));
    if (!bDialogue.length) return a;
    // Lift b's signs above a's by gapPct% of the (shared) PlayResY, so the two
    // languages' overlapping \pos signs don't sit on top of each other.
    if (gapPct) {
      const m = a.match(/PlayResY:\s*(\d+)/i);
      const dy = Math.round((gapPct / 100) * (m ? Number(m[1]) : 360));
      if (dy) bDialogue = bDialogue.map(l =>
        l
          // \pos(x, y) → lift y
          .replace(/(\\pos\(\s*[^,]+,\s*)(-?[\d.]+)(\s*\))/gi,
            (_, pre, y, post) => pre + (Number(y) - dy) + post)
          // \move(x1, y1, x2, y2[, t1, t2]) → lift both y1 and y2, else a moving
          // sign keeps its original Y and overlaps track A (the exact collision
          // the gap exists to prevent).
          .replace(/(\\move\(\s*[^,]+,\s*)(-?[\d.]+)(\s*,\s*[^,]+,\s*)(-?[\d.]+)(\s*(?:,[^)]*)?\))/gi,
            (_, p1, y1, p3, y2, p5) => p1 + (Number(y1) - dy) + p3 + (Number(y2) - dy) + p5));
    }
    return a.replace(/\r/g, '').replace(/\s+$/, '') + '\n' + bDialogue.join('\n') + '\n';
  }

  NS.CRSubFix.signTrack = { buildSignsAss, extractSignTexts, rebuildSignsAss, mergeSigns };
})();
