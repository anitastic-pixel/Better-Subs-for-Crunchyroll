/**
 * lib/cue-style.js — outlined-text rendering shared by the page-side
 * renderer and the popup preview.
 *
 * Renders each subtitle text line as an SVG <text> element with
 * `stroke-linejoin="round"`, `stroke-linecap="round"`, and
 * `paint-order="stroke"`.  That gives a true rounded outline on the actual
 * stroke path — something `-webkit-text-stroke` and `text-shadow` can't do
 * without halos or angular bumps at sharp glyph joins.
 *
 * Loaded into the MAIN-world content script via manifest.json, and into the
 * popup via popup.html.  Touches the DOM only to build SVG elements; safe
 * in any context that has a real document.
 *
 * Exposes:
 *   CRSubFix.cueStyle.hexToRgba(hexColor, alpha)         → "rgb(...)" / "rgba(...)"
 *   CRSubFix.cueStyle.applyAlpha(cssColor, alpha)        → "rgba(...)" with new alpha
 *   CRSubFix.cueStyle.createOutlinedTextSvg(text, opts)  → SVGElement (one line)
 *   CRSubFix.cueStyle.buildGlassCss({blur, sat, hue})    → frosted-glass CSS string
 *   CRSubFix.cueStyle.sanitizeFontName(name)             → CSS-safe font-family token
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Frosted-glass background-box recipe, shared by the page-side renderer
  // (lib/cue-renderer.js) and the popup's live preview (popup.js) so the
  // preview is byte-equal to playback.  Five layers sell the "floating glass"
  // look rather than "sticker on the video":
  //   1. backdrop-filter blurs / saturates / hue-shifts the video behind the
  //      box (effective only when the box colour's alpha < 1).
  //      brightness(1.04) gives the glass a faint inner lift.
  //   2. 1px white border at 24% — outline catching the light.
  //   3. inset top white highlight — bright edge.
  //   4. inset bottom dark — depth shadow.
  //   5. inset soft glows + outer drop shadow — lifts the box off the video.
  // Returns just the CSS declarations; the caller supplies colour / radius /
  // padding and concatenates this onto them.
  function buildGlassCss({ blur, sat, hue }) {
    const filter = `blur(${blur}px) saturate(${sat}%) hue-rotate(${hue}deg) brightness(1.04)`;
    return `backdrop-filter:${filter};-webkit-backdrop-filter:${filter};` +
           `border:1px solid rgba(255,255,255,0.24);` +
           `box-shadow:` +
             `inset 0 1px 0 rgba(255,255,255,0.32),` +
             `inset 0 -1px 0 rgba(0,0,0,0.20),` +
             `inset 0 10px 18px -10px rgba(255,255,255,0.18),` +
             `inset 0 -8px 16px -10px rgba(0,0,0,0.22),` +
             `0 6px 20px rgba(0,0,0,0.38),` +
             `0 1px 2px rgba(0,0,0,0.16);`;
  }

  // Sanitize a font-family name that originates from untrusted subtitle file
  // content before it is interpolated into an inline style string.  Subtitle
  // files are served from a CDN and can be cross-linked / wrong (see CONTEXT.md
  // "Wrong-title"), so their \fn override tags and [V4+ Styles] Fontname values
  // are untrusted input.  Strip the characters that could close the quoted CSS
  // token and inject extra declarations ( ' " ` ; { } ( ) : < > \ newlines ),
  // while keeping letters (incl. non-Latin / CJK), digits, spaces, commas,
  // hyphens and periods so legitimate font names survive.
  function sanitizeFontName(name) {
    if (!name) return '';
    return String(name)
      .replace(/['"`;{}()<>:\\\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hexToRgba(hex, alpha) {
    const s = String(hex).replace('#', '');
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    if (alpha == null || alpha >= 0.99) return `rgb(${r},${g},${b})`;
    return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
  }

  // Map the bg-box vertical-padding slider value to actual CSS values.
  // Positive values keep the standard 1.6 line-height and add padding (the
  // usual interpretation).  Negative values use 0 padding and shrink the
  // line-height instead, so the bg-box can be tighter than the natural
  // line box — useful when the default leading feels too tall.
  //
  //   py =  16 → { paddingY: 16, lineHeight: 1.6 }
  //   py =   0 → { paddingY:  0, lineHeight: 1.6 }
  //   py =  -6 → { paddingY:  0, lineHeight: 0.6 }   (clamped floor)
  function resolveBgYInsets(py) {
    const v = Number(py);
    if (!isFinite(v)) return { paddingY: 0, lineHeight: 1.6 };
    if (v >= 0) return { paddingY: v, lineHeight: 1.6 };
    const lh = Math.max(0.6, 1.6 + v * (1.0 / 6));   // py=-6 → 0.6
    return { paddingY: 0, lineHeight: lh };
  }

  function applyAlpha(color, alpha) {
    if (!color || alpha == null || alpha >= 0.99) return color;
    const m = String(color).match(/rgba?\((\d+),(\d+),(\d+)/);
    if (!m) return color;
    return `rgba(${m[1]},${m[2]},${m[3]},${Math.max(0, Math.min(1, alpha)).toFixed(2)})`;
  }

  // Lazy canvas used purely for text-width measurement so we can size each
  // line's SVG viewport without committing the text to the DOM first.
  let _measureCtx = null;
  function measureWidth(text, fontShorthand) {
    if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
    _measureCtx.font = fontShorthand;
    return _measureCtx.measureText(text).width;
  }

  /**
   * Build one SVG element rendering a single line of outlined text.  Returns
   * an <svg> with display:inline-block; the caller stacks multiple lines as
   * block-level children of a wrapper div (or wraps with <br>).
   *
   * opts:
   *   text          - the line content (the function also takes it as arg 1)
   *   fillColor     - CSS color for the text fill
   *   outlineColor  - CSS color for the stroke (falsy → no stroke)
   *   bord          - outline thickness in px (clamped 0..8); 0 → no stroke
   *   fontFamily    - CSS font-family value
   *   fontSize      - CSS font-size string ("13px", "1.2em", etc.)
   *   weight        - CSS font-weight ("500", "700", ...)
   *   italic        - boolean
   *   shad          - drop-shadow offset px (clamped -8..8); 0 → no shadow
   *   shadowColor   - drop-shadow CSS color (defaults to black)
   *   soft          - true → wider Gaussian shadow; false → tight blur
   *   shadOpacity   - 0..1; overrides alpha on shadowColor when given
   *   fscx, fscy    - ASS x/y scale percent (100 = no scaling)
   */
  function createOutlinedTextSvg(text, opts) {
    opts = opts || {};
    const {
      fillColor    = 'rgb(255,255,255)',
      outlineColor = 'rgb(0,0,0)',
      bord         = 0,
      fontFamily   = 'Arial, sans-serif',
      fontSize     = '13px',
      weight       = '500',
      italic       = false,
      shad         = 0,
      shadowColor  = null,
      soft         = false,
      shadOpacity  = null,
      fscx         = 100,
      fscy         = 100,
    } = opts;

    const px  = Math.min(Math.max(0, Math.round(bord)), 8);
    const fz  = parseFloat(fontSize) || 13;
    const wt  = String(weight || '500');

    // Canvas font shorthand for measureText.
    const fontShorthand = `${italic ? 'italic ' : ''}${wt} ${fz}px ${fontFamily}`;
    const textWidth = measureWidth(text, fontShorthand);

    // Padding accounts for the stroke that extends outside the glyph plus a
    // small safety margin for italic slant / overshoot.  Total SVG height
    // matches our standard line-height of 1.6 so consecutive lines stack
    // visually like CSS text would.
    const pad        = px + Math.ceil(fz * 0.15);
    const lineHeight = 1.6;
    const svgWidth   = Math.ceil(textWidth + 2 * pad);
    const svgHeight  = Math.ceil(fz * lineHeight);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width',  String(svgWidth));
    svg.setAttribute('height', String(svgHeight));
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
    svg.setAttribute('overflow', 'visible');
    svg.style.display       = 'inline-block';
    svg.style.verticalAlign = 'middle';
    svg.style.pointerEvents = 'none';

    // Drop shadow on the SVG itself so it filters the rendered stroked
    // silhouette — the offset shadow has the same outlined shape as the
    // text, matching reference broadcast subtitles.
    const sp = Math.max(-8, Math.min(8, Math.round(shad)));
    if (sp !== 0) {
      const base  = shadowColor ?? 'rgba(0,0,0,0.8)';
      const sc    = shadOpacity != null ? applyAlpha(base, shadOpacity) : base;
      const blur  = soft ? Math.max(2, Math.abs(sp) * 1.2) : Math.abs(sp) * 0.35;
      svg.style.filter = `drop-shadow(${sp}px ${sp}px ${blur.toFixed(2)}px ${sc})`;
    }

    if (fscx !== 100 || fscy !== 100) {
      svg.style.transform = `scaleX(${fscx / 100}) scaleY(${fscy / 100})`;
    }

    const textEl = document.createElementNS(SVG_NS, 'text');
    textEl.setAttribute('x', String(pad));
    // y is the text baseline.  fz·1.25 lands the baseline roughly where it
    // sits in CSS line-box rendering at line-height 1.6 — fine-tuned by eye
    // across Arial/Helvetica/sans-serif at typical subtitle sizes.
    textEl.setAttribute('y', String(Math.round(fz * 1.25)));
    textEl.setAttribute('fill', fillColor);
    textEl.setAttribute('font-family', fontFamily);
    textEl.setAttribute('font-size',   `${fz}px`);
    textEl.setAttribute('font-weight', wt);
    if (italic) textEl.setAttribute('font-style', 'italic');
    if (px > 0) {
      textEl.setAttribute('stroke',          outlineColor);
      // stroke-width is the full vector stroke width.  Half sits inside the
      // glyph path and is covered by the fill (paint-order: stroke fill),
      // so the visible outside-the-glyph stroke is exactly px.
      textEl.setAttribute('stroke-width',    String(px * 2));
      textEl.setAttribute('stroke-linejoin', 'round');
      textEl.setAttribute('stroke-linecap',  'round');
      textEl.setAttribute('paint-order',     'stroke');
    }
    textEl.textContent = text;

    svg.appendChild(textEl);
    return svg;
  }

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.cueStyle = {
    hexToRgba, applyAlpha,
    resolveBgYInsets,
    createOutlinedTextSvg,
    buildGlassCss,
    sanitizeFontName,
  };
})();
