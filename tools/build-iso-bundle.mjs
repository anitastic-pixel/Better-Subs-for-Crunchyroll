// tools/build-iso-bundle.mjs
//
// Generates extension/lib/iso-bundle.js by concatenating its two source
// modules so the settings/protocol schema lives in exactly one place.
//
// iso-bundle.js is the isolated-world dependency bundle for content.js. It has
// to be a separate physical file because of a Chrome MV3 quirk (see the banner
// it emits). Rather than hand-mirroring settings-schema.js + protocol.js into
// it — which silently drifts — this script rebuilds it from those sources.
//
// Run after editing settings-schema.js or protocol.js:
//   node tools/build-iso-bundle.mjs
//
// The output is committed to the repo (the unpacked extension loads it
// directly, so there must be no build step required just to run it).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const libDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'lib');
const SOURCES = ['settings-schema.js', 'protocol.js'];

const banner = `/**
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
`;

// Strip each source's own leading /** ... */ doc comment so the generated file
// reads cleanly under the banner above.
const stripLeadingDocComment = (src) =>
  src.replace(/^﻿?\s*\/\*\*[\s\S]*?\*\/\s*/, '');

const parts = SOURCES.map((name) => {
  const body = stripLeadingDocComment(readFileSync(join(libDir, name), 'utf8')).trimEnd();
  return `// ===== generated from lib/${name} =====\n${body}\n`;
});

writeFileSync(join(libDir, 'iso-bundle.js'), banner + '\n' + parts.join('\n'), 'utf8');
console.log(`Wrote extension/lib/iso-bundle.js from ${SOURCES.join(' + ')}`);
