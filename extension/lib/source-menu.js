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
  if (!NS.CRSubFix) return;

  const MENU_BTN_ID = 'cr-bsub-menu-btn';
  const MENU_ID     = 'cr-bsub-menu';
  const LOG         = '[CR Sub Fix]';

  function createSourceMenu({
    getEpisode, isOverlayActive,
    localeLabels = {},
    onSelectLocale, onTurnOff,
    onSelectCustom, onLoadFile, onRemoveCustom, onAdjustSync, onExport,
    onTranslate, getTranslateAction, onClearMt, getClearMtAction,
    onCancelTranslate, getCancelAction, onMtSettings, getMtSettingsAction,
  }) {
    let outsideHandler = null;
    let escapeHandler  = null;

    function close() {
      document.getElementById(MENU_ID)?.remove();
      if (outsideHandler) {
        document.removeEventListener('click', outsideHandler, true);
        outsideHandler = null;
      }
      if (escapeHandler) {
        document.removeEventListener('keydown', escapeHandler);
        escapeHandler = null;
      }
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
        fontFamily:   'sans-serif',
        color:        isActive ? '#ff6b35' : unavail ? '#555' : isWrong ? '#cc9900' : '#e0e0e0',
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
        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,107,53,0.15)'; });
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
        fontFamily: 'sans-serif', color: isActive ? '#ff6b35' : '#e0e0e0',
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
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,107,53,0.15)'; });
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
        fontFamily: 'sans-serif', color: '#9ecbff', fontWeight: '500',
        background: 'transparent', userSelect: 'none', whiteSpace: 'nowrap',
        borderRadius: '3px',
      });
      row.textContent = label;
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,107,53,0.15)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
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

    function buildContent(menuEl) {
      const ep = getEpisode();
      if (!ep) return;
      menuEl.innerHTML = '';

      const header = document.createElement('div');
      header.textContent = 'Subtitle Source';
      Object.assign(header.style, {
        padding:       '7px 14px 5px',
        fontSize:      '11px',
        fontFamily:    'sans-serif',
        color:         '#888',
        fontWeight:    '600',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        userSelect:    'none',
      });
      menuEl.appendChild(header);

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
      Object.assign(menu.style, {
        position:     'fixed',
        zIndex:       '2147483646',
        background:   '#1a1a2e',
        border:       '1px solid rgba(255,107,53,0.4)',
        borderRadius: '6px',
        boxShadow:    '0 4px 20px rgba(0,0,0,0.6)',
        minWidth:     '170px',
        padding:      '4px 0',
        userSelect:   'none',
      });

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
      setTimeout(() => {
        document.addEventListener('click',   outsideHandler, true);
        document.addEventListener('keydown', escapeHandler);
      }, 0);
    }

    // Show the picker whenever there is at least one source to act on.  It is
    // the only entry point to "Load subtitle file…", and single-locale episodes
    // (e.g. a show CR ships with no ja-JP track) are exactly where a user wants
    // to upload — so the old "hide unless >1 locale" rule would bury the feature.
    function menuHasContent() {
      const ep = getEpisode();
      const versions = ep?.catalog.versions() ?? [];
      const customs  = ep?.listCustomSources?.() ?? [];
      return versions.length >= 1 || customs.length > 0;
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
        color:        '#ff6b35',
        border:       '1.5px solid #ff6b35',
        borderRadius: '3px',
        padding:      '3px 5px',
        fontSize:     '11px',
        fontWeight:   '700',
        fontFamily:   'sans-serif',
        lineHeight:   '1',
        cursor:       'pointer',
        userSelect:   'none',
        transition:   'background 0.15s, color 0.15s',
        alignSelf:    'center',
        flexShrink:   '0',
        // Visible gap between the JP CC button and the ▾ picker.  Combined
        // with the JP button's marginRight=6px this lands at ~20px between
        // the two boxes — roughly matching the spacing between Crunchyroll's
        // own left-side player buttons so this control reads consistently.
        marginLeft:   '14px',
        marginRight:  '4px',
        display:      menuHasContent() ? '' : 'none',
      });

      menuBtn.addEventListener('mouseenter', () => { menuBtn.style.background = 'rgba(255,107,53,0.15)'; });
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
