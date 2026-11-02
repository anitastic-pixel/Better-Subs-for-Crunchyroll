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
Pair any subtitle language Crunchyroll offers with any audio. Dual subtitles for learners, custom styling, optional translation.

---

## Detailed description

On Crunchyroll, which subtitles you can pick depends on the audio. Choose the English dub and you usually get only that dub's own subtitles or captions. 🎧

Better Subs for Crunchyroll lets you use any subtitle language Crunchyroll has for an episode, whatever audio you're listening to. 🌍

⚠️ IMPORTANT: Better Subs CANNOT add subtitle languages Crunchyroll doesn't have. The menu lists only the subtitle languages Crunchyroll serves for that episode. Crunchyroll has NO Japanese subtitles, and Chinese and other languages appear only where Crunchyroll offers them for that episode. To get a missing language, use the optional machine translation (your own DeepL API key) or load your own subtitle file.

• Watch the English dub with the English subtitles written for the Japanese version (they follow the Japanese script, so they won't always match what the dub says).
• Watch a German dub with Spanish subtitles.
• Mix and match however you like, as long as Crunchyroll has that language for the episode. 🍿

For language learners, Better Subs can show the spoken language and your own language on screen together, so you can study line by line. This needs subtitles in the spoken language. Crunchyroll has them for many dubs (English, French, German, Spanish and more), but it has no Japanese subtitles. For Japanese audio, make a Japanese track with the optional DeepL machine translation or load your own subtitle file. 📚

The subtitle text comes straight from Crunchyroll, and Better Subs doesn't rewrite it. It draws the subtitles in its own overlay and changes only what you choose: size, style, position, and timing. When the subtitles come from a different version of the episode, it may also shift their timing to line up with your dub. ✨

🎉 Better Subs just passed 1,000 users! Thank you for watching with it, and thank you to everyone who sent a report: most of these improvements started with your feedback. 💛

🆕 WHAT'S NEW IN 3.0.0
- Works again after a Crunchyroll update that left subtitles stuck on "waiting for the episode to load" and stopped "hide Crunchyroll's subtitles" from working.
- Where Crunchyroll has no English subtitles for an episode, Better Subs now switches to another language it does have (your own language if available) instead of loading forever.
- Translate your own subtitle file: in Translation settings, pick "Your uploaded file" as the From track and DeepL translates your upload instead of Crunchyroll's track.
- Easier re-translation: picking a different From track now re-translates and replaces that language's translation. You no longer have to remove the old one first.
- Frame-accurate display: subtitles now appear and disappear on the exact video frame, instead of up to a quarter-second late.
- Faster sync: auto-sync is about 5× faster, and the extension does less work in the background while you watch.
- Native language names: the pop-up shows language names in their own language.
- Works with asbplayer: hiding Crunchyroll's subtitles no longer hides asbplayer's too.
- Hiding Crunchyroll's subtitles works again after a recent Crunchyroll change, and on most episodes it now takes effect without a reload.
- Better Subs no longer changes Crunchyroll's own subtitle setting unless you ask it to.
- The Translate option is always in the ▾ menu, even before you set up a DeepL key, so it's easier to find.
- Learning mode no longer claims Japanese subtitles that Crunchyroll doesn't have. With Japanese audio, it uses your machine-translated Japanese track if you've made one.
- Stale tab recovery: if a Crunchyroll tab was open before Better Subs was installed or updated, the pop-up offers a one-click "Reload tab".
- If the extension is installed twice, the second copy steps aside instead of clashing with the first.
- Tamil dubs are now labeled.
- Reports no longer include show titles or playback session IDs, and they flag when a tab only needs a reload.

🚀 FEATURES
- Any subtitles with any audio: pick from every subtitle language Crunchyroll has for the episode, whichever dub you're watching.
- Auto-sync: different versions of an episode can be edited differently. Better Subs re-times the subtitles to your dub when it finds enough matching lines. When it can't, you can adjust the timing yourself in 0.1-second steps. ⏱️
- Learning mode: one tap puts the spoken language on top (matched to your audio) and your own language underneath. It needs subtitles in the spoken language. 📚
- Dual subtitles: show any two subtitle languages stacked, and choose which one draws the on-screen signs (first, second, or both). 🈁
- Study tools: pause at the end of each line for reading or shadowing, replay the current line, or copy it. 🎯
- In-player menu: every available language in one dropdown. Languages with a known problem are marked ("wrong title" or "no subs"). 📊
- Sign rendering: positioned signs, rotations, and fades are drawn with libass, the open-source engine used by fansubbers and video players like mpv. 🎨
- Show on screen: turn dialogue, signs, and Crunchyroll's own subtitles on or off separately. Crunchyroll's new player often burns its subtitles into the video; on episodes where Crunchyroll has no subtitle-free video, they can't be hidden. 🙈
- Wrong-file recovery: catches subtitle files that clearly belong to another episode and swaps in a correct copy from another dub when one exists. It won't catch every mismatch. 🛠️
- Customization: auto-enable, subtitle size (25–250%), vertical position, timing offset, and separate styling for dialogue and signs (font, color, outline, shadow, size, and background boxes including frosted glass), with a live preview in the pop-up. ⚙️
- Keyboard shortcuts: ⌨️
   • Alt+J — toggle the subtitle overlay (changeable in Chrome's shortcut settings)
   • Alt+R — replay the current line
   • Alt+C — copy the current line
   • C — turn subtitles on or off while watching
- Remembers your language: the subtitle language you pick carries over to your next episodes. 💾
- Machine translation (optional): fills in a language Crunchyroll doesn't have for an episode, such as Japanese, by translating an existing track with your own DeepL API key (DeepL's free API plan works). Signs are translated too, though Japanese, Chinese, and Korean signs are drawn in a simpler style. The text goes from your browser straight to DeepL under your key and never reaches us. It's machine output, so expect mistakes. You can export the result as an .srt file. 🌐
- Your own subtitles: load an .ass, .ssa, .srt, or .vtt file from the ▾ menu (a fansub or your own edit). .ass files keep their signs and embedded fonts. The file stays in your browser. 📂

💡 GOOD TO KNOW
- Better Subs can only use what Crunchyroll has. If a language isn't offered for an episode, it won't appear unless you machine-translate it or load your own file.
- Crunchyroll sometimes links the wrong subtitle file to an episode. If every copy on Crunchyroll is wrong, the menu marks that language until Crunchyroll fixes it. 🔍
- A Crunchyroll tab that was open before you installed or updated Better Subs has to be reloaded before the extension works in it.

🤝 FEEDBACK & SUPPORT
Run into a problem? Use the "send a report?" prompt that appears by the player after an error, or send one anytime from the pop-up with a line about what went wrong. 🪲 A report includes the extension version, your OS and Chrome version, and your note. Unless you switch it off in the pop-up, it also includes a diagnostic log: the episode ID, your extension settings, and recent extension activity. Signed links, tokens, and email addresses are removed before it's sent. Reports go only to the developer and are never sold. 🔒
GitHub: https://github.com/anitastic-pixel/Better-Subs-for-Crunchyroll/issues

🛡️ NOT AFFILIATED
Better Subs for Crunchyroll is an independent project and is not affiliated with, endorsed by, or sponsored by Crunchyroll. "Crunchyroll" is a trademark of its owner, used only to say what this extension works with. The extension adds no content of its own: it switches between subtitle tracks Crunchyroll already serves to your account. Machine translations come from DeepL under your own key, and files you load are your own. You need a Crunchyroll account and subscription to watch.

Better Subs is free. If it's useful and you'd like to support development, you can buy me a coffee: https://buymeacoffee.com/ani_ (entirely optional, and it never unlocks features). ☕

---

## Single purpose (dashboard field)
Better Subs for Crunchyroll lets a viewer display any subtitle language Crunchyroll already provides for an episode, independently of the audio dub, and renders it in a customizable on-screen overlay.

---

## Permission justifications (dashboard fields)

### storage
Stores the user's own preferences (enabled state, auto-enable, subtitle size, vertical position, timing offset, and appearance/style overrides), their last-chosen subtitle language, an optional DeepL API key (read only by the background worker, never exposed to the page), and a short-lived cache of subtitle files Crunchyroll already served so they are not re-downloaded. Everything is stored locally on the user's device. Data leaves the device only when the user acts: a diagnostic report they choose to send, or — if they set up the optional machine translation — the subtitle text sent to DeepL under their own key (both disclosed under the Privacy practices tab / privacy policy).

### activeTab
Used only by the toolbar popup, at the moment the user opens it, to read the current tab's address. If the tab is a Crunchyroll page that was already open before the extension was installed or updated (so Chrome never injected the content script), the popup shows a "Reload tab" button instead of the misleading "Not on an episode page". If the user chooses to send a problem report, the report only notes whether that tab is a Crunchyroll page. The address itself is never stored or sent anywhere.

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
- [ ] Upload dist/better-subs-for-crunchyroll-v3.0.0.zip.
