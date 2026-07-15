import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput } from './input.js';

test('uses a one-result low-cost default', () => {
    const input = normalizeInput({});
    assert.equal(input.mode, 'feed');
    assert.equal(input.feed, 'top');
    assert.equal(input.maxResults, 1);
    assert.equal(input.includeComments, false);
});

test('normalizes and deduplicates explicit item IDs', () => {
    const input = normalizeInput({ mode: 'items', itemIds: ['42', 42, '43'] });
    assert.deepEqual(input.itemIds, [42, 43]);
});

test('rejects unknown input fields', () => {
    assert.throws(() => normalizeInput({ surprise: true }), /unsupported field/);
});

test('requires a search query in search mode', () => {
    assert.throws(() => normalizeInput({ mode: 'search', query: '  ' }), /query must not be empty/);
});

test('requires item IDs in items mode', () => {
    assert.throws(() => normalizeInput({ mode: 'items', itemIds: [] }), /itemIds must contain/);
});

test('normalizes date-only bounds to UTC day boundaries', () => {
    const input = normalizeInput({ fromDate: '2026-07-01', toDate: '2026-07-02' });
    assert.equal(input.fromTimestamp, Date.parse('2026-07-01T00:00:00.000Z'));
    assert.equal(input.toTimestamp, Date.parse('2026-07-02T23:59:59.999Z'));
});

test('rejects invalid dates and reversed ranges', () => {
    assert.throws(() => normalizeInput({ fromDate: '2026-02-30' }), /valid calendar date/);
    assert.throws(
        () => normalizeInput({ fromDate: '2026-07-03', toDate: '2026-07-02' }),
        /earlier than or equal/,
    );
});

test('bounds result and nested-comment workload', () => {
    assert.throws(() => normalizeInput({ maxResults: 0 }), /maxResults/);
    assert.throws(
        () => normalizeInput({ maxResults: 11, includeComments: true, maxCommentsPerItem: 500 }),
        /at most 5,000 comments/,
    );
});
