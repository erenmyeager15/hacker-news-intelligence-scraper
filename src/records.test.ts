import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput } from './input.js';
import { isValidRecord, mapComment, mapItem, matchesFilters } from './records.js';
import type { HnApiItem } from './types.js';

const collectedAt = '2026-07-15T00:00:00.000Z';

function story(overrides: Partial<HnApiItem> = {}): HnApiItem {
    return {
        id: 42,
        type: 'story',
        title: '<b>Launch</b> notes',
        text: 'A <i>developer</i> story',
        url: 'https://www.example.com/path',
        by: 'alice',
        score: 12,
        descendants: 4,
        time: 1_752_537_600,
        ...overrides,
    };
}

test('maps HTML, URLs, timestamps, and feed context', () => {
    const record = mapItem(story(), 'top', null, 1, collectedAt);
    assert.equal(record.title, 'Launch notes');
    assert.equal(record.text, 'A developer story');
    assert.equal(record.domain, 'example.com');
    assert.equal(record.rank, 1);
    assert.equal(record.createdAt, '2025-07-15T00:00:00.000Z');
    assert.equal(isValidRecord(record), true);
});

test('drops unsafe external URLs', () => {
    const record = mapItem(story({ url: 'javascript:alert(1)' }), null, null, null, collectedAt);
    assert.equal(record.url, null);
    assert.equal(record.domain, null);
    assert.equal(isValidRecord(record), true);
});

test('maps nested comments with moderation state', () => {
    const comment = mapComment({
        id: 7,
        type: 'comment',
        text: '<p>Hello</p>',
        parent: 42,
        dead: true,
    }, 2);
    assert.equal(comment.text, 'Hello');
    assert.equal(comment.depth, 2);
    assert.equal(comment.dead, true);
});

test('applies score, keyword, author, domain, and date filters', () => {
    const record = mapItem(story(), 'top', null, 1, collectedAt);
    const input = normalizeInput({
        minScore: 10,
        includeKeywords: ['developer'],
        authors: ['ALICE'],
        domain: 'example.com',
        fromDate: '2025-07-15',
        toDate: '2025-07-15',
    });
    assert.equal(matchesFilters(record, input), true);
    assert.equal(matchesFilters(record, normalizeInput({ minScore: 13 })), false);
    assert.equal(matchesFilters(record, normalizeInput({ excludeKeywords: ['launch'] })), false);
});

test('excludes dead records unless explicitly enabled', () => {
    const record = mapItem(story({ dead: true }), 'top', null, 1, collectedAt);
    assert.equal(matchesFilters(record, normalizeInput({})), false);
    assert.equal(matchesFilters(record, normalizeInput({ includeDeadOrDeleted: true })), true);
});

test('rejects an invalid output timestamp', () => {
    const record = mapItem(story(), 'top', null, 1, collectedAt);
    record.collectedAt = 'not-a-date';
    assert.equal(isValidRecord(record), false);
});
