/**
 * lib/remaster.js — pure timing-remap algorithm for the Remaster concept.
 *
 * CONTEXT.md defines Remaster as anchor-matched, piecewise-linear time
 * mapping used when the chosen Source comes from a different Audio session
 * than the active dub.  This module owns the algorithm — no DOM, no fetch,
 * no Episode state.  Callers feed in two Cue arrays and get back a third.
 *
 * Public surface:
 *   CRSubFix.remaster.MIN_ANCHORS
 *   CRSubFix.remaster.buildAnchorMap(srcCues, refCues, opts?)
 *     → [{ srcTime, refTime }]
 *   CRSubFix.remaster.interpolateTime(t, anchors)
 *     → mapped time, with linear extrapolation past the endpoints
 *   CRSubFix.remaster.remasterCues(cues, anchors)
 *     → new Cue array with start/end retimed through anchors
 *   CRSubFix.remaster.computeMedianDelta(anchors)
 *     → median (refTime − srcTime) across anchors, or 0 if empty
 */
(function () {
  'use strict';

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  if (!NS.CRSubFix || !NS.CRSubFix.parser) return;

  const { normalizeSubText } = NS.CRSubFix.parser;

  // 90 s covers any realistic timing shift between JP theatrical and
  // international distribution versions (inserted scenes, OP/ED moves).
  const DEFAULT_WINDOW_SEC = 90;
  // Below this similarity score, two cues are considered different lines.
  const MATCH_THRESHOLD    = 0.85;
  // Cues with fewer characters after normalization are too short to match
  // reliably — single words match too many candidates.
  const MIN_CUE_CHARS      = 8;
  // Minimum anchor pairs for reliable interpolation across a full file.
  const MIN_ANCHORS        = 15;

  /** Jaccard similarity of word sets — fast, language-independent. */
  function wordJaccard(a, b) {
    const wa = a.split(/\s+/).filter(Boolean);
    const wb = new Set(b.split(/\s+/).filter(Boolean));
    let inter = 0;
    for (const w of wa) if (wb.has(w)) inter++;
    const union = new Set([...wa, ...wb]).size;
    return union ? inter / union : 0;
  }

  /**
   * Build a piecewise-linear timing anchor map from two sets of cues that
   * share the same text but have timestamps from different video cuts.
   *
   * Sliding-window two-pointer: both arrays must be sorted by start time
   * (parseSubtitles already guarantees this).  The window [sc.start −
   * WINDOW, sc.start + WINDOW] advances with a single pointer instead of
   * rescanning from zero.
   */
  function buildAnchorMap(srcCues, refCues, opts) {
    const WINDOW = opts?.windowSec ?? DEFAULT_WINDOW_SEC;
    const refNorm = refCues.map(rc => ({ rc, txt: normalizeSubText(rc.text) }));
    const anchors = [];
    let winLo = 0;

    for (const sc of srcCues) {
      const sTxt = normalizeSubText(sc.text);
      if (sTxt.length < MIN_CUE_CHARS) continue;

      while (winLo < refNorm.length && refNorm[winLo].rc.start < sc.start - WINDOW) winLo++;

      let bestScore = 0, bestRef = null;
      for (let i = winLo; i < refNorm.length && refNorm[i].rc.start <= sc.start + WINDOW; i++) {
        const score = wordJaccard(sTxt, refNorm[i].txt);
        if (score > bestScore) { bestScore = score; bestRef = refNorm[i].rc; }
      }
      if (bestScore >= MATCH_THRESHOLD && bestRef) {
        anchors.push({ srcTime: sc.start, refTime: bestRef.start });
      }
    }

    anchors.sort((a, b) => a.srcTime - b.srcTime);
    return cleanAnchors(anchors);
  }

  /** Remove near-duplicate srcTimes and statistical outlier deltas (MAD filter). */
  function cleanAnchors(anchors) {
    if (anchors.length < 3) return anchors;
    const deduped = [];
    for (const a of anchors) {
      if (!deduped.length || a.srcTime - deduped[deduped.length - 1].srcTime > 0.5) {
        deduped.push(a);
      }
    }
    const deltas = deduped.map(a => a.refTime - a.srcTime).slice().sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)];
    const mad    = deltas.map(d => Math.abs(d - median)).sort((a, b) => a - b)[Math.floor(deltas.length / 2)];
    const tol    = Math.max(3 * mad, 2.0); // at least 2 s tolerance for noisy data
    return deduped.filter(a => Math.abs((a.refTime - a.srcTime) - median) <= tol);
  }

  /** Map a single timestamp from source-session space into audio-session space. */
  function interpolateTime(t, anchors) {
    if (!anchors.length) return t;
    if (t <= anchors[0].srcTime) return t + (anchors[0].refTime - anchors[0].srcTime);
    const last = anchors[anchors.length - 1];
    if (t >= last.srcTime) return t + (last.refTime - last.srcTime);
    let lo = 0, hi = anchors.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (anchors[mid].srcTime <= t) lo = mid; else hi = mid;
    }
    const prev = anchors[lo], next = anchors[hi];
    const frac = (t - prev.srcTime) / (next.srcTime - prev.srcTime);
    return prev.refTime + frac * (next.refTime - prev.refTime);
  }

  /** Return a new cue array with every start/end retimed through anchorMap. */
  function remasterCues(cues, anchors) {
    if (!anchors || anchors.length < 2) return cues.slice();
    return cues.map(c => ({
      ...c,
      start: interpolateTime(c.start, anchors),
      end:   interpolateTime(c.end,   anchors),
    }));
  }

  function computeMedianDelta(anchors) {
    if (!anchors.length) return 0;
    const deltas = anchors.map(a => a.refTime - a.srcTime).sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)];
  }

  NS.CRSubFix.remaster = {
    MIN_ANCHORS,
    buildAnchorMap, interpolateTime, remasterCues, computeMedianDelta,
  };
})();
