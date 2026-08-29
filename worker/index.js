/**
 * Minimal Cloudflare Worker for the Brand Ad-Spend dashboard.
 *
 * Static files (index.html, /js/*, /data/*) are served directly from the
 * `assets` binding configured in wrangler.jsonc — the Worker only runs for
 * paths that don't match a static asset. The single dynamic route is a stub
 * for a future live refresh (Bedrock + Mistral for AI answers, scrapers for
 * the rest); it returns 501 for now.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/refresh') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
      }
      return Response.json(
        {
          ok: false,
          status: 'not_implemented',
          message: 'Live refresh is not wired up yet. This dashboard currently runs on mock data in /data/*.json.',
        },
        { status: 501 },
      );
    }

    // Fallback to static assets for everything else.
    return env.ASSETS.fetch(request);
  },
};
