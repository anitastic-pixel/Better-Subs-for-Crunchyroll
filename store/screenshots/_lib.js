/* Shared rendering helpers for the store-screenshot mockups.
 * Copied verbatim from extension/lib/cue-style.js so the demo subtitles render
 * identically to playback. Keep this file alongside the .html mockups. */
(function () {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function hexToRgba(hex, alpha) {
    const s = String(hex).replace('#', '');
    const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
    if (alpha == null || alpha >= 0.99) return `rgb(${r},${g},${b})`;
    return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
  }
  function applyAlpha(color, alpha) {
    if (!color || alpha == null || alpha >= 0.99) return color;
    const m = String(color).match(/rgba?\((\d+),(\d+),(\d+)/);
    if (!m) return color;
    return `rgba(${m[1]},${m[2]},${m[3]},${Math.max(0, Math.min(1, alpha)).toFixed(2)})`;
  }
  function buildGlassCss({ blur, sat, hue }) {
    const filter = `blur(${blur}px) saturate(${sat}%) hue-rotate(${hue}deg) brightness(1.04)`;
    return `backdrop-filter:${filter};-webkit-backdrop-filter:${filter};` +
      `border:1px solid rgba(255,255,255,0.24);` +
      `box-shadow:inset 0 1px 0 rgba(255,255,255,0.32),inset 0 -1px 0 rgba(0,0,0,0.20),` +
      `inset 0 10px 18px -10px rgba(255,255,255,0.18),inset 0 -8px 16px -10px rgba(0,0,0,0.22),` +
      `0 6px 20px rgba(0,0,0,0.38),0 1px 2px rgba(0,0,0,0.16);`;
  }
  let _ctx = null;
  function measureWidth(text, font) { if (!_ctx) _ctx = document.createElement('canvas').getContext('2d'); _ctx.font = font; return _ctx.measureText(text).width; }

  function createOutlinedTextSvg(text, opts) {
    opts = opts || {};
    const {
      fillColor = 'rgb(255,255,255)', outlineColor = 'rgb(0,0,0)', bord = 0,
      fontFamily = 'Arial, sans-serif', fontSize = '13px', weight = '500',
      italic = false, shad = 0, shadowColor = null, soft = false, shadOpacity = null,
    } = opts;
    const px = Math.min(Math.max(0, Math.round(bord)), 8);
    const fz = parseFloat(fontSize) || 13;
    const wt = String(weight || '500');
    const fontShorthand = `${italic ? 'italic ' : ''}${wt} ${fz}px ${fontFamily}`;
    const textWidth = measureWidth(text, fontShorthand);
    const pad = px + Math.ceil(fz * 0.15);
    const lineHeight = 1.6;
    const svgWidth = Math.ceil(textWidth + 2 * pad), svgHeight = Math.ceil(fz * lineHeight);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(svgWidth)); svg.setAttribute('height', String(svgHeight));
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`); svg.setAttribute('overflow', 'visible');
    svg.style.display = 'inline-block'; svg.style.verticalAlign = 'middle';
    const sp = Math.max(-8, Math.min(8, Math.round(shad)));
    if (sp !== 0) {
      const base = shadowColor ?? 'rgba(0,0,0,0.8)';
      const sc = shadOpacity != null ? applyAlpha(base, shadOpacity) : base;
      const blur = soft ? Math.max(2, Math.abs(sp) * 1.2) : Math.abs(sp) * 0.35;
      svg.style.filter = `drop-shadow(${sp}px ${sp}px ${blur.toFixed(2)}px ${sc})`;
    }
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(pad)); t.setAttribute('y', String(Math.round(fz * 1.25)));
    t.setAttribute('fill', fillColor); t.setAttribute('font-family', fontFamily);
    t.setAttribute('font-size', `${fz}px`); t.setAttribute('font-weight', wt);
    if (italic) t.setAttribute('font-style', 'italic');
    if (px > 0) {
      t.setAttribute('stroke', outlineColor); t.setAttribute('stroke-width', String(px * 2));
      t.setAttribute('stroke-linejoin', 'round'); t.setAttribute('stroke-linecap', 'round');
      t.setAttribute('paint-order', 'stroke');
    }
    t.textContent = text;
    svg.appendChild(t);
    return svg;
  }

  window.DEMO = { hexToRgba, applyAlpha, buildGlassCss, createOutlinedTextSvg };
})();
