/**
 * lib/subtitle-parser.js — pure parsers and color utilities.
 *
 * Both ASS (Advanced SubStation Alpha) and WebVTT inputs return the same
 * Cue shape; the renderer and remaster code consume cue arrays without
 * caring about source format.
 *
 * No DOM, no fetch, no global state.
 *
 * Exposes:
 *   CRSubFix.parser.parseSubtitles(text, url)  → Cue[]
 *   CRSubFix.parser.normalizeSubText(t)        — strip markup for matching
 *   CRSubFix.parser.applyAlpha(cssColor, a)    — override alpha on rgb/rgba
 *   CRSubFix.parser.parseColorHex(assHex)      — ASS BGR/AABBGGRR → CSS color
 */
(function () {
  'use strict';

  function parseBGR(hex) {
    const b = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const r = parseInt(hex.slice(4, 6), 16);
    return `rgb(${r},${g},${b})`;
  }

  // ASS color: 6-char BBGGRR or 8-char AABBGGRR.  ASS alpha convention:
  // 0x00 = fully opaque, 0xFF = fully transparent.
  function parseColorHex(hex) {
    if (hex.length === 8) {
      const a   = (255 - parseInt(hex.slice(0, 2), 16)) / 255;
      const rgb = parseBGR(hex.slice(2));
      return a < 0.99 ? rgb.replace('rgb(', 'rgba(').replace(')', `,${a.toFixed(2)})`) : rgb;
    }
    return parseBGR(hex);
  }

  function applyAlpha(color, alpha) {
    if (!color || alpha == null || alpha >= 0.99) return color;
    const m = color.match(/rgba?\((\d+),(\d+),(\d+)/);
    if (!m) return color;
    return `rgba(${m[1]},${m[2]},${m[3]},${Math.max(0, Math.min(1, alpha)).toFixed(2)})`;
  }

  function parseOverrideTags(tagStr) {
    const s = {};
    const posM   = tagStr.match(/\\pos\(([^,)]+),([^)]+)\)/);
    if (posM)  s.pos          = { x: parseFloat(posM[1]), y: parseFloat(posM[2]) };
    const anM    = tagStr.match(/\\an([1-9])/);
    if (anM)   s.alignment    = parseInt(anM[1]);
    const fadM   = tagStr.match(/\\fad\(([^,)]+),([^)]+)\)/);
    if (fadM) { s.fadeIn = parseInt(fadM[1]); s.fadeOut = parseInt(fadM[2]); }
    const c1M    = tagStr.match(/\\1?c&H([0-9A-Fa-f]{6,8})&/);
    if (c1M)   s.color        = parseColorHex(c1M[1]);
    const c3M    = tagStr.match(/\\3c&H([0-9A-Fa-f]{6,8})&/);
    if (c3M)   s.outlineColor = parseColorHex(c3M[1]);
    const c4M    = tagStr.match(/\\4c&H([0-9A-Fa-f]{6,8})&/);
    if (c4M)   s.shadowColor  = parseColorHex(c4M[1]);
    const a1M    = tagStr.match(/\\1a&H([0-9A-Fa-f]{2})&/);
    if (a1M)   s.primaryAlpha = (255 - parseInt(a1M[1], 16)) / 255;
    const aAllM  = tagStr.match(/\\alpha&H([0-9A-Fa-f]{2})&/);
    if (aAllM) s.primaryAlpha = (255 - parseInt(aAllM[1], 16)) / 255;
    const bordM  = tagStr.match(/\\bord(\d+(?:\.\d+)?)/);
    if (bordM)  s.bord         = parseFloat(bordM[1]);
    const shadM  = tagStr.match(/\\shad(\d+(?:\.\d+)?)/);
    if (shadM)  s.shad         = parseFloat(shadM[1]);
    const frzM   = tagStr.match(/\\frz([-\d.]+)/);
    if (frzM)   s.frz          = parseFloat(frzM[1]);
    const fscxM  = tagStr.match(/\\fscx(\d+(?:\.\d+)?)/);
    if (fscxM)  s.fscx         = parseFloat(fscxM[1]);
    const fscyM  = tagStr.match(/\\fscy(\d+(?:\.\d+)?)/);
    if (fscyM)  s.fscy         = parseFloat(fscyM[1]);
    const fnM    = tagStr.match(/\\fn([^\\}]+)/);
    if (fnM)    s.fontName     = fnM[1].trim();
    const boldM  = tagStr.match(/\\b([01])/);
    if (boldM)  s.bold         = boldM[1] === '1';
    const italicM = tagStr.match(/\\i([01])/);
    if (italicM) s.italic      = italicM[1] === '1';
    const fsM    = tagStr.match(/\\fs(\d+(?:\.\d+)?)/);
    if (fsM)    s.fontSize     = parseFloat(fsM[1]);
    return s;
  }

  function parseASSTime(ts) {
    const p = ts.trim().split(':');
    return parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseFloat(p[2]);
  }

  // Default cue shape used by VTT cues.  ASS cues build their own object with
  // per-style and per-tag overrides.  Keep the property list in sync if either
  // parser starts emitting a new field.
  function defaultVttCue() {
    return {
      pos: null, alignment: 2, fadeIn: 0, fadeOut: 0,
      color: 'rgb(255,255,255)', outlineColor: 'rgb(0,0,0)', shadowColor: null,
      primaryAlpha: 1, bord: 2, shad: 0, borderStyle: 1,
      fontName: null, frz: 0, fscx: 100, fscy: 100,
      bold: false, italic: false, fontSize: null,
      marginV: null, playResX: 1280, playResY: 720,
    };
  }

  function parseASS(text) {
    const cues  = [];
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const scriptInfo = { playResX: 640, playResY: 360 };
    const styles     = {};
    let section      = '';
    let evStart = 1, evEnd = 2, evStyle = 3, evText = 9;
    let stName = 0, stFontname = 1, stSize = 2, stColor = 3, stOutlineColor = 5,
        stBackColor = 6, stBorderStyle = 15, stOutline = 16, stShadow = 17,
        stAlign = 18, stMarginV = 21;

    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('[')) { section = t; continue; }

      if (section === '[Script Info]') {
        const mX = t.match(/^PlayResX\s*:\s*(\d+)/i); if (mX) scriptInfo.playResX = parseInt(mX[1]);
        const mY = t.match(/^PlayResY\s*:\s*(\d+)/i); if (mY) scriptInfo.playResY = parseInt(mY[1]);
        continue;
      }

      if (section === '[V4+ Styles]') {
        if (t.startsWith('Format:')) {
          const f = t.slice(7).split(',').map(x => x.trim());
          stName         = f.indexOf('Name');
          stFontname     = f.indexOf('Fontname');
          stSize         = f.indexOf('Fontsize');
          stColor        = f.indexOf('PrimaryColour');
          stOutlineColor = f.indexOf('OutlineColour');
          stBackColor    = f.indexOf('BackColour');
          stBorderStyle  = f.indexOf('BorderStyle');
          stOutline      = f.indexOf('Outline');
          stShadow       = f.indexOf('Shadow');
          stAlign        = f.indexOf('Alignment');
          stMarginV      = f.indexOf('MarginV');
        } else if (t.startsWith('Style:')) {
          const f    = t.slice(6).split(',');
          const name = f[stName]?.trim();
          const ch   = f[stColor]?.trim().match(/&H([0-9A-Fa-f]{6,8})&/)?.[1];
          const och  = f[stOutlineColor]?.trim().match(/&H([0-9A-Fa-f]{6,8})&/)?.[1];
          const bch  = f[stBackColor]?.trim().match(/&H([0-9A-Fa-f]{6,8})&/)?.[1];
          if (name) styles[name] = {
            fontName:    f[stFontname]?.trim()          || null,
            alignment:   parseInt(f[stAlign])           || 2,
            fontSize:    parseFloat(f[stSize])          || null,
            color:       ch  ? parseColorHex(ch)        : null,
            outlineColor:och ? parseColorHex(och)       : null,
            shadowColor: bch ? parseColorHex(bch)       : null,
            bord:        parseFloat(f[stOutline])       ?? 2,
            shad:        parseFloat(f[stShadow])        ?? 0,
            borderStyle: parseInt(f[stBorderStyle])     || 1,
            marginV:     parseInt(f[stMarginV])         ?? null,
          };
        }
        continue;
      }

      if (section === '[Events]') {
        if (t.startsWith('Format:')) {
          const f = t.slice(7).split(',').map(x => x.trim());
          evStart = f.indexOf('Start'); evEnd   = f.indexOf('End');
          evStyle = f.indexOf('Style'); evText  = f.indexOf('Text');
        } else if (t.startsWith('Dialogue:')) {
          const f = t.slice(9).split(',');
          if (f.length <= evText) continue;

          const start     = parseASSTime(f[evStart]);
          const end       = parseASSTime(f[evEnd]);
          const styleName = f[evStyle]?.trim() ?? 'Default';
          const rawText   = f.slice(evText).join(',');

          const ov = {};
          for (const blk of (rawText.match(/\{([^}]*)\}/g) ?? [])) {
            Object.assign(ov, parseOverrideTags(blk.slice(1, -1)));
          }

          const clean = rawText
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ')
            .trim();
          if (!clean) continue;

          const base = styles[styleName] ?? {
            fontName: null, alignment: 2, fontSize: null,
            color: null, outlineColor: null, shadowColor: null,
            bord: 2, shad: 0, borderStyle: 1, marginV: null,
          };
          cues.push({
            start, end, text: clean,
            pos:          ov.pos          ?? null,
            alignment:    ov.alignment    ?? base.alignment,
            fadeIn:       ov.fadeIn       ?? 0,
            fadeOut:      ov.fadeOut      ?? 0,
            color:        ov.color        ?? base.color        ?? 'rgb(255,255,255)',
            outlineColor: ov.outlineColor ?? base.outlineColor ?? 'rgb(0,0,0)',
            shadowColor:  ov.shadowColor  ?? base.shadowColor  ?? null,
            primaryAlpha: ov.primaryAlpha ?? 1,
            bord:         ov.bord         ?? base.bord         ?? 2,
            shad:         ov.shad         ?? base.shad         ?? 0,
            borderStyle:  base.borderStyle ?? 1,
            fontName:     ov.fontName     ?? base.fontName     ?? null,
            frz:          ov.frz          ?? 0,
            fscx:         ov.fscx         ?? 100,
            fscy:         ov.fscy         ?? 100,
            bold:         ov.bold         ?? false,
            italic:       ov.italic       ?? false,
            fontSize:     ov.fontSize     ?? base.fontSize     ?? null,
            marginV:      base.marginV    ?? null,
            playResX:     scriptInfo.playResX,
            playResY:     scriptInfo.playResY,
          });
        }
      }
    }
    return cues;
  }

  function parseTimestamp(ts) {
    const p = ts.trim().split(':');
    if (p.length === 3) return +p[0] * 3600 + +p[1] * 60 + +p[2];
    if (p.length === 2) return +p[0] * 60 + +p[1];
    return 0;
  }

  function parseWebVTT(text) {
    const cues   = [];
    const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const tsIdx = lines.findIndex(l => l.includes('-->'));
      if (tsIdx === -1) continue;
      const [startRaw, endRaw] = lines[tsIdx].split('-->');
      const start   = parseTimestamp(startRaw);
      const end     = parseTimestamp(endRaw.trim().split(/\s+/)[0]);
      const cueText = lines.slice(tsIdx + 1).map(l => l.replace(/<[^>]+>/g, '')).join('\n').trim();
      if (cueText) cues.push({ start, end, text: cueText, ...defaultVttCue() });
    }
    return cues;
  }

  function parseSubtitles(text, url) {
    // Strip UTF-8 BOM (﻿) — some CDNs prepend it, which breaks the
    // '[Script Info]' header check and causes ASS files to be mis-parsed as VTT.
    const clean = text.replace(/^﻿/, '');
    const isAss = clean.trimStart().startsWith('[Script Info]') ||
                  /\.(?:ass|ssa)(?:[?#]|$)/i.test(url);
    const cues = isAss ? parseASS(clean) : parseWebVTT(clean);
    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  function normalizeSubText(t) {
    return t
      .replace(/\{[^}]*\}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\\[nNh]/gi, ' ')
      .replace(/[^a-z0-9 ']/gi, '')
      .trim().toLowerCase();
  }

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.parser = { parseSubtitles, normalizeSubText, applyAlpha, parseColorHex };
})();
