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
  index.html            app shell, CDN links, design system, tab markup
  js/app.js             bootstrap, tab/subtab router, controls, state, renderers
  js/charts.js          ApexCharts theme + one factory per chart type
  js/data.js            fetch + cache /data/*.json (falls back to the seed on file://)
  js/util.js            formatting + derived metrics (Pull score, signals, verdicts)
  js/seed.js            embedded mirror of /data/*.json for file:// support (generated)
  data/*.json           meta, spend (real pipeline), search-trends/social/reviews/ai (mock)
  data/manual/private-circle.json  hand-entered PrivateCircle/MCA numbers for unlisted peers
worker/index.js         Cloudflare Worker: serves assets + stub POST /api/refresh (501)
wrangler.jsonc          Cloudflare config (assets -> ./public, main -> worker/index.js)
lib/llm.mjs             LLM JSON extraction (Bedrock Claude primary, Mistral fallback)
lib/scrape.mjs          page/PDF scraping (Firecrawl primary, Scrape.do fallback)
lib/screener.mjs        best-effort screener.in session (playwright-core)
scripts/gen-data.mjs    default: mirror data/*.json -> seed.js; --regen-mock rebuilds mock
scripts/scrape-spend.mjs  refresh spend.json from primary sources (degrades gracefully)
.github/workflows/spend-refresh.yml  monthly + on-demand spend refresh
```

## Data pipeline (CI)

Spend is now backed by a real extraction pipeline; the other lanes are still
mock (later rounds). A monthly GitHub Actions job
(`.github/workflows/spend-refresh.yml`, also runnable via *workflow_dispatch*)
runs `scripts/scrape-spend.mjs`, which:

- **Aquaguard** (Eureka Forbes Ltd, listed) — finds the annual-report PDF via
  screener.in, reads it with Firecrawl, and extracts the *Advertisement* and
  *Selling & Sales Promotion* Other-Expenses lines with an LLM.
- **Kent** — screener/DRHP if reachable, else the manual PrivateCircle file.
- **Livpure / Pureit / AO Smith** (unlisted) — from
  `public/data/manual/private-circle.json` (paste real MCA/PrivateCircle numbers
  there; a brand omitted keeps its modelled estimate).

It then runs `gen-data.mjs` to refresh `seed.js`. Every source degrades
gracefully: on any failure it keeps the last-good committed value, marks it
`stale`, and exits 0 — it never regresses a real number to null, and it makes no
network calls at all when no secrets are set. Each spend figure carries a
`quality` tier (**Disclosed / Snapshot / PrivateCircle / Estimated**) and an
optional `_provenance` note surfaced by the ⓘ on the Spend tab.

Secrets (GitHub Actions repository secrets; see `.env.example`; never committed):
`CLAUDE_BEDROCK_API_KEY` (+ `CLAUDE_BEDROCK_REGION`, `CLAUDE_BEDROCK_MODEL_ID`),
`MISTRAL_API_KEY` (+ `MISTRAL_MODEL`), `FIRECRAWL_API_KEY`, `SCRAPEDO_API_KEY`,
`SCREENER_EMAIL`, `SCREENER_PASSWORD`. No secret ever reaches the frontend.

Run locally:

```bash
npm ci                       # installs playwright-core (the only dep)
cp .env.example .env         # fill in secrets, or leave blank to keep last-good
npm run scrape:spend         # refreshes public/data/spend.json + js/seed.js
```

## Data quality

Real published anchors (e.g. Eureka Forbes' FY23/FY24 advertising & promotion
spend) are used as-is and badged **Disclosed**; point-in-time figures are
**Snapshot**; unlisted-peer figures from MCA/PrivateCircle are **PrivateCircle**;
the rest is modelled and badged **Estimated**. The mock lanes can be rebuilt with
`node scripts/gen-data.mjs --regen-mock`.
