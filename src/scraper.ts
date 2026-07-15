import { mapConcurrent } from './api.js';
import { isValidRecord, mapComment, mapItem, matchesFilters } from './records.js';
import type {
    ChargeResult,
    HackerNewsClient,
    HackerNewsRunStatus,
    HnApiItem,
    HnRecord,
    NormalizedInput,
    RunDiagnostic,
} from './types.js';

const ITEM_CONCURRENCY = 20;
const COMMENT_CONCURRENCY = 10;
const DIAGNOSTIC_LIMIT = 20;

export interface HackerNewsRunDependencies {
    client: HackerNewsClient;
    saveRecord: (record: HnRecord) => Promise<ChargeResult>;
    writeStatus: (status: HackerNewsRunStatus) => Promise<void>;
    now?: () => Date;
    nowMs?: () => number;
}

export class HackerNewsRunError extends Error {
    constructor(
        message: string,
        public readonly runStatus: HackerNewsRunStatus,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'HackerNewsRunError';
    }
}

export async function runHackerNews(
    input: NormalizedInput,
    dependencies: HackerNewsRunDependencies,
): Promise<HackerNewsRunStatus> {
    const now = dependencies.now ?? (() => new Date());
    const nowMs = dependencies.nowMs ?? Date.now;
    const startedAt = nowMs();
    const status = createStatus(input);

    const finish = async (outcome: HackerNewsRunStatus['status']): Promise<HackerNewsRunStatus> => {
        status.status = outcome;
        status.durationMs = Math.max(0, nowMs() - startedAt);
        status.apiMetrics = dependencies.client.getMetrics();
        await dependencies.writeStatus(status);
        return status;
    };

    let discoveredIds: number[];
    try {
        if (input.mode === 'feed') {
            discoveredIds = await dependencies.client.fetchFeedIds(input.feed);
        } else if (input.mode === 'search') {
            const search = await dependencies.client.searchItemIds(
                input.query,
                input.searchType,
                Math.min(input.maxResults * 5, 1_000),
            );
            discoveredIds = search.ids;
            status.searchPagesFetched = search.pagesFetched;
            status.invalidSearchHitsSkipped = search.invalidHitsSkipped;
            status.searchPageLimitReached = search.pageLimitReached;
        } else {
            discoveredIds = input.itemIds;
        }
    } catch (error) {
        const message = `Candidate discovery failed: ${safeMessage(error)}`;
        addDiagnostic(status, { stage: 'discovery', message });
        status.failureMessage = message;
        await finish('failed');
        throw new HackerNewsRunError(message, status, { cause: error });
    }

    const uniqueIds = [...new Set(discoveredIds)];
    status.candidateIdsDiscovered = uniqueIds.length;
    const scanLimit = input.mode === 'items'
        ? uniqueIds.length
        : Math.min(uniqueIds.length, Math.max(input.maxResults * 5, input.maxResults));
    const selectedIds = uniqueIds.slice(0, scanLimit);
    status.candidateIdsSelected = selectedIds.length;
    const rankById = new Map(selectedIds.map((id, index) => [id, index + 1]));

    for (let offset = 0; offset < selectedIds.length && status.recordsSaved < input.maxResults; offset += ITEM_CONCURRENCY) {
        if (status.spendingLimitReached) break;
        const batch = selectedIds.slice(offset, offset + ITEM_CONCURRENCY);
        const fetched = await mapConcurrent(batch, ITEM_CONCURRENCY, async (id) => {
            status.itemRequests += 1;
            try {
                return { id, item: await dependencies.client.fetchItem(id), error: null };
            } catch (error) {
                return { id, item: null, error };
            }
        });

        for (const result of fetched) {
            if (status.recordsSaved >= input.maxResults || status.spendingLimitReached) break;
            if (result.error) {
                status.itemFailures += 1;
                addDiagnostic(status, {
                    stage: 'item',
                    itemId: result.id,
                    message: `Item request failed: ${safeMessage(result.error)}`,
                });
                continue;
            }
            if (!result.item) {
                status.itemsMissing += 1;
                continue;
            }

            status.itemsFetched += 1;
            const record = mapItem(
                result.item,
                input.mode === 'feed' ? input.feed : null,
                input.mode === 'search' ? input.query : null,
                input.mode === 'items' ? null : rankById.get(result.id) ?? null,
                now().toISOString(),
            );
            if (!isValidRecord(record)) {
                status.itemFailures += 1;
                addDiagnostic(status, {
                    stage: 'item',
                    itemId: result.id,
                    message: 'Mapped item failed output validation.',
                });
                continue;
            }
            if (!matchesFilters(record, input)) {
                status.recordsFiltered += 1;
                continue;
            }

            status.recordsMatched += 1;
            if (input.includeComments && result.item.kids?.length) {
                await addComments(record, result.item, input, dependencies.client, status);
            }

            try {
                const charge = await dependencies.saveRecord(record);
                const saved = charge.chargedCount > 0 || !charge.eventChargeLimitReached;
                if (saved) status.recordsSaved += 1;
                if (charge.eventChargeLimitReached) status.spendingLimitReached = true;
            } catch (error) {
                const message = `Dataset write failed for item ${record.id}: ${safeMessage(error)}`;
                addDiagnostic(status, { stage: 'storage', itemId: record.id, message });
                status.failureMessage = message;
                await finish('failed');
                throw new HackerNewsRunError(message, status, { cause: error });
            }
        }
    }

    if (status.spendingLimitReached) return finish('stopped_spending_limit');
    if (status.recordsSaved === 0) {
        if (status.itemFailures > 0) {
            status.failureMessage = 'No records were saved because all usable item requests failed.';
            return finish('failed');
        }
        return finish('empty');
    }
    const partial = status.itemFailures > 0
        || status.commentFailures > 0
        || status.invalidSearchHitsSkipped > 0
        || status.searchPageLimitReached;
    return finish(partial ? 'partial' : 'succeeded');
}

async function addComments(
    record: HnRecord,
    root: HnApiItem,
    input: NormalizedInput,
    client: HackerNewsClient,
    status: HackerNewsRunStatus,
): Promise<void> {
    const queue = (root.kids ?? []).map((id) => ({ id, depth: 1 }));
    const seen = new Set<number>();
    const requestLimit = Math.min(input.maxCommentsPerItem * 5, 2_000);

    while (queue.length > 0
        && record.comments.length < input.maxCommentsPerItem
        && seen.size < requestLimit) {
        const pending: Array<{ id: number; depth: number }> = [];
        while (queue.length > 0 && pending.length < COMMENT_CONCURRENCY && seen.size < requestLimit) {
            const entry = queue.shift();
            if (!entry || seen.has(entry.id)) continue;
            seen.add(entry.id);
            pending.push(entry);
        }
        if (pending.length === 0) continue;

        const fetched = await mapConcurrent(pending, COMMENT_CONCURRENCY, async (entry) => {
            status.commentRequests += 1;
            try {
                return { ...entry, item: await client.fetchItem(entry.id), error: null };
            } catch (error) {
                return { ...entry, item: null, error };
            }
        });

        for (const result of fetched) {
            if (result.error) {
                status.commentFailures += 1;
                addDiagnostic(status, {
                    stage: 'comment',
                    itemId: result.id,
                    message: `Comment request failed: ${safeMessage(result.error)}`,
                });
                continue;
            }
            if (!result.item) {
                status.commentsMissing += 1;
                continue;
            }
            if (result.depth < input.commentDepth) {
                queue.push(...(result.item.kids ?? []).map((id) => ({ id, depth: result.depth + 1 })));
            }
            if (result.item.type !== 'comment') {
                status.commentFailures += 1;
                addDiagnostic(status, {
                    stage: 'comment',
                    itemId: result.id,
                    message: `Expected a comment but received type ${result.item.type}.`,
                });
                continue;
            }
            if (!input.includeDeadOrDeleted && (result.item.dead || result.item.deleted)) {
                status.commentsSkippedByPolicy += 1;
                continue;
            }
            if (record.comments.length < input.maxCommentsPerItem) {
                record.comments.push(mapComment(result.item, result.depth));
                status.commentsSaved += 1;
            }
        }
    }
}

function createStatus(input: NormalizedInput): HackerNewsRunStatus {
    return {
        status: 'failed',
        source: 'hacker_news_firebase_and_algolia',
        mode: input.mode,
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
        apiMetrics: {
            requestAttempts: 0,
            retries: 0,
            firebaseAttempts: 0,
            algoliaAttempts: 0,
        },
        diagnostics: [],
    };
}

function addDiagnostic(status: HackerNewsRunStatus, diagnostic: RunDiagnostic): void {
    if (status.diagnostics.length >= DIAGNOSTIC_LIMIT) return;
    status.diagnostics.push({ ...diagnostic, message: safeMessage(diagnostic.message) });
}

function safeMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
        .replace(/https?:\/\/\S+/gi, '[URL omitted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
}
