/**
 * report-worker.js — Cloudflare Worker that receives OPT-IN, anonymized problem
 * reports from "Better Subs for Crunchyroll" and forwards them to your Discord
 * channel, so you read one tidy notification instead of a copy-pasted console
 * dump.
 *
 * WHY a Worker (not a direct webhook): the extension would otherwise need a host
 * permission for discord.com (a scary install prompt). This Worker returns a
 * permissive CORS header, so the extension talks to it with ZERO new
 * permissions, and your real webhook stays a server-side secret + rotatable.
 *
 * SECURITY POSTURE (the URL ships in public client code → effectively public):
 *   (1) Rate-limit binding ← the REAL volume control. WAF "Rate limiting rules"
 *       do NOT cover *.workers.dev, so use the Rate Limiting BINDING (Settings →
 *       Bindings → Add → Rate limiting), name it RATE_LIMITER; the code uses it
 *       if present and no-ops (fails OPEN) if not.
 *   (2) Optional shared-secret header (REPORT_TOKEN) — a minor speed bump.
 *   (3) Input sanitization — no code-fence breakout, no @everyone/@here pings.
 *   (4) Size caps so a payload can't blow past Discord's limits.
 *   (5) Discord's response body is NEVER reflected back to the (public) caller.
 *   (6) The caller IP is NEVER logged or forwarded (used only transiently as the
 *       rate-limit key). The webhook URL is a server-side secret.
 *   Blast radius if abused: spam in your own private channel — rate-limit it or
 *   rotate the webhook + redeploy.
 *
 * DEPLOY (free tier, ~10 min):
 *   1. dash.cloudflare.com -> Workers & Pages -> your `better-subs-reports`
 *      worker -> Edit code -> paste this whole file -> Deploy.
 *   2. Settings -> Variables and Secrets:
 *        DISCORD_WEBHOOK = your channel webhook URL  (required)
 *        REPORT_TOKEN    = a random string  (optional; if set, put the SAME
 *                          string in extension/lib/config.js REPORT_TOKEN).
 *   3. (Recommended) Settings -> Bindings -> Add -> Rate limiting -> name it
 *      RATE_LIMITER (e.g. 10 requests / 60s). Used automatically.
 *   4. Redeploy after any secret change (secrets don't apply until you do).
 *
 * Payload shape: { text: string, fields?: [{ name, value }] }
 */
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Better-Subs-Token',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST')    return json({ ok: false, error: 'method' }, 405, cors);

    // Optional shared-secret. Enforced only when REPORT_TOKEN is set in env.
    if (env.REPORT_TOKEN && request.headers.get('X-Better-Subs-Token') !== env.REPORT_TOKEN) {
      return json({ ok: false, error: 'auth' }, 401, cors);
    }

    // Optional rate limit (defense in depth). Active only if a Rate Limiting
    // binding named RATE_LIMITER is configured; no-ops when unbound. Caller IP
    // is used transiently as the key only — never logged or forwarded. Fails
    // OPEN so a misconfigured limiter can't silently drop legitimate reports.
    if (env.RATE_LIMITER) {
      try {
        const key = request.headers.get('cf-connecting-ip') || 'anon';
        const { success } = await env.RATE_LIMITER.limit({ key });
        if (!success) return json({ ok: false, error: 'rate-limited' }, 429, cors);
      } catch (_) { /* limiter error → allow the request through */ }
    }

    let data;
    try { data = await request.json(); } catch { return json({ ok: false, error: 'json' }, 400, cors); }

    // Sanitize everything that reaches Discord: kill code-fence breakouts and
    // neutralize mass mentions (belt-and-suspenders with allowed_mentions below).
    const clean = (s) => String(s == null ? '' : s)
      .replace(/`/g, 'ˋ')                        // backtick → modifier grave
      .replace(/@(everyone|here)/gi, '@​$1'); // zero-width break the mention

    const text = clean(data && data.text).slice(0, 3800);
    if (!text) return json({ ok: false, error: 'empty' }, 400, cors);

    const fields = Array.isArray(data && data.fields)
      ? data.fields.slice(0, 10).map((f) => ({
          name:   clean(f && f.name).slice(0, 40)   || '-',
          value:  clean(f && f.value).slice(0, 100) || '-',
          inline: true,
        }))
      : undefined;

    let discord = 'no-webhook';
    try {
      if (env.DISCORD_WEBHOOK) {
        const embed = { title: 'Better Subs report', color: 16742197,
                        description: '```\n' + text + '\n```' };
        if (fields && fields.length) embed.fields = fields;
        const dr = await fetch(env.DISCORD_WEBHOOK, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
        });
        // Coarse status only — never reflect Discord's body to a public caller.
        discord = dr.ok ? 'ok' : 'fail:' + dr.status;
        if (!dr.ok) console.warn('discord webhook failed', dr.status, (await dr.text()).slice(0, 300));
      } else if (env.SLACK_WEBHOOK) {
        const sr = await fetch(env.SLACK_WEBHOOK, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text: 'Better Subs report\n```' + text + '```' }),
        });
        discord = sr.ok ? 'slack:ok' : 'slack:fail:' + sr.status;
      }
    } catch (e) { discord = 'error'; console.warn('forward error', e && e.message); }

    return json({ ok: true, discord }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
