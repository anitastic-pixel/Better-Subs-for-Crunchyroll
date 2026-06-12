/**
 * lib/ui-theme.js — the extension's on-player visual tokens, in one place.
 *
 * Goal: read as NATIVE to Crunchyroll's player in *idiom* (borderless controls,
 * a dark translucent dropdown, a thin neutral edge, the page's own font) while
 * staying unmistakably OURS in *colour* — a single restrained accent.  We
 * deliberately do NOT match Crunchyroll's brand colour; matching generic UI
 * conventions is fine, copying a brand's exact palette is a trade-dress risk.
 *
 * Every floating surface (the source menu, the sync / translation / tune
 * panels, toasts, the control buttons) used to hand-roll its own hex values —
 * `#1a1a2e`, `#ff6b35`, `sans-serif`, the same shadow — scattered across
 * interceptor.js, source-menu.js, and overlay-ui.js.  Centralising them here
 * makes a restyle a one-file change and keeps the look coherent.
 *
 * Pure — no DOM, no fetch, no state.
 *
 * Public surface:
 *   CRSubFix.uiTheme.tokens          — the raw token values (see below)
 *   CRSubFix.uiTheme.panel(extra?)   — style object for a floating panel
 *                                      (near-black bg, thin neutral edge, soft
 *                                      shadow, page font); merge `extra` last.
 */
(function () {
  'use strict';

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  if (!NS.CRSubFix) NS.CRSubFix = {};

  const tokens = {
    // Our accent — kept distinct from Crunchyroll's brand orange on purpose.
    accent:      '#ff6b35',
    accentText:  '#fff',                       // text on a filled accent
    accentTint:  'rgba(255,107,53,0.15)',      // active/hover wash for accented controls

    // Floating-panel chrome: a near-black translucent sheet with a THIN NEUTRAL
    // edge (not an accent border) — the generic dark-menu idiom CR's own player
    // uses, without borrowing its colour.
    panelBg:     'rgba(16,16,18,0.94)',
    panelEdge:   'rgba(255,255,255,0.12)',
    panelShadow: '0 6px 22px rgba(0,0,0,0.5)',
    panelRadius: '8px',

    // Text + neutral interaction.
    text:        '#e8e8e8',
    textDim:     '#9aa0a6',
    textMuted:   '#5f6368',
    rowHover:    'rgba(255,255,255,0.08)',     // neutral hover, like CR's menus

    // Status hues (kept recognisable, used sparingly).
    warn:        '#cc9900',
    danger:      '#e55',
    info:        '#4ea8de',

    // Adopt the player's own typeface instead of a generic family, so our text
    // sits in the same font as the controls beside it.
    font:        'inherit',
  };

  // Common floating-panel style.  Spread `extra` last to override per-call
  // (position, width, padding).
  function panel(extra) {
    return Object.assign({
      background:   tokens.panelBg,
      border:       `1px solid ${tokens.panelEdge}`,
      borderRadius: tokens.panelRadius,
      boxShadow:    tokens.panelShadow,
      color:        tokens.text,
      fontFamily:   tokens.font,
      userSelect:   'none',
    }, extra || {});
  }

  NS.CRSubFix.uiTheme = { tokens, panel };
})();
