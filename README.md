# Hacker News Intelligence Scraper

Collect clean, structured Hacker News data from official public APIs. Scrape top, new, best, Ask HN, Show HN, and jobs feeds; run full-text searches; fetch specific item IDs; and optionally include nested comment threads.

No login, API key, browser, or proxy is required.

## Features

- Official Hacker News Firebase API for feeds and item details
- Public HN Algolia API for keyword search
- Top, new, best, Ask HN, Show HN, and jobs feeds
- Story or comment search
- Score, comment count, author, keyword, domain, and date filters
- Optional nested comments with depth and count limits
- Consistent dataset records for CSV, JSON, Excel, and API integrations
- Retry handling and bounded request concurrency

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | string | `feed` | `feed`, `search`, or `items` |
| `feed` | string | `top` | Top, new, best, ask, show, or jobs |
| `query` | string | `artificial intelligence` | Keyword query for search mode |
| `searchType` | string | `story` | Search stories or comments |
| `itemIds` | string[] | - | HN item IDs for items mode |
| `maxResults` | integer | `100` | Maximum dataset records |
| `minScore` | integer | `0` | Minimum points |
| `minComments` | integer | `0` | Minimum story comments |
| `includeKeywords` | string[] | `[]` | Require at least one title/text keyword |
| `excludeKeywords` | string[] | `[]` | Exclude matching title/text keywords |
| `authors` | string[] | `[]` | Exact HN usernames |
| `domain` | string | empty | Required substring in external hostname |
| `fromDate` | string | empty | Earliest publication date |
| `toDate` | string | empty | Latest publication date |
| `includeComments` | boolean | `false` | Nest comments in each record |
| `maxCommentsPerItem` | integer | `50` | Nested comment limit per record |
| `commentDepth` | integer | `3` | Reply depth limit |

## Example input

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

## Example output

```json
{
  "id": 48487029,
  "type": "story",
  "title": "Example Hacker News story",
  "text": null,
  "textHtml": null,
  "url": "https://example.com/article",
  "hnUrl": "https://news.ycombinator.com/item?id=48487029",
  "domain": "example.com",
  "author": "example_user",
  "score": 33,
  "commentCount": 3,
  "parentId": null,
  "pollId": null,
  "pollParts": [],
  "createdAt": "2026-06-11T05:22:06.000Z",
  "createdAtUnix": 1781155326,
  "rank": 1,
  "feed": "top",
  "query": null,
  "dead": false,
  "deleted": false,
  "comments": [],
  "collectedAt": "2026-06-11T06:00:00.000Z"
}
```

## Pricing

The Actor charges **$0.00075 per dataset item**. A run producing 1,000 records costs $0.75 plus standard Apify platform usage. Empty, filtered, or failed records are not charged.

## Use cases

- Monitor developer and startup trends
- Track product, brand, and competitor mentions
- Discover Show HN launches and emerging tools
- Analyze Ask HN discussions and developer sentiment
- Collect Hacker News jobs for recruiting research
- Build alerts, dashboards, datasets, and AI research pipelines

## Data sources

This Actor uses the official Hacker News Firebase API and the public HN Algolia Search API. It does not scrape fragile page selectors.
