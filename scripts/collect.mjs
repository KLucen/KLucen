import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const login = process.env.PROFILE_LOGIN || 'KLucen';
if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(login)) throw new Error('Invalid PROFILE_LOGIN.');
const output = path.resolve(root, process.env.PROFILE_STATS_PATH || 'data/stats.json');
const cacheDirectory = path.join(root, '.cache', 'github-profile');
const now = process.env.PROFILE_AS_OF ? new Date(process.env.PROFILE_AS_OF) : new Date();
if (!Number.isFinite(now.getTime())) throw new Error('Invalid PROFILE_AS_OF.');
const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
start.setUTCDate(start.getUTCDate() - 364);
const from = start.toISOString();
const to = now.toISOString();
const errors = [];
const cacheUsed = [];
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'KLucen-public-profile-stats', 'X-GitHub-Api-Version': '2022-11-28' };
let authentication = 'anonymous';
let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
if (token) authentication = 'environment';
if (!token && process.env.PROFILE_DISABLE_GIT_CREDENTIAL !== '1') {
  try {
    const credential = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 8000, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    token = credential.split(/\r?\n/).find((line) => line.startsWith('password='))?.slice(9) || '';
    if (token) authentication = 'git-credential';
  } catch { /* Credential absence is expected; public REST remains available. */ }
}
if (token) headers.Authorization = `Bearer ${token}`;

class CollectionError extends Error {
  constructor(message, code = 'REQUEST_FAILED') { super(message); this.code = code; }
}
function record(scope, error) {
  let message = String(error.message || error);
  if (token) message = message.replaceAll(token, '[redacted]');
  errors.push({ scope, code: error.code || 'REQUEST_FAILED', message });
}
async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}
async function saveJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}
async function request(url, options = {}) {
  const method = options.method || 'GET';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(25000) });
      if ((response.status >= 500 || response.status === 429) && attempt === 0) continue;
      return response;
    } catch (error) {
      if (attempt === 1) throw new CollectionError(`${method} ${new URL(url).pathname}: ${error.message}`, 'NETWORK_ERROR');
    }
  }
}
async function rest(endpoint, { allowStale = true } = {}) {
  const url = `https://api.github.com${endpoint}`;
  const cacheFile = path.join(cacheDirectory, `${createHash('sha256').update(url).digest('hex')}.json`);
  const cached = await readJson(cacheFile);
  try {
    const response = await request(url, { headers: cached?.etag ? { 'If-None-Match': cached.etag } : {} });
    if (response.status === 304 && cached) {
      cacheUsed.push({ endpoint, fetchedAt: cached.fetchedAt, stale: false });
      return cached;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new CollectionError(`${endpoint}: HTTP ${response.status}: ${body.message || response.statusText}`, `HTTP_${response.status}`);
    }
    const item = { data: await response.json(), link: response.headers.get('link'), etag: response.headers.get('etag'), fetchedAt: new Date().toISOString() };
    await saveJson(cacheFile, item);
    return item;
  } catch (error) {
    if (cached && allowStale) {
      record(endpoint, error);
      cacheUsed.push({ endpoint, fetchedAt: cached.fetchedAt, stale: true });
      return cached;
    }
    throw error;
  }
}
async function restPages(endpoint, options) {
  const items = [];
  let next = endpoint;
  while (next) {
    const result = await rest(next, options);
    if (!Array.isArray(result.data)) throw new CollectionError(`${next}: expected an array.`, 'INVALID_RESPONSE');
    items.push(...result.data);
    const match = result.link?.match(/<https:\/\/api\.github\.com([^>]+)>; rel="next"/);
    next = match?.[1] || null;
  }
  return items;
}
async function graphql(query, variables) {
  const response = await request('https://api.github.com/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length) {
    throw new CollectionError(`GraphQL: ${body.errors?.map((item) => item.message).join('; ') || body.message || `HTTP ${response.status}`}`, 'GRAPHQL_ERROR');
  }
  if (!body.data?.user) throw new CollectionError('GitHub user was not found.', 'USER_NOT_FOUND');
  return body.data.user;
}
const repositoryFields = 'name nameWithOwner url isArchived stargazerCount createdAt defaultBranchRef { name } languages(first: 100) { edges { size node { name } } totalSize pageInfo { hasNextPage endCursor } }';
const publicRepositoryFields = 'nameWithOwner isPrivate isFork';
const pageFields = 'pageInfo { hasNextPage endCursor } totalCount';
const contributionFields = {
  issueContributions: `occurredAt issue { repository { ${publicRepositoryFields} } }`,
  pullRequestContributions: `occurredAt pullRequest { repository { ${publicRepositoryFields} } }`,
  pullRequestReviewContributions: `occurredAt pullRequest { repository { ${publicRepositoryFields} } }`,
  repositoryContributions: `occurredAt repository { ${publicRepositoryFields} }`,
};
function blankCalendar() {
  return Array.from({ length: 365 }, (_, index) => ({ date: new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10), count: 0, level: 0 }));
}
function finishCalendar(calendar) {
  const maximum = Math.max(0, ...calendar.map((day) => day.count));
  return calendar.map((day) => ({ ...day, level: day.count === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((day.count / maximum) * 4))) }));
}
function addDay(calendar, occurredAt, count = 1) {
  const day = calendar.find((item) => item.date === occurredAt.slice(0, 10));
  if (day) day.count += count;
}
const owned = (repository) => repository && !repository.isPrivate && !repository.isFork && repository.nameWithOwner.split('/')[0].toLowerCase() === login.toLowerCase();

async function collectGraphql() {
  const query = `query($login: String!, $from: DateTime!, $to: DateTime!, $cursor: String) {
    user(login: $login) {
      login followers { totalCount }
      allPublic: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
      repositories(first: 100, after: $cursor, privacy: PUBLIC, ownerAffiliations: OWNER, isFork: false, orderBy: {field: NAME, direction: ASC}) { nodes { ${repositoryFields} } ${pageFields} }
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        commitContributionsByRepository(maxRepositories: 100) { repository { ${publicRepositoryFields} } contributions(first: 100) { nodes { occurredAt commitCount } ${pageFields} } }
        ${Object.entries(contributionFields).map(([field, fields]) => `${field}(first: 100) { nodes { ${fields} } ${pageFields} }`).join('\n')}
      }
    }
  }`;
  const first = await graphql(query, { login, from, to, cursor: null });
  const rawRepositories = [...first.repositories.nodes];
  let connection = first.repositories;
  while (connection.pageInfo.hasNextPage) {
    const page = await graphql(`query($login: String!, $cursor: String) { user(login: $login) { repositories(first: 100, after: $cursor, privacy: PUBLIC, ownerAffiliations: OWNER, isFork: false, orderBy: {field: NAME, direction: ASC}) { nodes { ${repositoryFields} } ${pageFields} } } }`, { login, cursor: connection.pageInfo.endCursor });
    connection = page.repositories;
    rawRepositories.push(...connection.nodes);
  }
  const repositories = [];
  for (const repo of rawRepositories) {
    const languages = Object.fromEntries(repo.languages.edges.map((edge) => [edge.node.name, edge.size]));
    let languagePage = repo.languages;
    while (languagePage.pageInfo.hasNextPage) {
      const response = await request('https://api.github.com/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query($owner: String!, $name: String!, $cursor: String) { repository(owner: $owner, name: $name) { languages(first: 100, after: $cursor) { edges { size node { name } } totalSize pageInfo { hasNextPage endCursor } } } }', variables: { owner: login, name: repo.name, cursor: languagePage.pageInfo.endCursor } }) });
      const body = await response.json();
      if (!response.ok || body.errors?.length || !body.data?.repository?.languages) throw new CollectionError(`Language pagination failed for ${repo.name}.`, 'GRAPHQL_LANGUAGE_ERROR');
      languagePage = body.data.repository.languages;
      for (const edge of languagePage.edges) languages[edge.node.name] = edge.size;
    }
    repositories.push({ name: repo.name, url: repo.url, fork: false, archived: repo.isArchived, stars: repo.stargazerCount, defaultBranch: repo.defaultBranchRef?.name || null, createdAt: repo.createdAt, languages });
  }
  const collection = first.contributionsCollection;
  if (collection.commitContributionsByRepository.length >= 100) throw new CollectionError('GitHub returned the 100 repository contribution limit; a complete public commit count cannot be established.', 'CONTRIBUTION_REPOSITORY_LIMIT');
  const calendar = blankCalendar();
  let commitCount = 0;
  for (const item of collection.commitContributionsByRepository) {
    if (!owned(item.repository)) continue;
    let commits = item.contributions;
    while (true) {
      for (const contribution of commits.nodes) {
        commitCount += contribution.commitCount;
        addDay(calendar, contribution.occurredAt, contribution.commitCount);
      }
      if (!commits.pageInfo.hasNextPage) break;
      const page = await graphql(`query($login: String!, $from: DateTime!, $to: DateTime!, $cursor: String) { user(login: $login) { contributionsCollection(from: $from, to: $to) { commitContributionsByRepository(maxRepositories: 100) { repository { ${publicRepositoryFields} } contributions(first: 100, after: $cursor) { nodes { occurredAt commitCount } ${pageFields} } } } } }`, { login, from, to, cursor: commits.pageInfo.endCursor });
      commits = page.contributionsCollection.commitContributionsByRepository.find((entry) => entry.repository.nameWithOwner === item.repository.nameWithOwner)?.contributions;
      if (!commits) throw new CollectionError('Commit contribution pagination changed during collection.', 'PAGINATION_CHANGED');
    }
  }
  const contributionCounts = { commits: commitCount, issues: 0, pullRequests: 0, reviews: 0, repositories: 0 };
  const countKeys = { issueContributions: 'issues', pullRequestContributions: 'pullRequests', pullRequestReviewContributions: 'reviews', repositoryContributions: 'repositories' };
  for (const [field, fields] of Object.entries(contributionFields)) {
    let contributions = collection[field];
    while (true) {
      for (const contribution of contributions.nodes) {
        const repository = contribution.repository || contribution.issue?.repository || contribution.pullRequest?.repository;
        if (!owned(repository)) continue;
        contributionCounts[countKeys[field]] += 1;
        addDay(calendar, contribution.occurredAt);
      }
      if (!contributions.pageInfo.hasNextPage) break;
      const page = await graphql(`query($login: String!, $from: DateTime!, $to: DateTime!, $cursor: String) { user(login: $login) { contributionsCollection(from: $from, to: $to) { ${field}(first: 100, after: $cursor) { nodes { ${fields} } ${pageFields} } } } }`, { login, from, to, cursor: contributions.pageInfo.endCursor });
      contributions = page.contributionsCollection[field];
    }
  }
  return {
    profile: { followers: first.followers.totalCount, publicRepos: repositories.length, totalPublicRepos: first.allPublic.totalCount, stars: repositories.reduce((sum, repo) => sum + repo.stars, 0) },
    repositories,
    commits: { count: commitCount, from, to, source: 'GitHub GraphQL public commit contributions', sourceReason: null, scope: 'Owned public non-fork repositories, including archived repositories; GitHub contribution eligibility rules apply.', metric: 'commit-contributions' },
    contributions: { total: Object.values(contributionCounts).reduce((sum, value) => sum + value, 0), counts: contributionCounts, calendar: finishCalendar(calendar), from, to, source: 'GitHub GraphQL; reconstructed from public repository nodes', sourceReason: null, scope: 'Owned public non-fork repositories, including archived repositories. Private and external repositories excluded.', kind: 'public-contributions' },
  };
}

async function collectRest() {
  let user = null;
  let rawRepositories = null;
  try { user = (await rest(`/users/${login}`)).data; } catch (error) { record('profile', error); }
  try { rawRepositories = await restPages(`/users/${login}/repos?type=owner&sort=full_name&per_page=100`, { allowStale: false }); } catch (error) { record('repositories', error); }
  if (!rawRepositories) {
    return { profile: { followers: user?.followers ?? null, publicRepos: null, totalPublicRepos: user?.public_repos ?? null, stars: null }, repositories: [], commits: { count: null, from, to, source: null, sourceReason: 'Public repository inventory unavailable.', scope: 'Owned public non-fork repositories', metric: 'default-branch-authored-commits' }, contributions: { total: null, calendar: [], from, to, source: null, sourceReason: 'Public repository inventory unavailable.', kind: 'unavailable' } };
  }
  const repositories = [];
  const calendar = blankCalendar();
  let commitsComplete = true;
  let commitCount = 0;
  for (const repo of rawRepositories.filter((item) => !item.private && !item.fork && item.owner?.login.toLowerCase() === login.toLowerCase())) {
    const item = { name: repo.name, url: repo.html_url, fork: false, archived: repo.archived, stars: repo.stargazers_count, defaultBranch: repo.default_branch || null, createdAt: repo.created_at, languages: null };
    try { item.languages = (await rest(`/repos/${login}/${repo.name}/languages`)).data; } catch (error) { record(`languages:${repo.name}`, error); }
    repositories.push(item);
    if (!repo.default_branch) continue;
    try {
      const query = new URLSearchParams({ author: login, sha: repo.default_branch, since: from, until: to, per_page: '100' });
      const commits = await restPages(`/repos/${login}/${repo.name}/commits?${query}`);
      const seen = new Set();
      for (const commit of commits) {
        if (seen.has(commit.sha)) continue;
        seen.add(commit.sha);
        const rawDate = commit.commit?.committer?.date;
        if (!rawDate || !Number.isFinite(Date.parse(rawDate))) continue;
        const occurredAt = new Date(rawDate).toISOString();
        if (occurredAt < from || occurredAt > to) continue;
        commitCount += 1;
        addDay(calendar, occurredAt);
      }
    } catch (error) {
      if (error.code === 'HTTP_409' && error.message.includes('Git Repository is empty')) continue;
      commitsComplete = false;
      record(`commits:${repo.name}`, error);
    }
  }
  return {
    profile: { followers: user?.followers ?? null, publicRepos: repositories.length, totalPublicRepos: user?.public_repos ?? null, stars: repositories.reduce((sum, repo) => sum + repo.stars, 0) },
    repositories,
    commits: { count: commitsComplete ? commitCount : null, from, to, source: 'GitHub REST authored commits on current default branches, dated by committer timestamp', sourceReason: commitsComplete ? 'GraphQL unavailable; this counts authored commits on owned public default branches by committer timestamp, not the complete GitHub contribution metric.' : 'At least one public repository commit request failed; a complete total is unavailable.', scope: 'Owned public non-fork repositories, including archived repositories; current default branches only; author identity resolved by GitHub; dates use normalized UTC committer timestamps.', metric: 'default-branch-authored-commits' },
    contributions: { total: commitsComplete ? commitCount : null, counts: commitsComplete ? { commits: commitCount } : null, calendar: commitsComplete ? finishCalendar(calendar) : [], from, to, source: 'GitHub REST default-branch authored commits', sourceReason: 'REST fallback provides a commit calendar only; issues, pull requests, reviews and private contributions are not included.', scope: 'Owned public non-fork repositories, including archived repositories; current default branches only.', kind: commitsComplete ? 'public-default-branch-commits' : 'unavailable' },
  };
}

let result;
if (token) {
  try { result = await collectGraphql(); } catch (error) { record('graphql', error); }
}
if (!result && process.env.PROFILE_REQUIRE_GRAPHQL === '1') {
  throw new CollectionError('Authenticated GraphQL is required. The existing snapshot has not been overwritten.', 'GRAPHQL_REQUIRED');
}
if (!result) result = await collectRest();
const totals = {};
for (const repo of result.repositories) {
  if (!repo.languages) continue;
  for (const [language, bytes] of Object.entries(repo.languages)) {
    if (!Number.isFinite(bytes) || bytes < 0) throw new CollectionError(`Invalid language byte count in ${repo.name}.`, 'INVALID_LANGUAGE_DATA');
    totals[language] = (totals[language] || 0) + bytes;
  }
}
const sortedTotals = Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]));
const totalBytes = Object.values(totals).reduce((sum, value) => sum + value, 0);
const languageComplete = result.profile.publicRepos !== null && result.repositories.every((repo) => repo.languages !== null);
const stats = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), login, timezone: 'UTC', ...result,
  languages: { totalBytes: languageComplete ? totalBytes : null, totals: languageComplete ? sortedTotals : null, percentages: languageComplete ? Object.fromEntries(Object.entries(sortedTotals).map(([language, bytes]) => [language, totalBytes ? Number((bytes / totalBytes * 100).toFixed(4)) : 0])) : null, complete: languageComplete, scope: 'GitHub Linguist bytes in owned public non-fork repositories, including archived repositories; not time spent or proficiency.', sourceReason: languageComplete ? null : 'At least one language request or repository inventory failed. Partial percentages are intentionally withheld.' },
  collection: { authentication, cacheUsed, errors, complete: result.profile.followers !== null && result.profile.publicRepos !== null && languageComplete && result.commits.count !== null && !cacheUsed.some((item) => item.stale), publicOnly: true, forksExcluded: true, archivedIncluded: true },
};
await saveJson(output, stats);
console.log(JSON.stringify({ file: path.relative(root, output), publicRepos: stats.profile.publicRepos, followers: stats.profile.followers, stars: stats.profile.stars, commits: stats.commits.count, commitMetric: stats.commits.metric, languagesComplete: stats.languages.complete, cacheRequests: cacheUsed.length, errors: errors.length, complete: stats.collection.complete }));
for (const error of errors) console.error(`[${error.scope}] ${error.code}: ${error.message}`);
if (process.env.PROFILE_REQUIRE_COMPLETE === '1' && !stats.collection.complete) process.exitCode = 1;
