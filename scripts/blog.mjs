import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const BLOG_URL = 'https://www.klucen.cn/';
export const FEED_URL = 'https://www.klucen.cn/rss.xml';
export const MAX_FEED_BYTES = 8 * 1024 * 1024;
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT = path.join(ROOT, 'data', 'blog.json');
const TIMEOUT_MS = 20_000;

function publicUrl(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing`);
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} must be an HTTP(S) URL without credentials`);
  }
  return url.href;
}

function feedText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing`);
  }
  return value.trim();
}

function feedDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('An RSS item has an invalid publication date');
  }
  return new Date(value).toISOString();
}

// Kept pure so XML validation, ordering, and data definitions can be tested offline.
export function parseBlogFeed(xml, generatedAt = new Date().toISOString()) {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('RSS response is empty');
  if (Buffer.byteLength(xml, 'utf8') > MAX_FEED_BYTES) {
    throw new Error('RSS response exceeds the 8 MiB size limit');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error('RSS response contains unsupported document entities');
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`RSS XML is invalid (${validation.err.code}, line ${validation.err.line})`);
  }
  const parsed = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  }).parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel || Array.isArray(channel) || typeof channel !== 'object') {
    throw new Error('RSS response must contain one channel');
  }
  const rawItems = channel.item === undefined
    ? []
    : Array.isArray(channel.item) ? channel.item : [channel.item];
  const items = rawItems.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('RSS item is invalid');
    return {
      title: feedText(item.title, 'RSS item title'),
      url: publicUrl(item.link, 'RSS item link'),
      date: feedDate(item.pubDate ?? item['dc:date']),
    };
  }).sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0));
  return {
    schemaVersion: 1,
    generatedAt,
    title: feedText(channel.title, 'RSS channel title'),
    url: publicUrl(channel.link, 'RSS channel link'),
    feedUrl: FEED_URL,
    itemCount: rawItems.length,
    latestDate: items[0]?.date ?? null,
    items: items.slice(0, 3),
    complete: true,
    sourceReason: 'Public RSS feed; itemCount counts feed entries, not all blog articles.',
  };
}

async function fetchXml(fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(FEED_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    });
    if (!response.ok) throw new Error(`RSS request failed with HTTP ${response.status}`);
    publicUrl(response.url || FEED_URL, 'RSS response URL');
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_FEED_BYTES) throw new Error('RSS response exceeds the 8 MiB size limit');
    if (!response.body) throw new Error('RSS response has no body');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_FEED_BYTES) throw new Error('RSS response exceeds the 8 MiB size limit');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (controller.signal.aborted) throw new Error('RSS request timed out after 20 seconds');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validCache(value) {
  try {
    if (value?.schemaVersion !== 1 || value.feedUrl !== FEED_URL
      || !Number.isFinite(Date.parse(value.generatedAt))
      || !Number.isInteger(value.itemCount) || value.itemCount < 0
      || !Array.isArray(value.items) || value.items.length !== Math.min(value.itemCount, 3)) return false;
    feedText(value.title, 'Cached title');
    publicUrl(value.url, 'Cached blog URL');
    feedDate(value.latestDate);
    for (const item of value.items) {
      feedText(item.title, 'Cached item title');
      publicUrl(item.url, 'Cached item URL');
      feedDate(item.date);
    }
    return value.latestDate === (value.items[0]?.date ?? null);
  } catch {
    return false;
  }
}

export async function collectBlog({ fetchImpl = fetch, outputPath = OUTPUT } = {}) {
  let data;
  try {
    data = parseBlogFeed(await fetchXml(fetchImpl));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'RSS collection failed';
    let cached;
    try {
      cached = JSON.parse(await readFile(outputPath, 'utf8'));
    } catch {
      cached = null;
    }
    if (validCache(cached)) {
      data = {
        schemaVersion: 1, generatedAt: cached.generatedAt, title: cached.title,
        url: cached.url, feedUrl: FEED_URL, itemCount: cached.itemCount,
        latestDate: cached.latestDate, items: cached.items, complete: false,
        cacheUsed: true,
        sourceReason: `${reason}. Retained the last valid RSS snapshot and its original generatedAt.`,
      };
    } else {
      data = {
        schemaVersion: 1, generatedAt: new Date().toISOString(), title: null,
        url: BLOG_URL, feedUrl: FEED_URL, itemCount: null, latestDate: null,
        items: [], complete: false, cacheUsed: false,
        sourceReason: `${reason}. No valid cached RSS snapshot is available.`,
      };
    }
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = await collectBlog();
  console.log(JSON.stringify({
    complete: data.complete, cacheUsed: data.cacheUsed ?? false,
    itemCount: data.itemCount, generatedAt: data.generatedAt,
    sourceReason: data.sourceReason,
  }));
}
