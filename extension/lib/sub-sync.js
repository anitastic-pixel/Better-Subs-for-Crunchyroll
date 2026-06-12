/**
 * lib/sub-sync.js — the Custom source timing model.
 *
 * A Custom source (CONTEXT.md) carries a `sync` describing how its raw cue
 * timings map onto the active video:
 *   {mode:'none'} | {mode:'linear', scale, offset} | {mode:'anchors', anchors}
 * This module owns that model — it derives a linear map from the user's two
 * sync marks, and applies any sync to a Cue array.  The anchor path delegates
 * to the Remaster algorithm (lib/remaster.js); the global sync-offset slider
 * still applies on top of all of this at render time.
 *
 * Pure — no DOM, no fetch, no Episode state.
 *
 * Public surface:
 *   CRSubFix.subSync.applySync(record) → Cue[]
 *     record's srcCues retimed through record.sync (a copy; never mutates).
 *   CRSubFix.subSync.computeLinearSync(markA, markB, firstRaw, lastRaw)
 *     → {mode:'linear', scale, offset} | null
 *     Two (rawTime → videoTime) marks define a linear map correcting both a
 *     constant offset and a runtime/framerate stretch; one mark gives an
 *     offset-only map; no marks → null (caller leaves the sync unchanged).
 */
(function () {
  'use strict';

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  if (!NS.CRSubFix || !NS.CRSubFix.remaster) return;
  const { remasterCues } = NS.CRSubFix.remaster;

  // Apply a record's stored sync params to its raw cues, producing display
  // cues.  'linear' (two-point manual sync) and 'anchors' (auto-sync via
  // remaster) are baked here; 'none' (and any malformed sync) passes through.
  function applySync(record) {
    const src  = record?.srcCues ?? [];
    const sync = record?.sync ?? { mode: 'none' };
    if (sync.mode === 'linear' && isFinite(sync.scale) && isFinite(sync.offset)) {
      return src.map(c => ({
        ...c,
        start: c.start * sync.scale + sync.offset,
        end:   c.end   * sync.scale + sync.offset,
      }));
    }
    if (sync.mode === 'anchors' && Array.isArray(sync.anchors) && sync.anchors.length >= 2) {
      return remasterCues(src, sync.anchors);
    }
    return src.slice();
  }

  // Minimum raw span (seconds) between the two marked lines for a reliable
  // two-point fit; closer than this, the marks can't separate offset from
  // stretch, so fall back to an offset-only map.
  const MIN_SPAN_SEC = 1;

  function computeLinearSync(markA, markB, firstRaw, lastRaw) {
    if (markA != null && markB != null && Math.abs(lastRaw - firstRaw) >= MIN_SPAN_SEC) {
      const scale  = (markB - markA) / (lastRaw - firstRaw);
      const offset = markA - firstRaw * scale;
      return { mode: 'linear', scale, offset };
    }
    if (markA != null) {
      return { mode: 'linear', scale: 1, offset: markA - firstRaw };  // offset-only until the end is marked
    }
    return null;
  }

  NS.CRSubFix.subSync = { applySync, computeLinearSync };
})();
