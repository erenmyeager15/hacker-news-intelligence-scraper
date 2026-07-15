import type { Feed, Mode, NormalizedInput, SearchType } from './types.js';

const MODES = new Set<Mode>(['feed', 'search', 'items']);
const FEEDS = new Set<Feed>(['top', 'new', 'best', 'ask', 'show', 'jobs']);
const SEARCH_TYPES = new Set<SearchType>(['story', 'comment']);
const INPUT_FIELDS = new Set([
    'mode',
    'feed',
    'query',
    'searchType',
    'itemIds',
    'maxResults',
    'minScore',
    'minComments',
    'includeKeywords',
    'excludeKeywords',
    'authors',
    'domain',
    'fromDate',
    'toDate',
    'includeComments',
    'maxCommentsPerItem',
    'commentDepth',
    'includeDeadOrDeleted',
]);

export function normalizeInput(value: unknown): NormalizedInput {
    const input = asObject(value, 'Input');
    rejectUnknownFields(input, INPUT_FIELDS, 'Input');

    const mode = enumValue(input.mode, MODES, 'mode', 'feed');
    const feed = enumValue(input.feed, FEEDS, 'feed', 'top');
    const query = stringValue(input.query, 'query', 'artificial intelligence', 256, true);
    const searchType = enumValue(input.searchType, SEARCH_TYPES, 'searchType', 'story');
    const itemIds = normalizeItemIds(input.itemIds);
    const maxResults = integerValue(input.maxResults, 'maxResults', 1, 1_000, 1);
    const minScore = integerValue(input.minScore, 'minScore', 0, 1_000_000_000, 0);
    const minComments = integerValue(input.minComments, 'minComments', 0, 1_000_000_000, 0);
    const includeKeywords = stringArray(input.includeKeywords, 'includeKeywords', 50, 128);
    const excludeKeywords = stringArray(input.excludeKeywords, 'excludeKeywords', 50, 128);
    const authors = stringArray(input.authors, 'authors', 50, 64);
    const domain = stringValue(input.domain, 'domain', '', 253, true).toLowerCase();
    const fromDate = stringValue(input.fromDate, 'fromDate', '', 35, true);
    const toDate = stringValue(input.toDate, 'toDate', '', 35, true);
    const fromTimestamp = parseDateBound(fromDate, false, 'fromDate');
    const toTimestamp = parseDateBound(toDate, true, 'toDate');
    if (fromTimestamp !== null && toTimestamp !== null && fromTimestamp > toTimestamp) {
        throw new Error('fromDate must be earlier than or equal to toDate.');
    }

    const includeComments = booleanValue(input.includeComments, 'includeComments', false);
    const maxCommentsPerItem = integerValue(input.maxCommentsPerItem, 'maxCommentsPerItem', 1, 500, 20);
    const commentDepth = integerValue(input.commentDepth, 'commentDepth', 1, 10, 3);
    const includeDeadOrDeleted = booleanValue(
        input.includeDeadOrDeleted,
        'includeDeadOrDeleted',
        false,
    );

    if (mode === 'search' && !query) throw new Error('query must not be empty in search mode.');
    if (mode === 'items' && itemIds.length === 0) {
        throw new Error('itemIds must contain at least one positive Hacker News item ID in items mode.');
    }
    if (includeComments && maxResults * maxCommentsPerItem > 5_000) {
        throw new Error('Nested-comment settings may request at most 5,000 comments per run.');
    }

    return {
        mode,
        feed,
        query,
        searchType,
        itemIds,
        maxResults,
        minScore,
        minComments,
        includeKeywords,
        excludeKeywords,
        authors,
        domain,
        fromDate,
        toDate,
        fromTimestamp,
        toTimestamp,
        includeComments,
        maxCommentsPerItem,
        commentDepth,
        includeDeadOrDeleted,
    };
}

function normalizeItemIds(value: unknown): number[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('itemIds must be an array.');
    if (value.length > 1_000) throw new Error('itemIds supports at most 1,000 IDs.');

    const ids = value.map((item, index) => {
        const numeric = typeof item === 'number'
            ? item
            : typeof item === 'string' && /^[1-9][0-9]{0,11}$/.test(item.trim())
                ? Number(item.trim())
                : Number.NaN;
        if (!Number.isSafeInteger(numeric) || numeric <= 0) {
            throw new Error(`itemIds[${index}] must be a positive safe integer.`);
        }
        return numeric;
    });
    return deduplicate(ids, (id) => String(id));
}

function parseDateBound(value: string, endOfDay: boolean, field: string): number | null {
    if (!value) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
    if (!dateOnly && !dateTime) {
        throw new Error(`${field} must be YYYY-MM-DD or an ISO date-time with a timezone.`);
    }
    const timestamp = Date.parse(dateOnly
        ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`
        : value);
    if (Number.isNaN(timestamp)) throw new Error(`${field} is not a valid calendar date.`);
    if (dateOnly && new Date(timestamp).toISOString().slice(0, 10) !== value) {
        throw new Error(`${field} is not a valid calendar date.`);
    }
    return timestamp;
}

function enumValue<T extends string>(
    value: unknown,
    allowed: Set<T>,
    field: string,
    fallback: T,
): T {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !allowed.has(value as T)) {
        throw new Error(`${field} must be one of: ${[...allowed].join(', ')}.`);
    }
    return value as T;
}

function stringValue(
    value: unknown,
    field: string,
    fallback: string,
    maximumLength: number,
    allowEmpty: boolean,
): string {
    if (value === undefined) return fallback;
    if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!allowEmpty && !normalized) throw new Error(`${field} cannot be empty.`);
    if (normalized.length > maximumLength) {
        throw new Error(`${field} must be at most ${maximumLength} characters.`);
    }
    return normalized;
}

function stringArray(value: unknown, field: string, maximumItems: number, maximumLength: number): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings.`);
    if (value.length > maximumItems) throw new Error(`${field} supports at most ${maximumItems} values.`);
    const normalized = value.map((item, index) => {
        if (typeof item !== 'string') throw new Error(`${field}[${index}] must be a string.`);
        const text = item.replace(/\s+/g, ' ').trim();
        if (!text) throw new Error(`${field}[${index}] cannot be empty.`);
        if (text.length > maximumLength) {
            throw new Error(`${field}[${index}] must be at most ${maximumLength} characters.`);
        }
        return text;
    });
    return deduplicate(normalized, (item) => item.toLocaleLowerCase('en-US'));
}

function integerValue(
    value: unknown,
    field: string,
    minimum: number,
    maximum: number,
    fallback: number,
): number {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
        throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
    }
    return value as number;
}

function booleanValue(value: unknown, field: string, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean.`);
    return value;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${field} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: Set<string>, field: string): void {
    const unknown = Object.keys(value).filter((key) => !allowed.has(key));
    if (unknown.length) throw new Error(`${field} contains unsupported field(s): ${unknown.join(', ')}.`);
}

function deduplicate<T>(items: T[], key: (item: T) => string): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const value = key(item);
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}
