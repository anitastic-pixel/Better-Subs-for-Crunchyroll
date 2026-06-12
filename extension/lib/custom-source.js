/**
 * lib/custom-source.js — Custom source identity and record construction.
 *
 * A Custom source (CONTEXT.md) is a serializable record attached to one
 * Episode — an uploaded file (kind:'local') or a machine translation
 * (kind:'mt').  The Episode only stores and serves these records; this module
 * owns their *shape* and the id namespace, so the two construction sites (file
 * upload and MT) can't drift apart and "what is a custom id" has one home.
 *
 * Record shape (fully serializable — round-trips through localStorage):
 *   { id, kind:'local'|'mt', label, lang, srcCues, signRawAss, sync, mtSource? }
 * where srcCues is the raw parsed Cue[] (pre-sync), signRawAss is the typeset
 * signs projection (lib/sign-track.js) or null, and sync is the timing model
 * (lib/sub-sync.js).
 *
 * Pure — no DOM, no fetch, no Episode state.  Depends on the parser and the
 * sign-track projection.
 *
 * Public surface:
 *   CRSubFix.customSource.LOCAL_ID                       — the single upload slot id
 *   CRSubFix.customSource.isCustomId(id)                 — true for 'custom:*'
 *   CRSubFix.customSource.makeLocalSource(filename, text) → record | null
 *       null when the file parses to zero cues (caller surfaces the message).
 *   CRSubFix.customSource.makeMtSource({ id, target, source, label, srcCues, signRawAss })
 *       → record
 */
(function () {
  'use strict';

  const NS = (typeof self !== 'undefined' ? self : globalThis);
  if (!NS.CRSubFix || !NS.CRSubFix.parser || !NS.CRSubFix.signTrack) return;
  const { parseSubtitles } = NS.CRSubFix.parser;
  const { buildSignsAss }  = NS.CRSubFix.signTrack;

  // The single upload slot — re-uploading replaces this id (see selectSource's
  // force path), so a viewing only ever holds one local file at a time.
  const LOCAL_ID = 'custom:local';

  const isCustomId = (id) => typeof id === 'string' && id.startsWith('custom:');

  // A file's base name, trimmed of extension and capped for the menu.
  function labelFromFilename(name) {
    return String(name || '').replace(/\.[^.]+$/, '').slice(0, 40);
  }

  function makeLocalSource(filename, text) {
    const cues = parseSubtitles(text, filename);
    if (!cues.length) return null;
    return {
      id:      LOCAL_ID,
      kind:    'local',
      label:   labelFromFilename(filename) || 'Uploaded file',
      lang:    null,
      srcCues: cues,
      // Render the upload's OWN typeset signs through libass — including any
      // fonts the .ass embeds (buildSignsAss keeps everything before [Events]).
      // null for sign-less files (SRT/VTT).
      signRawAss: buildSignsAss(text),
      sync:    { mode: 'none' },
    };
  }

  function makeMtSource({ id, target, source, label, srcCues, signRawAss }) {
    return {
      id,
      kind:       'mt',
      label,
      lang:       target,
      mtSource:   source,
      srcCues,
      signRawAss: signRawAss ?? null,   // base track's typeset signs, translated
      sync:       { mode: 'none' },
    };
  }

  NS.CRSubFix.customSource = { LOCAL_ID, isCustomId, makeLocalSource, makeMtSource };
})();
