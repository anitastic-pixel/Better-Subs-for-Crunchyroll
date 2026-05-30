/**
 * lib/cue-renderer.js — overlay DOM + per-frame Cue rendering.
 *
 * Owns:
 *   • the overlay <div> lifecycle (create, reparent, remove)
 *   • per-cue DOM build (positioned cues and alignment-grouped cues)
 *   • outlined text rendering via lib/cue-style.js's SVG factory (one
 *     SVG <text> per cue line, with stroke-linejoin="round" for true
 *     rounded outline joins) — and bg-box mode as a styled HTML span
 *   • the cue-key cache that suppresses redundant renders
 *   • layout queries (offsetWidth/Height, getBoundingClientRect) — read once
 *     per render call and threaded through the build
 *
 * Does NOT own:
 *   • when to call render — caller drives that from timeupdate
 *   • which cues are active — caller resolves them (Episode.cuesAt)
 *   • settings — caller reads via getStyleCtx() and passes the resulting
 *     style context into render() each frame
 *
 * Public surface:
 *   const r = CRSubFix.createCueRenderer({ getSubScale })
 *   r.mount(videoEl)              — creates overlay and attaches to video parent
 *   r.unmount()                   — removes overlay and listeners
 *   r.element                     — the overlay DOM node (for external consumers)
 *   r.show() / r.hide()           — toggle display
 *   r.render(cues, t, styleCtx)   — paint cues at video time t with the given
 *                                   style context.  No-op when the visible
 *                                   (cue start/end) set is unchanged since the
 *                                   last render.
 *   r.invalidate()                — drop the cache so the next render forces a
 *                                   repaint (used when settings change)
 *   r.reposition()                — re-anchor the fixed-position fallback
 *   r.reparentForFullscreen(fsEl) — move overlay into / out of the fullscreen
 *                                   element so it stays on top of the video
 */
(function () {
  'use strict';

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  if (!NS.CRSubFix || !NS.CRSubFix.parser || !NS.CRSubFix.cueStyle) return;

  const OVERLAY_ID = 'cr-jp-cc-overlay';
  const MAX_LINES  = 3; // max text lines per non-positioned cue

  // Alignment numpad → CSS transform anchoring the box at (left, top).
  const ALIGN_XFM = {
    1: 'translate(0%,-100%)',    2: 'translate(-50%,-100%)',  3: 'translate(-100%,-100%)',
    4: 'translate(0%,-50%)',     5: 'translate(-50%,-50%)',   6: 'translate(-100%,-50%)',
    7: 'translate(0%,0%)',       8: 'translate(-50%,0%)',     9: 'translate(-100%,0%)',
  };

  const PARSER    = NS.CRSubFix.parser;
  const CUE_STYLE = NS.CRSubFix.cueStyle;
  const { applyAlpha } = PARSER;
  const { createOutlinedTextSvg, resolveBgYInsets, buildGlassCss, sanitizeFontName } = CUE_STYLE;

  function createCueRenderer({ getSubScale, getSubBottomFloor }) {
    let videoEl  = null;
    let overlayEl = null;
    let lastCueKey = '';
    let resizeHandler = null;

    function calcFontSize(cue, vw, vh) {
      const scale = getSubScale?.() ?? 1;
      if (cue.fontSize && cue.playResY) {
        return `${Math.max(10, Math.round((cue.fontSize / cue.playResY) * vh * 0.65 * scale))}px`;
      }
      return `${Math.round(Math.max(13, Math.min(vw * 0.015, 26)) * scale)}px`;
    }

    // Resolve the colour / font / outline / shadow inputs for one cue line
    // into the shape that lib/cue-style.js's SVG builder expects.  Override
    // mode forces the shadow base to black so the popup's opacity slider is
    // the sole control — otherwise the cue's ASS-defined shadowColor (which
    // can be coloured for typeset signs) would leak through.
    function resolveLineOpts(cue, fz, sc) {
      return {
        fillColor: sc.override
          ? sc.color
          : applyAlpha(cue.color ?? 'rgb(255,255,255)', cue.primaryAlpha),
        outlineColor: (sc.override ? sc.outline : cue.outlineColor) ?? 'rgb(0,0,0)',
        bord:        sc.override ? sc.bord    : (cue.bord ?? 0),
        fontFamily:  (sc.override && sc.font)
          ? sc.font
          : (cue.fontName ? `'${cue.fontName}',Arial,sans-serif` : 'Arial,sans-serif'),
        fontSize:    fz,
        weight:      cue.bold ? '700' : '500',
        italic:      !!cue.italic,
        shad:        sc.override ? sc.shad   : (cue.shad ?? 0),
        shadowColor: sc.override ? 'rgb(0,0,0)' : cue.shadowColor,
        soft:        sc.override && sc.soft,
        shadOpacity: sc.override ? sc.shadOp : null,
        fscx:        cue.fscx ?? 100,
        fscy:        cue.fscy ?? 100,
      };
    }

    // bg-box mode: a single span with a background.  No outline / stroke,
    // so it stays HTML rather than SVG.  Multi-line content uses `\n` →
    // `<br>` translation done by the caller.
    function buildBgBoxLine(text, cue, fz, sc) {
      const span = document.createElement('span');
      const color = sc.override
        ? sc.color
        : applyAlpha(cue.color ?? 'rgb(255,255,255)', cue.primaryAlpha);
      // cue.fontName comes from the subtitle file (untrusted CDN content) and is
      // interpolated into cssText below, so sanitize it first.  The override
      // font (sc.font) comes from the popup's fixed <select> and is already safe.
      const cueFont = sanitizeFontName(cue.fontName);
      const font = (sc.override && sc.font)
        ? sc.font
        : (cueFont ? `'${cueFont}',Arial,sans-serif` : 'Arial,sans-serif');
      const fscx = cue.fscx ?? 100, fscy = cue.fscy ?? 100;
      const scaleCss = (fscx !== 100 || fscy !== 100)
        ? `transform:scaleX(${fscx / 100}) scaleY(${fscy / 100});`
        : '';
      let decorCss, lineHeight;
      if (sc.override) {
        const { paddingY, lineHeight: lh } = resolveBgYInsets(sc.bgPadY);
        decorCss = `background:${sc.bgCss};border-radius:${sc.bgRadius}px;padding:${paddingY}px ${sc.bgPadX}px;`;
        // Frosted-glass layers live in lib/cue-style.js's buildGlassCss so the
        // popup preview renders the identical recipe.
        if (sc.bgGlass) {
          decorCss += buildGlassCss({ blur: sc.bgBlur, sat: sc.bgSat, hue: sc.bgHue });
        }
        lineHeight = lh;
      } else {
        decorCss = 'background:rgba(0,0,0,0.82);border-radius:3px;padding:2px 10px;';
        lineHeight = 1.6;
      }
      span.style.cssText =
        `display:inline-block;${decorCss}${scaleCss}` +
        `color:${color};font-family:${font};font-size:${fz};` +
        `font-weight:${cue.bold ? '700' : '500'};font-style:${cue.italic ? 'italic' : 'normal'};` +
        `line-height:${lineHeight};margin:1px 0;white-space:pre-wrap;`;
      span.textContent = text;
      return span;
    }

    function buildLine(text, cue, fz, sc) {
      const useBox = sc.override ? sc.bgBox : (cue.borderStyle === 3);
      if (useBox) return buildBgBoxLine(text, cue, fz, sc);
      return createOutlinedTextSvg(text, resolveLineOpts(cue, fz, sc));
    }

    function applyFades(el, cue, currentTime) {
      if (cue.fadeIn  > 0)
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: cue.fadeIn, fill: 'forwards' });
      if (cue.fadeOut > 0) {
        const delay = Math.max(0, (cue.end - currentTime) * 1000 - cue.fadeOut);
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: cue.fadeOut, delay, fill: 'forwards' });
      }
    }

    // Append a sequence of text lines into `parent`, each wrapped in a
    // block-level div so the SVG / span sits on its own line.  Wrapping
    // (rather than relying on <br>) lets us text-align each line
    // independently for grouped cues' left/center/right columns.
    function appendLines(parent, lines, cue, fz, sc, textAlign) {
      for (const line of lines) {
        const wrap = document.createElement('div');
        wrap.style.lineHeight = '1';
        if (textAlign) wrap.style.textAlign = textAlign;
        wrap.appendChild(buildLine(line, cue, fz, sc));
        parent.appendChild(wrap);
      }
    }

    function createCueEl(cue, vw, vh, currentTime, sc) {
      const el = document.createElement('div');
      const an = cue.alignment ?? 2;
      const fz = calcFontSize(cue, vw, vh);

      const xforms = [ALIGN_XFM[an] ?? ALIGN_XFM[2]];
      if (cue.frz) xforms.push(`rotate(${cue.frz}deg)`);

      Object.assign(el.style, {
        position: 'absolute', pointerEvents: 'none',
        textAlign: 'center',
        left:      `${cue.pos.x * (vw / (cue.playResX || 640))}px`,
        top:       `${cue.pos.y * (vh / (cue.playResY || 360))}px`,
        transform: xforms.join(' '),
        maxWidth:  '90%',
      });

      appendLines(el, cue.text.split('\n'), cue, fz, sc, 'center');

      applyFades(el, cue, currentTime);
      return el;
    }

    function createGroupEl(an, cues, vw, vh, currentTime, sc) {
      const col   = (an - 1) % 3;
      const row   = Math.floor((an - 1) / 3);
      const mx    = vw * 0.05;
      const first = cues[0];
      const assMy = (first?.marginV != null && first.playResY)
        ? first.marginV * (vh / first.playResY)
        : vh * 0.05;
      // Bottom-anchored cues (row 0 = numpad alignments 1/2/3) get a
      // user-controlled minimum (popup slider, 0..30 %, default 6) so
      // they clear Crunchyroll's playbar chrome.  Honour ASS-specified
      // marginV when it's larger.  Middle and top rows aren't affected.
      const floorPct    = getSubBottomFloor?.() ?? 6;
      const bottomFloor = vh * (floorPct / 100);
      const my = row === 0 ? Math.max(assMy, bottomFloor) : assMy;

      const x = col === 0 ? mx : col === 1 ? vw / 2 : vw - mx;
      const y = row === 0 ? vh - my : row === 1 ? vh / 2 : my;
      const lineAlign = col === 0 ? 'left' : col === 2 ? 'right' : 'center';

      const container = document.createElement('div');
      Object.assign(container.style, {
        position:      'absolute',
        left:          `${x}px`,
        top:           `${y}px`,
        transform:     ALIGN_XFM[an] ?? ALIGN_XFM[2],
        maxWidth:      '90%',
        display:       'flex',
        flexDirection: 'column',
        alignItems:    col === 0 ? 'flex-start' : col === 2 ? 'flex-end' : 'center',
        gap:           '4px',
        pointerEvents: 'none',
      });

      for (const cue of cues) {
        const fz    = calcFontSize(cue, vw, vh);
        const lines = cue.text.split('\n').slice(0, MAX_LINES);

        const cueEl = document.createElement('div');
        cueEl.style.textAlign = lineAlign;
        if (cue.frz) cueEl.style.transform = `rotate(${cue.frz}deg)`;

        appendLines(cueEl, lines, cue, fz, sc, lineAlign);

        applyFades(cueEl, cue, currentTime);
        container.appendChild(cueEl);
      }

      return container;
    }

    function ensureOverlay() {
      let el = document.getElementById(OVERLAY_ID);
      if (el) return el;
      el = document.createElement('div');
      el.id = OVERLAY_ID;
      Object.assign(el.style, {
        position:      'absolute',
        top:           '0',
        left:          '0',
        width:         '100%',
        height:        '100%',
        pointerEvents: 'none',
        // Just above the <video> element, but well below Crunchyroll's
        // player chrome — so the scrub-preview thumbnail and controls
        // render over the subtitles like CR's own subs do, instead of
        // the subs popping through.  Was 2147483640 to clip-defeat
        // any chrome; that intent is no longer wanted.
        zIndex:        '2',
        display:       'none',
        overflow:      'hidden',
      });

      // Anchor inside the video's parent so the overlay tracks it automatically —
      // no coordinate math needed and immune to ancestor CSS transforms that
      // break position:fixed.
      const parent = videoEl?.parentElement;
      if (parent) {
        if (window.getComputedStyle(parent).position === 'static') {
          parent.style.position = 'relative';
        }
        parent.appendChild(el);
      } else {
        (document.body || document.documentElement).appendChild(el);
      }
      return el;
    }

    function reposition() {
      if (!overlayEl || !videoEl) return;
      const p = overlayEl.parentElement;
      if (p === document.body || p === document.documentElement) {
        const r = videoEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          Object.assign(overlayEl.style, {
            position: 'fixed',
            left: r.left + 'px', top: r.top + 'px',
            width: r.width + 'px', height: r.height + 'px',
          });
        }
      }
    }

    function reparentForFullscreen(fsEl) {
      if (!overlayEl) return;
      const target = fsEl ?? videoEl?.parentElement ?? document.body;
      if (overlayEl.parentElement !== target) {
        if (fsEl && window.getComputedStyle(fsEl).position === 'static') {
          fsEl.style.position = 'relative';
        }
        target.appendChild(overlayEl);
      }
    }

    function mount(v) {
      videoEl = v;
      overlayEl = ensureOverlay();
      lastCueKey = '';
      if (!resizeHandler) {
        resizeHandler = () => reposition();
        window.addEventListener('resize', resizeHandler);
      }
      return overlayEl;
    }

    function unmount() {
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
      }
      const el = document.getElementById(OVERLAY_ID);
      if (el) el.remove();
      overlayEl = null;
      videoEl = null;
      lastCueKey = '';
    }

    function show() { if (overlayEl) overlayEl.style.display = 'block'; }
    function hide() {
      if (overlayEl) {
        overlayEl.style.display = 'none';
        overlayEl.innerHTML = '';
      }
      lastCueKey = '';
    }

    function invalidate() { lastCueKey = ''; }

    function render(cues, currentTime, styleCtx) {
      if (!overlayEl) return;
      if (cues.length === 0) { overlayEl.style.display = 'none'; return; }

      // Cue-key cache suppresses redundant renders.  Includes the style
      // context's values so that when settings change (popup → content.js
      // → data attr → MutationObserver → render) we don't accept the
      // stale cue-key as identical and skip the repaint.  Object.values
      // preserves insertion order, and styleCtx is a flat literal built
      // by captureStyleCtx, so the join is deterministic.
      const cueKey = cues.map(c => `${c.start}:${c.end}`).join('|');
      const ctxKey = styleCtx ? Object.values(styleCtx).join('|') : '';
      const key = `${ctxKey}||${cueKey}`;
      if (key === lastCueKey) return;
      lastCueKey = key;

      reposition();
      const vw = overlayEl.offsetWidth  || videoEl?.getBoundingClientRect().width  || window.innerWidth;
      const vh = overlayEl.offsetHeight || videoEl?.getBoundingClientRect().height || window.innerHeight;

      overlayEl.style.display = 'block';
      overlayEl.innerHTML = '';

      for (const cue of cues) {
        if (cue.pos) overlayEl.appendChild(createCueEl(cue, vw, vh, currentTime, styleCtx));
      }

      const byAlignment = {};
      for (const cue of cues) {
        if (cue.pos) continue;
        const an = cue.alignment ?? 2;
        (byAlignment[an] ??= []).push(cue);
      }
      for (const [an, group] of Object.entries(byAlignment)) {
        overlayEl.appendChild(createGroupEl(parseInt(an), group, vw, vh, currentTime, styleCtx));
      }
    }

    return {
      mount, unmount,
      show, hide,
      render, invalidate,
      reposition, reparentForFullscreen,
      get element() { return overlayEl; },
    };
  }

  NS.CRSubFix.createCueRenderer = createCueRenderer;
})();
