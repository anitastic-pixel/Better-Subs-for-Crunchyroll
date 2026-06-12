# Better Subs for Crunchyroll

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![Manifest V3](https://img.shields.io/badge/manifest-v3-4caf50.svg) ![Data: opt-in reports only](https://img.shields.io/badge/data-opt--in%20reports%20only-ff6b35.svg) ![Chrome 88+](https://img.shields.io/badge/chrome-88%2B-4285F4.svg)

A Chrome extension that lets you mix and match subtitle languages independently from the audio track on Crunchyroll. Watch the English dub with the accurate original subtitles, the Japanese dub with French subtitles, or any other combination — the audio and subtitle tracks are fully decoupled. You can also **bring your own subtitles**: upload a fansub file or machine-translate an existing track, and the extension renders it over the player like any built-in source.

> **Not affiliated with, endorsed by, or sponsored by Crunchyroll.** "Crunchyroll" is a trademark of its respective owner and is used here only to describe what this extension works with. The extension ships **no subtitle content of its own**. It re-selects subtitle tracks that Crunchyroll already serves to your account, and — only at your initiative — displays subtitle files you supply yourself (a file you upload, or a machine translation produced with your own API key). It hosts, indexes, and distributes nothing.

---

## Features

- **Mix-and-match subtitles** — choose any subtitle source independently from the audio dub you're watching. Built-in sources are pulled from Crunchyroll's own CDN
- **Bring your own subtitles** — upload a local fansub file (`.ass`, `.ssa`, `.srt`, `.vtt`) and the extension renders it over the player as a *custom source*, with its own typeset signs and any fonts the `.ass` embeds. Useful when Crunchyroll ships no track for the language you want (e.g. no Japanese subtitles, since it can't stream in Japan)
- **Machine translation (bring your own key)** — translate any existing track into another language with your own DeepL API key. The result is added as a custom source and clearly labelled as machine-translated; keys stay on your device and translations are cached per episode
- **Dual subtitles** — show a second language alongside the first (target language + your own, say), stacked above the primary line. Pick it from the source picker's "Second subtitle" submenu; both tracks come from the same timeline so they stay in sync
- **Watch & learn** — `Alt+R` replays the line on screen (press again to step back line-by-line), `Alt+C` copies it to your clipboard, and an optional "pause at end of each line" mode stops on every subtitle for shadowing/reading
- **Subtitle sync** — custom sources auto-align to the video when they share a language with a Crunchyroll track, or you can align them by hand with a two-point sync panel right on the player
- **Source picker** — on-player dropdown lists every available subtitle locale with live validation badges so you can see at a glance which sources are usable, plus a "Custom" section for your uploads and translations
- **ASS overlay with full typesetting support** — renders subtitles via a custom overlay that supports positioned signs, per-dialogue style tags, and fade animations, matching the original subtitle file's intent. Positioned signs are rendered with the real libass engine for pixel-accurate typesetting
- **Subtitle validation** — automatically detects cross-linked wrong-title subtitle files (duration mismatch) and probes other dub sessions for a working replacement
- **Auto-activate** — optionally activate your preferred subtitle source automatically when an episode starts
- **Subtitle size** — scale subtitles from 25% to 250%
- **Sync offset** — shift subtitle timing in 0.1s increments, up to ±60 minutes
- **Style override** — override the subtitle appearance entirely:
  - Font family
  - Text colour and opacity
  - Outline colour and width
  - Shadow depth, style (hard/soft glow), and opacity
  - Background box with colour, opacity, corner radius, and padding
- **Keyboard shortcuts** — `Alt+J` toggle overlay · `Alt+R` replay current line · `Alt+C` copy current line
- **Preference memory** — remembers your last chosen subtitle source per episode
- **SPA navigation** — correctly resets between episodes without a page reload

---

## Supported subtitle locales

Japanese, English, English (UK), Deutsch, Español (Lat), Español (España), Français, Português (BR), Português (PT), Italiano, Русский, العربية, 中文 (简/繁), हिंदी, 한국어, Polski, Türkçe, Nederlands, and more.

---

## Install

### From the Chrome Web Store

> 🚧 **Pending review.** Once the listing is approved, the install button and a live version badge will appear here.
>
> <!-- After the listing is published, replace EXTENSION_ID below and uncomment:
> [![Available in the Chrome Web Store](https://img.shields.io/chrome-web-store/v/EXTENSION_ID?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/EXTENSION_ID)
> -->

### From source (developer mode)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `extension/` folder inside the repository
5. Navigate to any Crunchyroll episode — the extension activates automatically

---

## Usage

### Popup controls

| Control | Description |
|---|---|
| **Enable extension** | Turn the extension on or off |
| **Auto-enable subtitles** | Activate subtitles automatically when playback starts |
| **Subtitle size** | Scale subtitle size (25%–250%) |
| **Sync offset** | Nudge subtitle timing earlier or later |
| **Bottom margin** | Distance from the bottom of the video to default-anchored subtitles (0–30% of video height) |
| **Override subtitle style** | Enable custom appearance settings |

### On the player

A small button appears on the Crunchyroll player. The two-letter code shows the active subtitle source (e.g. **JP**, **EN**, **DE**). Click it to toggle the overlay on/off.

Click the source label next to the button to open the **source picker** and switch to any available subtitle locale. Each row shows a validation badge:

| Badge | Meaning |
|---|---|
| valid | Subtitle file confirmed to match this episode |
| ⚠ wrong title | Crunchyroll has linked the wrong subtitle file to this locale (see Known Issues) |
| no subs | No subtitle file found for this locale |

### Custom sources — bring your own subtitles

Open the source picker and look for the **Custom** section:

- **＋ Load subtitle file…** — pick a local `.ass`, `.ssa`, `.srt`, or `.vtt` file. It's parsed in the browser and added as a custom source; nothing is uploaded anywhere. `.ass` files keep their positioned signs and any embedded fonts.
- **🌐 Translate** — machine-translate an existing track into another language using your own DeepL key (configure the provider and key in the popup). The translation is added as a custom source labelled **machine** and cached per episode so it never re-spends your quota on a reload.
- Each custom row has a **✕** to remove it, and — when active — **⚙ Adjust sync…** to align the timing and **⬇ Export…** to save the track out as SRT (machine translations export bilingually, translation over source, for easy proofreading).

Custom sources are remembered per episode. A same-language upload auto-aligns to the video; a cross-language one (e.g. a Japanese fansub over an English track) is aligned with the two-point sync panel — mark the first line, mark the last line, and the timing is fitted between them.

### Dual subtitles

Open the source picker and choose **Second subtitle ▸**, then pick a language (or **Off**). It renders stacked just above your primary line — handy for learning (target language + your own) or for comparing the dub script against the accurate subs. Both tracks are pulled from the same session, so they share one timeline and stay in sync.

The secondary can be any built-in locale **or one of your custom sources** — pair, say, a Crunchyroll primary with a machine-translated second language. (Generating a second machine translation uses more of your DeepL quota, so the menu flags that.)

The same submenu has a **Signs** selector for the typeset signs: **Primary** (default) or **Secondary** draws signs from that one track — useful to keep the original-language signs under translated dialogue — and **Both** overlays both languages' signs (where a sign appears at the same spot in both tracks, the two will overlap). Some Crunchyroll locales are dialogue-only (no typeset signs) — for those, the **Secondary**/**Both** options are greyed out, since there's nothing to draw.

### Watch & learn

For studying or just catching a line you missed:

- **`Alt+R` — replay the current line.** Jumps the video back to the start of the subtitle on screen and plays it. Press again to step back line-by-line.
- **`Alt+C` — copy the current line** to your clipboard (for a dictionary lookup, a study deck, or quoting).
- **Pause at end of each line** (popup → *Playback*). Stops playback the moment each subtitle finishes — with the line still on screen — for shadowing or reading at your own pace.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+J` | Toggle the subtitle overlay |
| `Alt+R` | Replay the current/previous line |
| `Alt+C` | Copy the current line to the clipboard |

(`Alt`-modified so they never clash with Crunchyroll's own player keys; they don't fire while you're typing in a text field.)

### Status indicator (popup)

| Status | Meaning |
|---|---|
| Waiting for episode to load | Not on an episode page yet |
| Fetching subtitle data | Actively loading |
| Subtitles ready | Subtitles fetched and ready |
| Subtitles active | Overlay is currently on |
| Reload tab to activate subtitles | A reload is needed to load subtitle data |
| Error fetching subtitles | Fetch failed — click the player button to retry |
| No subtitles available for this episode | No usable subtitle source was found |

---

## Style Override

Enable **Override subtitle style** in the popup to replace the subtitle file's own styling with custom settings. A live preview (rendered over a sunset gradient) updates in real time as you adjust values.

Enabling **Background Box** disables the outline and shadow controls and replaces them with a solid colour box behind each subtitle line.

---

## How It Works

Two scripts run on Crunchyroll:

- **`interceptor.js`** (MAIN world) — intercepts `window.fetch` to capture Crunchyroll's playback API responses, collects subtitle CDN URLs for every available dub session, renders the ASS overlay, and manages the source picker menu
- **`content.js`** (isolated world) — bridges `chrome.storage` settings to the page via `<html>` data attributes and relays messages between the popup/background script and `interceptor.js`

Subtitle text is cached in `sessionStorage` per tab session to avoid redundant CDN requests. Validation results are cached in `localStorage` for 7 days per episode. Custom sources (uploaded files and machine translations) are stored per episode in `localStorage` for 30 days, so they survive a reload without re-uploading or re-translating.

Positioned typeset signs are rendered with a bundled build of [libass](https://github.com/libass/libass) (via [SubtitlesOctopus](https://github.com/libass/JavascriptSubtitlesOctopus)) so they match the original `.ass` file pixel-for-pixel, including embedded fonts; dialogue lines use the extension's own CSS overlay so your size and style overrides still apply.

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Persists user settings and subtitle cache across sessions |
| `https://api.deepl.com/*`, `https://api-free.deepl.com/*` *(optional)* | Only requested if you enable machine translation, so the extension can call DeepL with your own key. Not part of the default install prompt |

No host permissions are requested at install time. No remote code. No data is collected automatically — the only data that ever leaves your device is the text you choose to machine-translate (sent to DeepL with your own key, only when you enable that feature) and a problem report you choose to send (see [Privacy](#privacy)).

---

## Privacy

**Better Subs for Crunchyroll transmits nothing on its own** — no analytics, no tracking, no accounts. Your settings and a short-lived subtitle cache live entirely on your own device, and during normal use the extension only talks to Crunchyroll's own servers, reusing the session your browser already has. Files you upload as custom sources are parsed in the browser and never leave your device.

If you enable **machine translation**, the subtitle text you translate is sent directly to DeepL using the API key you provide — the key is stored on your device and is never sent anywhere else, and the resulting translation is cached locally per episode.

The one exception is a **problem report you choose to send** (the on-error prompt, or the popup's **Send a report**): it sends a small, anonymized diagnostic bundle — extension version, a **coarse platform string** (OS family + Chrome version, never your full user-agent), the **episode id** you're on (a public id; the title slug is dropped), recent in-extension activity, and your settings, plus an optional note — to the developer to help fix the bug. **URLs, signed tokens, emails, and long ids are redacted** before anything leaves your device, and there's no account, profile, or identifier attached. You can turn the diagnostics off in the popup (**Include diagnostics**) to send only the version, platform, and your note. Nothing is sold, shared with advertisers, or used for any unrelated purpose.

See the full [Privacy Policy](PRIVACY.md).

---

## Known Issues

### ⚠ Wrong subtitle file linked by Crunchyroll

Crunchyroll occasionally links the wrong subtitle file to an episode or locale — the subtitle data on their CDN points to a file that was authored for a completely different title. This is a server-side data error on Crunchyroll's end, not something the extension can correct.

When this happens, the extension detects it by comparing the subtitle file's duration against the video's actual runtime. If the gap exceeds 5 minutes, the locale is flagged. The extension then probes every other available dub session to see if any of them carry a valid copy of that subtitle language. If a valid replacement is found it is used automatically. If no valid source exists anywhere, the locale is marked **⚠ wrong title** in amber in the source picker and the subtitle overlay will not display for that locale.

There is currently no fix for episodes where every available session carries the wrong file — this is a data issue that only Crunchyroll can resolve on their end.

---

## Compatibility

- Chrome 88+
- Crunchyroll (`www.crunchyroll.com`)
