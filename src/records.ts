import { convert } from 'html-to-text';
import type { Feed, HnApiItem, HnRecord, NestedComment, NormalizedInput } from './types.js';

const ROOT_TEXT_LIMIT = 100_000;
const COMMENT_TEXT_LIMIT = 40_000;

export function mapItem(
    item: HnApiItem,
    feed: Feed | null,
    query: string | null,
    rank: number | null,
    collectedAt: string,
): HnRecord {
    return {
        id: item.id,
        type: item.type,
        title: toPlainText(item.title, 2_000),
        text: toPlainText(item.text, ROOT_TEXT_LIMIT),
        textHtml: cleanHtml(item.text, ROOT_TEXT_LIMIT),
        url: cleanExternalUrl(item.url),
        hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
        domain: getDomain(item.url),
        author: cleanText(item.by, 256),
        score: item.score ?? 0,
        commentCount: item.descendants ?? item.kids?.length ?? 0,
        parentId: item.parent ?? null,
        pollId: item.poll ?? null,
        pollParts: item.parts ?? [],
        createdAt: toIso(item.time),
        createdAtUnix: item.time ?? null,
        rank,
        feed,
        query,
        dead: item.dead ?? false,
        deleted: item.deleted ?? false,
        comments: [],
        collectedAt,
    };
}

export function mapComment(item: HnApiItem, depth: number): NestedComment {
    return {
        id: item.id,
        author: cleanText(item.by, 256),
        text: toPlainText(item.text, COMMENT_TEXT_LIMIT),
        textHtml: cleanHtml(item.text, COMMENT_TEXT_LIMIT),
        score: item.score ?? 0,
        createdAt: toIso(item.time),
        createdAtUnix: item.time ?? null,
        parentId: item.parent ?? null,
        depth,
        dead: item.dead ?? false,
        deleted: item.deleted ?? false,
        hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
    };
}

export function matchesFilters(record: HnRecord, input: NormalizedInput): boolean {
    if (!input.includeDeadOrDeleted && (record.dead || record.deleted)) return false;
    if (record.score < input.minScore) return false;
    if (record.commentCount < input.minComments) return false;

    const haystack = `${record.title ?? ''} ${record.text ?? ''}`.toLocaleLowerCase('en-US');
    const includes = input.includeKeywords.map((value) => value.toLocaleLowerCase('en-US'));
    const excludes = input.excludeKeywords.map((value) => value.toLocaleLowerCase('en-US'));
    if (includes.length > 0 && !includes.some((keyword) => haystack.includes(keyword))) return false;
    if (excludes.some((keyword) => haystack.includes(keyword))) return false;

    const authors = input.authors.map((value) => value.toLocaleLowerCase('en-US'));
    if (authors.length > 0 && (!record.author || !authors.includes(record.author.toLocaleLowerCase('en-US')))) {
        return false;
    }
    if (input.domain && (!record.domain || !record.domain.toLocaleLowerCase('en-US').includes(input.domain))) {
        return false;
    }

    const createdAt = record.createdAt ? Date.parse(record.createdAt) : null;
    if (input.fromTimestamp !== null && (createdAt === null || createdAt < input.fromTimestamp)) return false;
    if (input.toTimestamp !== null && (createdAt === null || createdAt > input.toTimestamp)) return false;
    return true;
}

export function isValidRecord(record: HnRecord): boolean {
    return Number.isSafeInteger(record.id)
        && record.id > 0
        && ['job', 'story', 'comment', 'poll', 'pollopt'].includes(record.type)
        && isHnUrl(record.hnUrl, record.id)
        && (record.url === null || isHttpUrl(record.url))
        && (record.createdAt === null || isIso(record.createdAt))
        && isIso(record.collectedAt)
        && Number.isSafeInteger(record.score)
        && record.score >= 0
        && Number.isSafeInteger(record.commentCount)
        && record.commentCount >= 0
        && (record.rank === null || (Number.isSafeInteger(record.rank) && record.rank > 0))
        && record.comments.every((comment) => Number.isSafeInteger(comment.id)
            && comment.id > 0
            && isHnUrl(comment.hnUrl, comment.id)
            && Number.isSafeInteger(comment.depth)
            && comment.depth > 0
            && Number.isSafeInteger(comment.score)
            && comment.score >= 0
            && (comment.createdAt === null || isIso(comment.createdAt))
            && (comment.parentId === null || (Number.isSafeInteger(comment.parentId) && comment.parentId > 0)));
}

function toPlainText(html: string | undefined, maximumLength: number): string | null {
    if (!html) return null;
    try {
        return cleanText(convert(html, {
            wordwrap: false,
            selectors: [
                { selector: 'a', options: { ignoreHref: true } },
                { selector: 'img', format: 'skip' },
            ],
        }), maximumLength);
    } catch {
        return cleanText(html.replace(/<[^>]+>/g, ' '), maximumLength);
    }
}

function cleanHtml(value: string | undefined, maximumLength: number): string | null {
    if (!value) return null;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maximumLength) : null;
}

function cleanText(value: string | undefined, maximumLength: number): string | null {
    if (!value) return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized ? normalized.slice(0, maximumLength) : null;
}

function cleanExternalUrl(value: string | undefined): string | null {
    if (!value || value.length > 4_096) return null;
    try {
        const parsed = new URL(value);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
    } catch {
        return null;
    }
}

function getDomain(value: string | undefined): string | null {
    const url = cleanExternalUrl(value);
    if (!url) return null;
    return new URL(url).hostname.replace(/^www\./i, '').toLocaleLowerCase('en-US');
}

function toIso(value: number | undefined): string | null {
    if (value === undefined) return null;
    const date = new Date(value * 1_000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isHnUrl(value: string, id: number): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:'
            && parsed.hostname === 'news.ycombinator.com'
            && parsed.pathname === '/item'
            && parsed.searchParams.get('id') === String(id);
    } catch {
        return false;
    }
}

function isHttpUrl(value: string): boolean {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function isIso(value: string): boolean {
    const timestamp = Date.parse(value);
    return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}
