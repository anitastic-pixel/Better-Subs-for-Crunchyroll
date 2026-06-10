/**
 * background.js — MV3 service worker.
 *
 * Responsibilities:
 * 1. Relay the Alt+J keyboard shortcut to the active tab's content script.
 * 2. Update the extension action badge when content.js reports overlay state.
 * 3. Machine translation: the ONLY place the user's BYOK API key is read.  The
 *    key lives in chrome.storage.local and never crosses into a page/content
 *    world — content.js forwards just the text batch; the SW attaches the key
 *    and calls DeepL / Google.  Cross-origin fetch here relies on the
 *    optional_host_permissions the popup requests when the user enables MT.
 */

importScripts('lib/protocol.js');
const { MSG } = self.CRSubFix.protocol;

// ── Machine translation ────────────────────────────────────────────────────
// DeepL free keys end in ':fx' and use a different host from pro keys.
function deeplHost(key) {
  return key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
}
// DeepL source codes are 2-letter (no region); target codes may be regional.
function deeplSource(loc) { return loc ? loc.slice(0, 2).toUpperCase() : ''; }
function deeplTarget(loc) {
  const m = { 'pt-BR': 'PT-BR', 'pt-PT': 'PT-PT', 'en': 'EN-US', 'en-US': 'EN-US', 'en-GB': 'EN-GB' };
  return m[loc] ?? (loc ? loc.slice(0, 2).toUpperCase() : '');
}
function googleLang(loc) {
  if (!loc) return '';
  const m = { 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'pt-BR': 'pt', 'pt-PT': 'pt' };
  return m[loc] ?? loc.slice(0, 2).toLowerCase();
}
// Google with format:'text' can still emit a few HTML entities (e.g. &#39;).
function decodeEntities(s) {
  return String(s)
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
}

async function deeplTranslate(key, texts, source, target) {
  const params = new URLSearchParams();
  for (const t of texts) params.append('text', t);
  params.append('target_lang', deeplTarget(target));
  const src = deeplSource(source);
  if (src) params.append('source_lang', src);
  const resp = await fetch(deeplHost(key) + '/v2/translate', {
    method:  'POST',
    headers: { 'Authorization': 'DeepL-Auth-Key ' + key.trim(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    let msg = '';
    try { msg = (JSON.parse(body)?.message) || ''; } catch (_) {}
    console.warn('[Better Subs] DeepL HTTP ' + resp.status + ': ' + body.slice(0, 300));
    return { ok: false, error: 'DeepL HTTP ' + resp.status + (msg ? ': ' + msg.slice(0, 130) : ''), status: resp.status };
  }
  const data = await resp.json();
  if (!data || !Array.isArray(data.translations)) return { ok: false, error: 'DeepL: bad response' };
  return { ok: true, translations: data.translations.map(t => t.text) };
}

async function googleTranslate(key, texts, source, target) {
  const body = { q: texts, target: googleLang(target), format: 'text' };
  const src = googleLang(source);
  if (src) body.source = src;
  const resp = await fetch('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(key.trim()), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!resp.ok) return { ok: false, error: 'Google HTTP ' + resp.status, status: resp.status };
  const data = await resp.json();
  const arr  = data?.data?.translations;
  if (!Array.isArray(arr)) return { ok: false, error: 'Google: bad response' };
  return { ok: true, translations: arr.map(t => decodeEntities(t.translatedText)) };
}

// Gemini (Generative Language API).  An LLM, so unlike NMT we can ask it to
// preserve speaker register / character voice and keep names accurate — the
// weakness DeepL/Google NMT show.  Strict JSON-array output keeps cues aligned.
const GEMINI_LANG = {
  'ja-JP': 'Japanese', 'ko-KR': 'Korean', 'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)', 'en-US': 'English', 'en-GB': 'English',
  'de-DE': 'German', 'es-419': 'Latin American Spanish', 'es-ES': 'European Spanish',
  'fr-FR': 'French', 'pt-BR': 'Brazilian Portuguese', 'it-IT': 'Italian', 'ru-RU': 'Russian',
};
const geminiLang = (loc) => GEMINI_LANG[loc] || loc || 'the source language';

async function geminiTranslate(key, texts, source, target) {
  const model  = 'gemini-2.0-flash';
  const prompt =
    `Translate these anime subtitle lines from ${geminiLang(source)} to ${geminiLang(target)}. ` +
    `Translate naturally and idiomatically, preserving each speaker's register and tone ` +
    `(casual, rough, polite, formal, archaic, etc.) and keeping character names and proper nouns accurate. ` +
    `Return a JSON array of strings: the translations in the same order and EXACTLY the same count as the input.\n` +
    `Input: ${JSON.stringify(texts)}`;
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key.trim())}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json',
          responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        // Anime dialogue (violence, etc.) can trip safety filters and blank the
        // output; we're translating existing subtitles, so disable blocking.
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    let msg = '';
    try { msg = (JSON.parse(body)?.error?.message) || ''; } catch (_) {}
    console.warn('[Better Subs] Gemini HTTP ' + resp.status + ': ' + body.slice(0, 600));
    return { ok: false, error: 'Gemini HTTP ' + resp.status + (msg ? ': ' + msg.slice(0, 140) : ''), status: resp.status };
  }
  const data = await resp.json();
  const txt  = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'no-output';
    return { ok: false, error: 'Gemini: ' + reason };
  }
  let arr;
  try { arr = JSON.parse(txt); }
  catch {
    try { arr = JSON.parse(txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
    catch { return { ok: false, error: 'Gemini: unparseable response' }; }
  }
  if (!Array.isArray(arr)) return { ok: false, error: 'Gemini: response not an array' };
  return { ok: true, translations: arr.map((s) => String(s)) };
}

async function handleTranslate(payload) {
  const texts = Array.isArray(payload?.texts) ? payload.texts : null;
  if (!texts || !texts.length) return { ok: false, error: 'no-texts' };
  const { mtApiKey, mtProvider } = await chrome.storage.local.get(['mtApiKey', 'mtProvider']);
  if (!mtApiKey) return { ok: false, error: 'no-key' };
  const provider = mtProvider || 'deepl';
  try {
    const fn = provider === 'google' ? googleTranslate
             : provider === 'gemini' ? geminiTranslate
             : deeplTranslate;
    const out = await fn(mtApiKey, texts, payload.source || '', payload.target || 'ja-JP');
    if (out.ok && out.translations.length !== texts.length) {
      console.warn('[Better Subs] translate count mismatch:', texts.length, '→', out.translations.length);
      return { ok: false, error: 'count-mismatch' };
    }
    if (!out.ok) console.warn('[Better Subs] translate error:', out.error);
    return out;
  } catch (e) {
    console.warn('[Better Subs] translate fetch threw:', e && e.message);
    return { ok: false, error: 'fetch-failed: ' + (e && e.message) };
  }
}

// ── Keyboard shortcut → active tab relay ──────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-jp-cc') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: MSG.TOGGLE_JP_CC }).catch(() => {});
  }
});

// ── Badge updates from content script ─────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== MSG.SET_BADGE || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  chrome.action.setBadgeText({ text: msg.active ? 'ON' : '', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#ff6b35', tabId });
});

// ── Machine-translation requests from content script ──────────────────────
// Only our own content scripts can reach the SW (no externally_connectable),
// so sender.id is implicitly this extension.  Returns true to keep the async
// sendResponse channel open while the provider fetch is in flight.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== MSG.MT_TRANSLATE) return;
  handleTranslate(msg.payload).then(sendResponse).catch(e =>
    sendResponse({ ok: false, error: 'handler: ' + (e && e.message) }));
  return true;
});
