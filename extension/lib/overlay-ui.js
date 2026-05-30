/**
 * lib/overlay-ui.js — transient overlay primitives shared across the
 * extension's status messaging.
 *
 * Replaces three near-duplicate toast functions and a HUD getter/updater/
 * fader trio that all hand-rolled the same parent-resolution dance.
 *
 * Exposes:
 *   CRSubFix.ui.showToast({ host, text, color, borderColor, fontWeight,
 *                          duration, zIndex })
 *
 *   CRSubFix.ui.makeProgressHud(host) → { update, html, fade }
 *     update(step, total, desc) — progress bar + step description
 *     html(content, fadeAfterMs?) — replace contents (caller composes HTML)
 *     fade()                    — fade out and remove
 *
 *   CRSubFix.ui.escapeHtml(s)
 */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast({
    host, text,
    color       = 'rgba(255,255,255,0.72)',
    borderColor = 'rgba(255,255,255,0.13)',
    fontWeight  = '500',
    duration    = 2200,
    zIndex      = 10,
  }) {
    const target = host ?? document.body;
    if (!target) return;
    const isAbsolute = target !== document.body;
    if (isAbsolute && window.getComputedStyle(target).position === 'static') {
      target.style.position = 'relative';
    }
    const toast = document.createElement('div');
    toast.textContent = text;
    Object.assign(toast.style, {
      position:      isAbsolute ? 'absolute' : 'fixed',
      bottom:        isAbsolute ? '18%'      : '120px',
      left:          '50%',
      transform:     'translateX(-50%)',
      background:    'rgba(0,0,0,0.52)',
      color,
      fontSize:      '12px',
      fontFamily:    'sans-serif',
      fontWeight,
      padding:       '4px 14px',
      borderRadius:  '20px',
      border:        `1px solid ${borderColor}`,
      pointerEvents: 'none',
      zIndex:        String(zIndex),
      opacity:       '1',
      transition:    'opacity 0.6s ease',
      whiteSpace:    'nowrap',
      letterSpacing: '0.3px',
    });
    target.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; }, duration);
    setTimeout(() => { toast.remove(); }, duration + 700);
  }

  const HUD_ID = 'cr-remaster-hud';

  function makeProgressHud(host) {
    function el() {
      if (!host) return null;
      let h = document.getElementById(HUD_ID);
      if (h) return h;
      h = document.createElement('div');
      h.id = HUD_ID;
      Object.assign(h.style, {
        position:      'absolute',
        top:           '10%',
        left:          '50%',
        transform:     'translateX(-50%)',
        background:    'rgba(0,0,0,0.72)',
        color:         'rgba(255,255,255,0.88)',
        fontSize:      '11px',
        fontFamily:    'monospace, sans-serif',
        fontWeight:    '500',
        padding:       '6px 16px 8px',
        borderRadius:  '4px',
        border:        '1px solid rgba(255,107,53,0.4)',
        pointerEvents: 'none',
        zIndex:        '10',
        opacity:       '1',
        transition:    'opacity 0.5s ease',
        whiteSpace:    'nowrap',
        letterSpacing: '0.3px',
        lineHeight:    '1.5',
        minWidth:      '260px',
        textAlign:     'center',
      });
      host.appendChild(h);
      return h;
    }

    function update(step, total, desc) {
      const h = el();
      if (!h) return;
      const pct = Math.round((step / total) * 100);
      h.innerHTML =
        `<div style="margin-bottom:5px;color:#ff6b35;font-weight:700;letter-spacing:0.5px;">` +
          `⟳  step ${step}/${total}  <span style="color:rgba(255,255,255,0.5);">│</span>  ${desc}` +
        `</div>` +
        `<div style="height:2px;background:rgba(255,255,255,0.12);border-radius:1px;overflow:hidden;">` +
          `<div style="width:${pct}%;height:100%;background:#ff6b35;border-radius:1px;transition:width 0.25s ease;"></div>` +
        `</div>`;
    }

    function html(content, fadeAfterMs) {
      const h = el();
      if (!h) return;
      h.innerHTML = content;
      if (fadeAfterMs > 0) setTimeout(fade, fadeAfterMs);
    }

    function fade() {
      const h = document.getElementById(HUD_ID);
      if (!h) return;
      h.style.opacity = '0';
      setTimeout(() => h.remove(), 600);
    }

    return { update, html, fade };
  }

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.ui = { showToast, makeProgressHud, escapeHtml };
})();
