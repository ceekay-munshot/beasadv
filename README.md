# Is the ad spend working? — India water-purifier brands

A colourful, single-purpose dashboard that answers one plain question about six
Indian water-purifier brands:

> **Is each brand's advertising spend actually working — is it buying real demand and mind-share?**

The story is **Spend vs Pull**: money spent on ads/promotion on one side; real
"pull" on the other — search interest, social reach & engagement, e-commerce
reviews, and how often AI assistants recommend the brand. When spend rises but
pull stays flat, the brand is losing its organic pull.

> **Note:** this round is UI + **mock data** only. No scrapers, no live fetches.
> Real, published anchors are used where available and clearly badged
> **Disclosed** / **Snapshot**; everything else is **Estimated**.

## The six brands

| Brand | Group | Signature colour | Spend data |
|---|---|---|---|
| Aquaguard | Eureka Forbes | `#0ea5e9` | Disclosed (via parent) |
| Eureka Forbes | Eureka Forbes | `#6366f1` | Disclosed |
| Kent | — | `#10b981` | Snapshot |
| Livpure | — | `#f59e0b` | Estimated |
| Pureit | A.O. Smith group | `#8b5cf6` | Estimated |
| AO Smith | A.O. Smith group | `#f43f5e` | Estimated |

Each brand keeps its signature colour in every chart, tab and table.

## The six tabs

1. **Overview — "the verdict."** Per-brand Pull-score gauges + plain verdicts, a
   hero chart pairing marketing spend (% of revenue) with search interest, and a
   "who leads each signal" strip.
2. **Spend.** Eureka Forbes' ad vs promotion split, marketing as a share of
   revenue over time, latest-year spend across brands, and a full brand × year
   table — all with data-quality badges. Toggle ₹ crore ↔ % of revenue and
   Advertisement only ↔ Ad + Promotion.
3. **Web & Social.** *Search* — Google-Trends-style interest per brand (or the
   generic "water purifier" term). *Social* — followers per platform (each on its
   own scale) or engagement rate, plus audience-growth sparklines.
4. **Shelf.** Amazon/Flipkart review counts or ratings, a star-rating strip,
   review-velocity trends, and a flagship-model table.
5. **AI Answers.** How often each assistant (ChatGPT / Claude / Perplexity /
   Gemini / All) names a brand, share of AI mentions, sentiment, and a
   "where you're invisible" list of buyer questions. *(Mock now; wired to
   Bedrock + Mistral later.)*
6. **Vs Rivals.** Pick 2–4 brands and a metric for a head-to-head, a Pull-score
   leaderboard with medals, and a green→red heat-strip across every signal.

Global controls in the header: a **brand multi-select** (also toggled by the
coloured legend chips) and the **₹ crore ↔ % of revenue** switch.

## Running it

**Option 1 — just open the file.** Double-click `public/index.html` (or open it
in a browser). It works straight from `file://`: the CDN libraries load over
HTTPS, and the data is embedded in `public/js/seed.js` because browsers block
`fetch()` of local files under `file://`.

**Option 2 — any static server** (exercises the real `fetch` + loading/empty/
error states):

```bash
cd public && python3 -m http.server 8080
# then open http://localhost:8080/
```

**Option 3 — Cloudflare Worker locally:**

```bash
npx wrangler dev      # serves ./public via the Worker; POST /api/refresh -> 501
```

No build step and no `npm install` are required just to view the dashboard.

## Tech

Plain `index.html` + vanilla JS (namespaced classic scripts, so it also runs from
`file://`) + CDN libraries only:

- **Tailwind** (Play CDN) for layout and the design system
- **ApexCharts** for every chart — hover tooltips, legends, soft axes
- **Lucide** icons, **Inter** + **Plus Jakarta Sans** fonts

```
public/
  index.html        app shell, CDN links, design system, tab markup
  js/app.js         bootstrap, tab/subtab router, controls, state, renderers
  js/charts.js      ApexCharts theme + one factory per chart type
  js/data.js        fetch + cache /data/*.json (falls back to the seed on file://)
  js/util.js        formatting + derived metrics (Pull score, signals, verdicts)
  js/seed.js        embedded mirror of /data/*.json for file:// support (generated)
  data/*.json       mock data (meta, spend, search-trends, social, reviews, ai-visibility)
worker/index.js     Cloudflare Worker: serves assets + stub POST /api/refresh (501)
wrangler.jsonc      Cloudflare config (assets -> ./public, main -> worker/index.js)
scripts/gen-data.mjs  regenerates data/*.json + js/seed.js  (node scripts/gen-data.mjs)
```

## Data quality

All figures are illustrative. Where real published anchors exist (e.g. Eureka
Forbes' FY23/FY24 advertising and promotion spend) they are used as-is and
badged **Disclosed**; point-in-time figures are **Snapshot**; the rest is
modelled and badged **Estimated**. To change the numbers, edit
`scripts/gen-data.mjs` and run `node scripts/gen-data.mjs`.
