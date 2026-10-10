# Hacker News Monitor - Trends, Launches & Mentions

Collect Hacker News feeds, keyword search results, specific item IDs, and optional nested comment threads into clean Apify dataset rows. Repeat the same named watchlist to see score, discussion and feed-rank momentum, newly observed launches, content/link changes, and moderation changes. The Actor uses the official Hacker News Firebase API for item data and the public HN Algolia API for keyword search. No login, browser, API key, or proxy is required.

Use it for startup and competitor monitoring, Show HN launch tracking, developer trend research, Ask HN analysis, job signals, and recurring technical-news reports.

## Repeat-run watchlists

Keep the same `monitorName` on a schedule. The first run creates a private baseline; later runs label every current row as `updated` or `unchanged` and retain a bounded observation history. Each row includes score/comment/rank deltas, points and comments per hour, comment-to-score ratio, severity, changed fields, and deterministic signals such as `new_item`, `score_spike`, `discussion_spike`, `rank_rising`, `rank_falling`, `link_changed`, and `moderation_changed`.

Every run also writes `MONITOR_SUMMARY`, a Markdown `CHANGE_REPORT`, and a formula-safe `CHANGE_REPORT_CSV` to the default key-value store. Watchlist state lives in a separate named private store in the caller's Apify account. Current rows remain complete on every run; this is observation-based monitoring, not a guarantee that Algolia or Firebase exposes every HN item immediately.

Example: monitor recent AI launch stories and their momentum:

```json
{
  "mode": "search",
  "query": "artificial intelligence",
  "searchType": "story",
  "fromDate": "2026-10-01",
  "maxResults": 25,
  "trackChanges": true,
  "monitorName": "ai-launch-watch",
  "scoreChangeThreshold": 10,
  "commentChangeThreshold": 5
}
```

## Quick Start

```json
{
  "mode": "feed",
  "feed": "top",
  "query": "artificial intelligence",
  "searchType": "story",
  "maxResults": 1,
  "includeComments": false,
  "trackChanges": true,
  "monitorName": "hn-us-tech-watchlist"
}
```

This collects one top-feed item without nested comments, keeping the first run fast and low-cost. Increase `maxResults` after checking the sample row.

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
| `maxResults` | integer | `1` | Maximum dataset rows, from 1 to 1,000. |
| `minScore` | integer | `0` | Keep only items with at least this score. |
| `minComments` | integer | `0` | Keep only stories with at least this many comments. |
| `includeKeywords` | string array | `[]` | Require at least one keyword in title or text. |
| `excludeKeywords` | string array | `[]` | Exclude matching title or text. |
| `authors` | string array | `[]` | Exact Hacker News usernames. |
| `domain` | string | empty | Keep links whose hostname contains this value. |
| `fromDate`, `toDate` | string | empty | Optional ISO date or date-time filters. |
| `includeComments` | boolean | `false` | Fetch nested comments into each result. |
| `maxCommentsPerItem` | integer | `20` | Comment cap per item; nested-comment requests are capped at 5,000 per run. |
| `commentDepth` | integer | `3` | Nested reply depth. |
| `includeDeadOrDeleted` | boolean | `false` | Include moderation/deleted records only when explicitly enabled. |
| `trackChanges` | boolean | `true` | Compare current rows with a bounded private history. |
| `monitorName` | string | `hn-us-tech-watchlist` | Stable watchlist name; different names isolate histories. |
| `observationHistoryLimit` | integer | `10` | Private observations retained per item, from 2 to 50. |
| `scoreChangeThreshold` | integer | `10` | Minimum positive point change for `score_spike`. |
| `commentChangeThreshold` | integer | `5` | Minimum positive comment change for `discussion_spike`. |
| `newItemWindowHours` | integer | `24` | Maximum age for a baseline `new_item` signal. |

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
| `ageHours`, `pointsPerHour`, `commentsPerHour`, `commentToScoreRatio` | Deterministic engagement and momentum metrics. |
| `monitoringStatus`, `changeSeverity`, `changeSummary` | Repeat-run watchlist outcome. |
| `previousScore`, `previousCommentCount`, `previousRank` | Prior observation values. |
| `scoreDelta`, `commentDelta`, `rankDelta` | Current movement; positive rank delta means the item moved upward. |
| `changedFields`, `changeSignals`, `observationCount` | Evidence for every reported update. |

The default key-value store also contains `RUN_STATUS`. It reports the final outcome, discovered and requested item counts, saved rows, filters, missing items, comment counts, retries, upstream failures, spending-limit state, and up to 20 concise diagnostics.

Possible outcomes are:

| Status | Meaning |
| --- | --- |
| `succeeded` | Requested records were saved without detected upstream loss. |
| `partial` | Records were saved, but one or more item/comment requests or search hits could not be used. |
| `empty` | The source responded correctly, but no records matched or available IDs were missing/deleted. |
| `stopped_spending_limit` | Collection stopped at the caller's maximum cost per run. |
| `failed` | Discovery, all usable item requests, input validation, or dataset storage failed. |

## Verified Sample

A one-result top-feed proof on July 15, 2026 returned this row:

```json
{
  "id": 48915709,
  "type": "story",
  "title": "Jurassic Park computers in excruciating detail",
  "url": "https://fabiensanglard.net/jurrasic_park_computers/index.html",
  "hnUrl": "https://news.ycombinator.com/item?id=48915709",
  "domain": "fabiensanglard.net",
  "author": "vinhnx",
  "score": 362,
  "commentCount": 86,
  "createdAt": "2026-07-15T02:57:47.000Z",
  "rank": 1,
  "feed": "top"
}
```

## Pricing

Active pay-per-event pricing:

| Event | Price |
| --- | ---: |
| `item-scraped` | `$0.00075` per item (`$0.75` per 1,000) |
| `apify-actor-start` | `$0.00005` per GB at run start |

Records are saved and charged atomically. Empty, filtered, dead/deleted excluded, or failed records are not charged, and later API batches are skipped after the user's spending limit is reached.
The Actor uses a 256 MB default and requires no browser, API key, or proxy, keeping platform usage small for normal feed and search runs.

## Common Workflows

1. Schedule `top`, `new`, or `best` watchlists for developer and startup momentum.
2. Track product or competitor mentions with `mode: "search"` and a stable `monitorName`.
3. Watch Show HN launches for score, discussion and rank changes.
4. Monitor Ask HN or jobs feeds for buyer, hiring and technical-demand signals.
5. Analyze discussion quality by enabling comments on a small result set.
6. Export current rows or the generated Markdown/CSV change report through Apify integrations.

## Notes and Limits

- Inputs are validated at runtime and unsupported fields are rejected instead of silently ignored.
- Firebase and Algolia responses are shape-checked before use. Retryable `408`, `429`, and `5xx` responses use bounded retries; other HTTP and malformed-data errors fail immediately.
- Search pagination, response size, item scans, comment traversal, and diagnostic output are bounded.
- Search results depend on HN Algolia indexing and ranking.
- Nested comments increase runtime; keep `maxResults`, `maxCommentsPerItem`, and `commentDepth` small at first.
- Dead or deleted root items and nested comments are excluded unless `includeDeadOrDeleted` is enabled. Eligible replies below an excluded comment are still traversed.
- A feed rank is meaningful only within the same feed and comparable input. Use separate monitor names for materially different feeds, searches, filters, or result limits.
- Change signals are deterministic thresholds, not sentiment analysis or investment advice.
- The Actor collects public HN metadata; it is not a private user-profile or contact scraper.

## Responsible Use

Use this Actor for lawful collection of publicly available Hacker News data. Respect Hacker News, Algolia, and downstream platform terms, privacy laws, and any restrictions that apply to how you store or process exported data.

This independent Actor is not affiliated with, endorsed by, or sponsored by Hacker News, Y Combinator, or Algolia.

## License

Apache-2.0
