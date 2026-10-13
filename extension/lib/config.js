/**
 * lib/config.js — deploy-time configuration the developer sets.
 *
 * REPORT_ENDPOINT — URL of your error-report receiver (a Cloudflare Worker that
 * forwards to Discord/email; see tools/report-worker.js for ready-to-deploy
 * code).  Leave EMPTY ('') to keep the extension fully offline / "collects
 * nothing": on-error auto-reporting stays DORMANT and no data is ever
 * transmitted.  Set it to your Worker URL to turn on the in-page
 * "Better Subs hit an error — send a report?" prompt.
 *
 * IMPORTANT: a non-empty endpoint means the extension transmits diagnostics
 * (only when a user clicks "Send").  Before publishing with it set, update the
 * Chrome Web Store "Privacy practices" declaration and the README "data
 * collected" badge to match.
 */
(function () {
  'use strict';
  const NS = (typeof self !== 'undefined' ? self : globalThis);
  NS.CRSubFix = NS.CRSubFix || {};
  NS.CRSubFix.config = {
    REPORT_ENDPOINT: 'https://better-subs-reports.andrewtristanwillis.workers.dev',
    // Optional shared secret mirrored in the Worker's REPORT_TOKEN env var.
    // Leave '' when the Worker doesn't enforce one.  (If you set it in the
    // Worker but not here, every report/survey silently 401s.)
    REPORT_TOKEN: '',
    // Coarse, non-identifying platform string (OS family + Chrome major) for
    // reports.  Never the full User-Agent — that's a fingerprinting surface.
    coarsePlatform: function coarsePlatform() {
      const ua = navigator.userAgent || '';
      let os = 'Unknown';
      if (/Windows NT/.test(ua)) os = 'Windows';
      else if (/Mac OS X/.test(ua)) os = 'macOS';
      else if (/CrOS/.test(ua)) os = 'ChromeOS';
      else if (/Android/.test(ua)) os = 'Android';
      else if (/Linux/.test(ua)) os = 'Linux';
      const m = ua.match(/(?:Chrome|Chromium)\/(\d+)/);
      return `${os} · Chrome ${m ? m[1] : '?'}`;
    },
  };
})();
