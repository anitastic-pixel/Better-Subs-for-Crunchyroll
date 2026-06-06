// ── Element refs ──────────────────────────────────────────────────────────
const toggleEnabled       = document.getElementById('toggleEnabled');
const toggleAuto          = document.getElementById('toggleAuto');
const toggleHideOfficial  = document.getElementById('toggleHideOfficial');
const scaleSlider         = document.getElementById('scaleSlider');
const scaleLabel          = document.getElementById('scaleLabel');
const offsetLabel         = document.getElementById('offsetLabel');
const statusDot           = document.getElementById('statusDot');
const statusText          = document.getElementById('statusText');
const offsetReset         = document.getElementById('offsetReset');
const subBottomFloor      = document.getElementById('subBottomFloor');
const subBottomFloorLabel = document.getElementById('subBottomFloorLabel');
// Style override
const toggleStyleOverride = document.getElementById('toggleStyleOverride');
const styleControls       = document.getElementById('styleControls');
const previewSpan         = document.getElementById('previewSpan');
const fontFamily          = document.getElementById('fontFamily');
const colorText           = document.getElementById('colorText');
const textOpacity         = document.getElementById('textOpacity');
const textOpacityLabel    = document.getElementById('textOpacityLabel');
const outlineShadowCtrls  = document.getElementById('outlineShadowControls');
const colorOutline        = document.getElementById('colorOutline');
const bordSlider          = document.getElementById('bordSlider');
const bordLabel           = document.getElementById('bordLabel');
const shadSlider          = document.getElementById('shadSlider');
const shadLabel           = document.getElementById('shadLabel');
const shadStyleSeg        = document.getElementById('shadStyleSeg');
const shadOpacity         = document.getElementById('shadOpacity');
const shadOpacityLabel    = document.getElementById('shadOpacityLabel');
const toggleBgBox         = document.getElementById('toggleBgBox');
const bgControls          = document.getElementById('bgControls');
const bgColor             = document.getElementById('bgColor');
const bgOpacity           = document.getElementById('bgOpacity');
const bgOpacityLabel      = document.getElementById('bgOpacityLabel');
const bgRadius            = document.getElementById('bgRadius');
const bgRadiusLabel       = document.getElementById('bgRadiusLabel');
const bgPaddingX          = document.getElementById('bgPaddingX');
const bgPaddingXLabel     = document.getElementById('bgPaddingXLabel');
const bgPaddingY          = document.getElementById('bgPaddingY');
const bgPaddingYLabel     = document.getElementById('bgPaddingYLabel');
const toggleBgGlass       = document.getElementById('toggleBgGlass');
const glassControls       = document.getElementById('glassControls');
const bgGlassBlur         = document.getElementById('bgGlassBlur');
const bgGlassBlurLabel    = document.getElementById('bgGlassBlurLabel');
const bgGlassSat          = document.getElementById('bgGlassSat');
const bgGlassSatLabel     = document.getElementById('bgGlassSatLabel');
const bgGlassHue          = document.getElementById('bgGlassHue');
const bgGlassHueLabel     = document.getElementById('bgGlassHueLabel');
const presetSelect        = document.getElementById('presetSelect');
const previewBox          = document.getElementById('previewBox');
const togglePreviewAnimate = document.getElementById('togglePreviewAnimate');

// ── Style presets ─────────────────────────────────────────────────────────
// Each preset is a partial settings bundle that gets merged on top of the
// schema defaults when applied.  Order: keys that affect the "look".
// presetSelect.value is matched back against these so the dropdown stays
// in sync with the actual settings — if the user nudges any slider after
// applying a preset, the dropdown reverts to "Custom".
const PRESETS = {
  'cr-default': {
    label: 'CR Default',
    settings: {
      styleOverride: false,
    },
  },
  'white-outlined': {
    label: 'White & Outlined',
    settings: {
      styleOverride:        true,
      overrideFontFamily:   '',
      overrideTextColor:    '#ffffff',
      overrideTextOpacity:  100,
      overrideOutlineColor: '#000000',
      overrideBord:         3,
      overrideShad:         0,
      overrideShadStyle:    'hard',
      overrideShadOpacity:  80,
      overrideBgBox:        false,
      overrideBgGlass:      false,
    },
  },
  'sticker': {
    label: 'Sticker',
    settings: {
      styleOverride:        true,
      overrideFontFamily:   '',
      overrideTextColor:    '#fff8e7',
      overrideTextOpacity:  100,
      overrideOutlineColor: '#000000',
      overrideBord:         4,
      overrideShad:         2,
      overrideShadStyle:    'hard',
      overrideShadOpacity:  70,
      overrideBgBox:        false,
      overrideBgGlass:      false,
    },
  },
  'glass': {
    label: 'Glass',
    settings: {
      styleOverride:        true,
      overrideTextColor:    '#ffffff',
      overrideTextOpacity:  100,
      overrideBord:         0,
      overrideShad:         0,
      overrideBgBox:        true,
      overrideBgColor:      '#000000',
      overrideBgOpacity:    30,
      overrideBgRadius:     12,
      overrideBgPaddingX:   16,
      overrideBgPaddingY:   4,
      overrideBgGlass:      true,
      overrideBgGlassBlur:  12,
      overrideBgGlassSat:   160,
      overrideBgGlassHue:   0,
    },
  },
};

// Return the preset id whose `settings` is a subset-match of the current
// state, or null if nothing matches (→ dropdown shows "Custom").
function matchingPresetId(state) {
  for (const [id, preset] of Object.entries(PRESETS)) {
    let match = true;
    for (const [k, v] of Object.entries(preset.settings)) {
      if (state[k] !== v) { match = false; break; }
    }
    if (match) return id;
  }
  return null;
}

let currentShadStyle = 'hard';

// ── Status indicator ──────────────────────────────────────────────────────
// Status enum (S) and message types (MSG) come from lib/protocol.js — the
// single source of truth shared with content.js, interceptor.js, and
// background.js.  STATUS_DISPLAY maps each protocol value to popup chrome.
const { STATUS: S, MSG } = self.CRSubFix.protocol;

const STATUS_DISPLAY = {
  [S.NONE]:        { color: '#555',    pulse: false, text: 'Waiting for episode to load' },
  loading:         { color: '#ffc107', pulse: true,  text: 'Fetching subtitle data…' },
  [S.READY]:       { color: '#4caf50', pulse: false, text: 'Subtitles ready' },
  [S.ACTIVE]:      { color: '#ff6b35', pulse: true,  text: 'Subtitles active' },
  [S.RELOAD]:      { color: '#ffc107', pulse: false, text: 'Reload tab to activate subtitles' },
  [S.ERROR]:       { color: '#e55',    pulse: false, text: 'Error fetching subtitles — click the player button to retry' },
  [S.UNAVAILABLE]: { color: '#555',    pulse: false, text: 'No subtitles available for this episode' },
  notwatch:        { color: '#555',    pulse: false, text: 'Not on an episode page' },
};

const statusDetail = document.getElementById('statusDetail');

// Minimal locale-code → friendly name table.  Mirrors the larger map in
// interceptor.js but only carries the common ones — anything not listed
// is shown as the raw code (e.g. "tr-TR"), which is still informative.
const LOCALE_LABELS = {
  'ja-JP': 'Japanese',  'en-US': 'English',  'en-GB': 'English (UK)',
  'de-DE': 'German',    'es-419':'Spanish (LA)','es-ES':'Spanish',
  'fr-FR': 'French',    'pt-BR': 'Portuguese (BR)','pt-PT':'Portuguese',
  'it-IT': 'Italian',   'ru-RU': 'Russian',  'ar-SA': 'Arabic',
  'zh-CN': 'Chinese (Simpl.)','zh-TW':'Chinese (Trad.)',
  'hi-IN': 'Hindi',     'ko-KR': 'Korean',
};
const localeName = (l) => l ? (LOCALE_LABELS[l] ?? l) : null;

function setStatus(key, info) {
  const cfg = STATUS_DISPLAY[key] ?? STATUS_DISPLAY[S.NONE];
  statusDot.style.background = cfg.color;
  statusDot.classList.toggle('pulse', cfg.pulse);
  statusText.textContent = cfg.text;

  // Detail line under the status pill: source · audio · remaster.  Only
  // shown when there's something to report (active overlay or non-default
  // source), keeps the bar clean when nothing's actively playing.
  const parts = [];
  if (info) {
    if (info.source)  parts.push(`Source: ${localeName(info.source)}`);
    if (info.audio)   parts.push(`Audio: ${localeName(info.audio)}`);
    if (info.remaster === 'synced') parts.push('Synced');
  }
  if (parts.length) {
    statusDetail.textContent = parts.join(' • ');
    statusDetail.style.display = '';
  } else {
    statusDetail.style.display = 'none';
  }
}

(async () => {
  async function queryStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    return chrome.tabs.sendMessage(tab.id, { type: MSG.GET_STATUS });
  }
  try {
    const resp = await queryStatus();
    setStatus(resp?.jpStatus ?? S.NONE, resp?.activeInfo);
  } catch (_) {
    // Content script may not have finished injecting yet (page still loading).
    // Wait briefly before concluding we're not on a watch page.
    await new Promise(r => setTimeout(r, 400));
    try {
      const resp = await queryStatus();
      setStatus(resp?.jpStatus ?? S.NONE, resp?.activeInfo);
    } catch (_) {
      setStatus('notwatch');
    }
  }
})();

// ── Live preview ──────────────────────────────────────────────────────────
// Outlined text is rendered via the shared SVG builder in lib/cue-style.js
// so a formula change lands in one place and the preview matches playback.
const { hexToRgba, createOutlinedTextSvg, resolveBgYInsets, buildGlassCss } = self.CRSubFix.cueStyle;
const PREVIEW_TEXT = 'Subtitle preview text';

// Replace the previewSpan contents with a single SVG (or styled span for
// bg-box mode) reflecting the current overlay settings.
function renderPreviewContent(node) {
  previewSpan.textContent = '';
  previewSpan.appendChild(node);
}

function updatePreview() {
  const override = toggleStyleOverride.checked;

  // Reset the container styles each call — earlier calls may have set
  // background / padding on the span itself when bg-box was enabled.
  previewSpan.style.cssText =
    'display:inline-block;line-height:1.6;padding:0 2px;background:none;';

  if (!override) {
    // Default look — white text, black silhouette outline.  Same SVG
    // builder as the page-side renderer for byte-equal styling.
    renderPreviewContent(createOutlinedTextSvg(PREVIEW_TEXT, {
      fillColor:    'rgb(255,255,255)',
      outlineColor: 'rgb(0,0,0)',
      bord:         2,
      fontFamily:   'Arial, sans-serif',
      fontSize:     '13px',
      weight:       '500',
    }));
    return;
  }

  const textAlpha = parseInt(textOpacity.value) / 100;
  const textColor = hexToRgba(colorText.value, textAlpha);
  const font      = fontFamily.value || 'Arial, sans-serif';
  const bgEnabled = toggleBgBox.checked;

  if (bgEnabled) {
    // bg-box mode renders as a styled HTML span — no outline / stroke.
    const alpha  = parseInt(bgOpacity.value) / 100;
    const bgCol  = hexToRgba(bgColor.value, alpha);
    const radius = parseInt(bgRadius.value);
    const px     = parseInt(bgPaddingX.value);
    const pySlider = parseInt(bgPaddingY.value);
    const { paddingY, lineHeight } = resolveBgYInsets(pySlider);
    const span = document.createElement('span');
    let glassCss = '';
    if (toggleBgGlass.checked) {
      // Same recipe as the page-side renderer — both call the shared builder
      // in lib/cue-style.js so the preview equals playback.
      glassCss = buildGlassCss({
        blur: parseInt(bgGlassBlur.value),
        sat:  parseInt(bgGlassSat.value),
        hue:  parseInt(bgGlassHue.value),
      });
    }
    span.style.cssText =
      `display:inline-block;color:${textColor};font-family:${font};font-size:13px;` +
      `font-weight:500;line-height:${lineHeight};` +
      `background:${bgCol};border-radius:${radius}px;padding:${paddingY}px ${px}px;` +
      glassCss;
    span.textContent = PREVIEW_TEXT;
    renderPreviewContent(span);
    return;
  }

  renderPreviewContent(createOutlinedTextSvg(PREVIEW_TEXT, {
    fillColor:    textColor,
    outlineColor: colorOutline.value,
    bord:         parseFloat(bordSlider.value),
    fontFamily:   font,
    fontSize:     '13px',
    weight:       '500',
    shad:         parseFloat(shadSlider.value),
    shadowColor:  'rgb(0,0,0)',
    soft:         currentShadStyle === 'soft',
    shadOpacity:  parseInt(shadOpacity.value) / 100,
  }));
}

// ── Load settings ─────────────────────────────────────────────────────────

function populateFromSettings(s) {
  toggleEnabled.checked = s.enabled;
  toggleAuto.checked    = s.autoActivate;
  toggleHideOfficial.checked = s.hideOfficialSubs;
  const pct = Math.round(s.subScale * 100);
  scaleSlider.value      = pct;
  scaleLabel.textContent = `${pct}%`;
  renderOffsetLabel(s.subOffset);
  subBottomFloor.value         = s.subBottomFloor;
  subBottomFloorLabel.textContent = `${s.subBottomFloor}%`;

  // Style overrides
  toggleStyleOverride.checked = s.styleOverride;
  styleControls.classList.toggle('disabled', !s.styleOverride);

  fontFamily.value          = s.overrideFontFamily;

  colorText.value           = s.overrideTextColor;
  textOpacity.value         = s.overrideTextOpacity;
  textOpacityLabel.textContent = `${s.overrideTextOpacity}%`;

  colorOutline.value        = s.overrideOutlineColor;
  bordSlider.value          = s.overrideBord;
  bordLabel.textContent     = s.overrideBord;

  shadSlider.value          = s.overrideShad;
  shadLabel.textContent     = s.overrideShad;
  currentShadStyle          = s.overrideShadStyle ?? 'hard';
  shadStyleSeg.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === currentShadStyle);
  });
  shadOpacity.value         = s.overrideShadOpacity;
  shadOpacityLabel.textContent = `${s.overrideShadOpacity}%`;

  toggleBgBox.checked       = s.overrideBgBox;
  bgControls.classList.toggle('disabled', !s.overrideBgBox);
  outlineShadowCtrls.classList.toggle('disabled', s.overrideBgBox);
  bgColor.value              = s.overrideBgColor;
  bgOpacity.value            = s.overrideBgOpacity;
  bgOpacityLabel.textContent = `${s.overrideBgOpacity}%`;
  bgRadius.value             = s.overrideBgRadius;
  bgRadiusLabel.textContent  = `${s.overrideBgRadius}px`;
  bgPaddingX.value           = s.overrideBgPaddingX;
  bgPaddingXLabel.textContent = `${s.overrideBgPaddingX}px`;
  bgPaddingY.value           = s.overrideBgPaddingY;
  bgPaddingYLabel.textContent = `${s.overrideBgPaddingY}px`;

  toggleBgGlass.checked      = s.overrideBgGlass;
  glassControls.classList.toggle('disabled', !s.overrideBgGlass);
  bgGlassBlur.value          = s.overrideBgGlassBlur;
  bgGlassBlurLabel.textContent = `${s.overrideBgGlassBlur}px`;
  bgGlassSat.value           = s.overrideBgGlassSat;
  bgGlassSatLabel.textContent = `${s.overrideBgGlassSat}%`;
  bgGlassHue.value           = s.overrideBgGlassHue;
  bgGlassHueLabel.textContent = `${s.overrideBgGlassHue}°`;

  presetSelect.value = matchingPresetId(s) ?? '';

  updatePreview();
}

function loadFromStorage() {
  chrome.storage.local.get(self.CRSubFix.settings.defaults(), populateFromSettings);
}

loadFromStorage();

// ── Enable / Auto-activate ────────────────────────────────────────────────

toggleEnabled.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggleEnabled.checked });
});
toggleAuto.addEventListener('change', () => {
  chrome.storage.local.set({ autoActivate: toggleAuto.checked });
});
toggleHideOfficial.addEventListener('change', () => {
  chrome.storage.local.set({ hideOfficialSubs: toggleHideOfficial.checked });
});

// ── Subtitle size ─────────────────────────────────────────────────────────

scaleSlider.addEventListener('input', () => {
  const pct = parseInt(scaleSlider.value);
  scaleLabel.textContent = `${pct}%`;
  chrome.storage.local.set({ subScale: pct / 100 });
});

// ── Sync offset ───────────────────────────────────────────────────────────

function renderOffsetLabel(offset) {
  const sign = offset >= 0 ? '+' : '-';
  const abs  = Math.abs(offset);
  if (abs < 60) {
    offsetLabel.textContent = `${sign}${abs.toFixed(1)}s`;
  } else {
    const m = Math.floor(abs / 60);
    const s = (abs % 60).toFixed(1).padStart(4, '0');
    offsetLabel.textContent = `${sign}${m}:${s}`;
  }
}

function adjustOffset(delta) {
  chrome.storage.local.get({ subOffset: 0 }, ({ subOffset }) => {
    // ±60 minutes (matches README); enough headroom for badly-cut sources.
    const next = Math.max(-3600, Math.min(3600, Math.round((subOffset + delta) * 10) / 10));
    chrome.storage.local.set({ subOffset: next });
    renderOffsetLabel(next);
  });
}

document.querySelectorAll('[data-delta]').forEach(btn => {
  btn.addEventListener('click', () => adjustOffset(parseFloat(btn.dataset.delta)));
});
offsetReset.addEventListener('click', () => {
  chrome.storage.local.set({ subOffset: 0 });
  renderOffsetLabel(0);
});

subBottomFloor.addEventListener('input', () => {
  const v = parseInt(subBottomFloor.value);
  subBottomFloorLabel.textContent = `${v}%`;
  chrome.storage.local.set({ subBottomFloor: v });
});

// ── Style override controls ───────────────────────────────────────────────

toggleStyleOverride.addEventListener('change', () => {
  const on = toggleStyleOverride.checked;
  chrome.storage.local.set({ styleOverride: on });
  styleControls.classList.toggle('disabled', !on);
  updatePreview();
});

fontFamily.addEventListener('change', () => {
  chrome.storage.local.set({ overrideFontFamily: fontFamily.value });
  updatePreview();
});

colorText.addEventListener('input', () => {
  chrome.storage.local.set({ overrideTextColor: colorText.value });
  updatePreview();
});

textOpacity.addEventListener('input', () => {
  const v = parseInt(textOpacity.value);
  textOpacityLabel.textContent = `${v}%`;
  chrome.storage.local.set({ overrideTextOpacity: v });
  updatePreview();
});

colorOutline.addEventListener('input', () => {
  chrome.storage.local.set({ overrideOutlineColor: colorOutline.value });
  updatePreview();
});

bordSlider.addEventListener('input', () => {
  const v = parseFloat(bordSlider.value);
  bordLabel.textContent = v;
  chrome.storage.local.set({ overrideBord: v });
  updatePreview();
});

shadSlider.addEventListener('input', () => {
  const v = parseFloat(shadSlider.value);
  shadLabel.textContent = v;
  chrome.storage.local.set({ overrideShad: v });
  updatePreview();
});

shadStyleSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn');
  if (!btn) return;
  currentShadStyle = btn.dataset.val;
  shadStyleSeg.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b === btn);
  });
  chrome.storage.local.set({ overrideShadStyle: currentShadStyle });
  updatePreview();
});

shadOpacity.addEventListener('input', () => {
  const v = parseInt(shadOpacity.value);
  shadOpacityLabel.textContent = `${v}%`;
  chrome.storage.local.set({ overrideShadOpacity: v });
  updatePreview();
});

toggleBgBox.addEventListener('change', () => {
  const on = toggleBgBox.checked;
  chrome.storage.local.set({ overrideBgBox: on });
  bgControls.classList.toggle('disabled', !on);
  // Outline + Shadow do nothing when the background box is on, so dim them too.
  outlineShadowCtrls.classList.toggle('disabled', on);
  updatePreview();
});

bgColor.addEventListener('input', () => {
  chrome.storage.local.set({ overrideBgColor: bgColor.value });
  updatePreview();
});

bgOpacity.addEventListener('input', () => {
  const v = parseInt(bgOpacity.value);
  bgOpacityLabel.textContent = `${v}%`;
  chrome.storage.local.set({ overrideBgOpacity: v });
  updatePreview();
});

bgRadius.addEventListener('input', () => {
  const v = parseInt(bgRadius.value);
  bgRadiusLabel.textContent = `${v}px`;
  chrome.storage.local.set({ overrideBgRadius: v });
  updatePreview();
});

bgPaddingX.addEventListener('input', () => {
  const v = parseInt(bgPaddingX.value);
  bgPaddingXLabel.textContent = `${v}px`;
  chrome.storage.local.set({ overrideBgPaddingX: v });
  updatePreview();
});

bgPaddingY.addEventListener('input', () => {
  const v = parseInt(bgPaddingY.value);
  bgPaddingYLabel.textContent = `${v}px`;
  chrome.storage.local.set({ overrideBgPaddingY: v });
  updatePreview();
});

// ── Glass effect ─────────────────────────────────────────────────────────
toggleBgGlass.addEventListener('change', () => {
  const on = toggleBgGlass.checked;
  chrome.storage.local.set({ overrideBgGlass: on });
  glassControls.classList.toggle('disabled', !on);
  updatePreview();
});

bgGlassBlur.addEventListener('input', () => {
  const v = parseInt(bgGlassBlur.value);
  bgGlassBlurLabel.textContent = `${v}px`;
  chrome.storage.local.set({ overrideBgGlassBlur: v });
  updatePreview();
});

bgGlassSat.addEventListener('input', () => {
  const v = parseInt(bgGlassSat.value);
  bgGlassSatLabel.textContent = `${v}%`;
  chrome.storage.local.set({ overrideBgGlassSat: v });
  updatePreview();
});

bgGlassHue.addEventListener('input', () => {
  const v = parseInt(bgGlassHue.value);
  bgGlassHueLabel.textContent = `${v}°`;
  chrome.storage.local.set({ overrideBgGlassHue: v });
  updatePreview();
});

// ── Tooltip positioning ───────────────────────────────────────────────────
// Single fixed-position tooltip element reused for every [data-tip] target.
// Positioned above the target when there's room, otherwise below; clamped
// to the popup viewport so it never overflows the right edge or wraps to a
// 13px column.
(function setupTips() {
  let tipEl = null;
  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'cr-tip';
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function showTip(target) {
    const text = target.dataset.tip;
    if (!text) return;
    const tip = ensureTip();
    tip.textContent = text;
    tip.style.display = 'block';
    // Force a layout pass so getBoundingClientRect reflects the new size.
    tip.style.left = '0px';
    tip.style.top  = '0px';
    const r = target.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = r.left + (r.width / 2) - (tr.width / 2);
    left = Math.max(6, Math.min(left, vw - tr.width - 6));
    let top = r.top - tr.height - 8;
    if (top < 6) top = Math.min(r.bottom + 8, vh - tr.height - 6);
    tip.style.left = `${left}px`;
    tip.style.top  = `${top}px`;
    // Add show class on next frame so the opacity transition runs.
    requestAnimationFrame(() => tip.classList.add('show'));
  }
  function hideTip() {
    if (!tipEl) return;
    tipEl.classList.remove('show');
    setTimeout(() => { if (tipEl && !tipEl.classList.contains('show')) tipEl.style.display = 'none'; }, 150);
  }
  for (const el of document.querySelectorAll('[data-tip]')) {
    el.addEventListener('mouseenter', () => showTip(el));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus',      () => showTip(el));
    el.addEventListener('blur',       hideTip);
  }
})();

presetSelect.addEventListener('change', () => {
  const id = presetSelect.value;
  if (!id) return;                 // "Custom" — no-op
  const preset = PRESETS[id];
  if (!preset) return;
  chrome.storage.local.set(preset.settings, () => {
    // Reload UI from storage so every control reflects the new bundle.
    // populateFromSettings also re-runs matchingPresetId, so the dropdown
    // sticks on the chosen preset until the user nudges any slider.
    loadFromStorage();
  });
});

// ── Preview animation toggle ──────────────────────────────────────────────
// Popup-only preference (no page-side effect), so stored as a plain
// chrome.storage key without registering in SCHEMA.  Default off.
chrome.storage.local.get({ previewAnimate: false }, ({ previewAnimate }) => {
  togglePreviewAnimate.checked = previewAnimate;
  previewBox.classList.toggle('animated', previewAnimate);
});

togglePreviewAnimate.addEventListener('change', () => {
  const on = togglePreviewAnimate.checked;
  chrome.storage.local.set({ previewAnimate: on });
  previewBox.classList.toggle('animated', on);
});
