# Privacy Policy — Better Subs for Crunchyroll

_Last updated: 2026-06-06_

**Better Subs for Crunchyroll does not collect, transmit, or sell your data
automatically.** There are no analytics, no tracking, and no accounts. The one
exception is a **problem report you explicitly choose to send** (see below).

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

## Problem reports you choose to send

The extension transmits nothing on its own. If — and only if — you click the
on-error "Send a report?" prompt, or the popup's **Send a report** button, a
small diagnostic bundle is sent to the developer to help fix the bug:

- the extension version and your browser's user-agent string;
- the current Crunchyroll page URL and recent in-extension activity (which
  episodes you navigated between and subtitle-loading events);
- your extension settings, and an optional note you type.

You can turn the diagnostic details off in the popup (**Include diagnostics**),
which sends only the version and your note. **Signed access tokens are stripped
before anything is sent.** Reports are delivered to a private developer channel,
used solely to diagnose and fix bugs, and are never sold, shared with
advertisers, or used for any unrelated purpose.

## Network activity

The extension only ever talks to **Crunchyroll's own servers**
(`www.crunchyroll.com` and its subtitle CDN), and only to do the thing it
exists to do: read the list of available subtitle tracks for the episode you
are watching and download the subtitle file you select.

To make those requests it reuses the authorization token your browser is
**already** sending to Crunchyroll for your own session. That token is used
solely to call Crunchyroll's playback API on the same origin; it is never
logged, stored long-term, or sent anywhere other than Crunchyroll.

The only other network destination is the problem-report endpoint described
above, and only when you choose to send a report.

## Permissions

- **`storage`** — to save your settings and the subtitle cache (described
  above). This is the only permission the extension requests.

The extension runs only on `www.crunchyroll.com` pages.

## Third parties

The extension shares no data for advertising or sale. A problem report you
choose to send is delivered to the developer through a Cloudflare Worker (which
only relays it) and a private chat channel; these process the report on the
developer's behalf and for no other purpose.

## Contact

Questions about this policy can be raised as an issue on the project's
repository.
