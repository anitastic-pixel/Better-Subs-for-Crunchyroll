# Chrome Web Store listing — Better Subs for Crunchyroll

Copy-paste source for the developer dashboard. Not shipped with the extension.

---

## Product name
Better Subs for Crunchyroll

## Category
Entertainment

## Language
English

---

## Summary (short description — max 132 characters)
Mix any subtitle language with any audio on Crunchyroll — plus dual subtitles for language learning, custom styling & translation.

---

## Detailed description

On Crunchyroll, subtitle tracks are tied to the audio dub you select. If you choose the English dub, you're limited to that dub's subtitles. 🎧

Better Subs for Crunchyroll removes that restriction, letting you use any available subtitle language with any audio track. 🌍

Watch the English dub with the original Japanese-based subtitles. Watch the Japanese audio with French subtitles. Mix and match audio and subtitles however you prefer. 🍿

It's also built for language learners: show the language being spoken and your own language on screen at the same time, and study a scene line by line. 📚

By default, subtitles are fetched directly from Crunchyroll's servers — nothing is added, modified, or sourced externally — and a custom overlay preserves the original styling and positioning while letting you customize the appearance. When a language you want simply isn't offered, two optional tools fill the gap: machine-translate an existing track, or load a subtitle file of your own. ✨

🚀 FEATURES
• Independent audio and subtitles — use any available subtitle language regardless of the selected dub.
• NEW • Learning mode — one tap shows the language being spoken (matched to your audio automatically) on top, with your own language beneath it: the classic study layout for picking up a language from what you're watching. 📚
• NEW • Dual subtitles — show any two subtitle languages stacked at once, and choose which track draws the on-screen typeset signs (primary, secondary, or both). 🈁
• NEW • Study tools — pause automatically at the end of each line for reading and shadowing, replay the last line, or copy the current line to your clipboard. 🎯
• In-player subtitle picker — browse every available subtitle language from a dropdown; problem tracks are flagged (wrong file, or no subtitles) so you can steer around them. 📊
• Accurate subtitle & sign rendering — positioned signs, rotations, per-line styling, and fade effects render through a real subtitle engine (the same kind fansubbers use) instead of being flattened to plain text. 🎨
• Show on screen — independently toggle the dialogue, the typeset signs, and Crunchyroll's own built-in subtitles, so only what you want appears. 🙈
• Automatic wrong-file recovery — detects when Crunchyroll has linked an incorrect subtitle file and automatically retrieves a correct version from another dub when available. 🛠️
• Extensive customization: ⚙️
   - Auto-enable subtitles
   - Subtitle size scaling (25–250%)
   - Timing offset adjustment (±60 minutes in 0.1-second increments) ⏱️
   - Vertical positioning
   - Independent styling for dialogue and typeset signs — fonts, colors, outlines, shadows, sizes, plus frosted-glass background boxes for dialogue
   - Live preview for all appearance settings
• Keyboard shortcuts: ⌨️
   - Alt+J — toggle the subtitle overlay
   - Alt+R — replay the current line (great for study)
   - Alt+C — copy the current subtitle line to the clipboard
   - C — quickly enable or disable subtitles while watching
• Per-episode memory — remembers your last selected subtitle language for each episode. 💾
• Machine translation (optional) — fill in a subtitle language Crunchyroll doesn't carry for a title, like Japanese or Korean, by translating an existing track with your own DeepL key; the on-screen typeset signs are translated too. Machine output is an approximation, not authored subtitles. 🌐
• Load your own subtitles — upload a custom .ass, .srt, or .vtt file (a fansub, or your own edit) and play it over the video, complete with its typeset signs and embedded fonts. 📂

💡 GOOD TO KNOW
Occasionally Crunchyroll links the wrong subtitle file to an episode on their own servers. Better Subs detects this and swaps in a correct copy from another dub when one exists; if every copy on their side is wrong, the source picker flags that language until Crunchyroll fixes the file. 🔍

🤝 HELP SHAPE IT
Better Subs is new and under active development, so you may hit the occasional rough edge. Bug reports, feature ideas, and feedback are genuinely welcome — they directly steer where the extension goes next.

Reporting is built right in: if something breaks, a one-click "Send a report?" prompt appears by the player, and you can send a report (with an optional note) anytime from the pop-up menu. 🪲 Reports attach a small diagnostic log to help fix the issue faster — it's optional (toggle it off in the pop-up), access tokens are stripped out, and nothing is sold or shared. 🔒 Prefer GitHub? Open an issue: https://github.com/anitastic-pixel/Better-Subs-for-Crunchyroll/issues

🛡️ NOT AFFILIATED
Better Subs for Crunchyroll is not affiliated with, endorsed by, or sponsored by Crunchyroll. "Crunchyroll" is a trademark of its respective owner, used only to describe what this extension works with. The extension adds no content of its own — it re-selects subtitle tracks Crunchyroll already serves to your account, and any machine translation or uploaded file comes from you (and your chosen translation provider), not from us. A Crunchyroll account/subscription is required to watch.

Better Subs is free. If it's useful to you and you'd like to support development, you can buy me some coffee: https://buymeacoffee.com/ani_ — entirely optional, and it never gates any feature. ☕

---

## Single purpose (dashboard field)
Better Subs for Crunchyroll lets a viewer display any subtitle language Crunchyroll already provides for an episode, independently of the audio dub, and renders it in a customizable on-screen overlay.

---

## Permission justifications (dashboard fields)

### storage
Stores the user's own preferences (enabled state, auto-enable, subtitle size, vertical position, timing offset, and appearance/style overrides), their last-chosen subtitle language, an optional DeepL API key (read only by the background worker, never exposed to the page), and a short-lived cache of subtitle files Crunchyroll already served so they are not re-downloaded. Everything is stored locally on the user's device. Data leaves the device only when the user acts: a diagnostic report they choose to send, or — if they set up the optional machine translation — the subtitle text sent to DeepL under their own key (both disclosed under the Privacy practices tab / privacy policy).

### activeTab
Used only by the toolbar popup, at the moment the user opens it, to read the current tab's address. If the tab is a Crunchyroll page that was already open before the extension was installed or updated (so Chrome never injected the content script), the popup shows a "Reload tab" button instead of the misleading "Not on an episode page". The address is not stored or sent anywhere.

### Host access — www.crunchyroll.com
The extension runs only on Crunchyroll watch pages (declared content scripts on www.crunchyroll.com). There it reads the list of subtitle tracks Crunchyroll already provides for the current episode and renders the user's chosen track as an overlay. It does not run on, inject into, or read any other website. To request the selected subtitle file it reuses the authorization token the browser is already sending to Crunchyroll for the user's own session; that token is used only to call Crunchyroll's own API on the same origin and is never stored long-term or sent anywhere else.

### Optional host access — api-free.deepl.com / api.deepl.com (DeepL)
Requested only if the user enables the optional machine-translation feature, and only at that moment (via chrome.permissions.request on a user click). It lets the background worker send the subtitle text the user chose to translate, together with the user's own DeepL API key, directly to DeepL over HTTPS — so a language Crunchyroll doesn't carry can be filled in. The key is stored locally and read only by the background worker; it is never exposed to the Crunchyroll page or sent anywhere except DeepL. If the user never enables translation, this permission is never requested, and it can be revoked any time from Chrome's settings.

### Remote code
Not used. All executable code is contained in the package. The extension loads no remote or external scripts.

---

## Privacy practices tab

Data collected/used — ONLY when a user submits a problem report (the voluntary survey sends only the answers, version, platform string, and optional feature on/off flags — nothing covered by the boxes below):
- Web history — the current Crunchyroll page URL plus the episodes navigated in the report's recent-activity log. CHECK THIS BOX.
- User activity — the user's subtitle/audio choices and recent in-extension actions. CHECK THIS BOX.
Leave everything else unchecked — no PII, health, financial, personal communications, location, or website content; Authentication stays unchecked because access tokens are stripped before anything is sent.
- The three certification checkboxes can all be affirmed:
  • Data is not sold or transferred to third parties (outside approved use cases).
  • Data is not used or transferred for purposes unrelated to the item's single purpose (diagnosing user-reported bugs).
  • Data is not used or transferred to determine creditworthiness or for lending.

Privacy policy URL: https://github.com/anitastic-pixel/Better-Subs-for-Crunchyroll/blob/main/PRIVACY.md

---

## Pre-submission checklist
- [ ] Set the LICENSE copyright holder (currently a generic placeholder).
- [x] PRIVACY.md is published in the repo; its URL goes in the Privacy practices tab.
- [ ] Privacy practices tab: check Web history + User activity (see above); update the storage justification with the report note.
- [ ] Screenshots (1280×800 or 640×400): popup with style controls, the on-player source picker, an episode with the overlay active. Min 1, up to 5.
- [ ] Optional: 440×280 small promo tile.
- [ ] Upload dist/better-subs-for-crunchyroll-v2.8.1.zip.
