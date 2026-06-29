import { Actor, log } from 'apify';
import { convert } from 'html-to-text';
import { fetchFeedIds, fetchItem, mapConcurrent, searchItemIds } from './api.js';
import type { Feed, HnApiItem, HnRecord, Input, NestedComment } from './types.js';

const DEFAULT_INPUT: Input = {
    mode: 'feed',
    feed: 'top',
    query: 'artificial intelligence',
    searchType: 'story',
    maxResults: 10,
    minScore: 0,
    minComments: 0,
    includeKeywords: [],
    excludeKeywords: [],
    authors: [],
    domain: '',
    fromDate: '',
    toDate: '',
    includeComments: false,
    maxCommentsPerItem: 20,
    commentDepth: 3,
    includeDeadOrDeleted: false,
};

function parseDate(value: string | undefined, endOfDay = false): number | null {
    if (!value?.trim()) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
    const timestamp = Date.parse(dateOnly && endOfDay ? `${value.trim()}T23:59:59.999Z` : value.trim());
    if (Number.isNaN(timestamp)) throw new Error(`Invalid date: ${value}`);
    return timestamp;
}

function getDomain(url: string | undefined): string | null {
    if (!url) return null;
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

function toPlainText(html: string | undefined): string | null {
    if (!html) return null;
    return convert(html, {
        wordwrap: false,
        selectors: [
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'img', format: 'skip' },
        ],
    }).trim() || null;
}

function normalizeItem(item: HnApiItem, feed: Feed | null, query: string | null, rank: number | null): HnRecord {
    return {
        id: item.id,
        type: item.type ?? 'unknown',
        title: item.title ? toPlainText(item.title) : null,
        text: toPlainText(item.text),
        textHtml: item.text ?? null,
        url: item.url ?? null,
        hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
        domain: getDomain(item.url),
        author: item.by ?? null,
        score: item.score ?? 0,
        commentCount: item.descendants ?? item.kids?.length ?? 0,
        parentId: item.parent ?? null,
        pollId: item.poll ?? null,
        pollParts: item.parts ?? [],
        createdAt: item.time ? new Date(item.time * 1000).toISOString() : null,
        createdAtUnix: item.time ?? null,
        rank,
        feed,
        query,
        dead: item.dead ?? false,
        deleted: item.deleted ?? false,
        comments: [],
        collectedAt: new Date().toISOString(),
    };
}

function matchesFilters(record: HnRecord, input: Input, fromTimestamp: number | null, toTimestamp: number | null): boolean {
    if (!input.includeDeadOrDeleted && (record.dead || record.deleted)) return false;
    if (record.score < (input.minScore ?? 0)) return false;
    if (record.commentCount < (input.minComments ?? 0)) return false;

    const haystack = `${record.title ?? ''} ${record.text ?? ''}`.toLowerCase();
    const includes = (input.includeKeywords ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
    const excludes = (input.excludeKeywords ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (includes.length > 0 && !includes.some((keyword) => haystack.includes(keyword))) return false;
    if (excludes.some((keyword) => haystack.includes(keyword))) return false;

    const authors = (input.authors ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (authors.length > 0 && (!record.author || !authors.includes(record.author.toLowerCase()))) return false;

    const domain = input.domain?.trim().toLowerCase();
    if (domain && (!record.domain || !record.domain.toLowerCase().includes(domain))) return false;

    const createdAt = record.createdAt ? Date.parse(record.createdAt) : null;
    if (fromTimestamp !== null && (createdAt === null || createdAt < fromTimestamp)) return false;
    if (toTimestamp !== null && (createdAt === null || createdAt > toTimestamp)) return false;
    return true;
}

async function fetchComments(root: HnApiItem, maxComments: number, maxDepth: number): Promise<NestedComment[]> {
    const comments: NestedComment[] = [];
    let queue = (root.kids ?? []).map((id) => ({ id, depth: 1 }));

    while (queue.length > 0 && comments.length < maxComments) {
        const batch = queue.splice(0, Math.min(20, maxComments - comments.length));
        const fetched = await mapConcurrent(batch, 10, async ({ id, depth }) => ({ item: await fetchItem(id), depth }));

        for (const { item, depth } of fetched) {
            if (!item) continue;
            comments.push({
                id: item.id,
                author: item.by ?? null,
                text: toPlainText(item.text),
                textHtml: item.text ?? null,
                score: item.score ?? 0,
                createdAt: item.time ? new Date(item.time * 1000).toISOString() : null,
                createdAtUnix: item.time ?? null,
                parentId: item.parent ?? null,
                depth,
                dead: item.dead ?? false,
                deleted: item.deleted ?? false,
                hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
            });

            if (depth < maxDepth) queue.push(...(item.kids ?? []).map((id) => ({ id, depth: depth + 1 })));
            if (comments.length >= maxComments) break;
        }
    }

    return comments;
}

async function getCandidateIds(input: Input): Promise<number[]> {
    if (input.mode === 'feed') return fetchFeedIds(input.feed);
    if (input.mode === 'search') {
        if (!input.query.trim()) throw new Error('query must not be empty in search mode');
        return searchItemIds(input.query, input.searchType, Math.min(input.maxResults * 5, 1000));
    }

    const ids = (input.itemIds ?? []).map(Number).filter(Number.isSafeInteger);
    if (ids.length === 0) throw new Error('itemIds must contain at least one numeric ID in items mode');
    return ids;
}

await Actor.main(async () => {
    const suppliedInput = await Actor.getInput<Partial<Input>>() ?? {};
    const input: Input = { ...DEFAULT_INPUT, ...suppliedInput };
    const fromTimestamp = parseDate(input.fromDate);
    const toTimestamp = parseDate(input.toDate, true);
    if (fromTimestamp !== null && toTimestamp !== null && fromTimestamp > toTimestamp) {
        throw new Error('fromDate must be earlier than or equal to toDate');
    }

    const candidateIds = [...new Set(await getCandidateIds(input))];
    const scanLimit = input.mode === 'items' ? candidateIds.length : Math.min(candidateIds.length, Math.max(input.maxResults * 5, input.maxResults));
    const selectedIds = candidateIds.slice(0, scanLimit);
    log.info(`Fetching ${selectedIds.length} candidate items`, { mode: input.mode, maxResults: input.maxResults });

    let pushed = 0;
    let spendingLimitReached = false;
    const candidateBatchSize = 20;

    for (let offset = 0; offset < selectedIds.length && pushed < input.maxResults; offset += candidateBatchSize) {
        if (spendingLimitReached) break;

        const batchIds = selectedIds.slice(offset, offset + candidateBatchSize);
        const items = await mapConcurrent(batchIds, candidateBatchSize, fetchItem);

        for (let batchIndex = 0; batchIndex < items.length && pushed < input.maxResults; batchIndex += 1) {
            const item = items[batchIndex];
            if (!item) continue;

            const record = normalizeItem(
                item,
                input.mode === 'feed' ? input.feed : null,
                input.mode === 'search' ? input.query : null,
                input.mode === 'feed' ? offset + batchIndex + 1 : null,
            );
            if (!matchesFilters(record, input, fromTimestamp, toTimestamp)) continue;

            if (input.includeComments && item.kids?.length) {
                record.comments = await fetchComments(item, input.maxCommentsPerItem ?? 50, input.commentDepth ?? 3);
            }

            const chargeResult = await Actor.pushData(record, 'item-scraped');
            const recordWasSaved = chargeResult.chargedCount > 0 || !chargeResult.eventChargeLimitReached;
            if (recordWasSaved) pushed += 1;

            if (chargeResult.eventChargeLimitReached) {
                spendingLimitReached = true;
                const message = `Stopped at the user's spending limit after ${pushed} Hacker News item(s).`;
                await Actor.setStatusMessage(message);
                log.warning(message);
                break;
            }
        }
    }

    if (!spendingLimitReached) {
        await Actor.setStatusMessage(`Finished with ${pushed} Hacker News item(s).`);
        log.info('Hacker News collection finished', { candidates: selectedIds.length, pushed });
    }
});
