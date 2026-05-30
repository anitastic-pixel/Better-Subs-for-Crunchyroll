# Privacy Policy — Better Subs for Crunchyroll

_Last updated: 2026-05-28_

**Better Subs for Crunchyroll does not collect, transmit, or sell any personal
data.** There are no analytics, no tracking, no remote servers, and no accounts.

## What the extension stores

All data stays on your own device:

- **Your settings** (enable state, auto-activate, subtitle size, sync offset,
  style overrides, last-chosen subtitle source) are saved with the Chrome
  `storage` API, scoped to the extension.
- **A subtitle cache** is kept in the page's own `localStorage` /
  `sessionStorage` to avoid re-downloading the same subtitle files. Cached
  entries expire automatically (7–30 days depending on the entry).

None of this leaves your browser. Removing the extension (or clearing its data)
removes all of it.

## Network activity

The extension only ever talks to **Crunchyroll's own servers**
(`www.crunchyroll.com` and its subtitle CDN), and only to do the thing it
exists to do: read the list of available subtitle tracks for the episode you
are watching and download the subtitle file you select.

To make those requests it reuses the authorization token your browser is
**already** sending to Crunchyroll for your own session. That token is used
solely to call Crunchyroll's playback API on the same origin; it is never
logged, stored long-term, or sent anywhere other than Crunchyroll.

## Permissions

- **`storage`** — to save your settings and the subtitle cache (described
  above). This is the only permission the extension requests.

The extension runs only on `www.crunchyroll.com` pages.

## Third parties

There are none. No data is shared with any third party because no data is
collected in the first place.

## Contact

Questions about this policy can be raised as an issue on the project's
repository.
