/**
 * background.js — MV3 service worker.
 *
 * Responsibilities:
 * 1. Relay the Alt+J keyboard shortcut to the active tab's content script.
 * 2. Update the extension action badge when content.js reports overlay state.
 * 3. Machine translation: the ONLY place the user's BYOK API key is read.  The
 *    key lives in chrome.storage.local and never crosses into a page/content
 *    world — content.js forwards just the text batch; the SW attaches the key
 *    and calls DeepL.  Cross-origin fetch here relies on the
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

async function handleTranslate(payload) {
  const texts = Array.isArray(payload?.texts) ? payload.texts : null;
  if (!texts || !texts.length) return { ok: false, error: 'no-texts' };
  const { mtApiKey } = await chrome.storage.local.get(['mtApiKey']);
  if (!mtApiKey) return { ok: false, error: 'no-key' };
  try {
    const out = await deeplTranslate(mtApiKey, texts, payload.source || '', payload.target || 'ja-JP');
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
