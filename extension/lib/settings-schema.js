/**
 * lib/settings-schema.js — single source of truth for extension settings.
 *
 * Loaded into all three contexts:
 *   • popup (popup.html)
 *   • content-script isolated world (content.js)
 *   • content-script MAIN world (interceptor.js)
 *
 * Each entry binds a chrome.storage.local key, a data-cr-* attribute on
 * <html>, a default, and a primitive type for round-trip encoding.
 *
 * Replaces three independent declarations of these defaults that used to
 * carry "keep in sync" comments.
 */
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
