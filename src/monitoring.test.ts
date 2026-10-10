import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput } from './input.js';
import {
    appendObservation,
    enrichRecord,
    latestObservation,
    monitorRecordKey,
    monitorStoreName,
    normalizeObservationHistory,
} from './monitoring.js';
import type { HnRecord } from './types.js';

function record(overrides: Partial<HnRecord> = {}): HnRecord {
    return {
        id: 42,
        type: 'story',
        title: 'Show HN: Example',
        text: null,
        textHtml: null,
        url: 'https://example.com/',
        hnUrl: 'https://news.ycombinator.com/item?id=42',
        domain: 'example.com',
        author: 'alice',
        score: 20,
        commentCount: 5,
        parentId: null,
        pollId: null,
        pollParts: [],
        createdAt: '2026-10-10T10:00:00.000Z',
        createdAtUnix: 1_760_091_200,
        rank: 10,
        feed: 'show',
        query: null,
        dead: false,
        deleted: false,
        comments: [],
        collectedAt: '2026-10-10T12:00:00.000Z',
        ...overrides,
    };
}

test('creates a stable isolated store name', () => {
    assert.equal(monitorStoreName('My Watchlist'), monitorStoreName('My Watchlist'));
    assert.notEqual(monitorStoreName('My Watchlist'), monitorStoreName('my watchlist'));
    assert.match(monitorStoreName('My Watchlist'), /^hn-monitor-my-watchlist-[a-f0-9]{12}$/);
    assert.equal(monitorRecordKey(42), 'ITEM_42');
});

test('creates a baseline with deterministic engagement metrics', () => {
    const monitored = enrichRecord(record(), normalizeInput({ monitorName: 'launches' }), null);
    assert.equal(monitored.monitoringStatus, 'baseline');
    assert.equal(monitored.ageHours, 2);
    assert.equal(monitored.pointsPerHour, 10);
    assert.equal(monitored.commentsPerHour, 2.5);
    assert.equal(monitored.commentToScoreRatio, 0.25);
    assert.deepEqual(monitored.changeSignals, ['new_item']);
});

test('detects score, discussion and rank momentum on repeat', () => {
    const input = normalizeInput({ monitorName: 'launches', scoreChangeThreshold: 10, commentChangeThreshold: 5 });
    const baseline = enrichRecord(record(), input, null);
    const history = appendObservation([], baseline, input.observationHistoryLimit);
    const repeat = enrichRecord(record({ score: 35, commentCount: 12, rank: 4, collectedAt: '2026-10-10T13:00:00.000Z' }), input, latestObservation(history), history.length);
    assert.equal(repeat.monitoringStatus, 'updated');
    assert.equal(repeat.changeSeverity, 'medium');
    assert.equal(repeat.scoreDelta, 15);
    assert.equal(repeat.commentDelta, 7);
    assert.equal(repeat.rankDelta, 6);
    assert.deepEqual(repeat.changeSignals, ['score_spike', 'discussion_spike', 'rank_rising']);
});

test('caps history and returns unchanged on an identical repeat', () => {
    const input = normalizeInput({ monitorName: 'stable', observationHistoryLimit: 2 });
    const baseline = enrichRecord(record(), input, null);
    let history = appendObservation([], baseline, 2);
    const repeat = enrichRecord(record(), input, latestObservation(history), history.length);
    assert.equal(repeat.monitoringStatus, 'unchanged');
    history = appendObservation(history, repeat, 2);
    history = appendObservation(history, repeat, 2);
    assert.equal(history.length, 2);
    assert.equal(repeat.observationCount, 2);
});

test('disables monitoring without removing engagement metrics', () => {
    const monitored = enrichRecord(record(), normalizeInput({ trackChanges: false }), null);
    assert.equal(monitored.monitoringStatus, 'disabled');
    assert.equal(monitored.monitorName, null);
    assert.equal(monitored.pointsPerHour, 10);
});

test('rejects malformed stored observations and bounds restored history', () => {
    const history = normalizeObservationHistory([{ observedAt: 'bad' }]);
    assert.deepEqual(history, []);
});
