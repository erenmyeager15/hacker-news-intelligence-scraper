export type Mode = 'feed' | 'search' | 'items';
export type Feed = 'top' | 'new' | 'best' | 'ask' | 'show' | 'jobs';
export type SearchType = 'story' | 'comment';

export interface Input {
    mode: Mode;
    feed: Feed;
    query: string;
    searchType: SearchType;
    itemIds?: string[];
    maxResults: number;
    minScore?: number;
    minComments?: number;
    includeKeywords?: string[];
    excludeKeywords?: string[];
    authors?: string[];
    domain?: string;
    fromDate?: string;
    toDate?: string;
    includeComments?: boolean;
    maxCommentsPerItem?: number;
    commentDepth?: number;
    includeDeadOrDeleted?: boolean;
}

export interface HnApiItem {
    id: number;
    type?: string;
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
    type: string;
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
