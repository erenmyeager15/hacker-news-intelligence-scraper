import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput } from './input.js';
import { HackerNewsRunError, runHackerNews } from './scraper.js';
import type {
    ApiMetrics,
    HackerNewsClient,
    HackerNewsRunStatus,
    HnApiItem,
    HnRecord,
} from './types.js';

const metrics: ApiMetrics = {
    requestAttempts: 0,
    retries: 0,
    firebaseAttempts: 0,
    algoliaAttempts: 0,
};

function item(id: number, overrides: Partial<HnApiItem> = {}): HnApiItem {
    return {
        id,
        type: 'story',
        title: `Story ${id}`,
        by: 'alice',
        score: 10,
        descendants: 2,
        time: 1_752_537_600,
        ...overrides,
    };
}

function client(overrides: Partial<HackerNewsClient> = {}): HackerNewsClient {
    return {
        fetchFeedIds: async () => [1],
        fetchItem: async (id) => item(id),
        searchItemIds: async () => ({
            ids: [1],
            pagesFetched: 1,
            invalidHitsSkipped: 0,
            pageLimitReached: false,
        }),
        getMetrics: () => ({ ...metrics }),
        ...overrides,
    };
}

function harness(overrides: {
    client?: HackerNewsClient;
    saveRecord?: (record: HnRecord) => Promise<{ chargedCount: number; eventChargeLimitReached: boolean }>;
} = {}) {
    const records: HnRecord[] = [];
    const statuses: HackerNewsRunStatus[] = [];
    let clock = 100;
    return {
        records,
        statuses,
        dependencies: {
            client: overrides.client ?? client(),
            saveRecord: overrides.saveRecord ?? (async (record: HnRecord) => {
                records.push(record);
                return { chargedCount: 1, eventChargeLimitReached: false };
            }),
            writeStatus: async (status: HackerNewsRunStatus) => {
                statuses.push(structuredClone(status));
            },
            now: () => new Date('2026-07-15T00:00:00.000Z'),
            nowMs: () => {
                clock += 5;
                return clock;
            },
        },
    };
}

test('saves a successful feed item with rank and status metrics', async () => {
    const run = harness();
    const status = await runHackerNews(normalizeInput({ maxResults: 1 }), run.dependencies);
    assert.equal(status.status, 'succeeded');
    assert.equal(status.recordsSaved, 1);
    assert.equal(status.itemRequests, 1);
    assert.equal(run.records[0].rank, 1);
    assert.equal(run.records[0].feed, 'top');
    assert.equal(run.statuses.at(-1)?.status, 'succeeded');
});

test('returns an honest empty outcome when filters match nothing', async () => {
    const run = harness();
    const status = await runHackerNews(normalizeInput({ minScore: 11 }), run.dependencies);
    assert.equal(status.status, 'empty');
    assert.equal(status.recordsFiltered, 1);
    assert.equal(status.recordsSaved, 0);
});

test('marks a mixed-success run as partial', async () => {
    const run = harness({
        client: client({
            fetchFeedIds: async () => [1, 2],
            fetchItem: async (id) => {
                if (id === 2) throw new Error('temporary upstream failure');
                return item(id);
            },
        }),
    });
    const status = await runHackerNews(normalizeInput({ maxResults: 2 }), run.dependencies);
    assert.equal(status.status, 'partial');
    assert.equal(status.recordsSaved, 1);
    assert.equal(status.itemFailures, 1);
    assert.equal(status.diagnostics.length, 1);
});

test('marks a zero-result upstream failure as failed', async () => {
    const run = harness({ client: client({ fetchItem: async () => { throw new Error('offline'); } }) });
    const status = await runHackerNews(normalizeInput({}), run.dependencies);
    assert.equal(status.status, 'failed');
    assert.equal(status.recordsSaved, 0);
    assert.match(status.failureMessage ?? '', /all usable item requests failed/);
});

test('writes failed status and throws when discovery fails', async () => {
    const run = harness({ client: client({ fetchFeedIds: async () => { throw new Error('feed offline'); } }) });
    await assert.rejects(
        () => runHackerNews(normalizeInput({}), run.dependencies),
        (error: unknown) => error instanceof HackerNewsRunError,
    );
    assert.equal(run.statuses.at(-1)?.status, 'failed');
    assert.match(run.statuses.at(-1)?.failureMessage ?? '', /Candidate discovery failed/);
});

test('traverses through excluded dead comments to eligible children', async () => {
    const run = harness({
        client: client({
            fetchFeedIds: async () => [1],
            fetchItem: async (id) => {
                if (id === 1) return item(1, { kids: [2] });
                if (id === 2) return item(2, { type: 'comment', dead: true, kids: [3], parent: 1 });
                return item(3, { type: 'comment', parent: 2, text: 'eligible child' });
            },
        }),
    });
    const status = await runHackerNews(normalizeInput({
        includeComments: true,
        maxCommentsPerItem: 10,
        commentDepth: 3,
    }), run.dependencies);
    assert.equal(status.status, 'succeeded');
    assert.equal(status.commentsSkippedByPolicy, 1);
    assert.equal(status.commentsSaved, 1);
    assert.deepEqual(run.records[0].comments.map((comment) => comment.id), [3]);
});

test('stops cleanly at the user spending limit', async () => {
    const run = harness({
        saveRecord: async () => ({ chargedCount: 0, eventChargeLimitReached: true }),
    });
    const status = await runHackerNews(normalizeInput({}), run.dependencies);
    assert.equal(status.status, 'stopped_spending_limit');
    assert.equal(status.spendingLimitReached, true);
    assert.equal(status.recordsSaved, 0);
});

test('treats dataset write errors as fatal and records diagnostics', async () => {
    const run = harness({ saveRecord: async () => { throw new Error('dataset unavailable'); } });
    await assert.rejects(
        () => runHackerNews(normalizeInput({}), run.dependencies),
        (error: unknown) => error instanceof HackerNewsRunError,
    );
    assert.equal(run.statuses.at(-1)?.status, 'failed');
    assert.equal(run.statuses.at(-1)?.diagnostics[0].stage, 'storage');
});

test('sets search context and rank on Algolia-discovered records', async () => {
    const run = harness({
        client: client({
            searchItemIds: async () => ({
                ids: [9],
                pagesFetched: 2,
                invalidHitsSkipped: 0,
                pageLimitReached: false,
            }),
            fetchItem: async () => item(9),
        }),
    });
    const status = await runHackerNews(normalizeInput({ mode: 'search', query: 'typescript' }), run.dependencies);
    assert.equal(status.searchPagesFetched, 2);
    assert.equal(run.records[0].query, 'typescript');
    assert.equal(run.records[0].rank, 1);
});

test('keeps explicit item mode unranked', async () => {
    const run = harness({ client: client({ fetchItem: async () => item(99) }) });
    await runHackerNews(normalizeInput({ mode: 'items', itemIds: ['99'] }), run.dependencies);
    assert.equal(run.records[0].rank, null);
    assert.equal(run.records[0].feed, null);
});
