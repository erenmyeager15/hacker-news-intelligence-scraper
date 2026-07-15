import type {
    ApiMetrics,
    Feed,
    HackerNewsClient,
    HnApiItem,
    HnItemType,
    SearchIdsResult,
    SearchType,
} from './types.js';

const FIREBASE_BASE = 'https://hacker-news.firebaseio.com/v0';
const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ATTEMPTS = 3;
const MAX_RESPONSE_LENGTH = 5_000_000;
const MAX_RETRY_DELAY_MS = 10_000;
const MAX_SEARCH_PAGES = 100;
const ITEM_TYPES = new Set<HnItemType>(['job', 'story', 'comment', 'poll', 'pollopt']);

export type HnApiErrorKind = 'blocked' | 'rate_limit' | 'upstream' | 'invalid_response' | 'timeout' | 'network';

export class HnApiError extends Error {
    constructor(
        message: string,
        public readonly kind: HnApiErrorKind,
        public readonly statusCode: number | null,
        public readonly attempts: number,
    ) {
        super(message);
        this.name = 'HnApiError';
    }
}

export interface HackerNewsClientOptions {
    fetchImpl?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<void>;
    timeoutMs?: number;
    maxAttempts?: number;
}

export function createHackerNewsClient(options: HackerNewsClientOptions = {}): HackerNewsClient {
    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, 60_000, 'timeoutMs');
    const maxAttempts = boundedInteger(options.maxAttempts ?? DEFAULT_ATTEMPTS, 1, 5, 'maxAttempts');
    const metrics: ApiMetrics = {
        requestAttempts: 0,
        retries: 0,
        firebaseAttempts: 0,
        algoliaAttempts: 0,
    };

    async function fetchJson(url: string, source: 'firebase' | 'algolia', label: string): Promise<unknown> {
        let lastError: HnApiError | null = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            metrics.requestAttempts += 1;
            if (source === 'firebase') metrics.firebaseAttempts += 1;
            else metrics.algoliaAttempts += 1;

            try {
                const response = await fetchImpl(url, {
                    headers: {
                        'User-Agent': 'apify-hacker-news-intelligence-scraper/1.0',
                        Accept: 'application/json',
                        'Accept-Encoding': 'gzip, deflate',
                    },
                    signal: AbortSignal.timeout(timeoutMs),
                });

                if (!response.ok) {
                    const statusError = classifyStatus(response.status, attempt, label);
                    if (!isRetryableStatus(response.status) || attempt === maxAttempts) throw statusError;
                    lastError = statusError;
                    metrics.retries += 1;
                    await response.body?.cancel().catch(() => undefined);
                    await sleep(retryDelay(response.headers, attempt));
                    continue;
                }

                const contentLength = Number(response.headers.get('content-length'));
                if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_LENGTH) {
                    throw new HnApiError(`${label} response exceeded the size limit.`, 'invalid_response', response.status, attempt);
                }
                const body = await response.text();
                if (!body.trim()) {
                    throw new HnApiError(`${label} returned an empty response.`, 'invalid_response', response.status, attempt);
                }
                if (body.length > MAX_RESPONSE_LENGTH) {
                    throw new HnApiError(`${label} response exceeded the size limit.`, 'invalid_response', response.status, attempt);
                }
                try {
                    return JSON.parse(body) as unknown;
                } catch {
                    throw new HnApiError(`${label} returned malformed JSON.`, 'invalid_response', response.status, attempt);
                }
            } catch (error) {
                if (error instanceof HnApiError) throw error;
                const timedOut = error instanceof Error
                    && (error.name === 'AbortError' || error.name === 'TimeoutError');
                const normalized = new HnApiError(
                    `${label} ${timedOut ? 'timed out' : 'request failed'}: ${safeMessage(error)}`,
                    timedOut ? 'timeout' : 'network',
                    null,
                    attempt,
                );
                if (attempt === maxAttempts) throw normalized;
                lastError = normalized;
                metrics.retries += 1;
                await sleep(Math.min(500 * (2 ** (attempt - 1)), 4_000));
            }
        }

        throw lastError ?? new HnApiError(`${label} request failed.`, 'network', null, maxAttempts);
    }

    return {
        async fetchFeedIds(feed: Feed): Promise<number[]> {
            const endpoint = feed === 'jobs' ? 'jobstories' : `${feed}stories`;
            const value = await fetchJson(`${FIREBASE_BASE}/${endpoint}.json`, 'firebase', `Hacker News ${feed} feed`);
            return parseIdArray(value, `Hacker News ${feed} feed`, 1_000);
        },

        async fetchItem(id: number): Promise<HnApiItem | null> {
            const value = await fetchJson(`${FIREBASE_BASE}/item/${id}.json`, 'firebase', `Hacker News item ${id}`);
            return parseItem(value, id);
        },

        async searchItemIds(query: string, type: SearchType, limit: number): Promise<SearchIdsResult> {
            boundedInteger(limit, 1, 1_000, 'search limit');
            const ids: number[] = [];
            let invalidHitsSkipped = 0;
            let pagesFetched = 0;
            let reportedPageCount = 0;
            const hitsPerPage = Math.min(100, limit);

            for (let page = 0; ids.length < limit && page < MAX_SEARCH_PAGES; page += 1) {
                const parameters = new URLSearchParams({
                    query,
                    tags: type,
                    hitsPerPage: String(hitsPerPage),
                    page: String(page),
                });
                const value = await fetchJson(
                    `${ALGOLIA_BASE}/search?${parameters.toString()}`,
                    'algolia',
                    `HN Algolia search page ${page}`,
                );
                const parsed = parseSearchResponse(value, page);
                pagesFetched += 1;
                reportedPageCount = parsed.nbPages;
                invalidHitsSkipped += parsed.invalidHitsSkipped;
                ids.push(...parsed.ids);
                if (page + 1 >= parsed.nbPages || parsed.hitCount === 0) break;
            }

            return {
                ids: deduplicate(ids).slice(0, limit),
                pagesFetched,
                invalidHitsSkipped,
                pageLimitReached: pagesFetched >= MAX_SEARCH_PAGES
                    && ids.length < limit
                    && reportedPageCount > MAX_SEARCH_PAGES,
            };
        },

        getMetrics(): ApiMetrics {
            return { ...metrics };
        },
    };
}

export async function mapConcurrent<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
    boundedInteger(concurrency, 1, 100, 'concurrency');
    const output = new Array<R>(values.length);
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < values.length) {
            const index = cursor;
            cursor += 1;
            output[index] = await mapper(values[index], index);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
    return output;
}

function parseItem(value: unknown, expectedId: number): HnApiItem | null {
    if (value === null) return null;
    const item = asObject(value, `Hacker News item ${expectedId}`);
    const id = requiredPositiveInteger(item.id, 'item.id');
    if (id !== expectedId) throw invalidContract(`Hacker News item ${expectedId} returned mismatched id ${id}.`);
    if (typeof item.type !== 'string' || !ITEM_TYPES.has(item.type as HnItemType)) {
        throw invalidContract(`Hacker News item ${expectedId} has an invalid type.`);
    }

    return {
        id,
        type: item.type as HnItemType,
        ...(optionalString(item.by, 'item.by', 256) !== undefined ? { by: item.by as string } : {}),
        ...(optionalInteger(item.time, 'item.time', 0) !== undefined ? { time: item.time as number } : {}),
        ...(optionalString(item.text, 'item.text', 2_000_000) !== undefined ? { text: item.text as string } : {}),
        ...(optionalString(item.title, 'item.title', 100_000) !== undefined ? { title: item.title as string } : {}),
        ...(optionalString(item.url, 'item.url', 4_096) !== undefined ? { url: item.url as string } : {}),
        ...(optionalInteger(item.score, 'item.score', 0) !== undefined ? { score: item.score as number } : {}),
        ...(optionalInteger(item.descendants, 'item.descendants', 0) !== undefined
            ? { descendants: item.descendants as number }
            : {}),
        ...(optionalInteger(item.parent, 'item.parent', 1) !== undefined ? { parent: item.parent as number } : {}),
        ...(optionalInteger(item.poll, 'item.poll', 1) !== undefined ? { poll: item.poll as number } : {}),
        ...(item.parts !== undefined ? { parts: parseIdArray(item.parts, 'item.parts', 100_000) } : {}),
        ...(item.kids !== undefined ? { kids: parseIdArray(item.kids, 'item.kids', 100_000) } : {}),
        ...(optionalBoolean(item.dead, 'item.dead') !== undefined ? { dead: item.dead as boolean } : {}),
        ...(optionalBoolean(item.deleted, 'item.deleted') !== undefined ? { deleted: item.deleted as boolean } : {}),
    };
}

function parseSearchResponse(value: unknown, expectedPage: number): {
    ids: number[];
    nbPages: number;
    hitCount: number;
    invalidHitsSkipped: number;
} {
    const response = asObject(value, 'HN Algolia response');
    const page = requiredInteger(response.page, 'search.page', 0);
    const nbPages = requiredInteger(response.nbPages, 'search.nbPages', 0, 1_000_000);
    if (page !== expectedPage) throw invalidContract(`HN Algolia returned page ${page}, expected ${expectedPage}.`);
    if (!Array.isArray(response.hits) || response.hits.length > 1_000) {
        throw invalidContract('HN Algolia response.hits must be a bounded array.');
    }

    const ids: number[] = [];
    let invalidHitsSkipped = 0;
    for (const value of response.hits) {
        const hit = typeof value === 'object' && value !== null && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null;
        const objectId = hit?.objectID;
        if (typeof objectId !== 'string' || !/^[1-9][0-9]{0,11}$/.test(objectId)) {
            invalidHitsSkipped += 1;
            continue;
        }
        const id = Number(objectId);
        if (!Number.isSafeInteger(id)) {
            invalidHitsSkipped += 1;
            continue;
        }
        ids.push(id);
    }
    return { ids, nbPages, hitCount: response.hits.length, invalidHitsSkipped };
}

function parseIdArray(value: unknown, field: string, maximumItems: number): number[] {
    if (!Array.isArray(value) || value.length > maximumItems) {
        throw invalidContract(`${field} must be an array with at most ${maximumItems} IDs.`);
    }
    const ids = value.map((id, index) => requiredPositiveInteger(id, `${field}[${index}]`));
    return deduplicate(ids);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw invalidContract(`${field} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function requiredPositiveInteger(value: unknown, field: string): number {
    return requiredInteger(value, field, 1);
}

function requiredInteger(
    value: unknown,
    field: string,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER,
): number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw invalidContract(`${field} must be a safe integer from ${minimum} to ${maximum}.`);
    }
    return value as number;
}

function optionalInteger(value: unknown, field: string, minimum: number): number | undefined {
    if (value === undefined) return undefined;
    return requiredInteger(value, field, minimum);
}

function optionalString(value: unknown, field: string, maximumLength: number): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length > maximumLength) {
        throw invalidContract(`${field} must be a string no longer than ${maximumLength} characters.`);
    }
    return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw invalidContract(`${field} must be a boolean.`);
    return value;
}

function classifyStatus(statusCode: number, attempt: number, label: string): HnApiError {
    const kind: HnApiErrorKind = statusCode === 403
        ? 'blocked'
        : statusCode === 429
            ? 'rate_limit'
            : statusCode === 408 || statusCode >= 500
                ? 'upstream'
                : 'invalid_response';
    return new HnApiError(`${label} returned HTTP ${statusCode}.`, kind, statusCode, attempt);
}

function isRetryableStatus(statusCode: number): boolean {
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function retryDelay(headers: Headers, attempt: number): number {
    const value = headers.get('retry-after');
    const seconds = value === null ? Number.NaN : Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS);
    if (value) {
        const timestamp = Date.parse(value);
        if (!Number.isNaN(timestamp)) return Math.min(Math.max(0, timestamp - Date.now()), MAX_RETRY_DELAY_MS);
    }
    return Math.min(1_000 * (2 ** (attempt - 1)), MAX_RETRY_DELAY_MS);
}

function invalidContract(message: string): HnApiError {
    return new HnApiError(message, 'invalid_response', 200, 1);
}

function safeMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
        .replace(/https?:\/\/\S+/gi, '[URL omitted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
}

function deduplicate(ids: number[]): number[] {
    return [...new Set(ids)];
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
    }
    return value;
}
