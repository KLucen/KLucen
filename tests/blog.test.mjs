import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectBlog, parseBlogFeed, MAX_FEED_BYTES, FEED_URL } from '../scripts/blog.mjs';

const STAMP = '2026-10-10T00:00:00.000Z';
const item = (title, date, url = `https://www.klucen.cn/posts/${title}/`) =>
  `<item><title>${title}</title><link>${url}</link>${date ? `<pubDate>${date}</pubDate>` : ''}</item>`;
const feed = (items = '') =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>KLucen &amp; Blog</title><link>https://www.klucen.cn/</link>${items}</channel></rss>`;
const success = (xml) => async () => new Response(xml, { status: 200 });

async function outputFile(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'profile-blog-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'blog.json');
}

test('RSS counts all feed entries, sorts dates, and retains the newest three', () => {
  const data = parseBlogFeed(feed(
    item('old', '2026-09-01') + item('new', '2026-10-07')
    + item('second', '2026-10-05') + item('third', '2026-09-25'),
  ), STAMP);
  assert.equal(data.itemCount, 4);
  assert.deepEqual(data.items.map(({ title }) => title), ['new', 'second', 'third']);
  assert.equal(data.latestDate, '2026-10-07T00:00:00.000Z');
  assert.equal(data.generatedAt, STAMP);
  assert.equal(data.title, 'KLucen & Blog');
  assert.equal(data.complete, true);
  assert.match(data.sourceReason, /feed entries, not all blog articles/);
});

test('empty feeds and missing item dates have explicit values', () => {
  const empty = parseBlogFeed(feed(), STAMP);
  assert.equal(empty.itemCount, 0);
  assert.equal(empty.latestDate, null);
  assert.deepEqual(empty.items, []);
  const undated = parseBlogFeed(feed(item('undated')), STAMP);
  assert.equal(undated.items[0].date, null);
  assert.equal(undated.latestDate, null);
});

test('malformed XML, document entities, and non-RSS documents are rejected', () => {
  assert.throws(() => parseBlogFeed('<rss><channel></rss>'), /XML is invalid/);
  assert.throws(() => parseBlogFeed('<!DOCTYPE rss><rss/>'), /document entities/);
  assert.throws(() => parseBlogFeed('<html><body>Oops</body></html>'), /one channel/);
});

test('invalid or credential-bearing links cannot reach generated data', () => {
  for (const link of ['javascript:alert(1)', 'https://user:password@example.com/', 'invalid']) {
    assert.throws(() => parseBlogFeed(feed(item('entry', '2026-10-07', link))), /URL/);
  }
  assert.throws(() => parseBlogFeed(feed(item('entry', 'invalid date'))), /publication date/);
});

test('the parser rejects input exceeding the feed byte limit', () => {
  assert.throws(() => parseBlogFeed('x'.repeat(MAX_FEED_BYTES + 1)), /size limit/);
});

test('a successful collection writes the contract to JSON', async (t) => {
  const outputPath = await outputFile(t);
  const data = await collectBlog({ fetchImpl: success(feed(item('entry', '2026-10-07'))), outputPath });
  assert.equal(data.itemCount, 1);
  assert.equal(data.feedUrl, FEED_URL);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), data);
});

test('collection failures retain a valid cache without changing its generatedAt', async (t) => {
  const outputPath = await outputFile(t);
  const cached = parseBlogFeed(feed(item('entry', '2026-10-07')), STAMP);
  await writeFile(outputPath, JSON.stringify(cached));
  const data = await collectBlog({ fetchImpl: async () => new Response('', { status: 503 }), outputPath });
  assert.equal(data.generatedAt, STAMP);
  assert.equal(data.cacheUsed, true);
  assert.equal(data.complete, false);
  assert.deepEqual(data.items, cached.items);
  assert.match(data.sourceReason, /HTTP 503/);
  const again = await collectBlog({ fetchImpl: async () => { throw new Error('offline'); }, outputPath });
  assert.equal(again.generatedAt, STAMP);
  assert.equal(again.itemCount, 1);
});

test('invalid caches produce explicit missing statistics', async (t) => {
  const outputPath = await outputFile(t);
  await writeFile(outputPath, JSON.stringify({ schemaVersion: 1, itemCount: 45 }));
  const data = await collectBlog({ fetchImpl: async () => { throw new Error('offline'); }, outputPath });
  assert.equal(data.itemCount, null);
  assert.equal(data.latestDate, null);
  assert.deepEqual(data.items, []);
  assert.equal(data.cacheUsed, false);
  assert.equal(data.complete, false);
  assert.match(data.sourceReason, /No valid cached RSS/);
});

test('oversized responses are rejected before parsing, with and without a length header', async (t) => {
  const outputPath = await outputFile(t);
  const oversized = 'x'.repeat(MAX_FEED_BYTES + 1);
  for (const headers of [{ 'content-length': String(oversized.length) }, {}]) {
    const data = await collectBlog({ fetchImpl: async () => new Response(oversized, { headers }), outputPath });
    assert.equal(data.complete, false);
    assert.equal(data.itemCount, null);
    assert.match(data.sourceReason, /size limit/);
  }
});

test('slow requests are aborted at the timeout and return explicit missing data', async (t) => {
  const outputPath = await outputFile(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = collectBlog({
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    outputPath,
  });
  t.mock.timers.tick(20_000);
  const data = await pending;
  assert.equal(data.itemCount, null);
  assert.equal(data.complete, false);
  assert.match(data.sourceReason, /timed out after 20 seconds/);
});
