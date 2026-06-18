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
    onTranslate, getTranslateAction, onClearMt, getClearMtAction,
    onCancelTranslate, getCancelAction, onMtSettings, getMtSettingsAction,
    onSelectSecondary, getSecondary,
    onSetSignSource, getSignSource, getSecondaryHasSigns,
  }) {
    let outsideHandler = null;
    let escapeHandler  = null;
    let secondaryMode  = false;  // the menu is showing the "Second subtitle" picker
    let pendingBind    = null;   // setTimeout id for the deferred document-listener bind
    let positionedTarget = null; // CR container we flipped to position:relative (to revert)

    function close() {
      secondaryMode = false;  // next open starts on the main source list
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

    function makeRow(label, isActive, hasContent, onClick, validation, locale) {
      const unavail = hasContent === false;
      const isWrong = validation === 'wrong-title';
      const isValid = validation === 'ok';
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
      } else if (isValid || isActive) {
        // Active row shows "✓ valid" too (it's the working, selected source) so
        // it isn't the only row without a status.
        const tag = document.createElement('span');
        tag.dataset.vtag = '1';
        tag.textContent = '✓ valid';
        tag.style.cssText = 'font-size:10px;color:#4caf50;margin-left:auto;padding-left:8px;flex-shrink:0;';
        row.appendChild(tag);
      }
      if (!unavail) {
        row.addEventListener('mouseenter', () => { row.style.background = THEME.rowHover; });
        row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      }
      row.addEventListener('click', e => { e.stopPropagation(); onClick(); });
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
      const isValid  = validation === 'ok';
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
      } else if (isValid || isActive) {
        ensureTag().textContent = '✓ valid';
        tag.style.color = '#4caf50';
      } else if (validation === 'no-subs' && !unavail) {
        ensureTag().textContent = 'no subs';
        tag.style.color = '#555';
      } else if (tag) {
        tag.remove();
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

    function buildContent(menuEl) {
      const ep = getEpisode();
      if (!ep) return;
      menuEl.innerHTML = '';

      // ── Secondary-subtitle picker (dual subtitles) ────────────────────────
      // A submenu so the main list stays compact: pick a second locale shown
      // alongside the primary, or "Off" for a single track.  The active primary
      // is excluded (a track can't be its own secondary).
      if (secondaryMode) {
        menuEl.appendChild(makeSectionHeader('Second subtitle'));
        menuEl.appendChild(makeActionRow('‹ Back to sources', () => { secondaryMode = false; buildContent(menuEl); }));
        menuEl.appendChild(makeDivider());
        const cur     = getSecondary?.() || '';
        const primary = ep.activeSource() ?? 'ja-JP';
        menuEl.appendChild(makeRow('Off (single subtitle)', !cur, true, () => {
          close(); onSelectSecondary?.('');
        }, null, null));
        for (const v of ep.catalog.versions()) {
          if (v.locale === primary) continue;
          const label = localeLabels[v.locale] ?? v.locale;
          menuEl.appendChild(makeRow(label, cur === v.locale, localeHasContent(ep, v.locale), () => {
            close(); onSelectSecondary?.(v.locale);
          }, null, null));
        }
        // Custom sources (uploads / machine translations) are valid secondaries
        // too — pair, say, a CR primary with a machine-translated second language.
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
        // Sign-track selector — only meaningful once a secondary is chosen.
        if (cur && onSetSignSource) {
          menuEl.appendChild(makeDivider());
          menuEl.appendChild(makeSignSourceRow(() => buildContent(menuEl)));
        }
        return;
      }

      menuEl.appendChild(makeSectionHeader('Subtitle Source'));

      const div1 = document.createElement('div');
      div1.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:0 8px 4px;';
      menuEl.appendChild(div1);

      for (const v of ep.catalog.versions()) {
        const label      = localeLabels[v.locale] ?? v.locale;
        const curLocale  = ep.activeSource() ?? 'ja-JP';
        const isActive   = (curLocale === v.locale) && isOverlayActive();
        const hasContent = localeHasContent(ep, v.locale);
        // Catalog owns both the version list and per-locale validation status —
        // no JOIN with a parallel map needed.
        const validation = ep.catalog.validation(v.locale);
        menuEl.appendChild(makeRow(label, isActive, hasContent, () => {
          close();
          onSelectLocale?.(v.locale);
        }, validation, v.locale));
      }

      // ── Custom sources (uploaded files / machine translation) ─────────────
      const customs = ep.listCustomSources?.() ?? [];
      const curLocale2 = ep.activeSource() ?? 'ja-JP';
      const divC = document.createElement('div');
      divC.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:4px 8px;';
      menuEl.appendChild(divC);
      for (const cs of customs) {
        const isActive = (curLocale2 === cs.id) && isOverlayActive();
        const badge    = cs.kind === 'mt' ? 'machine' : 'file';
        menuEl.appendChild(makeCustomRow(cs.label || cs.id, isActive, badge, () => {
          close();
          onSelectCustom?.(cs.id);
        }, () => {
          close();
          onRemoveCustom?.(cs.id);
        }));
      }
      const activeCustom = customs.some(c => c.id === curLocale2) && isOverlayActive();
      if (activeCustom && onAdjustSync) {
        menuEl.appendChild(makeActionRow('⚙ Adjust sync…', () => {
          close();
          onAdjustSync(curLocale2);
        }));
      }
      if (activeCustom && onExport) {
        menuEl.appendChild(makeActionRow('⬇ Export subtitles…', () => {
          close();
          onExport();
        }));
      }
      const translateAction = getTranslateAction?.();
      if (translateAction && onTranslate) {
        menuEl.appendChild(makeActionRow(translateAction.label, () => {
          close();
          onTranslate();
        }));
      }
      const mtSettingsAction = getMtSettingsAction?.();
      if (mtSettingsAction && onMtSettings) {
        menuEl.appendChild(makeActionRow(mtSettingsAction.label, () => {
          close();
          onMtSettings();
        }));
      }
      const cancelAction = getCancelAction?.();
      if (cancelAction && onCancelTranslate) {
        menuEl.appendChild(makeActionRow(cancelAction.label, () => {
          close();
          onCancelTranslate();
        }));
      }
      const clearMtAction = getClearMtAction?.();
      if (clearMtAction && onClearMt) {
        menuEl.appendChild(makeActionRow(clearMtAction.label, () => {
          close();
          onClearMt();
        }));
      }
      if (onLoadFile) {
        menuEl.appendChild(makeActionRow('＋ Load subtitle file…', () => {
          close();
          onLoadFile();
        }));
      }

      // Dual subtitles: enter the "Second subtitle" submenu.  Shows the current
      // choice inline so it's discoverable at a glance.
      if (onSelectSecondary) {
        const cur = getSecondary?.() || '';
        // A custom-source id (custom:mt:…) isn't in localeLabels — resolve it to
        // the source's friendly label instead of showing the raw id.
        const curCustom = (ep.listCustomSources?.() ?? []).find(c => c.id === cur);
        const secLabel = cur ? (curCustom?.label || localeLabels[cur] || cur) : 'Off';
        menuEl.appendChild(makeActionRow(`Second subtitle: ${secLabel}  ›`, () => {
          secondaryMode = true;
          buildContent(menuEl);
        }));
      }

      const div2 = document.createElement('div');
      div2.style.cssText = 'height:1px;background:rgba(255,255,255,0.1);margin:4px 8px;';
      menuEl.appendChild(div2);

      menuEl.appendChild(makeRow('Off', !isOverlayActive(), true, () => {
        close();
        onTurnOff?.();
      }));
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

      const r     = menuBtn.getBoundingClientRect();
      const mh    = menu.offsetHeight;
      const above = r.top > mh + 8 || r.top > window.innerHeight - r.bottom;
      if (inPlayer) {
        // position:absolute, relative to the player container's box.
        menu.style.position = 'absolute';
        const mt = mountTarget.getBoundingClientRect();
        if (above) { menu.style.bottom = `${mt.bottom - r.top + 4}px`; menu.style.top = ''; }
        else       { menu.style.top    = `${r.bottom - mt.top + 4}px`; menu.style.bottom = ''; }
        menu.style.left = `${Math.max(0, Math.min(r.left - mt.left, mt.width - menu.offsetWidth - 8))}px`;
      } else {
        if (above) { menu.style.bottom = `${window.innerHeight - r.top + 4}px`; menu.style.top = ''; }
        else       { menu.style.top    = `${r.bottom + 4}px`; menu.style.bottom = ''; }
        menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
      }

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
