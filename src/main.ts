import { Actor, log } from 'apify';
import { createHackerNewsClient } from './api.js';
import { normalizeInput } from './input.js';
import {
    appendObservation,
    enrichRecord,
    latestObservation,
    monitorRecordKey,
    monitorStoreName,
    normalizeObservationHistory,
} from './monitoring.js';
import { createCsvReport, createMarkdownReport, createMonitorSummary } from './reports.js';
import { HackerNewsRunError, runHackerNews } from './scraper.js';
import type {
    ApiMetrics,
    HackerNewsRunStatus,
    HnMonitoredRecord,
    HnObservation,
    Mode,
} from './types.js';

await Actor.main(async () => {
    const rawInput = await Actor.getInput<unknown>() ?? {};
    let input;
    try {
        input = normalizeInput(rawInput);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = invalidInputStatus(rawInput, message);
        await Actor.setValue('RUN_STATUS', status);
        await Actor.setStatusMessage(`Invalid input: ${message.slice(0, 180)}`);
        throw error;
    }

    const client = createHackerNewsClient();
    const monitorStore = input.trackChanges
        ? await Actor.openKeyValueStore(monitorStoreName(input.monitorName))
        : null;
    const savedRecords: HnMonitoredRecord[] = [];
    const pendingHistories = new Map<string, HnObservation[]>();
    log.info('Starting Hacker News collection', {
        mode: input.mode,
        maxResults: input.maxResults,
        includeComments: input.includeComments,
        trackChanges: input.trackChanges,
        monitorName: input.trackChanges ? input.monitorName : null,
    });

    try {
        const status = await runHackerNews(input, {
            client,
            saveRecord: async (record) => {
                const recordKey = monitorRecordKey(record.id);
                const history = input.trackChanges
                    ? pendingHistories.get(recordKey)
                        ?? normalizeObservationHistory(await monitorStore?.getValue(recordKey))
                    : [];
                const previous = input.trackChanges ? latestObservation(history) : null;
                const monitored = enrichRecord(
                    record,
                    input,
                    previous,
                    history.length,
                );
                const charge = await Actor.pushData(monitored, 'item-scraped');
                const saved = charge.chargedCount > 0 || !charge.eventChargeLimitReached;
                if (saved) {
                    savedRecords.push(monitored);
                    if (input.trackChanges) {
                        pendingHistories.set(
                            recordKey,
                            appendObservation(history, monitored, input.observationHistoryLimit),
                        );
                    }
                }
                return charge;
            },
            writeStatus: async (runStatus) => Actor.setValue('RUN_STATUS', runStatus),
        });
        if (monitorStore && pendingHistories.size > 0) {
            const entries = [...pendingHistories.entries()];
            for (let offset = 0; offset < entries.length; offset += 25) {
                await Promise.all(entries.slice(offset, offset + 25).map(
                    ([key, history]) => monitorStore.setValue(key, history),
                ));
            }
        }
        const generatedAt = savedRecords.at(-1)?.collectedAt ?? new Date().toISOString();
        const summary = createMonitorSummary(
            savedRecords,
            input.trackChanges ? input.monitorName : null,
            input.trackChanges,
            generatedAt,
        );
        await Promise.all([
            Actor.setValue('MONITOR_SUMMARY', summary),
            Actor.setValue('CHANGE_REPORT', createMarkdownReport(savedRecords, summary), { contentType: 'text/markdown; charset=utf-8' }),
            Actor.setValue('CHANGE_REPORT_CSV', createCsvReport(savedRecords), { contentType: 'text/csv; charset=utf-8' }),
        ]);
        const message = statusMessage(status);
        await Actor.setStatusMessage(message);
        if (status.status === 'partial') log.warning(message, status);
        else if (status.status === 'failed') log.error(message, status);
        else log.info(message, status);

        if (status.status === 'failed') {
            throw new HackerNewsRunError(status.failureMessage ?? message, status);
        }
    } catch (error) {
        if (error instanceof HackerNewsRunError) {
            await Actor.setStatusMessage(`Failed: ${error.message.slice(0, 180)}`);
        }
        throw error;
    }
});

function invalidInputStatus(rawInput: unknown, message: string): HackerNewsRunStatus {
    const mode = typeof rawInput === 'object'
        && rawInput !== null
        && !Array.isArray(rawInput)
        && ['feed', 'search', 'items'].includes(String((rawInput as Record<string, unknown>).mode))
        ? (rawInput as Record<string, Mode>).mode
        : 'feed';
    return {
        status: 'failed',
        source: 'hacker_news_firebase_and_algolia',
        mode,
        candidateIdsDiscovered: 0,
        candidateIdsSelected: 0,
        itemRequests: 0,
        itemsFetched: 0,
        itemsMissing: 0,
        itemFailures: 0,
        recordsFiltered: 0,
        recordsMatched: 0,
        recordsSaved: 0,
        commentRequests: 0,
        commentsSaved: 0,
        commentsMissing: 0,
        commentFailures: 0,
        commentsSkippedByPolicy: 0,
        searchPagesFetched: 0,
        invalidSearchHitsSkipped: 0,
        searchPageLimitReached: false,
        spendingLimitReached: false,
        durationMs: 0,
        apiMetrics: emptyMetrics(),
        diagnostics: [{ stage: 'discovery', message: `Invalid input: ${message.slice(0, 260)}` }],
        failureMessage: message.slice(0, 300),
    };
}

function emptyMetrics(): ApiMetrics {
    return { requestAttempts: 0, retries: 0, firebaseAttempts: 0, algoliaAttempts: 0 };
}

function statusMessage(status: HackerNewsRunStatus): string {
    if (status.status === 'stopped_spending_limit') {
        return `Stopped at the spending limit after ${status.recordsSaved} saved item(s).`;
    }
    if (status.status === 'empty') return 'Finished successfully with no matching Hacker News items.';
    if (status.status === 'partial') {
        return `Finished partially with ${status.recordsSaved} item(s) and ${status.itemFailures + status.commentFailures} upstream failure(s).`;
    }
    if (status.status === 'failed') return status.failureMessage ?? 'Hacker News collection failed.';
    return `Finished with ${status.recordsSaved} Hacker News item(s).`;
}
