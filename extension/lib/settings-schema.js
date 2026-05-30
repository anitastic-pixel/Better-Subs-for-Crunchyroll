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
