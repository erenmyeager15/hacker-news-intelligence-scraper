import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInput } from './input.js';
import { enrichRecord } from './monitoring.js';
import { createCsvReport, createMarkdownReport, createMonitorSummary } from './reports.js';
import type { HnRecord } from './types.js';

const base: HnRecord = {
    id: 7,
    type: 'story',
    title: '=unsafe title',
    text: null,
    textHtml: null,
    url: null,
    hnUrl: 'https://news.ycombinator.com/item?id=7',
    domain: null,
    author: 'alice',
    score: 5,
    commentCount: 1,
    parentId: null,
    pollId: null,
    pollParts: [],
    createdAt: '2026-10-10T10:00:00.000Z',
    createdAtUnix: 1_760_091_200,
    rank: 1,
    feed: 'top',
    query: null,
    dead: false,
    deleted: false,
    comments: [],
    collectedAt: '2026-10-10T12:00:00.000Z',
};

test('builds a monitor summary and readable Markdown report', () => {
    const row = enrichRecord(base, normalizeInput({ monitorName: 'test' }), null);
    const summary = createMonitorSummary([row], 'test', true, base.collectedAt);
    assert.equal(summary.baseline, 1);
    assert.equal(summary.signals.new_item, 1);
    assert.match(createMarkdownReport([row], summary), /Hacker News watchlist report/);
});

test('escapes formula-like CSV cells', () => {
    const row = enrichRecord(base, normalizeInput({ monitorName: 'test' }), null);
    const csv = createCsvReport([row]);
    assert.match(csv, /"'=unsafe title"/);
    assert.match(csv, /monitoringStatus/);
});
