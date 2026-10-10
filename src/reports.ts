import type { HnMonitoredRecord, MonitorSummary } from './types.js';

const CSV_FIELDS = [
    'id', 'type', 'title', 'domain', 'author', 'score', 'commentCount', 'rank',
    'ageHours', 'pointsPerHour', 'commentsPerHour', 'monitoringStatus',
    'changeSeverity', 'scoreDelta', 'commentDelta', 'rankDelta', 'changeSignals',
    'observationCount', 'createdAt', 'hnUrl',
] as const;

export function createMonitorSummary(
    records: HnMonitoredRecord[],
    monitorName: string | null,
    trackChanges: boolean,
    generatedAt: string,
): MonitorSummary {
    const signals: Record<string, number> = {};
    for (const record of records) {
        for (const signal of record.changeSignals) signals[signal] = (signals[signal] ?? 0) + 1;
    }
    return {
        monitorName,
        trackChanges,
        total: records.length,
        baseline: records.filter((record) => record.monitoringStatus === 'baseline').length,
        updated: records.filter((record) => record.monitoringStatus === 'updated').length,
        unchanged: records.filter((record) => record.monitoringStatus === 'unchanged').length,
        highSeverity: records.filter((record) => record.changeSeverity === 'high').length,
        mediumSeverity: records.filter((record) => record.changeSeverity === 'medium').length,
        signals,
        generatedAt,
    };
}

export function createMarkdownReport(records: HnMonitoredRecord[], summary: MonitorSummary): string {
    const lines = [
        '# Hacker News watchlist report',
        '',
        `- Watchlist: ${summary.monitorName ?? 'tracking disabled'}`,
        `- Generated: ${summary.generatedAt}`,
        `- Records: ${summary.total}`,
        `- Baseline / updated / unchanged: ${summary.baseline} / ${summary.updated} / ${summary.unchanged}`,
        `- Medium / high severity: ${summary.mediumSeverity} / ${summary.highSeverity}`,
        '',
        '| Status | Severity | Score Δ | Comments Δ | Rank Δ | Title | Signals |',
        '| --- | --- | ---: | ---: | ---: | --- | --- |',
    ];
    for (const record of records) {
        lines.push(`| ${record.monitoringStatus} | ${record.changeSeverity} | ${numberCell(record.scoreDelta)} | ${numberCell(record.commentDelta)} | ${numberCell(record.rankDelta)} | [${markdownText(record.title ?? `HN ${record.id}`)}](${record.hnUrl}) | ${markdownText(record.changeSignals.join(', '))} |`);
    }
    return `${lines.join('\n')}\n`;
}

export function createCsvReport(records: HnMonitoredRecord[]): string {
    const rows = [CSV_FIELDS.join(',')];
    for (const record of records) {
        const values = CSV_FIELDS.map((field) => {
            const value = field === 'changeSignals' ? record.changeSignals.join('|') : record[field];
            return csvCell(value);
        });
        rows.push(values.join(','));
    }
    return `${rows.join('\r\n')}\r\n`;
}

function csvCell(value: unknown): string {
    const raw = value === null || value === undefined ? '' : String(value);
    const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
}

function markdownText(value: string): string {
    return value.replace(/[|\[\]]/g, '\\$&').replace(/\r?\n/g, ' ').slice(0, 500);
}

function numberCell(value: number | null): string {
    return value === null ? '' : String(value);
}
