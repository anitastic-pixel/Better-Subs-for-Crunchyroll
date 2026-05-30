# Better Subs for Crunchyroll

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![Manifest V3](https://img.shields.io/badge/manifest-v3-4caf50.svg) ![Data collected: none](https://img.shields.io/badge/data%20collected-none-ff6b35.svg) ![Chrome 88+](https://img.shields.io/badge/chrome-88%2B-4285F4.svg)

A Chrome extension that lets you mix and match subtitle languages independently from the audio track on Crunchyroll. Watch the English dub with Japanese subtitles, the Japanese dub with French subtitles, or any other combination — the audio and subtitle tracks are fully decoupled.

> **Not affiliated with, endorsed by, or sponsored by Crunchyroll.** "Crunchyroll" is a trademark of its respective owner and is used here only to describe what this extension works with. The extension adds no content of its own — it only re-selects subtitle tracks that Crunchyroll already serves to your own account.

---

## Features

- **Mix-and-match subtitles** — choose any subtitle source independently from the audio dub you're watching. Subtitles are pulled from Crunchyroll's own CDN; no external sources
- **Source picker** — on-player dropdown lists every available subtitle locale with live validation badges so you can see at a glance which sources are usable
- **ASS overlay with full typesetting support** — renders subtitles via a custom overlay that supports positioned signs, per-dialogue style tags, and fade animations, matching the original subtitle file's intent
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
- **Keyboard shortcut** — `Alt+J` to toggle the subtitle overlay
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

### Keyboard shortcut

`Alt+J` toggles the subtitle overlay without opening the popup.

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

Subtitle text is cached in `sessionStorage` per tab session to avoid redundant CDN requests. Validation results are cached in `localStorage` for 7 days per episode.

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Persists user settings and subtitle cache across sessions |

No host permissions required. No remote code. No data collection or external servers.

---

## Privacy

**Better Subs for Crunchyroll collects no data.** No analytics, no tracking, no accounts, no remote servers. Your settings and a short-lived subtitle cache live entirely on your own device, and the extension only ever communicates with Crunchyroll's own servers — reusing the session your browser already has.

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
