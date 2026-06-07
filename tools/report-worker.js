/**
 * report-worker.js — Cloudflare Worker that receives error reports from the
 * "Better Subs for Crunchyroll" extension and forwards them to you (Discord or
 * Slack), so you only have to read a notification.
 *
 * WHY a Worker (not a direct Discord/Slack webhook): the extension would
 * otherwise need a host permission for discord.com/slack.com (a scary install
 * prompt). This Worker sends a permissive CORS header, so the extension talks to
 * it with ZERO new permissions, and your real webhook stays hidden + rotatable.
 *
 * DEPLOY (free tier, ~10 min):
 *   1. dash.cloudflare.com -> Workers & Pages -> Create -> Worker -> Deploy.
 *   2. Edit code -> paste this whole file -> Deploy.
 *   3. Settings -> Variables and Secrets -> add  DISCORD_WEBHOOK  =  your Discord
 *      channel webhook URL  (Discord: Channel gear -> Integrations -> Webhooks ->
 *      New Webhook -> Copy Webhook URL). For Slack, name it SLACK_WEBHOOK.
 *   4. Copy the Worker URL (https://<name>.<you>.workers.dev) and paste it into
 *      extension/lib/config.js -> REPORT_ENDPOINT.
 *
 * The Worker echoes the downstream status back as { ok, discord } so failures
 * are visible instead of swallowed. Spam: the URL is public; if abused, add a
 * free Cloudflare "Rate limiting" rule or redeploy for a new URL.
 */
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST')    return json({ ok: false, error: 'method' }, 405, cors);

    let data;
    try { data = await request.json(); } catch { return json({ ok: false, error: 'json' }, 400, cors); }

    // Discord embed description caps at 4096 chars (vs 2000 for plain content),
    // so we use an embed to fit a longer trace. 4000 + the fence stays under.
    const text = String((data && data.text) || '').slice(0, 4000);
    if (!text) return json({ ok: false, error: 'empty' }, 400, cors);

    let discord = 'no-webhook';
    try {
      if (env.DISCORD_WEBHOOK) {
        const dr = await fetch(env.DISCORD_WEBHOOK, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            embeds: [{ title: 'Better Subs report', color: 16742197, description: '```\n' + text + '\n```' }],
          }),
        });
        discord = String(dr.status);
        if (!dr.ok) discord += ': ' + (await dr.text()).slice(0, 300);
      } else if (env.SLACK_WEBHOOK) {
        const sr = await fetch(env.SLACK_WEBHOOK, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Better Subs report\n```' + text + '```' }),
        });
        discord = 'slack ' + sr.status;
      }
    } catch (e) { discord = 'error: ' + (e && e.message); }

    return json({ ok: true, discord }, 200, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
