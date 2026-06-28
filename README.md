# Hacker News Scraper - Stories, Comments, Scores & Search

Scrape Hacker News stories, comments, scores, and search results into clean, structured data. This Hacker News scraper collects top, new, best, Ask HN, Show HN, and jobs feeds, runs full-text keyword search, fetches specific item IDs, and optionally nests comment threads. Export to JSON, CSV, Excel, or HTML, or pull via the Apify API. No login and no API key required.

Built with Node.js 20, TypeScript, and the Apify SDK. It uses the official Hacker News Firebase API for feeds and item details and the public HN Algolia Search API for keyword search, with retries and bounded concurrency so runs are reliable and repeatable. No browser and no proxy are required.

## What It Extracts

- `id` - numeric Hacker News item ID
- `type` - item type (story, comment, job, poll)
- `title` - story or item title
- `text` and `textHtml` - item body as plain text and HTML
- `url` - external link, when present
- `hnUrl` - the Hacker News discussion URL
- `domain` - hostname of the external link
- `author` - HN username
- `score` - points
- `commentCount` - number of comments
- `parentId` - parent item ID for comments
- `pollId` and `pollParts` - poll references
- `createdAt` and `createdAtUnix` - publication time (ISO and Unix)
- `rank` - position in the feed
- `feed` - source feed (top, new, best, ask, show, jobs)
- `query` - the search query that matched the record
- `dead` and `deleted` - moderation flags
- `comments` - optional nested comment threads (`id`, `author`, `text`, `textHtml`, `score`, `createdAt`, `createdAtUnix`, `parentId`, `depth`, `dead`, `deleted`, `hnUrl`)
- `collectedAt` - scrape timestamp

## Use Cases

1. Monitor developer, startup, and technology trends across the top, new, and best feeds.
2. Track product, brand, and competitor mentions with keyword and domain filters.
3. Discover Show HN launches and emerging tools as they appear.
4. Analyze Ask HN discussions and developer sentiment with nested comments.
5. Collect Hacker News jobs feed data for recruiting and hiring research.
6. Build alerts, dashboards, and datasets for AI and research pipelines.

## Pricing

This Actor uses Apify Pay Per Event pricing. Each clean record is saved and charged atomically. Empty, filtered, or failed records are not charged, and later API batches are not requested after the user's spending limit is reached.

| Event name | Price per event | 1,000 results | 10,000 results |
| --- | ---: | ---: | ---: |
| `item-scraped` | $0.00075 | $0.75 | $7.50 |

## Input

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `mode` | string | yes | `feed` | `feed`, `search`, or `items` |
| `feed` | string | yes | `top` | Top, new, best, ask, show, or jobs |
| `query` | string | yes | `artificial intelligence` | Keyword query for search mode |
| `searchType` | string | yes | `story` | Search stories or comments |
| `itemIds` | string[] | no | - | HN item IDs for items mode |
| `maxResults` | integer | yes | `100` | Maximum dataset records (1-1000) |
| `minScore` | integer | no | `0` | Minimum points |
| `minComments` | integer | no | `0` | Minimum story comments |
| `includeKeywords` | string[] | no | `[]` | Require at least one title/text keyword |
| `excludeKeywords` | string[] | no | `[]` | Exclude matching title/text keywords |
| `authors` | string[] | no | `[]` | Exact HN usernames |
| `domain` | string | no | empty | Required substring in external hostname |
| `fromDate` | string | no | empty | Earliest publication date |
| `toDate` | string | no | empty | Latest publication date |
| `includeComments` | boolean | no | `false` | Nest comments in each record |
| `maxCommentsPerItem` | integer | no | `50` | Nested comment limit per record (1-500) |
| `commentDepth` | integer | no | `3` | Reply depth limit (1-10) |
| `includeDeadOrDeleted` | boolean | no | `false` | Include dead or deleted items |

### Example input

```json
{
  "mode": "feed",
  "feed": "show",
  "maxResults": 25,
  "minScore": 10,
  "includeKeywords": ["AI", "developer"],
  "includeComments": true,
  "maxCommentsPerItem": 20,
  "commentDepth": 2
}
```

## How to Scrape Hacker News (Step by Step)

1. Click **Try for free** / **Run**.
2. Pick a `mode`: a `feed` (top, new, best, ask, show, jobs), keyword `search`, or specific `itemIds`.
3. Add filters such as `minScore`, `includeKeywords`, `authors`, `domain`, or a date range to narrow results.
4. Set `maxResults` (start small to test) and toggle `includeComments` if you want nested threads.
5. Run the Actor, then export results as JSON, CSV, Excel, or HTML, or pull them via the Apify API.

## Sample Output

```json
{
  "id": 48487029,
  "type": "story",
  "title": "Show HN: An open-source AI agent for developers",
  "text": null,
  "textHtml": null,
  "url": "https://github.com/example/ai-agent",
  "hnUrl": "https://news.ycombinator.com/item?id=48487029",
  "domain": "github.com",
  "author": "devbuilder",
  "score": 287,
  "commentCount": 94,
  "parentId": null,
  "pollId": null,
  "pollParts": [],
  "createdAt": "2026-06-11T05:22:06.000Z",
  "createdAtUnix": 1781155326,
  "rank": 1,
  "feed": "show",
  "query": null,
  "dead": false,
  "deleted": false,
  "comments": [
    {
      "id": 48487102,
      "author": "curious_hacker",
      "text": "This is great, how does it handle rate limits?",
      "textHtml": "<p>This is great, how does it handle rate limits?</p>",
      "score": 0,
      "createdAt": "2026-06-11T05:41:12.000Z",
      "createdAtUnix": 1781156472,
      "parentId": 48487029,
      "depth": 1,
      "dead": false,
      "deleted": false,
      "hnUrl": "https://news.ycombinator.com/item?id=48487102"
    }
  ],
  "collectedAt": "2026-06-11T06:00:00.000Z"
}
```

## How It Works

1. Validates the input and selects the collection mode (feed, search, or items).
2. Fetches feed and item details from the official Hacker News Firebase API, and keyword results from the public HN Algolia Search API.
3. Applies score, comment, keyword, author, domain, and date filters.
4. Optionally fetches and nests comment threads up to your depth and count limits.
5. Charges `item-scraped` only after a clean record is saved, then writes it to the Apify Dataset.

## Known Limits

- `text` and `textHtml` are only present for items that have body content; link stories return `null` for these fields.
- `comments` are only populated when `includeComments` is enabled, and are bounded by `maxCommentsPerItem` and `commentDepth`.
- Keyword search uses the HN Algolia API, so results and ranking follow that service's coverage and indexing.
- Dead or deleted items are excluded unless `includeDeadOrDeleted` is enabled.
- `maxResults` is capped at 1,000 records per run.

## Data Sources

This Actor uses the official Hacker News Firebase API and the public HN Algolia Search API. It does not rely on fragile page selectors.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0.
