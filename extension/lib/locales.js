/**
 * lib/locales.js — display names for Crunchyroll locale codes, shared by the
 * page (interceptor.js) and the popup.
 *
 *   CRSubFix.locales.LABELS — locale → menu/status name (each dub = a source option)
 *   CRSubFix.locales.SHORT  — locale → 2-char label on the toggle button
 */
(function () {
  'use strict';
  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.locales = {
    LABELS: {
      'ja-JP': 'English (Japanese source)', 'en-US': 'English',
      'en-GB': 'English (UK)',      'de-DE': 'Deutsch',
      'es-419':'Español (Lat)',     'es-ES': 'Español (España)',
      'ca-ES': 'Català',            'fr-FR': 'Français',
      'pt-BR': 'Português (BR)',    'pt-PT': 'Português (PT)',
      'it-IT': 'Italiano',          'ru-RU': 'Русский',
      'ar-ME': 'العربية',            'ar-SA': 'العربية (SA)',
      'zh-CN': '中文 (简)',           'zh-TW': '中文 (繁)',
      'zh-HK': '中文 (港)',
      'hi-IN': 'हिंदी',             'ko-KR': '한국어',
      'pl-PL': 'Polski',            'tr-TR': 'Türkçe',
      'nl-NL': 'Nederlands',        'fi-FI': 'Suomi',
      'sv-SE': 'Svenska',           'nb-NO': 'Norsk',
      'da-DK': 'Dansk',             'cs-CZ': 'Čeština',
      'ro-RO': 'Română',            'hu-HU': 'Magyar',
      'ms-MY': 'Bahasa Melayu',     'th-TH': 'ภาษาไทย',
      'id-ID': 'Bahasa Indonesia',  'vi-VN': 'Tiếng Việt',
      'te-IN': 'తెలుగు',            // seen live 2026-08 (Telugu dub sessions)
      'ta-IN': 'தமிழ்',             // seen live 2026-09 (Tamil dub)
    },
    SHORT: {
      'ja-JP':'JP','en-US':'EN','en-GB':'EN','de-DE':'DE',
      'es-419':'ES','es-ES':'ES','ca-ES':'CA',
      'fr-FR':'FR','pt-BR':'PT','pt-PT':'PT','it-IT':'IT',
      'ru-RU':'RU','ar-ME':'AR','ar-SA':'AR',
      'zh-CN':'ZH','zh-TW':'ZH','zh-HK':'ZH','hi-IN':'HI','ko-KR':'KO',
      'pl-PL':'PL','tr-TR':'TR','nl-NL':'NL','fi-FI':'FI',
      'sv-SE':'SV','nb-NO':'NO','da-DK':'DA','cs-CZ':'CS',
      'ro-RO':'RO','hu-HU':'HU','ms-MY':'MS','th-TH':'TH',
      'id-ID':'ID','vi-VN':'VI','te-IN':'TE','ta-IN':'TA',
    },
  };
})();
