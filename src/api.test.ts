import assert from 'node:assert/strict';
import test from 'node:test';
import { createHackerNewsClient, HnApiError } from './api.js';

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

test('uses the official jobs endpoint and deduplicates feed IDs', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
        urls.push(String(input));
        return jsonResponse([3, 2, 3]);
    }) as typeof fetch;
    const client = createHackerNewsClient({ fetchImpl });
    assert.deepEqual(await client.fetchFeedIds('jobs'), [3, 2]);
    assert.match(urls[0], /\/jobstories\.json$/);
});

test('validates feed response shape', async () => {
    const client = createHackerNewsClient({
        fetchImpl: (async () => jsonResponse({ ids: [1] })) as typeof fetch,
    });
    await assert.rejects(() => client.fetchFeedIds('top'), HnApiError);
});

test('accepts extra official item fields but validates the contract', async () => {
    const client = createHackerNewsClient({
        fetchImpl: (async () => jsonResponse({ id: 42, type: 'story', title: 'Hello', extra: true })) as typeof fetch,
    });
    assert.deepEqual(await client.fetchItem(42), { id: 42, type: 'story', title: 'Hello' });
});

test('rejects mismatched item IDs', async () => {
    const client = createHackerNewsClient({
        fetchImpl: (async () => jsonResponse({ id: 41, type: 'story' })) as typeof fetch,
    });
    await assert.rejects(() => client.fetchItem(42), /mismatched id/);
});

test('returns null for a missing item', async () => {
    const client = createHackerNewsClient({
        fetchImpl: (async () => jsonResponse(null)) as typeof fetch,
    });
    assert.equal(await client.fetchItem(42), null);
});

test('retries bounded upstream errors and reports metrics', async () => {
    let calls = 0;
    const client = createHackerNewsClient({
        fetchImpl: (async () => {
            calls += 1;
            return calls === 1 ? jsonResponse({ error: true }, 503) : jsonResponse([1]);
        }) as typeof fetch,
        sleep: async () => undefined,
    });
    assert.deepEqual(await client.fetchFeedIds('top'), [1]);
    assert.deepEqual(client.getMetrics(), {
        requestAttempts: 2,
        retries: 1,
        firebaseAttempts: 2,
        algoliaAttempts: 0,
    });
});

test('does not retry non-retryable HTTP failures', async () => {
    let calls = 0;
    const client = createHackerNewsClient({
        fetchImpl: (async () => {
            calls += 1;
            return jsonResponse({}, 404);
        }) as typeof fetch,
        sleep: async () => undefined,
    });
    await assert.rejects(() => client.fetchFeedIds('top'), /HTTP 404/);
    assert.equal(calls, 1);
});

test('rejects malformed JSON without retrying', async () => {
    let calls = 0;
    const client = createHackerNewsClient({
        fetchImpl: (async () => {
            calls += 1;
            return new Response('{broken', { status: 200 });
        }) as typeof fetch,
        sleep: async () => undefined,
    });
    await assert.rejects(() => client.fetchFeedIds('top'), /malformed JSON/);
    assert.equal(calls, 1);
});

test('paginates search, skips malformed hits, and deduplicates IDs', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        return url.includes('page=0')
            ? jsonResponse({ page: 0, nbPages: 2, hits: [{ objectID: '10' }, { objectID: 'bad' }] })
            : jsonResponse({ page: 1, nbPages: 2, hits: [{ objectID: '10' }, { objectID: '11' }] });
    }) as typeof fetch;
    const client = createHackerNewsClient({ fetchImpl });
    const result = await client.searchItemIds('artificial intelligence', 'story', 2);
    assert.deepEqual(result, {
        ids: [10, 11],
        pagesFetched: 2,
        invalidHitsSkipped: 1,
        pageLimitReached: false,
    });
    assert.match(urls[0], /query=artificial\+intelligence/);
    assert.match(urls[0], /tags=story/);
});
