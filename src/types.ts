export type Mode = 'feed' | 'search' | 'items';
export type Feed = 'top' | 'new' | 'best' | 'ask' | 'show' | 'jobs';
export type SearchType = 'story' | 'comment';
export type HnItemType = 'job' | 'story' | 'comment' | 'poll' | 'pollopt';

export interface NormalizedInput {
    mode: Mode;
    feed: Feed;
    query: string;
    searchType: SearchType;
    itemIds: number[];
    maxResults: number;
    minScore: number;
    minComments: number;
    includeKeywords: string[];
    excludeKeywords: string[];
    authors: string[];
    domain: string;
    fromDate: string;
    toDate: string;
    fromTimestamp: number | null;
    toTimestamp: number | null;
    includeComments: boolean;
    maxCommentsPerItem: number;
    commentDepth: number;
    includeDeadOrDeleted: boolean;
}

export interface HnApiItem {
    id: number;
    type: HnItemType;
    by?: string;
    time?: number;
    text?: string;
    title?: string;
    url?: string;
    score?: number;
    descendants?: number;
    parent?: number;
    poll?: number;
    parts?: number[];
    kids?: number[];
    dead?: boolean;
    deleted?: boolean;
}

export interface SearchIdsResult {
    ids: number[];
    pagesFetched: number;
    invalidHitsSkipped: number;
    pageLimitReached: boolean;
}

export interface ApiMetrics {
    requestAttempts: number;
    retries: number;
    firebaseAttempts: number;
    algoliaAttempts: number;
}

export interface HackerNewsClient {
    fetchFeedIds(feed: Feed): Promise<number[]>;
    fetchItem(id: number): Promise<HnApiItem | null>;
    searchItemIds(query: string, type: SearchType, limit: number): Promise<SearchIdsResult>;
    getMetrics(): ApiMetrics;
}

export interface NestedComment {
    id: number;
    author: string | null;
    text: string | null;
    textHtml: string | null;
    score: number;
    createdAt: string | null;
    createdAtUnix: number | null;
    parentId: number | null;
    depth: number;
    dead: boolean;
    deleted: boolean;
    hnUrl: string;
}

export interface HnRecord {
    id: number;
    type: HnItemType;
    title: string | null;
    text: string | null;
    textHtml: string | null;
    url: string | null;
    hnUrl: string;
    domain: string | null;
    author: string | null;
    score: number;
    commentCount: number;
    parentId: number | null;
    pollId: number | null;
    pollParts: number[];
    createdAt: string | null;
    createdAtUnix: number | null;
    rank: number | null;
    feed: Feed | null;
    query: string | null;
    dead: boolean;
    deleted: boolean;
    comments: NestedComment[];
    collectedAt: string;
}

export interface ChargeResult {
    chargedCount: number;
    eventChargeLimitReached: boolean;
}

export interface RunDiagnostic {
    stage: 'discovery' | 'item' | 'comment' | 'storage';
    itemId?: number;
    message: string;
}

export interface HackerNewsRunStatus {
    status: 'succeeded' | 'partial' | 'empty' | 'stopped_spending_limit' | 'failed';
    source: 'hacker_news_firebase_and_algolia';
    mode: Mode;
    candidateIdsDiscovered: number;
    candidateIdsSelected: number;
    itemRequests: number;
    itemsFetched: number;
    itemsMissing: number;
    itemFailures: number;
    recordsFiltered: number;
    recordsMatched: number;
    recordsSaved: number;
    commentRequests: number;
    commentsSaved: number;
    commentsMissing: number;
    commentFailures: number;
    commentsSkippedByPolicy: number;
    searchPagesFetched: number;
    invalidSearchHitsSkipped: number;
    searchPageLimitReached: boolean;
    spendingLimitReached: boolean;
    durationMs: number;
    apiMetrics: ApiMetrics;
    diagnostics: RunDiagnostic[];
    failureMessage?: string;
}
