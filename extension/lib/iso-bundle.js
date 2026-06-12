/**
 * lib/iso-bundle.js — GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Regenerate with:  node tools/build-iso-bundle.mjs
 *
 * Isolated-world dependency bundle for content.js, concatenated from
 * lib/settings-schema.js + lib/protocol.js.  It exists only because of a Chrome
 * MV3 quirk: when the same content_script file path appears in two entries —
 * one with world:"MAIN" and one without — Chrome injects it only in the
 * MAIN-world entry, silently dropping it from the isolated world.  Giving the
 * isolated world its own physical file path sidesteps that deduplication.
 *
 * Edit the SOURCE modules (settings-schema.js / protocol.js) and re-run the
 * build; never edit this file directly.
 */

// ===== generated from lib/settings-schema.js =====
(function () {
  'use strict';

  const SCHEMA = [
    { key: 'enabled',              attr: 'data-cr-sub-fix',        default: true,       type: 'bool'   },
    { key: 'autoActivate',         attr: 'data-cr-auto-activate',  default: false,      type: 'bool'   },
    { key: 'hideOfficialSubs',     attr: 'data-cr-hide-official',  default: false,      type: 'bool'   },
    { key: 'includeDiagnostics',   attr: 'data-cr-include-diag',    default: true,       type: 'bool'   },
    { key: 'subScale',             attr: 'data-cr-sub-scale',      default: 1,          type: 'float'  },
    { key: 'subOffset',            attr: 'data-cr-sub-offset',     default: 0,          type: 'float'  },
    { key: 'subBottomFloor',       attr: 'data-cr-sub-bottom-floor', default: 6,        type: 'int'    },
    // Study mode: pause playback the moment a dialogue line ends (kept visible),
    // for shadowing / reading along.  Opt-in; pairs with the Alt+R replay hotkey.
    { key: 'autoPauseLine',        attr: 'data-cr-auto-pause',      default: false,      type: 'bool'   },
    // Dual signs ("Both" mode): how far (% of video height) to lift the secondary
    // track's typeset signs above the primary's so the two don't overlap.
    { key: 'secondarySignGap',     attr: 'data-cr-sec-sign-gap',    default: 8,          type: 'int'    },
    { key: 'styleOverride',        attr: 'data-cr-style-override', default: false,      type: 'bool'   },
    { key: 'overrideFontFamily',   attr: 'data-cr-font-family',    default: '',         type: 'string' },
    { key: 'overrideTextColor',    attr: 'data-cr-override-color', default: '#ffffff',  type: 'string' },
    { key: 'overrideTextOpacity',  attr: 'data-cr-text-opacity',   default: 100,        type: 'int'    },
    { key: 'overrideOutlineColor', attr: 'data-cr-outline-color',  default: '#000000',  type: 'string' },
    { key: 'overrideBord',         attr: 'data-cr-bord-size',      default: 2,          type: 'float'  },
    { key: 'overrideShad',         attr: 'data-cr-shad-size',      default: 1,          type: 'float'  },
    { key: 'overrideShadStyle',    attr: 'data-cr-shad-style',     default: 'hard',     type: 'string' },
    { key: 'overrideShadOpacity',  attr: 'data-cr-shad-opacity',   default: 80,         type: 'int'    },
    { key: 'overrideBgBox',        attr: 'data-cr-bg-box',         default: false,      type: 'bool'   },
    { key: 'overrideBgColor',      attr: 'data-cr-bg-color',       default: '#000000',  type: 'string' },
    { key: 'overrideBgOpacity',    attr: 'data-cr-bg-opacity',     default: 70,         type: 'int'    },
    { key: 'overrideBgRadius',     attr: 'data-cr-bg-radius',      default: 4,          type: 'int'    },
    { key: 'overrideBgPaddingX',   attr: 'data-cr-bg-padding-x',   default: 10,         type: 'int'    },
    { key: 'overrideBgPaddingY',   attr: 'data-cr-bg-padding-y',   default: 2,          type: 'int'    },
    { key: 'overrideBgGlass',      attr: 'data-cr-bg-glass',       default: false,      type: 'bool'   },
    { key: 'overrideBgGlassBlur',  attr: 'data-cr-bg-glass-blur',  default: 8,          type: 'int'    },
    { key: 'overrideBgGlassSat',   attr: 'data-cr-bg-glass-sat',   default: 160,        type: 'int'    },
    { key: 'overrideBgGlassHue',   attr: 'data-cr-bg-glass-hue',   default: 0,          type: 'int'    },
    // Per-type style profile for TYPESET SIGNS (\pos cues).  Mirrors the dialogue
    // keys above with a `sign_` prefix; default sign_styleOverride=false means
    // "match original" (native ASS style), so signs blend into the artwork until
    // the user opts into a custom sign look via the popup's "Style for: Signs".
    { key: 'sign_styleOverride',        attr: 'data-cr-sign-style-override', default: false,     type: 'bool'   },
    { key: 'sign_overrideFontFamily',   attr: 'data-cr-sign-font-family',    default: '',        type: 'string' },
    { key: 'sign_overrideTextColor',    attr: 'data-cr-sign-color',          default: '#ffffff', type: 'string' },
    { key: 'sign_overrideTextOpacity',  attr: 'data-cr-sign-text-opacity',   default: 100,       type: 'int'    },
    { key: 'sign_overrideOutlineColor', attr: 'data-cr-sign-outline-color',  default: '#000000', type: 'string' },
    { key: 'sign_overrideBord',         attr: 'data-cr-sign-bord-size',      default: 2,         type: 'float'  },
    { key: 'sign_overrideShad',         attr: 'data-cr-sign-shad-size',      default: 1,         type: 'float'  },
    { key: 'sign_overrideShadStyle',    attr: 'data-cr-sign-shad-style',     default: 'hard',    type: 'string' },
    { key: 'sign_overrideShadOpacity',  attr: 'data-cr-sign-shad-opacity',   default: 80,        type: 'int'    },
    { key: 'sign_overrideBgBox',        attr: 'data-cr-sign-bg-box',         default: false,     type: 'bool'   },
    { key: 'sign_overrideBgColor',      attr: 'data-cr-sign-bg-color',       default: '#000000', type: 'string' },
    { key: 'sign_overrideBgOpacity',    attr: 'data-cr-sign-bg-opacity',     default: 70,        type: 'int'    },
    { key: 'sign_overrideBgRadius',     attr: 'data-cr-sign-bg-radius',      default: 4,         type: 'int'    },
    { key: 'sign_overrideBgPaddingX',   attr: 'data-cr-sign-bg-padding-x',   default: 10,        type: 'int'    },
    { key: 'sign_overrideBgPaddingY',   attr: 'data-cr-sign-bg-padding-y',   default: 2,         type: 'int'    },
    { key: 'sign_overrideBgGlass',      attr: 'data-cr-sign-bg-glass',       default: false,     type: 'bool'   },
    { key: 'sign_overrideBgGlassBlur',  attr: 'data-cr-sign-bg-glass-blur',  default: 8,         type: 'int'    },
    { key: 'sign_overrideBgGlassSat',   attr: 'data-cr-sign-bg-glass-sat',   default: 160,       type: 'int'    },
    { key: 'sign_overrideBgGlassHue',   attr: 'data-cr-sign-bg-glass-hue',   default: 0,         type: 'int'    },
    // Force the sign TEXT colour to win even on signs that animate their own
    // colour via ASS \t (libass renders the override colour only if the inline
    // \t/\c colour tags are stripped — which also drops that colour animation).
    { key: 'sign_forceColor',           attr: 'data-cr-sign-force-color',    default: false,     type: 'bool'   },
    // Scales the typeset sign font (multiplies the .ass Style Fontsize).  Applies
    // independently of sign_styleOverride so signs can be resized without recolour.
    { key: 'sign_textScale',            attr: 'data-cr-sign-text-scale',     default: 1,         type: 'float'  },
    // Machine translation (BYOK).  The API KEY is intentionally NOT in this
    // schema — it lives in chrome.storage.local read only by the service worker
    // and must never be mirrored to the page DOM.  Only these non-secret
    // selectors cross into the page.  mtSource '' = auto-pick the best track.
    { key: 'mtEnabled',            attr: 'data-cr-mt-enabled',     default: true,       type: 'bool'   },
    { key: 'mtProvider',           attr: 'data-cr-mt-provider',    default: 'deepl',    type: 'string' },
    { key: 'mtTarget',             attr: 'data-cr-mt-target',      default: 'ja-JP',    type: 'string' },
    { key: 'mtSource',             attr: 'data-cr-mt-source',      default: '',         type: 'string' },
  ];

  function defaults() {
    const o = {};
    for (const e of SCHEMA) o[e.key] = e.default;
    return o;
  }

  function encode(entry, value) {
    if (entry.type === 'bool') return (value === true || value === 'true') ? 'true' : 'false';
    if (value == null) value = entry.default;
    return String(value);
  }

  function decode(entry, raw) {
    switch (entry.type) {
      case 'bool':
        if (raw === 'true')  return true;
        if (raw === 'false') return false;
        return entry.default;
      case 'float': {
        const v = parseFloat(raw);
        return isFinite(v) ? v : entry.default;
      }
      case 'int': {
        const v = parseInt(raw, 10);
        return isFinite(v) ? v : entry.default;
      }
      case 'string':
      default:
        return (raw == null || raw === '') ? entry.default : raw;
    }
  }

  function writeAttrs(el, settings) {
    for (const e of SCHEMA) el.setAttribute(e.attr, encode(e, settings[e.key]));
  }

  function readAll(el) {
    const o = {};
    for (const e of SCHEMA) o[e.key] = decode(e, el.getAttribute(e.attr));
    return o;
  }

  function read(el, key) {
    const e = SCHEMA.find(s => s.key === key);
    return e ? decode(e, el.getAttribute(e.attr)) : undefined;
  }

  const ATTRS = SCHEMA.map(e => e.attr);

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.settings = { SCHEMA, ATTRS, defaults, writeAttrs, readAll, read };
})();

// ===== generated from lib/protocol.js =====
(function () {
  'use strict';

  // <html> data attributes shared between content.js and interceptor.js.
  // JP_STATUS / JP_ACTIVE are written by interceptor.js, read by content.js;
  // TOGGLE_TOKEN is written by interceptor.js and echoed by content.js inside
  // its CR_SUB_TOGGLE postMessage.  It rejects accidental/unrelated messages of
  // the same type; it is not a hard security boundary (interceptor runs in the
  // MAIN world and writes the token to the page DOM, so a page script could read
  // it).  The guarded action — toggling the subtitle overlay — is non-sensitive.
  const ATTR = {
    JP_STATUS:    'data-cr-jp-status',
    JP_ACTIVE:    'data-cr-jp-active',
    TOGGLE_TOKEN: 'data-cr-toggle-token',
    // JSON-encoded {source, audio, remaster} populated by interceptor.js
    // so the popup can show what's actually playing right now (active
    // Source locale, audio dub locale, remaster state).  Updated on
    // source/audio change and on remaster completion.
    ACTIVE_INFO:  'data-cr-active-info',
    // 'true' when a machine-translation API key is stored.  Set by content.js
    // from chrome.storage — the KEY itself is never mirrored to the DOM (a page
    // script could read it); only this derived boolean crosses into MAIN world.
    MT_CONFIGURED: 'data-cr-mt-configured',
  };

  // Values written into ATTR.JP_STATUS by interceptor.js.  The popup reads this
  // and renders a status pill; the badge reflects ATTR.JP_ACTIVE separately.
  const STATUS = {
    NONE:        'none',
    READY:       'ready',
    ACTIVE:      'active',
    RELOAD:      'reload',
    ERROR:       'error',
    UNAVAILABLE: 'unavailable',
  };

  // chrome.runtime.sendMessage `type` values.
  const MSG = {
    TOGGLE_JP_CC: 'TOGGLE_JP_CC',     // background → content (keyboard shortcut)
    GET_STATUS:   'GET_STATUS',       // popup       → content (status query)
    GET_DIAG:     'GET_DIAGNOSTICS',  // popup       → content (issue-report bundle)
    SET_BADGE:    'setBadge',         // content     → background (badge update)
    MT_TRANSLATE: 'MT_TRANSLATE',     // content     → background (translate a batch)
  };

  // window.postMessage `type` values sent between content.js (isolated world)
  // and interceptor.js (MAIN world).  CR_SUB_TOGGLE is the keyboard-shortcut
  // relay; RPC_REQ/RPC_RES are a token-guarded request/response bridge that lets
  // the MAIN world reach the service worker (which it can't address directly) —
  // used for machine translation.  Each RPC carries a numeric `id` so concurrent
  // calls correlate their responses.
  const POST = {
    CR_SUB_TOGGLE: 'CR_SUB_TOGGLE',  // content → MAIN: toggle overlay (token-guarded)
    RPC_REQ:       'CR_SUB_RPC_REQ', // MAIN    → content: {id, method, payload, token}
    RPC_RES:       'CR_SUB_RPC_RES', // content → MAIN: {id, ok, result?, error?}
    SIGN_ASS:      'CR_SUB_SIGN_ASS',// MAIN    → content: {ass, token} — feed libass (signs) or null to clear
  };

  const protocol = { ATTR, STATUS, MSG, POST };

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.protocol = protocol;
})();
