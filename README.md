# Hacker News Intelligence Scraper

Collect Hacker News feeds, keyword search results, specific item IDs, and optional nested comment threads into clean Apify dataset rows. The Actor uses the official Hacker News Firebase API for item data and the public HN Algolia API for keyword search. No login, browser, API key, or proxy is required.

Use it for developer trend monitoring, startup research, Show HN discovery, Ask HN analysis, and lightweight technical-news dashboards.

## Quick Start

```json
{
  "mode": "feed",
  "feed": "top",
  "query": "artificial intelligence",
  "searchType": "story",
  "maxResults": 10,
  "includeComments": false
}
```

This collects the first 10 top-feed items without nested comments, keeping the first run fast and low-cost.

## Modes

| Mode | What it does |
| --- | --- |
| `feed` | Collects `top`, `new`, `best`, `ask`, `show`, or `jobs` feeds. |
| `search` | Searches stories or comments through the public HN Algolia API. |
| `items` | Fetches exact Hacker News item IDs. |

## Input

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `mode` | string | `feed` | `feed`, `search`, or `items`. |
| `feed` | string | `top` | Used when `mode` is `feed`. |
| `query` | string | `artificial intelligence` | Used when `mode` is `search`. |
| `searchType` | string | `story` | Search `story` or `comment`. |
| `itemIds` | string array | `[]` | Numeric HN item IDs for `items` mode. |
| `maxResults` | integer | `10` | Maximum dataset rows. |
| `minScore` | integer | `0` | Keep only items with at least this score. |
| `minComments` | integer | `0` | Keep only stories with at least this many comments. |
| `includeKeywords` | string array | `[]` | Require at least one keyword in title or text. |
| `excludeKeywords` | string array | `[]` | Exclude matching title or text. |
| `authors` | string array | `[]` | Exact Hacker News usernames. |
| `domain` | string | empty | Keep links whose hostname contains this value. |
| `fromDate`, `toDate` | string | empty | Optional ISO date or date-time filters. |
| `includeComments` | boolean | `false` | Fetch nested comments into each result. |
| `maxCommentsPerItem` | integer | `20` | Comment cap per item when comments are enabled. |
| `commentDepth` | integer | `3` | Nested reply depth. |
| `includeDeadOrDeleted` | boolean | `false` | Include moderation/deleted records only when explicitly enabled. |

## Output

Each dataset row is one Hacker News item:

| Field | Description |
| --- | --- |
| `id`, `type` | Hacker News item ID and item type. |
| `title`, `text`, `textHtml` | Story or comment content when available. |
| `url`, `hnUrl`, `domain` | External URL, HN discussion URL, and hostname. |
| `author`, `score`, `commentCount` | Public HN metadata. |
| `createdAt`, `createdAtUnix` | Publication time. |
| `feed`, `query`, `rank` | Source context for feed/search runs. |
| `dead`, `deleted` | Moderation flags. |
| `comments` | Optional nested comments when enabled. |
| `collectedAt` | Actor scrape timestamp. |

## Verified Sample

An existing successful top-feed run returned this row:

```json
{
  "id": 48626137,
  "type": "story",
  "title": "Deno Desktop",
  "url": "https://docs.deno.com/runtime/desktop/",
  "hnUrl": "https://news.ycombinator.com/item?id=48626137",
  "domain": "docs.deno.com",
  "author": "GeneralMaximus",
  "score": 204,
  "commentCount": 66,
  "createdAt": "2026-06-22T05:38:40.000Z",
  "rank": 1,
  "feed": "top"
}
```

## Pricing

Active pay-per-event pricing:

| Event | Price |
| --- | ---: |
| `item-scraped` | `$0.00075` per item |
| `apify-actor-start` | `$0.00005` per GB at run start |

Records are saved and charged atomically. Empty, filtered, dead/deleted excluded, or failed records are not charged, and later API batches are skipped after the user's spending limit is reached.

## Common Workflows

1. Monitor `top`, `new`, or `best` for developer and startup trends.
2. Track product or competitor mentions with `mode: "search"` and a query.
3. Find launch examples with the `show` feed and filters such as `minScore`.
4. Analyze discussion quality by enabling comments on a small result set.
5. Export to CSV, Excel, JSON, HTML, or connect through the Apify API.

## Notes and Limits

- Search results depend on HN Algolia indexing and ranking.
- Nested comments increase runtime; keep `maxResults`, `maxCommentsPerItem`, and `commentDepth` small at first.
- Dead or deleted items are excluded unless `includeDeadOrDeleted` is enabled.
- The Actor collects public HN metadata; it is not a private user-profile or contact scraper.

## Responsible Use

Use this Actor for lawful collection of publicly available Hacker News data. Respect Hacker News, Algolia, and downstream platform terms, privacy laws, and any restrictions that apply to how you store or process exported data.

## License

Apache-2.0
