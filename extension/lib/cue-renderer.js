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

  // Matching transform-origin so \frz/\fr rotation pivots at the alignment
  // anchor (the \pos point), the way ASS rotates — not the CSS-default centre.
  const ALIGN_ORIGIN = {
    1: '0% 100%',  2: '50% 100%', 3: '100% 100%',
    4: '0% 50%',   5: '50% 50%',  6: '100% 50%',
    7: '0% 0%',    8: '50% 0%',   9: '100% 0%',
  };

  const PARSER    = NS.CRSubFix.parser;
  const CUE_STYLE = NS.CRSubFix.cueStyle;
  const { applyAlpha } = PARSER;
  const { createOutlinedTextSvg, resolveBgYInsets, buildGlassCss, sanitizeFontName } = CUE_STYLE;

  function createCueRenderer({ getSubScale, getSubBottomFloor }) {
    let videoEl  = null;
    let overlayEl = null;
    // While the video is PAUSED the dialogue bands become text-selectable
    // (flashcards, dictionary lookups): the caller flips this via
    // setSelectable(paused).  Playing keeps bands pointer-transparent so a
    // click on the subtitle still reaches Crunchyroll's pause layer, and the
    // overlay stays under CR's chrome (selection mid-playback is futile
    // anyway — the next render replaces the DOM and drops it).
    let selectable = false;
    let lastCueKey = '';
    // Memo for the style-context portion of the cache key: the caller hands back
    // the SAME styleCtx object reference until settings change, so we stringify
    // it only when the reference actually changes — not on every frame.
    let ctxMemoRef = null, ctxMemoStr = '';
    let resizeHandler = null;

    // Per-render cache of the localStorage tuning reads below.  signTune() alone
    // is read 3× per positioned sign; on a scene with many \pos signs that's
    // dozens of synchronous localStorage hits per repaint.  render() resets this
    // to {} at the top of each repaint, so the values are read at most once per
    // key per frame and still pick up live tuning-slider changes next frame.
    let _lsFrame = null;
    function lsNum(key) {
      if (_lsFrame && key in _lsFrame) return _lsFrame[key];
      let v = NaN;
      try { v = parseFloat(localStorage.getItem(key)); } catch (_) {}
      if (_lsFrame) _lsFrame[key] = v;
      return v;
    }

    // Typeset (\pos) signs pass trueSize=true: they render near the EXACT ASS
    // size (no readability fudge, no user size slider) so they match the video's
    // native typeset.  CR renders a hair smaller than pure libass, so a tunable
    // sign factor (default 0.9, crSubFixDebug.signScale(x)) trims it.  Dialogue
    // keeps the 0.65 readability factor and the user's size preference.
    function signScale() {
      const v = lsNum('crSubFix_signscale'); if (v > 0 && v <= 2) return v;
      return 0.9;
    }
    // CSS perspective distance (px) for \frx/\fry 3-D rotation.  Scales with the
    // rendered video height (libass projects in PlayRes space, so the focal
    // length must scale with the video) — default ≈ 1× video height.  A
    // localStorage override (the tuning slider) wins, for display-specific dial-in.
    function signPersp(boxH) {
      const v = lsNum('crSubFix_persp'); if (v > 0) return v;
      return Math.round((boxH || 1018) * 1.0);
    }
    // Live tuning multipliers on the file's transform values (1 = faithful),
    // driven by the in-player Typeset-tuning sliders (localStorage crSubFix_ts_*).
    function signTune(key, def) {
      const v = lsNum('crSubFix_ts_' + key); if (v >= 0) return v;
      return def;
    }
    function calcFontSize(cue, vw, vh, trueSize) {
      const scale = trueSize ? 1 : (getSubScale?.() ?? 1);
      const fudge = trueSize ? signScale() : 0.65;
      if (cue.fontSize && cue.playResY) {
        return `${Math.max(8, Math.round((cue.fontSize / cue.playResY) * vh * fudge * scale))}px`;
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

    // `sc` is the style profile for THIS cue's type — render() passes the sign
    // profile to positioned cues and the dialogue profile to grouped cues, so a
    // sign with override off renders native (authored colour + outline).
    function buildLine(text, cue, fz, sc) {
      const useBox = sc.override ? sc.bgBox : (cue.borderStyle === 3);
      if (useBox) return buildBgBoxLine(text, cue, fz, sc);
      return createOutlinedTextSvg(text, resolveLineOpts(cue, fz, sc));
    }

    // Time-aware fades.  The overlay is torn down + rebuilt whenever ANY active
    // cue changes, so a naive 0→1 fade re-fires on every rebuild and makes all
    // faded signs flicker in typeset-heavy scenes.  Only animate the fade-in
    // while the cue is still INSIDE its fade window (resuming from the current
    // progress); an already-visible cue just renders solid.
    function applyFades(el, cue, currentTime) {
      if (cue.fadeIn > 0) {
        const sinceMs = (currentTime - cue.start) * 1000;
        if (sinceMs < cue.fadeIn) {
          const from = Math.max(0, Math.min(1, sinceMs / cue.fadeIn));
          el.animate([{ opacity: from }, { opacity: 1 }],
                     { duration: Math.max(1, cue.fadeIn - sinceMs), fill: 'forwards' });
        }
        // else: past the fade-in window — leave at full opacity (no re-flash).
      }
      if (cue.fadeOut > 0) {
        const delay = Math.max(0, (cue.end - currentTime) * 1000 - cue.fadeOut);
        el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: cue.fadeOut, delay, fill: 'forwards' });
      }
    }

    // The displayed video CONTENT box within the overlay, accounting for
    // letterbox/pillarbox (object-fit: contain).  On a matching aspect (most
    // 16:9 fullscreen / windowed cases) this is the full overlay — a no-op — so
    // positioning only changes on non-16:9 displays where bars exist.
    function videoContentBox(overlay, video) {
      const w = overlay.offsetWidth, h = overlay.offsetHeight;
      const vW = video?.videoWidth, vH = video?.videoHeight;
      if (!vW || !vH || !w || !h) return { x: 0, y: 0, w, h };
      const elAspect = w / h, vidAspect = vW / vH;
      if (Math.abs(elAspect - vidAspect) < 0.01) return { x: 0, y: 0, w, h };
      if (elAspect > vidAspect) {            // bars left/right (pillarbox)
        const cw = h * vidAspect;
        return { x: (w - cw) / 2, y: 0, w: cw, h };
      }
      const ch = w / vidAspect;              // bars top/bottom (letterbox)
      return { x: 0, y: (h - ch) / 2, w, h: ch };
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

    function createCueEl(cue, box, currentTime, sc) {
      const el = document.createElement('div');
      const an = cue.alignment ?? 2;
      const fz = calcFontSize(cue, box.w, box.h, true);  // \pos sign → true ASS size

      // ASS is font-space (Y-UP, CCW), CSS is Y-DOWN/CW, so 2-D signs are NEGATED
      // to match libass: \frz θ ≡ rotate(-θ), \fax f ≡ skewX(-atan f).  \frx/\fry
      // are true 3-D rotation (perspective foreshortening) — rendered with a
      // perspective() projection; their signs (and the persp distance) are tuned
      // visually.  CSS list is evaluated right-to-left, so perspective (leftmost)
      // projects the fully-rotated geometry last.
      const has3D = cue.frx || cue.fry;
      const rotMul = signTune('rot', 1), d3Mul = signTune('3d', 1), skewMul = signTune('skew', 1);
      const xforms = [];
      if (has3D) xforms.push(`perspective(${signPersp(box.h)}px)`);
      xforms.push(ALIGN_XFM[an] ?? ALIGN_XFM[2]);
      // Rotation order matches ASS (Rz·Ry·Rx — X applied first): list rotateY
      // BEFORE rotateX so CSS (right-to-left) applies X, then Y, then Z.
      if (cue.frz) xforms.push(`rotate(${(-cue.frz * rotMul).toFixed(2)}deg)`);
      if (cue.fry) xforms.push(`rotateY(${(cue.fry * d3Mul).toFixed(2)}deg)`);
      if (cue.frx) xforms.push(`rotateX(${(-cue.frx * d3Mul).toFixed(2)}deg)`);
      if (cue.fax) xforms.push(`skewX(${(-Math.atan(cue.fax * skewMul) * 180 / Math.PI).toFixed(2)}deg)`);
      if (cue.fay) xforms.push(`skewY(${(-Math.atan(cue.fay * skewMul) * 180 / Math.PI).toFixed(2)}deg)`);

      Object.assign(el.style, {
        position: 'absolute', pointerEvents: 'none',
        textAlign: 'center',
        left:      `${box.x + cue.pos.x * (box.w / (cue.playResX || 640))}px`,
        top:       `${box.y + cue.pos.y * (box.h / (cue.playResY || 360))}px`,
        transform: xforms.join(' '),
        transformOrigin: ALIGN_ORIGIN[an] ?? '50% 100%',
        maxWidth:  '90%',
      });
      // Tag with the source coordinates so crSubFixDebug.geom() can correlate
      // the rendered box back to the ASS \pos / PlayRes for positioning checks.
      el.dataset.crpos = `${cue.pos.x},${cue.pos.y}`;
      el.dataset.crres = `${cue.playResX || 640}x${cue.playResY || 360}`;
      el.dataset.cran  = String(an);

      appendLines(el, cue.text.split('\n'), cue, fz, sc, 'center');

      applyFades(el, cue, currentTime);
      return el;
    }

    function createGroupEl(an, cues, box, currentTime, sc) {
      const col   = (an - 1) % 3;
      const row   = Math.floor((an - 1) / 3);
      const mx    = box.w * 0.05;
      const first = cues[0];
      const assMy = (first?.marginV != null && first.playResY)
        ? first.marginV * (box.h / first.playResY)
        : box.h * 0.05;
      // Bottom-anchored cues (row 0 = numpad alignments 1/2/3) get a
      // user-controlled minimum (popup slider, 0..30 %, default 6) so
      // they clear Crunchyroll's playbar chrome.  Honour ASS-specified
      // marginV when it's larger.  Middle and top rows aren't affected.
      const floorPct    = getSubBottomFloor?.() ?? 6;
      const bottomFloor = box.h * (floorPct / 100);
      const my = row === 0 ? Math.max(assMy, bottomFloor) : assMy;

      const x = box.x + (col === 0 ? mx : col === 1 ? box.w / 2 : box.w - mx);
      const y = box.y + (row === 0 ? box.h - my : row === 1 ? box.h / 2 : my);
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
      });
      container.dataset.crBand = '1';
      applyBandSelectability(container);

      for (const cue of cues) {
        const fz    = calcFontSize(cue, box.w, box.h);
        const lines = cue.text.split('\n').slice(0, MAX_LINES);

        const cueEl = document.createElement('div');
        cueEl.style.textAlign = lineAlign;
        if (cue.frz) {
          cueEl.style.transform = `rotate(${-cue.frz}deg)`;  // ASS CCW → CSS CW
          cueEl.style.transformOrigin = ALIGN_ORIGIN[an] ?? '50% 100%';
        }

        appendLines(cueEl, lines, cue, fz, sc, lineAlign);

        applyFades(cueEl, cue, currentTime);
        container.appendChild(cueEl);
      }

      return container;
    }

    // Dual subtitles: a second locale's dialogue, rendered as a bottom-centred
    // band sitting just ABOVE the primary bottom dialogue.  Built like the
    // alignment-2 group but anchored via `bottom` (set by positionSecondaryBand
    // after the primary is measured) so it stacks without overlap on any aspect.
    function buildSecondaryBand(cues, box, currentTime, sc) {
      const band = document.createElement('div');
      Object.assign(band.style, {
        position:      'absolute',
        left:          '50%',
        transform:     'translateX(-50%)',
        maxWidth:      '90%',
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'center',
        gap:           '4px',
        textAlign:     'center',
      });
      band.dataset.crBand = '1';
      applyBandSelectability(band);
      for (const cue of cues) {
        const fz    = calcFontSize(cue, box.w, box.h);
        const lines = cue.text.split('\n').slice(0, MAX_LINES);
        const cueEl = document.createElement('div');
        cueEl.style.textAlign = 'center';
        appendLines(cueEl, lines, cue, fz, sc, 'center');
        applyFades(cueEl, cue, currentTime);
        band.appendChild(cueEl);
      }
      return band;
    }

    // Place the secondary band's bottom edge just above the primary bottom
    // group's top (measured), so dual lines stack cleanly.  Falls back to the
    // bottom-margin floor + ~one line when there's no primary bottom group.
    function positionSecondaryBand(band, box, primaryBottomEl) {
      const gap = Math.max(4, box.h * 0.012);
      if (primaryBottomEl) {
        const oRect = overlayEl.getBoundingClientRect();
        const pRect = primaryBottomEl.getBoundingClientRect();
        band.style.bottom = `${Math.round((oRect.bottom - pRect.top) + gap)}px`;
      } else {
        const overlayH = overlayEl.offsetHeight || box.h;
        const floorPct = getSubBottomFloor?.() ?? 6;
        const fromBottom = (overlayH - (box.y + box.h)) + box.h * (floorPct / 100) + box.h * 0.07;
        band.style.bottom = `${Math.round(fromBottom)}px`;
      }
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
        // Sit ABOVE the <video> (it's absolutely positioned over it) but BELOW
        // all of Crunchyroll's player chrome — controls AND the scrub-preview
        // thumbnail — so they render over the subtitles like CR's own subs do.
        // z-index 0 (not 2): the chrome layers are positive-z-index, and at 2 the
        // subs popped through the hover preview.  Was 2147483640 originally to
        // clip-defeat chrome; that intent is no longer wanted.  (While paused,
        // setSelectable raises this to 2 so the bands can take text selection.)
        zIndex:        selectable ? '2' : '0',
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
      // Keep the overlay in the video's own parent when that parent is already
      // inside the fullscreen element (the usual case) — hoisting it up to the
      // fullscreen element's top level would, by DOM order, stack the subtitles
      // ABOVE the player controls + scrub preview (the windowed z-index:0 only
      // works because the overlay sits in a sub-container below the chrome).
      // Only reparent to fsEl when the video's parent isn't contained in it, so
      // the overlay would otherwise fall outside the fullscreen view.
      const pref = videoEl?.parentElement;
      const target = fsEl
        ? ((pref && fsEl.contains(pref)) ? pref : fsEl)
        : (pref ?? document.body);
      if (overlayEl.parentElement !== target) {
        if (target !== document.body && window.getComputedStyle(target).position === 'static') {
          target.style.position = 'relative';
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

    function render(cues, currentTime, styleCtx, secondaryCues) {
      if (!overlayEl) return;
      const hasSecondary = !!(secondaryCues && secondaryCues.length);
      if (cues.length === 0 && !hasSecondary) { overlayEl.style.display = 'none'; return; }

      // styleCtx is { dialogue, signs } — two flat profiles.  Split them; each
      // builder gets its own so signs and dialogue style independently.  The
      // secondary band uses the dialogue profile (it's dialogue from another
      // locale), so the user's style override applies to both lines.
      const dlgCtx  = (styleCtx && styleCtx.dialogue) || { override: false };
      const signCtx = (styleCtx && styleCtx.signs)    || { override: false };

      // Cue-key cache suppresses redundant renders.  Includes BOTH profiles plus
      // the secondary cues so a settings change or a secondary line in/out busts
      // the cache and repaints; JSON.stringify of the flat literals is deterministic.
      const cueKey = cues.map(c => `${c.start}:${c.end}`).join('|');
      const secKey = hasSecondary ? secondaryCues.map(c => `${c.start}:${c.end}`).join('|') : '';
      let ctxKey = '';
      if (styleCtx) {
        if (styleCtx === ctxMemoRef) ctxKey = ctxMemoStr;
        else { ctxKey = JSON.stringify(styleCtx); ctxMemoRef = styleCtx; ctxMemoStr = ctxKey; }
      }
      const key = `${ctxKey}||${cueKey}||S:${secKey}`;
      if (key === lastCueKey) return;
      lastCueKey = key;
      _lsFrame = {};   // fresh per-repaint cache for the localStorage tuning reads

      reposition();
      // Map cues to the actual displayed video content (handles letterbox /
      // pillarbox on non-16:9 displays); falls back to the full overlay box.
      const fbW = overlayEl.offsetWidth  || videoEl?.getBoundingClientRect().width  || window.innerWidth;
      const fbH = overlayEl.offsetHeight || videoEl?.getBoundingClientRect().height || window.innerHeight;
      const box = videoContentBox(overlayEl, videoEl);
      if (!box.w || !box.h) { box.x = 0; box.y = 0; box.w = fbW; box.h = fbH; }

      overlayEl.style.display = 'block';
      overlayEl.innerHTML = '';

      for (const cue of cues) {
        if (cue.pos) overlayEl.appendChild(createCueEl(cue, box, currentTime, signCtx));
      }

      // Grouped dialogue by alignment; remember the bottom-centre (an=2) group so
      // the secondary band can be stacked directly above it.
      let primaryBottomEl = null;
      const byAlignment = {};
      for (const cue of cues) {
        if (cue.pos) continue;
        const an = cue.alignment ?? 2;
        (byAlignment[an] ??= []).push(cue);
      }
      for (const [an, group] of Object.entries(byAlignment)) {
        const el = createGroupEl(parseInt(an), group, box, currentTime, dlgCtx);
        overlayEl.appendChild(el);
        if (parseInt(an) === 2) primaryBottomEl = el;
      }

      if (hasSecondary) {
        const band = buildSecondaryBand(secondaryCues, box, currentTime, dlgCtx);
        overlayEl.appendChild(band);
        positionSecondaryBand(band, box, primaryBottomEl);
      }
    }

    // One band's selection styling, from the current `selectable` flag.
    function applyBandSelectability(el) {
      Object.assign(el.style, {
        pointerEvents: selectable ? 'auto' : 'none',
        userSelect:    selectable ? 'text' : 'none',
        cursor:        selectable ? 'text' : '',
      });
    }

    // Paused → selectable: raise the overlay above CR's chrome (z 2 — the same
    // level that made subs pop through the scrub-preview thumbnail, which is
    // the accepted cosmetic cost WHILE PAUSED) and open the bands to pointer
    // events.  Playing → restore z 0 / pointer-transparent.  Applies to the
    // bands already on screen too — while paused there's no timeupdate to
    // rebuild them.
    function setSelectable(on) {
      selectable = !!on;
      if (overlayEl) {
        overlayEl.style.zIndex = selectable ? '2' : '0';
        overlayEl.querySelectorAll('[data-cr-band]').forEach(applyBandSelectability);
      }
    }

    return {
      mount, unmount,
      show, hide,
      render, invalidate,
      reposition, reparentForFullscreen,
      setSelectable,
      get element() { return overlayEl; },
    };
  }

  NS.CRSubFix.createCueRenderer = createCueRenderer;
})();
