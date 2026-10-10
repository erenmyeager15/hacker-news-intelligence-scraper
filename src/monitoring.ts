import { createHash } from 'node:crypto';
import type {
    ChangeSeverity,
    HnMonitoredRecord,
    HnObservation,
    HnRecord,
    MonitoringStatus,
    NormalizedInput,
} from './types.js';

export function monitorStoreName(monitorName: string): string {
    const slug = monitorName
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 42) || 'watchlist';
    const suffix = createHash('sha256').update(monitorName).digest('hex').slice(0, 12);
    return `hn-monitor-${slug}-${suffix}`;
}

export function monitorRecordKey(id: number): string {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Hacker News item ID must be a positive safe integer.');
    return `ITEM_${id}`;
}

export function normalizeObservationHistory(value: unknown): HnObservation[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isObservation).slice(-50);
}

export function latestObservation(history: HnObservation[]): HnObservation | null {
    return history.at(-1) ?? null;
}

export function enrichRecord(
    record: HnRecord,
    input: NormalizedInput,
    previous: HnObservation | null,
    previousObservationCount = previous ? 1 : 0,
): HnMonitoredRecord {
    const metrics = engagementMetrics(record);
    if (!input.trackChanges) {
        return {
            ...record,
            ...metrics,
            monitorName: null,
            monitoringStatus: 'disabled',
            changeSeverity: 'info',
            changeSummary: 'Change tracking is disabled for this run.',
            changedFields: [],
            changeSignals: [],
            previousSeenAt: null,
            observationCount: 0,
            previousScore: null,
            previousCommentCount: null,
            previousRank: null,
            scoreDelta: null,
            commentDelta: null,
            rankDelta: null,
        };
    }

    if (!previous) {
        const signals = metrics.ageHours !== null && metrics.ageHours <= input.newItemWindowHours
            ? ['new_item']
            : [];
        return monitored(record, metrics, input.monitorName, 'baseline', 'info',
            'First observation saved for this watchlist.', [], signals, null, 1, null);
    }

    const changedFields: string[] = [];
    const signals: string[] = [];
    const scoreDelta = record.score - previous.score;
    const commentDelta = record.commentCount - previous.commentCount;
    const rankDelta = rankDifference(record.rank, previous.rank);

    compare(changedFields, 'score', record.score, previous.score);
    compare(changedFields, 'commentCount', record.commentCount, previous.commentCount);
    compare(changedFields, 'rank', record.rank, previous.rank);
    compare(changedFields, 'title', record.title, previous.title);
    compare(changedFields, 'url', record.url, previous.url);
    compare(changedFields, 'domain', record.domain, previous.domain);
    compare(changedFields, 'author', record.author, previous.author);
    compare(changedFields, 'dead', record.dead, previous.dead);
    compare(changedFields, 'deleted', record.deleted, previous.deleted);

    if (scoreDelta >= input.scoreChangeThreshold) signals.push('score_spike');
    if (commentDelta >= input.commentChangeThreshold) signals.push('discussion_spike');
    if (rankDelta !== null && rankDelta > 0) signals.push('rank_rising');
    if (rankDelta !== null && rankDelta < 0) signals.push('rank_falling');
    if (record.title !== previous.title) signals.push('title_changed');
    if (record.url !== previous.url || record.domain !== previous.domain) signals.push('link_changed');
    if (record.dead !== previous.dead || record.deleted !== previous.deleted) signals.push('moderation_changed');
    if (scoreDelta < 0) signals.push('score_decreased');

    const status: MonitoringStatus = changedFields.length > 0 ? 'updated' : 'unchanged';
    const severity = severityFor(signals);
    const summary = status === 'unchanged'
        ? 'No monitored Hacker News changes were observed.'
        : `${changedFields.length} monitored field(s) changed; ${signals.length} signal(s) emitted.`;
    return monitored(record, metrics, input.monitorName, status, severity, summary,
        changedFields, signals, previous.observedAt, previousObservationCount + 1, previous,
        scoreDelta, commentDelta, rankDelta);
}

export function appendObservation(
    history: HnObservation[],
    record: HnMonitoredRecord,
    historyLimit: number,
): HnObservation[] {
    return [...history, toObservation(record)].slice(-historyLimit);
}

function monitored(
    record: HnRecord,
    metrics: ReturnType<typeof engagementMetrics>,
    monitorName: string,
    monitoringStatus: MonitoringStatus,
    changeSeverity: ChangeSeverity,
    changeSummary: string,
    changedFields: string[],
    changeSignals: string[],
    previousSeenAt: string | null,
    observationCountValue: number,
    previous: HnObservation | null,
    scoreDelta: number | null = null,
    commentDelta: number | null = null,
    rankDelta: number | null = null,
): HnMonitoredRecord {
    return {
        ...record,
        ...metrics,
        monitorName,
        monitoringStatus,
        changeSeverity,
        changeSummary,
        changedFields,
        changeSignals: [...new Set(changeSignals)],
        previousSeenAt,
        observationCount: observationCountValue,
        previousScore: previous?.score ?? null,
        previousCommentCount: previous?.commentCount ?? null,
        previousRank: previous?.rank ?? null,
        scoreDelta,
        commentDelta,
        rankDelta,
    };
}

function engagementMetrics(record: HnRecord): {
    ageHours: number | null;
    pointsPerHour: number | null;
    commentsPerHour: number | null;
    commentToScoreRatio: number | null;
} {
    const collected = Date.parse(record.collectedAt);
    const created = record.createdAt ? Date.parse(record.createdAt) : Number.NaN;
    const ageHours = Number.isFinite(collected) && Number.isFinite(created)
        ? Math.max(0, (collected - created) / 3_600_000)
        : null;
    const denominator = ageHours === null ? null : Math.max(ageHours, 1);
    return {
        ageHours: round(ageHours),
        pointsPerHour: denominator === null ? null : round(record.score / denominator),
        commentsPerHour: denominator === null ? null : round(record.commentCount / denominator),
        commentToScoreRatio: record.score > 0 ? round(record.commentCount / record.score) : null,
    };
}

function toObservation(record: HnMonitoredRecord): HnObservation {
    return {
        observedAt: record.collectedAt,
        score: record.score,
        commentCount: record.commentCount,
        rank: record.rank,
        title: record.title,
        url: record.url,
        domain: record.domain,
        author: record.author,
        dead: record.dead,
        deleted: record.deleted,
    };
}

function rankDifference(current: number | null, previous: number | null): number | null {
    if (current === null || previous === null) return null;
    return previous - current;
}

function severityFor(signals: string[]): ChangeSeverity {
    if (signals.includes('moderation_changed')) return 'high';
    if (signals.includes('score_spike') || signals.includes('discussion_spike')) return 'medium';
    return signals.length > 0 ? 'low' : 'info';
}

function compare(changed: string[], field: string, current: unknown, previous: unknown): void {
    if (current !== previous) changed.push(field);
}

function isObservation(value: unknown): value is HnObservation {
    return isObject(value)
        && typeof value.observedAt === 'string'
        && !Number.isNaN(Date.parse(value.observedAt))
        && Number.isSafeInteger(value.score)
        && (value.score as number) >= 0
        && Number.isSafeInteger(value.commentCount)
        && (value.commentCount as number) >= 0
        && (value.rank === null || (Number.isSafeInteger(value.rank) && (value.rank as number) > 0))
        && (value.title === null || typeof value.title === 'string')
        && (value.url === null || typeof value.url === 'string')
        && (value.domain === null || typeof value.domain === 'string')
        && (value.author === null || typeof value.author === 'string')
        && typeof value.dead === 'boolean'
        && typeof value.deleted === 'boolean';
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function round(value: number | null): number | null {
    return value === null ? null : Math.round(value * 10_000) / 10_000;
}
