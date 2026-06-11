import type { HnApiItem, SearchType } from './types.js';

const FIREBASE_BASE = 'https://hacker-news.firebaseio.com/v0';
const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';
const MAX_RETRIES = 3;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJson<T>(url: string): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
            const response = await fetch(url, {
                headers: {
                    'user-agent': 'Apify Hacker News Intelligence Scraper/1.0',
                    connection: 'close',
                },
                signal: controller.signal,
            });

            if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
            return await response.json() as T;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES - 1) await sleep(400 * 2 ** attempt);
        } finally {
            clearTimeout(timeout);
        }
    }

    throw lastError;
}

export async function fetchFeedIds(feed: string): Promise<number[]> {
    const endpoint = feed === 'jobs' ? 'jobstories' : `${feed}stories`;
    return fetchJson<number[]>(`${FIREBASE_BASE}/${endpoint}.json`);
}

export async function fetchItem(id: number): Promise<HnApiItem | null> {
    return fetchJson<HnApiItem | null>(`${FIREBASE_BASE}/item/${id}.json`);
}

interface AlgoliaHit {
    objectID: string;
}

interface AlgoliaResponse {
    hits: AlgoliaHit[];
    page: number;
    nbPages: number;
}

export async function searchItemIds(query: string, type: SearchType, limit: number): Promise<number[]> {
    const ids: number[] = [];
    const hitsPerPage = Math.min(100, limit);
    const tags = encodeURIComponent(type);

    for (let page = 0; ids.length < limit; page += 1) {
        const url = `${ALGOLIA_BASE}/search?query=${encodeURIComponent(query)}&tags=${tags}&hitsPerPage=${hitsPerPage}&page=${page}`;
        const result = await fetchJson<AlgoliaResponse>(url);

        ids.push(...result.hits.map((hit) => Number(hit.objectID)).filter(Number.isSafeInteger));
        if (page + 1 >= result.nbPages || result.hits.length === 0) break;
    }

    return ids.slice(0, limit);
}

export async function mapConcurrent<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
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
