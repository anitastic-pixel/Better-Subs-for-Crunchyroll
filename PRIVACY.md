# Privacy Policy — Better Subs for Crunchyroll

_Last updated: 2026-09-21_

**Better Subs for Crunchyroll does not collect, transmit, or sell your data
automatically.** There are no analytics, no tracking, and no accounts. The one
exception is a **problem report or survey you explicitly choose to send** (see
below).

## What the extension stores

All data stays on your own device:

- **Your settings** (enable state, auto-activate, subtitle size, sync offset,
  style overrides, last-chosen subtitle source) are saved with the Chrome
  `storage` API, scoped to the extension.
- **A subtitle cache** is kept in the page's own `localStorage` /
  `sessionStorage` to avoid re-downloading the same subtitle files. Cached
  entries expire automatically (7–30 days depending on the entry).
- **Custom sources you add** — a subtitle file you upload, or a
  machine-translated track you generate — are stored in the page's
  `localStorage`, scoped to that episode, so they survive a reload.
- **A machine-translation API key**, if you choose to set one up, is stored with
  the Chrome `storage` API on your device. It is read only by the extension's
  background worker to call the translation provider, and is never shown to the
  Crunchyroll page or sent anywhere except that provider.

None of this leaves your browser, except the machine-translation requests
described under **Network activity** (which happen only if you set up and use
that optional feature). Removing the extension (or clearing its data) removes
all of it.

## Problem reports you choose to send

The extension transmits nothing on its own. If — and only if — you click the
on-error "Send a report?" prompt, or the popup's **Send a report** button, a
small diagnostic bundle is sent to the developer to help fix the bug:

- the extension version and a **coarse platform string** (OS family + Chrome
  major version — e.g. "Windows · Chrome 148"). The full user-agent is
  **never** sent, at any level;
- the **episode id** of the page you're on (a public identifier — the title
  slug is dropped) and recent in-extension activity (subtitle-loading events,
  including the paths of subtitle files loaded from Crunchyroll's CDN). Before
  it leaves your device, URL query strings (where signed access tokens live),
  email addresses, and long hexadecimal ids are removed;
- your extension settings, and an optional note you type.

You can turn the diagnostic details off in the popup (**Include diagnostics**).
A report from the popup then sends only the version, the platform string, and
your note; the on-error prompt sends only the version and the error message.
**Signed access tokens are stripped before anything is sent.** Reports are delivered to a private developer channel,
used solely to diagnose and fix bugs, and are never sold, shared with
advertisers, or used for any unrelated purpose.

## The voluntary survey

The popup's **Quick survey** (under Help & feedback) works the same way: it
sends nothing until you press **Send survey**, and the payload is only your
answers — which features you use (checkboxes), an optional note, an optional
1–5 rating — the extension version and the coarse platform string, plus, if you leave **Include settings snapshot** ticked, a list
of on/off feature flags (e.g. `mtEnabled=true`). No episode, page, history, or
identifying information is ever part of a survey. It goes to the same private
developer channel as problem reports and is used only to prioritize what to
build next.

## Network activity

The extension only ever talks to **Crunchyroll's own servers**
(`www.crunchyroll.com` and its subtitle CDN), and only to do the thing it
exists to do: read the list of available subtitle tracks for the episode you
are watching and download the subtitle file you select.

To make those requests it reuses the authorization token your browser is
**already** sending to Crunchyroll for your own session. That token is used
solely to call Crunchyroll's playback API on the same origin; it is never
logged, stored long-term, or sent anywhere other than Crunchyroll.

The only other network destinations are:

- the problem-report endpoint described above, and only when you choose to send
  a report;
- **DeepL** (the machine-translation provider), and only if you set up the
  optional machine-translation feature and then generate a translated track. In
  that case the subtitle text being translated is sent — together with your own
  DeepL API key — directly from the extension's background worker to DeepL. No
  translation request is ever made unless you both configure a key and trigger a
  translation; the text and key go only to DeepL, never to the developer.

## Permissions

- **`storage`** — to save your settings, the subtitle cache, your custom
  sources, and (if set) your translation API key.
- **`activeTab`** — lets the popup see the address of the tab you opened it
  on, only at the moment you open it, so it can tell a Crunchyroll tab that
  needs reloading apart from a non-Crunchyroll tab. Nothing about the tab is
  stored or sent.

`storage` and `activeTab` are the only permissions requested at install time.
- **Optional host access to `api-free.deepl.com` and `api.deepl.com`** —
  requested only when you enable machine translation, so the background worker
  can reach DeepL. If you never use that feature, it is never requested, and you
  can revoke it any time from Chrome's extension settings.

The extension's content scripts run only on `www.crunchyroll.com` pages.

## Third parties

The extension shares no data for advertising or sale. A problem report you
choose to send is delivered to the developer through a Cloudflare Worker (which
only relays it) and a private chat channel; these process the report on the
developer's behalf and for no other purpose.

If you enable machine translation, the subtitle text you translate is sent to
**DeepL** under **your own** API key and their terms and privacy policy — a
direct relationship between you and DeepL, with the developer neither involved
in nor able to see it.

## Contact

Questions about this policy can be raised as an issue on the project's
repository.
