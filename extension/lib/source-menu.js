/**
 * lib/source-menu.js — the in-player Source picker (▾ button + dropdown).
 *
 * Reads the live Episode's Catalog (versions + per-locale validation) and
 * lets the user pick a Source.  Selection turns into a callback
 * (onSelectLocale) — this module does not know about overlay activation,
 * the JP CC button, or fetch.
 *
 * Public surface:
 *   const menu = CRSubFix.createSourceMenu({
 *     getEpisode,          // () → Episode or null
 *     isOverlayActive,     // () → boolean
 *     localeLabels,        // { 'ja-JP': 'Japanese', ... }
 *     onSelectLocale,      // (locale) → void
 *     onTurnOff,           // () → void  (called when user picks Off)
 *     onSelectCustom,      // (id) → void  (pick an uploaded / translated track)
 *     onLoadFile,          // () → void  (open the file picker)
 *     onRemoveCustom,      // (id) → void  (delete a custom source)
 *     onAdjustSync,        // (id) → void  (open the two-point sync panel)
 *     onExport,            // () → void  (download the active custom source as SRT)
 *     onTranslate,         // () → void  (generate a machine-translated track)
 *     getTranslateAction,  // () → { label } | null  (show the translate row?)
 *     onClearMt,           // () → void  (drop all machine-translated tracks)
 *     getClearMtAction,    // () → { label } | null  (show the clear-MT row?)
 *     onCancelTranslate,   // () → void  (cancel an in-progress translation)
 *     getCancelAction,     // () → { label } | null  (show the cancel row?)
 *     onMtSettings,        // () → void  (open the translation settings panel)
 *     getMtSettingsAction, // () → { label } | null  (show the ⚙ settings row?)
 *     onApplyLearning,     // (nativeLocale) → void  (set the audio+native stack)
 *     getLearningInfo,     // () → { audioLocale, audioLabel, audioHasSub, native }
 *   });
 *   menu.injectButton(found, afterBtn)   // adds the ▾ button to controls
 *   menu.removeButton()                  // removes the ▾ button
 *   menu.updateButtonVisibility()        // hide ▾ when only one version
 *   menu.close()                         // close the dropdown if open
 *   menu.updateRow(locale, validation)   // patch one open-menu row in place
 */
(function () {
  'use strict';

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  if (!NS.CRSubFix || !NS.CRSubFix.uiTheme) return;

  const MENU_BTN_ID = 'cr-bsub-menu-btn';
  const MENU_ID     = 'cr-bsub-menu';
  const LOG         = '[CR Sub Fix]';
  const THEME       = NS.CRSubFix.uiTheme.tokens;
  const panelStyle  = NS.CRSubFix.uiTheme.panel;

  function createSourceMenu({
    getEpisode, isOverlayActive,
    localeLabels = {},
    onSelectLocale, onTurnOff,
    onSelectCustom, onLoadFile, onRemoveCustom, onAdjustSync, onExport,
    onAdjustTiming, getAdjustTimingAction,
    onTranslate, getTranslateAction, onClearMt, getClearMtAction,
    onCancelTranslate, getCancelAction, onMtSettings, getMtSettingsAction,
    onSelectSecondary, getSecondary,
    onSetSignSource, getSignSource, getSecondaryHasSigns,
    getLayer, onSetLayer,
    onApplyLearning, getLearningInfo,
  }) {
    let outsideHandler = null;
    let escapeHandler  = null;
    // Which screen the dropdown is showing: the source picker, or one of the
    // submenus ('learn' = learning mode / second subtitle, 'show' = per-layer
    // visibility, 'manage' = the action verbs).  Always reset to 'sources' on close.
    let view           = 'sources';
    let pendingBind    = null;   // setTimeout id for the deferred document-listener bind
    let positionedTarget = null; // CR container we flipped to position:relative (to revert)

    function close() {
      view = 'sources';  // next open starts on the main source list
      document.getElementById(MENU_ID)?.remove();
      // Cancel a not-yet-fired deferred bind, else it would attach the outside/
      // Escape listeners to `document` AFTER the menu is gone — orphaned, since
      // close() already cleared the handler refs it would remove.
      if (pendingBind) { clearTimeout(pendingBind); pendingBind = null; }
      if (outsideHandler) {
        document.removeEventListener('click', outsideHandler, true);
        outsideHandler = null;
      }
      if (escapeHandler) {
        document.removeEventListener('keydown', escapeHandler);
        escapeHandler = null;
      }
      // Restore the player container's positioning we changed on open, so we
      // don't permanently mutate CR's layout (which can shift its own
      // absolutely-positioned controls).
      if (positionedTarget) { positionedTarget.style.position = ''; positionedTarget = null; }
    }

    // true/false/null availability for a locale.  ja-JP is owned by the
    // Episode's JP-first session fetch (catalog doesn't see it); everything
    // else routes through the catalog.
    function localeHasContent(ep, locale) {
      if (!ep) return false;
      if (locale === 'ja-JP') {
        if (ep.jpCaptionUrl || ep.jpSubtitleUrl) return true;
        return ep.jpGuid ? null : false;
      }
      return ep.catalog.availability(locale);
    }

    // Display label for a locale row.  Appends "(CC)" when the pick will serve
    // the dub's own closed captions — the current audio's locale with a
    // captions-sourced entry (urlFor's same-language policy in
    // lib/subtitle-catalog.js) — mirroring CR's own "English (CC)" naming so
    // dub watchers find the track they expect.
    function localeRowLabel(ep, locale) {
      const base  = localeLabels[locale] ?? locale;
      const audio = ep?.catalog.currentAudio();
      return (audio && audio !== 'ja-JP' && locale === audio &&
              ep.catalog.captionSourced?.(audio, locale)) ? `${base} (CC)` : base;
    }

    function makeRow(label, isActive, hasContent, onClick, validation, locale) {
      const unavail = hasContent === false;
      const isWrong = validation === 'wrong-title';
      const row = document.createElement('div');
      if (locale)  row.dataset.locale  = locale;
      if (isActive) row.dataset.active = 'true';
      if (unavail)  row.dataset.unavail = 'true';
      Object.assign(row.style, {
        padding:      '7px 14px',
        cursor:       unavail ? 'default' : 'pointer',
        fontSize:     '13px',
        fontFamily:   THEME.font,
        color:        isActive ? THEME.accent : unavail ? THEME.textMuted : isWrong ? THEME.warn : THEME.text,
        fontWeight:   isActive ? '700' : '400',
        background:   'transparent',
        userSelect:   'none',
        whiteSpace:   'nowrap',
        display:      'flex',
        alignItems:   'center',
        gap:          '8px',
        borderRadius: '3px',
      });
      const check = document.createElement('span');
      check.textContent = isActive ? '✓' : '';
      check.style.cssText = 'width:14px;text-align:center;font-size:11px;flex-shrink:0;';
      const text = document.createElement('span');
      text.textContent = label;
      row.appendChild(check);
      row.appendChild(text);
      if (unavail) {
        const tag = document.createElement('span');
        tag.textContent = 'no subs';
        tag.style.cssText = 'font-size:10px;color:#444;margin-left:auto;padding-left:8px;flex-shrink:0;';
        row.appendChild(tag);
      } else if (validation === 'no-subs') {
        const tag = document.createElement('span');
        tag.dataset.vtag = '1';
        tag.textContent = 'no subs';
        tag.style.cssText = 'font-size:10px;color:#555;margin-left:auto;padding-left:8px;flex-shrink:0;';
        row.appendChild(tag);
      } else if (isWrong) {
        const tag = document.createElement('span');
        tag.dataset.vtag = '1';
        tag.textContent = '⚠ wrong title';
        tag.style.cssText = 'font-size:10px;color:#cc9900;margin-left:auto;padding-left:8px;flex-shrink:0;';
        row.appendChild(tag);
      }
      // Valid / active rows carry NO badge — validity is flagged only when
      // there's a problem (wrong-title / no-subs).  The active row is marked by
      // its accent colour + leading ✓, so the list stays clean (Concept 4).
      if (!unavail) {
        row.addEventListener('mouseenter', () => { row.style.background = THEME.rowHover; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      }
      // "no subs" rows read as disabled — a click must not fire the select
      // action (which would wipe the saved locale pref and swap the subs),
      // but still swallow the event so the menu doesn't close underneath.
      row.addEventListener('click', e => { e.stopPropagation(); if (!unavail) onClick(); });
      return row;
    }

    // Row for a custom source: label + a small kind badge (file/machine) and a
    // hover-revealed × to remove it.  Kept separate from makeRow so the CR-locale
    // validation-badge logic stays untouched.
    function makeCustomRow(label, isActive, badge, onClick, onRemove) {
      const row = document.createElement('div');
      row.dataset.custom = 'true';
      if (isActive) row.dataset.active = 'true';
      Object.assign(row.style, {
        padding: '7px 14px', cursor: 'pointer', fontSize: '13px',
        fontFamily: THEME.font, color: isActive ? THEME.accent : THEME.text,
        fontWeight: isActive ? '700' : '400', background: 'transparent',
        userSelect: 'none', whiteSpace: 'nowrap', display: 'flex',
        alignItems: 'center', gap: '8px', borderRadius: '3px',
      });
      const check = document.createElement('span');
      check.textContent = isActive ? '✓' : '';
      check.style.cssText = 'width:14px;text-align:center;font-size:11px;flex-shrink:0;';
      const text = document.createElement('span');
      text.textContent = label;
      text.style.cssText = 'overflow:hidden;text-overflow:ellipsis;max-width:150px;';
      const tag = document.createElement('span');
      tag.textContent = badge;
      tag.style.cssText = `font-size:10px;color:${badge === 'machine' ? '#b08cff' : '#7fcfff'};margin-left:auto;padding-left:8px;flex-shrink:0;`;
      // Always-visible remove button (a small ✕ chip), so it doesn't depend on
      // hover discovery.  Turns red on its own hover.
      const del = document.createElement('span');
      del.textContent = '✕';
      del.title = 'Remove this source';
      del.style.cssText = 'font-size:11px;color:#bbb;margin-left:6px;padding:1px 6px;flex-shrink:0;' +
        'border:1px solid rgba(255,255,255,0.25);border-radius:3px;background:rgba(255,255,255,0.06);cursor:pointer;transition:background 0.12s,color 0.12s,border-color 0.12s;';
      del.addEventListener('mouseenter', e => { e.stopPropagation(); del.style.background = 'rgba(229,85,85,0.3)'; del.style.color = '#fff'; del.style.borderColor = '#e55'; });
      del.addEventListener('mouseleave', () => { del.style.background = 'rgba(255,255,255,0.06)'; del.style.color = '#bbb'; del.style.borderColor = 'rgba(255,255,255,0.25)'; });
      row.appendChild(check);
      row.appendChild(text);
      row.appendChild(tag);
      row.appendChild(del);
      row.addEventListener('mouseenter', () => { row.style.background = THEME.rowHover; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      del.addEventListener('click', e => { e.stopPropagation(); onRemove?.(); });
      row.addEventListener('click', e => { e.stopPropagation(); onClick(); });
      return row;
    }

    // Plain action row (e.g. "Load subtitle file…") — no check column, no badge.
    function makeActionRow(label, onClick) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        padding: '7px 14px 7px 36px', cursor: 'pointer', fontSize: '12px',
        fontFamily: THEME.font, color: THEME.textDim, fontWeight: '500',
        background: 'transparent', userSelect: 'none', whiteSpace: 'nowrap',
        borderRadius: '3px',
      });
      row.textContent = label;
      row.addEventListener('mouseenter', () => { row.style.background = THEME.rowHover; row.style.color = THEME.text; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; row.style.color = THEME.textDim; });
      row.addEventListener('click', e => { e.stopPropagation(); onClick(); });
      return row;
    }

    function updateRow(locale, validation) {
      const menu = document.getElementById(MENU_ID);
      if (!menu) return;
      const row = menu.querySelector(`[data-locale="${locale}"]`);
      if (!row) return;

      const isWrong  = validation === 'wrong-title';
      const isActive = row.dataset.active === 'true';
      const unavail  = row.dataset.unavail === 'true';

      if (!isActive && !unavail) {
        row.style.color = isWrong ? '#cc9900' : '#e0e0e0';
      }

      let tag = row.querySelector('[data-vtag]');
      function ensureTag() {
        if (tag) return tag;
        tag = document.createElement('span');
        tag.dataset.vtag = '1';
        tag.style.cssText = 'font-size:10px;margin-left:auto;padding-left:8px;flex-shrink:0;';
        row.appendChild(tag);
        return tag;
      }

      if (isWrong) {
        ensureTag().textContent = '⚠ wrong title';
        tag.style.color = '#cc9900';
      } else if (validation === 'no-subs' && !unavail) {
        ensureTag().textContent = 'no subs';
        tag.style.color = '#555';
      } else if (tag) {
        tag.remove();   // valid / active: no badge (de-noised — Concept 4)
      }
    }

    function makeSectionHeader(text) {
      const h = document.createElement('div');
      h.textContent = text;
      Object.assign(h.style, {
        padding:       '7px 14px 5px',
        fontSize:      '11px',
        fontFamily:    THEME.font,
        color:         THEME.textDim,
        fontWeight:    '600',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        userSelect:    'none',
      });
      return h;
    }
    function makeDivider() {
      const d = document.createElement('div');
      d.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:4px 8px;';
      return d;
    }

    // ── Concept-4 ("Anchored") building blocks ────────────────────────────────
    // The main source view pins a current-state header, a primary Learning-mode
    // call-to-action, a compact tools strip, and Off, so only the language list
    // scrolls.  These helpers build those pinned pieces.

    // Current state: the active source (accent + ✓) and, on the right, the
    // episode's audio language — answers "what am I seeing / what's spoken".
    function makeHeaderRow(activeLabel, audioLabel) {
      const h = document.createElement('div');
      Object.assign(h.style, {
        display: 'flex', alignItems: 'baseline', gap: '8px',
        padding: '9px 14px', borderBottom: `1px solid ${THEME.panelEdge}`,
        fontFamily: THEME.font, flexShrink: '0',
      });
      const cur = document.createElement('span');
      if (activeLabel) {
        cur.textContent = `${activeLabel} ✓`;
        cur.style.cssText = `font-size:13px;font-weight:700;color:${THEME.accent};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      } else {
        cur.textContent = 'Subtitles off';
        cur.style.cssText = `font-size:13px;font-weight:600;color:${THEME.textMuted};white-space:nowrap;`;
      }
      h.appendChild(cur);
      if (audioLabel) {
        const aud = document.createElement('span');
        aud.textContent = `audio · ${audioLabel}`;
        aud.style.cssText = `font-size:10px;color:${THEME.textMuted};margin-left:auto;white-space:nowrap;flex-shrink:0;`;
        h.appendChild(aud);
      }
      return h;
    }

    // A two-line row: icon + title + a dim sub-line + chevron.  Used for the
    // grouped "Second subtitle" options — Learning mode (accentTitle=true, the
    // recommended "auto" path) sits beside the manual pick.
    function makeSubtextRow(icon, title, sub, onClick, accentTitle) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 14px', cursor: 'pointer', fontFamily: THEME.font,
        borderRadius: '3px', flexShrink: '0',
      });
      const ic = document.createElement('span');
      ic.textContent = icon;
      ic.style.cssText = 'font-size:15px;line-height:1;flex-shrink:0;';
      const col = document.createElement('span');
      col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;';
      const t = document.createElement('span');
      t.textContent = title;
      t.style.cssText = `font-size:12.5px;font-weight:${accentTitle ? '700' : '500'};color:${accentTitle ? THEME.accent : THEME.text};white-space:nowrap;`;
      const s = document.createElement('span');
      s.textContent = sub;
      s.style.cssText = `font-size:10px;font-weight:400;color:${THEME.textMuted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      col.appendChild(t); col.appendChild(s);
      const ar = document.createElement('span');
      ar.textContent = '›';
      ar.style.cssText = `color:${THEME.textDim};font-size:11px;flex-shrink:0;`;
      row.appendChild(ic); row.appendChild(col); row.appendChild(ar);
      row.addEventListener('mouseenter', () => { row.style.background = THEME.rowHover; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      row.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      return row;
    }

    // A row of equal-width secondary buttons (Show on screen · Manage).
    function make2ColRow(items) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', gap: '6px', padding: '8px', flexShrink: '0' });
      for (const it of items) {
        const b = document.createElement('div');
        Object.assign(b.style, {
          flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '6px', padding: '8px 6px', borderRadius: '6px',
          background: 'rgba(255,255,255,0.05)', border: `1px solid ${THEME.panelEdge}`,
          cursor: 'pointer', fontFamily: THEME.font, fontSize: '11px', color: THEME.text, whiteSpace: 'nowrap',
        });
        const ic = document.createElement('span'); ic.textContent = it.icon;
        const lb = document.createElement('span'); lb.textContent = it.label;
        b.appendChild(ic); b.appendChild(lb);
        b.addEventListener('mouseenter', () => { b.style.borderColor = THEME.accent; });
        b.addEventListener('mouseleave', () => { b.style.borderColor = THEME.panelEdge; });
        b.addEventListener('click', (e) => { e.stopPropagation(); it.onClick(); });
        row.appendChild(b);
      }
      return row;
    }

    // A row with a label (+ optional sub-label) and a small on/off switch on the
    // right — used by the "Show on screen" submenu.  The whole row toggles;
    // onToggle receives the NEW value.  The pill mirrors the popup's switch look
    // (accent when on, neutral track when off) for a consistent feel.
    function makeToggleRow(label, isOn, onToggle, sub) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        padding: '7px 14px', cursor: 'pointer', fontFamily: THEME.font,
        display: 'flex', alignItems: 'center', gap: '10px',
        borderRadius: '3px', userSelect: 'none',
      });
      const txt = document.createElement('div');
      txt.style.cssText = 'flex:1;min-width:0;';
      const main = document.createElement('div');
      main.textContent = label;
      main.style.cssText = `font-size:13px;color:${THEME.text};white-space:nowrap;`;
      txt.appendChild(main);
      if (sub) {
        const s = document.createElement('div');
        s.textContent = sub;
        s.style.cssText = `font-size:10px;color:${THEME.textMuted};margin-top:1px;white-space:nowrap;`;
        txt.appendChild(s);
      }
      const sw = document.createElement('span');
      sw.style.cssText =
        'position:relative;width:32px;height:18px;flex-shrink:0;border-radius:18px;transition:background 0.15s;' +
        `background:${isOn ? THEME.accent : 'rgba(255,255,255,0.18)'};`;
      const knob = document.createElement('span');
      knob.style.cssText =
        'position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:#fff;transition:transform 0.15s;' +
        `transform:translateX(${isOn ? '14px' : '0'});`;
      sw.appendChild(knob);
      row.appendChild(txt);
      row.appendChild(sw);
      row.addEventListener('mouseenter', () => { row.style.background = THEME.rowHover; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      row.addEventListener('click', (e) => { e.stopPropagation(); onToggle(!isOn); });
      return row;
    }

    // "Signs" selector for dual subtitles: which track draws the typeset signs.
    // Primary / Secondary pick one clean track; Both merges them (may overlap).
    function makeSignSourceRow(rebuild) {
      // CR ships some locales dialogue-only — grey out Secondary/Both (and note
      // it) when the loaded secondary track carries no typeset signs.
      const hasSigns = (typeof getSecondaryHasSigns === 'function') ? !!getSecondaryHasSigns() : true;
      const wrap = document.createElement('div');
      const row = document.createElement('div');
      Object.assign(row.style, {
        padding: '7px 14px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: '8px', fontFamily: THEME.font,
      });
      const label = document.createElement('span');
      label.textContent = 'Signs';
      label.style.cssText = `font-size:11px;color:${THEME.text};`;
      const seg = document.createElement('div');
      seg.style.cssText = 'display:flex;gap:3px;';
      const cur = getSignSource?.() || 'primary';
      for (const [val, txt] of [['primary', 'Primary'], ['secondary', 'Secondary'], ['both', 'Both']]) {
        const disabled = !hasSigns && val !== 'primary';
        const b = document.createElement('button');
        b.textContent = txt;
        const active = cur === val;
        b.style.cssText =
          'padding:3px 7px;font-size:10px;font-weight:600;font-family:inherit;border-radius:4px;flex-shrink:0;' +
          (disabled ? 'cursor:default;opacity:0.4;' : 'cursor:pointer;') +
          (active
            ? `background:${THEME.accentTint};color:${THEME.accent};border:1px solid ${THEME.accent};`
            : `background:rgba(255,255,255,0.06);color:${THEME.textDim};border:1px solid ${THEME.panelEdge};`);
        if (disabled) b.title = 'This track has no typeset signs';
        else b.addEventListener('click', (e) => { e.stopPropagation(); onSetSignSource?.(val); rebuild(); });
        seg.appendChild(b);
      }
      row.appendChild(label);
      row.appendChild(seg);
      wrap.appendChild(row);
      if (!hasSigns) {
        const note = document.createElement('div');
        note.textContent = 'This subtitle track has no typeset signs.';
        note.style.cssText = `padding:0 14px 6px;font-size:10px;line-height:1.4;color:${THEME.textMuted};`;
        wrap.appendChild(note);
      }
      return wrap;
    }

    // Is there anything to put in the "Manage sources" submenu?  Load-file is
    // effectively always offered, so this is true whenever that callback exists;
    // the per-source verbs (sync/export) and MT actions show contextually inside.
    function hasManageActions() {
      return !!(onLoadFile || onTranslate || onMtSettings || onClearMt);
    }

    function buildContent(menuEl) {
      const ep = getEpisode();
      if (!ep) return;
      menuEl.innerHTML = '';

      // The main source view is a flex column so ONLY the language list scrolls
      // (the current-state header, the Learning-mode CTA, the tools strip, and
      // Off all stay pinned).  Submenus scroll as a single block, as before.
      if (view === 'sources') {
        menuEl.style.display       = 'flex';
        menuEl.style.flexDirection = 'column';
        menuEl.style.overflowY     = 'hidden';
      } else {
        menuEl.style.display   = 'block';
        menuEl.style.overflowY = 'auto';
      }

      // ── "Show on screen" submenu (per-layer visibility) ───────────────────
      // Toggle the spoken-line band, the typeset signs, and CR's own subtitles
      // independently — this is the "what to show or not" control.  A submenu so
      // the main list stays a clean source picker.
      if (view === 'show') {
        menuEl.appendChild(makeSectionHeader('Show on screen'));
        menuEl.appendChild(makeActionRow('‹ Back to sources', () => { view = 'sources'; buildContent(menuEl); }));
        menuEl.appendChild(makeDivider());
        const layer  = (name, dflt) => (typeof getLayer === 'function' ? !!getLayer(name) : dflt);
        const toggle = (name, on) => { onSetLayer?.(name, on); buildContent(menuEl); };
        menuEl.appendChild(makeToggleRow('Dialogue', layer('dialogue', true),
          (on) => toggle('dialogue', on), 'Spoken-line subtitles'));
        menuEl.appendChild(makeToggleRow('Typeset signs', layer('signs', true),
          (on) => toggle('signs', on), 'On-screen text — signs, titles, captions'));
        menuEl.appendChild(makeToggleRow('Crunchyroll’s own subtitles', layer('official', false),
          (on) => toggle('official', on), 'Turn off to hide CR’s built-in subtitles'));
        return;
      }

      // ── "Learning mode" submenu — the single dual-subtitle control ────────
      // Merges what used to be two menus: the one-tap "match my audio + your
      // language" study setup, the manual second-language picker, and the Signs
      // (primary / secondary / both) selector.  Adding a second subtitle is
      // essentially the learning use case, so it all lives here.
      if (view === 'learn') {
        const info        = (typeof getLearningInfo === 'function') ? (getLearningInfo() || {}) : {};
        const audio       = info.audioLocale || '';
        // Prefer the caller-resolved audio label (it knows ja-JP audio is
        // "Japanese", not the ja-JP subtitle-row label); fall back to our map.
        const audioLabel  = info.audioLabel || (audio ? (localeLabels[audio] ?? audio) : '');
        const audioHasSub = !!info.audioHasSub;
        const native      = info.native || '';
        const nativeLabel = localeLabels[native] ?? native;
        const nativeAvail = info.nativeAvailable !== false;   // undefined (old caller) → assume available
        const cur         = getSecondary?.() || '';
        const primary     = ep.activeSource() ?? 'ja-JP';

        menuEl.appendChild(makeSectionHeader('Learning mode'));
        menuEl.appendChild(makeActionRow('‹ Back to sources', () => { view = 'sources'; buildContent(menuEl); }));
        menuEl.appendChild(makeDivider());

        const intro = document.createElement('div');
        intro.textContent = 'Show two subtitles at once — one matching the audio, one in your language — to read along while you learn.';
        intro.style.cssText = `padding:2px 14px 8px;font-size:11px;line-height:1.5;color:${THEME.textDim};white-space:normal;max-width:250px;`;
        menuEl.appendChild(intro);

        // One-tap: set the main subtitle to the audio language + your language
        // below.  Only offered when it would actually do something.
        if (onApplyLearning && audio) {
          if (audioHasSub && audio !== native) {
            // Only promise "with <your language> below" when it's actually on
            // this episode; otherwise the tap gives the audio-language sub alone.
            const sub = nativeAvail
              ? `with ${nativeLabel} below`
              : `${nativeLabel} isn’t on this episode — ${audioLabel} only`;
            menuEl.appendChild(makeSubtextRow('📚', `Match my audio — ${audioLabel}`,
              sub, () => { close(); onApplyLearning(native); }, true));
          } else if (!audioHasSub) {
            const note = document.createElement('div');
            note.textContent = `No ${audioLabel} subtitles on this episode to match the audio — pick a second language below.`;
            note.style.cssText = `padding:0 14px 8px;font-size:10px;line-height:1.4;color:${THEME.textMuted};`;
            menuEl.appendChild(note);
          }
        }

        // Manual: choose the second subtitle, kept alongside your current main
        // one.  The active primary is excluded (a track can't pair with itself).
        menuEl.appendChild(makeSectionHeader('Second subtitle'));
        menuEl.appendChild(makeRow('Off (single subtitle)', !cur, true, () => {
          close(); onSelectSecondary?.('');
        }, null, null));
        for (const v of ep.catalog.versions()) {
          if (v.locale === primary) continue;
          const label = localeRowLabel(ep, v.locale);
          menuEl.appendChild(makeRow(label, cur === v.locale, localeHasContent(ep, v.locale), () => {
            close(); onSelectSecondary?.(v.locale);
          }, null, null));
        }
        // Custom sources (uploads / machine translations) are valid secondaries.
        const secCustoms = (ep.listCustomSources?.() ?? []).filter(c => c.id !== primary);
        if (secCustoms.length) {
          menuEl.appendChild(makeDivider());
          let hasMt = false;
          for (const cs of secCustoms) {
            if (cs.kind === 'mt') hasMt = true;
            const tag = cs.kind === 'mt' ? ' · machine' : ' · file';
            menuEl.appendChild(makeRow((cs.label || cs.id) + tag, cur === cs.id, true, () => {
              close(); onSelectSecondary?.(cs.id);
            }, null, null));
          }
          if (hasMt) {
            const note = document.createElement('div');
            note.textContent = '⚠ A second machine translation uses extra DeepL quota.';
            note.style.cssText = `padding:4px 14px 6px;font-size:10px;line-height:1.4;color:${THEME.warn};`;
            menuEl.appendChild(note);
          }
        }

        // Signs: which track draws the typeset signs — only meaningful once a
        // second subtitle is chosen (primary / secondary / both).
        if (cur && onSetSignSource) {
          menuEl.appendChild(makeDivider());
          menuEl.appendChild(makeSignSourceRow(() => buildContent(menuEl)));
        }
        return;
      }

      // ── "Manage sources" submenu (the action verbs) ───────────────────────
      // Load a file, translate, tweak sync, export, clear MT — infrequent, so
      // they live one level down to keep the source list short.  Shown
      // contextually (sync/export only for the active custom source, etc.).
      if (view === 'manage') {
        menuEl.appendChild(makeSectionHeader('Manage sources'));
        menuEl.appendChild(makeActionRow('‹ Back to sources', () => { view = 'sources'; buildContent(menuEl); }));
        menuEl.appendChild(makeDivider());
        const curLocale    = ep.activeSource() ?? 'ja-JP';
        const customs      = ep.listCustomSources?.() ?? [];
        const activeCustom = customs.some(c => c.id === curLocale) && isOverlayActive();
        if (onLoadFile) {
          menuEl.appendChild(makeActionRow('＋ Load subtitle file…', () => { close(); onLoadFile(); }));
        }
        const translateAction = getTranslateAction?.();
        if (translateAction && onTranslate) {
          menuEl.appendChild(makeActionRow(translateAction.label, () => { close(); onTranslate(); }));
        }
        const mtSettingsAction = getMtSettingsAction?.();
        if (mtSettingsAction && onMtSettings) {
          menuEl.appendChild(makeActionRow(mtSettingsAction.label, () => { close(); onMtSettings(); }));
        }
        const cancelAction = getCancelAction?.();
        if (cancelAction && onCancelTranslate) {
          menuEl.appendChild(makeActionRow(cancelAction.label, () => { close(); onCancelTranslate(); }));
        }
        const timingAction = getAdjustTimingAction?.();
        if (timingAction && onAdjustTiming) {
          menuEl.appendChild(makeActionRow(timingAction.label, () => { close(); onAdjustTiming(); }));
        }
        if (activeCustom && onAdjustSync) {
          menuEl.appendChild(makeActionRow('⚙ Adjust sync…', () => { close(); onAdjustSync(curLocale); }));
        }
        if (activeCustom && onExport) {
          menuEl.appendChild(makeActionRow('⬇ Export subtitles…', () => { close(); onExport(); }));
        }
        const clearMtAction = getClearMtAction?.();
        if (clearMtAction && onClearMt) {
          menuEl.appendChild(makeActionRow(clearMtAction.label, () => { close(); onClearMt(); }));
        }
        return;
      }

      // ── Main list ("Anchored"): current state · primary action · a scrolling
      //    language list (the ONLY scroll region) · pinned tools · Off ─────────
      const on        = isOverlayActive();
      const curLocale = ep.activeSource();
      const customs   = ep.listCustomSources?.() ?? [];
      const curCustom = customs.find((c) => c.id === curLocale);
      const activeLabel = (on && curLocale)
        ? (curCustom?.label || localeRowLabel(ep, curLocale))
        : null;
      const learnInfo = (typeof getLearningInfo === 'function') ? (getLearningInfo() || {}) : {};

      // (a) Current state — active source + the episode's audio language.
      menuEl.appendChild(makeHeaderRow(activeLabel, learnInfo.audioLabel || ''));

      // (b) The language list is the ONLY scrolling region, so everything
      // pinned above/below stays reachable no matter how many locales there are.
      const langHdr = makeSectionHeader('Language');
      langHdr.style.flexShrink = '0';
      menuEl.appendChild(langHdr);

      const list = document.createElement('div');
      Object.assign(list.style, { flex: '1 1 auto', minHeight: '56px', overflowY: 'auto' });
      // Thin, subtle scrollbar (modern Chrome honours these as inline props).
      list.style.scrollbarWidth = 'thin';
      list.style.scrollbarColor = 'rgba(255,255,255,0.28) transparent';

      for (const v of ep.catalog.versions()) {
        const label      = localeRowLabel(ep, v.locale);
        const isActive   = on && (curLocale === v.locale);
        const hasContent = localeHasContent(ep, v.locale);
        // Catalog owns both the version list and per-locale validation status.
        const validation = ep.catalog.validation(v.locale);
        list.appendChild(makeRow(label, isActive, hasContent, () => {
          close(); onSelectLocale?.(v.locale);
        }, validation, v.locale));
      }
      // Custom sources (uploads / MT) are selectable languages too — same list.
      for (const cs of customs) {
        const isActive = on && (curLocale === cs.id);
        const badge    = cs.kind === 'mt' ? 'machine' : 'file';
        list.appendChild(makeCustomRow(cs.label || cs.id, isActive, badge, () => {
          close(); onSelectCustom?.(cs.id);
        }, () => {
          close(); onRemoveCustom?.(cs.id);
        }));
      }
      menuEl.appendChild(list);

      // (c) Learning mode — the single dual-subtitle entry.  Its submenu merges
      // the audio-match one-tap, the manual second-language picker, and the
      // Signs (primary/secondary/both) selector.  Shows the current 2nd sub.
      if (onApplyLearning || onSelectSecondary) {
        const cur = getSecondary?.() || '';
        const secCustom = customs.find((c) => c.id === cur);
        const secLabel  = cur ? (secCustom?.label || localeRowLabel(ep, cur)) : '';
        menuEl.appendChild(makeSubtextRow('📚', 'Learning mode',
          secLabel ? `Second subtitle: ${secLabel}` : 'Show two subtitles for study',
          () => { view = 'learn'; buildContent(menuEl); }, true));
      }

      // (d) Show on screen + Manage sources — a compact two-up row.
      const tools = [];
      if (typeof getLayer === 'function' && typeof onSetLayer === 'function') {
        tools.push({ icon: '👁', label: 'Show on screen', onClick: () => { view = 'show'; buildContent(menuEl); } });
      }
      if (hasManageActions()) {
        tools.push({ icon: '⚙', label: 'Manage', onClick: () => { view = 'manage'; buildContent(menuEl); } });
      }
      if (tools.length) menuEl.appendChild(make2ColRow(tools));

      // (e) Off.
      const off = document.createElement('div');
      Object.assign(off.style, {
        padding: '9px 14px', cursor: 'pointer', fontFamily: THEME.font, fontSize: '12px',
        color: THEME.text, borderTop: `1px solid ${THEME.panelEdge}`, textAlign: 'center', flexShrink: '0',
      });
      off.textContent = 'Turn subtitles off';
      off.addEventListener('mouseenter', () => { off.style.background = THEME.rowHover; });
      off.addEventListener('mouseleave', () => { off.style.background = 'transparent'; });
      off.addEventListener('click', (e) => { e.stopPropagation(); close(); onTurnOff?.(); });
      menuEl.appendChild(off);
    }

    // Rebuilt content can be wider/taller than the view it was positioned for —
    // re-clamp (no-op before the menu is mounted, i.e. the open() build).
    const _origBuildContent = buildContent;
    buildContent = function (menuEl) {
      _origBuildContent(menuEl);
      if (menuEl.isConnected) positionMenu(menuEl);
    };

    // Anchor the menu to the ▾ button, clamped inside the player (or viewport)
    // box.  Called at open AND after every submenu rebuild: the views differ in
    // width (toggle rows are wider than the source list), so a left position
    // clamped for the sources view can push a wider submenu off the right edge.
    function positionMenu(menu) {
      const menuBtn = document.getElementById(MENU_BTN_ID);
      if (!menuBtn) return;
      const r     = menuBtn.getBoundingClientRect();
      const mh    = menu.offsetHeight;
      const above = r.top > mh + 8 || r.top > window.innerHeight - r.bottom;
      if (menu.parentElement && menu.parentElement !== document.body) {
        // position:absolute, relative to the player container's box.
        menu.style.position = 'absolute';
        const mt = menu.parentElement.getBoundingClientRect();
        if (above) { menu.style.bottom = `${mt.bottom - r.top + 4}px`; menu.style.top = ''; }
        else       { menu.style.top    = `${r.bottom - mt.top + 4}px`; menu.style.bottom = ''; }
        menu.style.left = `${Math.max(0, Math.min(r.left - mt.left, mt.width - menu.offsetWidth - 8))}px`;
      } else {
        if (above) { menu.style.bottom = `${window.innerHeight - r.top + 4}px`; menu.style.top = ''; }
        else       { menu.style.top    = `${r.bottom + 4}px`; menu.style.bottom = ''; }
        menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
      }
    }

    function open() {
      if (document.getElementById(MENU_ID)) { close(); return; }
      const menuBtn = document.getElementById(MENU_BTN_ID);
      if (!menuBtn) return;

      const menu = document.createElement('div');
      menu.id = MENU_ID;
      Object.assign(menu.style, panelStyle({
        position:  'fixed',
        zIndex:    '2147483646',
        minWidth:  '170px',
        padding:   '4px 0',
        // Long source lists (10 locales + customs + actions + the secondary
        // entry) can exceed the viewport — cap the height and scroll instead of
        // running off the top/bottom edge.
        maxHeight: 'min(82vh, 680px)',
        overflowY: 'auto',
      }));

      buildContent(menu);
      // Mount INSIDE the player — the video's parent, or the fullscreen element —
      // so the menu tracks the player and shows in fullscreen, exactly like the
      // subtitle overlay (cue-renderer mounts to the same container).  Falls back
      // to <body> with viewport-fixed positioning only if no <video> exists yet.
      const video       = document.querySelector('video');
      const mountTarget = document.fullscreenElement ?? video?.parentElement ?? document.body;
      const inPlayer    = mountTarget !== document.body;
      if (inPlayer && window.getComputedStyle(mountTarget).position === 'static') {
        mountTarget.style.position = 'relative';
        positionedTarget = mountTarget;   // revert on close()
      }
      mountTarget.appendChild(menu);

      positionMenu(menu);

      outsideHandler = (e) => {
        if (!menu.contains(e.target) && e.target !== menuBtn) close();
      };
      escapeHandler = (e) => { if (e.key === 'Escape') close(); };
      pendingBind = setTimeout(() => {
        pendingBind = null;
        document.addEventListener('click',   outsideHandler, true);
        document.addEventListener('keydown', escapeHandler);
      }, 0);
    }

    // Show the picker whenever we're on an Episode.  The menu always offers
    // "＋ Load subtitle file…" (its only entry point) and "Off", and CR always
    // carries ≥1 locale once data arrives — so there's always something to act
    // on.  We deliberately do NOT gate on catalog.versions(): that list lags a
    // dub switch (the JP-playback handler populates it, and only THEN calls
    // updateButtonVisibility), so gating on it injected the ▾ hidden during the
    // dub-switch nav and left it hidden — the picker would intermittently
    // vanish after changing dubs.  Gate on the Episode existing instead.
    function menuHasContent() {
      return !!getEpisode();
    }

    function updateButtonVisibility() {
      const menuBtn = document.getElementById(MENU_BTN_ID);
      if (!menuBtn) return;
      menuBtn.style.display = menuHasContent() ? '' : 'none';
    }

    function injectButton(found, afterBtn) {
      if (document.getElementById(MENU_BTN_ID)) return;
      if (!found) return;

      const menuBtn = document.createElement('button');
      menuBtn.id    = MENU_BTN_ID;
      menuBtn.title = 'Select subtitle source';
      menuBtn.textContent = '▾';

      Object.assign(menuBtn.style, {
        background:   'transparent',
        color:        THEME.text,
        border:       '1px solid transparent',  // borderless like the toggle; no box
        borderRadius: '4px',
        padding:      '3px 5px',
        fontSize:     '12px',
        fontWeight:   '600',
        fontFamily:   THEME.font,
        lineHeight:   '1',
        cursor:       'pointer',
        userSelect:   'none',
        transition:   'background 0.15s, color 0.15s',
        alignSelf:    'center',
        flexShrink:   '0',
        // Hug the toggle (the JP button keeps marginRight=6px) so the two read
        // as one split control — a label + its caret — rather than two separate
        // boxes, matching how the player groups a control with its menu affordance.
        marginLeft:   '0',
        marginRight:  '4px',
        display:      menuHasContent() ? '' : 'none',
      });

      menuBtn.addEventListener('mouseenter', () => { menuBtn.style.background = THEME.rowHover; });
      menuBtn.addEventListener('mouseleave', () => { menuBtn.style.background = 'transparent'; });
      menuBtn.addEventListener('click', e => { e.stopPropagation(); open(); });

      if (afterBtn.nextSibling) {
        found.row.insertBefore(menuBtn, afterBtn.nextSibling);
      } else {
        found.row.appendChild(menuBtn);
      }
      try { if (localStorage.getItem('crSubFix_debug') === '1') console.info(LOG, 'Source picker button injected.'); } catch (_) {}
    }

    function removeButton() {
      document.getElementById(MENU_BTN_ID)?.remove();
    }

    return { injectButton, removeButton, updateButtonVisibility, close, updateRow };
  }

  NS.CRSubFix.createSourceMenu = createSourceMenu;
})();
