import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const source = fileURLToPath(new URL('../scripts/collect.mjs', import.meta.url));
const INVENTORY = '/users/KLucen/repos?type=owner&sort=full_name&per_page=100';
const PAGE_TWO = INVENTORY + '&page=2';
const AS_OF = '2026-10-10T12:00:00.000Z';
const repository = (name, changes = {}) => ({
  name, private: false, fork: false, owner: { login: 'KLucen' },
  html_url: 'https://github.com/KLucen/' + name, archived: false,
  stargazers_count: 2, default_branch: 'main', created_at: '2026-01-01T00:00:00Z',
  ...changes,
});

async function runCollector(t, scenario, cached = []) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'profile-collect-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  await mkdir(path.join(scratch, 'scripts'));
  await writeFile(path.join(scratch, 'scripts', 'collect.mjs'), await readFile(source));
  const cacheDirectory = path.join(scratch, '.cache', 'github-profile');
  await mkdir(cacheDirectory, { recursive: true });
  for (const [endpoint, data, link = null] of cached) {
    const key = createHash('sha256').update('https://api.github.com' + endpoint).digest('hex');
    await writeFile(path.join(cacheDirectory, key + '.json'), JSON.stringify({
      data, link, etag: '"test-etag"', fetchedAt: '2026-01-01T00:00:00.000Z',
    }));
  }
  const runner = `
    import { writeFile } from 'node:fs/promises';
    const scenario = ${JSON.stringify(scenario)};
    const inventory = ${JSON.stringify(INVENTORY)};
    const pageTwo = ${JSON.stringify(PAGE_TWO)};
    const requests = [];
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      const endpoint = parsed.pathname + parsed.search;
      requests.push(endpoint);
      if (endpoint === '/graphql') return Response.json({ errors: [{ message: 'Mock GraphQL unavailable' }] });
      if (endpoint === '/users/KLucen') return Response.json({ followers: 0, public_repos: 5 });
      if (endpoint === inventory) {
        if (scenario.inventoryStatus === 304) return new Response(null, { status: 304 });
        if (scenario.inventoryStatus) return Response.json({ message: 'Mock inventory unavailable' }, { status: scenario.inventoryStatus });
        return Response.json(scenario.repositories, { headers: scenario.paginate ? { link: '<https://api.github.com' + pageTwo + '>; rel="next"' } : {} });
      }
      if (endpoint === pageTwo) return Response.json({ message: 'Mock second page unavailable' }, { status: 503 });
      if (parsed.pathname.endsWith('/languages')) return Response.json({ TypeScript: 123 });
      if (parsed.pathname.endsWith('/commits')) return Response.json(scenario.commits || []);
      throw new Error('Unexpected mock endpoint: ' + endpoint);
    };
    await import('./scripts/collect.mjs');
    await writeFile('requests.json', JSON.stringify(requests));
  `;
  await exec(process.execPath, ['--input-type=module', '-e', runner], {
    cwd: scratch, timeout: 15_000, windowsHide: true,
    env: {
      ...process.env, GITHUB_TOKEN: 'test-token-not-a-credential', GH_TOKEN: '',
      PROFILE_DISABLE_GIT_CREDENTIAL: '1', PROFILE_LOGIN: 'KLucen',
      PROFILE_AS_OF: AS_OF, PROFILE_STATS_PATH: 'data/stats.json',
      PROFILE_REQUIRE_COMPLETE: '0', PROFILE_REQUIRE_GRAPHQL: '0',
    },
  });
  return {
    stats: JSON.parse(await readFile(path.join(scratch, 'data', 'stats.json'), 'utf8')),
    requests: JSON.parse(await readFile(path.join(scratch, 'requests.json'), 'utf8')),
  };
}

function assertMissingInventory({ stats, requests }) {
  assert.equal(stats.profile.publicRepos, null);
  assert.equal(stats.profile.stars, null);
  assert.deepEqual(stats.repositories, []);
  assert.equal(stats.commits.count, null);
  assert.equal(stats.contributions.total, null);
  assert.deepEqual(stats.contributions.calendar, []);
  assert.equal(stats.languages.complete, false);
  assert.equal(stats.languages.totals, null);
  assert.equal(stats.collection.complete, false);
  assert.equal(stats.collection.publicOnly, true);
  assert.equal(requests.some((endpoint) => endpoint.startsWith('/repos/')), false);
}

test('fresh REST inventory excludes private, fork, and externally owned repositories', async (t) => {
  const result = await runCollector(t, { repositories: [
    repository('public'), repository('archived', { archived: true, default_branch: null }),
    repository('private', { private: true }), repository('fork', { fork: true }),
    repository('external', { owner: { login: 'Elsewhere' } }),
  ] });
  assert.deepEqual(result.stats.repositories.map(({ name }) => name), ['public', 'archived']);
  assert.equal(result.stats.profile.publicRepos, 2);
  assert.equal(result.stats.profile.stars, 4);
  assert.deepEqual(result.stats.languages.totals, { TypeScript: 246 });
  assert.equal(result.stats.commits.count, 0);
  assert.equal(result.stats.collection.complete, true);
  assert.equal(result.requests.some((endpoint) => /\/(private|fork|external)\//.test(endpoint)), false);
});

test('stale inventory cannot authorize reading formerly public repository data', async (t) => {
  const result = await runCollector(t, { inventoryStatus: 503 }, [
    [INVENTORY, [repository('formerly-public')]],
  ]);
  assertMissingInventory(result);
  assert.equal(result.stats.collection.errors.some(({ scope }) => scope === 'repositories'), true);
});

test('a stale later inventory page invalidates the whole inventory before repository requests', async (t) => {
  const result = await runCollector(t, { repositories: [repository('first-page')], paginate: true }, [
    [PAGE_TWO, [repository('formerly-public')]],
  ]);
  assertMissingInventory(result);
  assert.equal(result.requests.includes(PAGE_TWO), true);
});

test('HTTP 403 and 404 inventories produce explicit missing values', async (t) => {
  for (const inventoryStatus of [403, 404]) {
    await t.test('HTTP ' + inventoryStatus, async (child) => {
      const result = await runCollector(child, { inventoryStatus });
      assertMissingInventory(result);
      assert.equal(result.stats.collection.errors.some(({ code }) => code === 'HTTP_' + inventoryStatus), true);
    });
  }
});

test('HTTP 304 revalidates inventory cache and permits public data collection', async (t) => {
  const result = await runCollector(t, { inventoryStatus: 304 }, [
    [INVENTORY, [repository('public')]],
  ]);
  assert.equal(result.stats.profile.publicRepos, 1);
  assert.equal(result.stats.collection.complete, true);
  assert.deepEqual(result.stats.collection.cacheUsed, [
    { endpoint: INVENTORY, fetchedAt: '2026-01-01T00:00:00.000Z', stale: false },
  ]);
  assert.equal(result.requests.some((endpoint) => endpoint.endsWith('/languages')), true);
});

test('REST timestamps normalize to UTC and use committer dates across 365 UTC dates', async (t) => {
  const result = await runCollector(t, {
    repositories: [repository('public')],
    commits: [
      { sha: 'valid', commit: { author: { date: '2020-01-01T00:00:00Z' }, committer: { date: '2026-10-10T01:00:00+08:00' } } },
      { sha: 'valid', commit: { committer: { date: '2026-10-10T01:00:00+08:00' } } },
      { sha: 'before-start', commit: { committer: { date: '2025-10-11T01:00:00+08:00' } } },
      { sha: 'after-end', commit: { committer: { date: '2026-10-10T13:00:00Z' } } },
    ],
  });
  const { stats } = result;
  assert.equal(stats.commits.from, '2025-10-11T00:00:00.000Z');
  assert.equal(stats.commits.to, AS_OF);
  assert.equal(stats.commits.count, 1);
  assert.equal(stats.contributions.calendar.length, 365);
  assert.equal(stats.contributions.calendar.find(({ date }) => date === '2026-10-09').count, 1);
  assert.equal(stats.contributions.calendar.find(({ date }) => date === '2026-10-10').count, 0);
  assert.equal(stats.contributions.calendar.reduce((sum, { count }) => sum + count, 0), 1);
});
