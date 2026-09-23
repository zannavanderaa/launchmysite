#!/usr/bin/env node
// Netlify helper for launchmysite. Talks to the Netlify REST API with the login
// that `netlify login` stored, and to GitHub with the login that `gh auth login` stored.
// It never prints a token.
//
// Usage (run from the site project folder):
//   node netlify.mjs whoami
//   node netlify.mjs setup   --repo <owner/name> --name <site-name> [--team <slug>] [--publish site] [--commit-status]
//   node netlify.mjs build   [--site-id <id>]
//   node netlify.mjs status  [--site-id <id>]
//   node netlify.mjs domain  --domain <example.nl> [--site-id <id>]
//   node netlify.mjs tls     [--provision] [--site-id <id>]
//   node netlify.mjs preview --pr <number> [--wait <seconds>] [--site-id <id>]
//   node netlify.mjs count   [--site-id <id>]
//
// Why `setup` exists instead of `netlify init`: `netlify init` asks its questions in an
// interactive menu, which Claude cannot answer from its own tool. `setup` performs the
// same steps as `netlify init` does for GitHub (netlify/cli src/utils/init/config-github.ts):
// a read-only deploy key on the repo, a webhook for push, pull_request and delete, and the
// repo link on the Netlify site. It reuses the existing `gh` login, so there is no second
// browser authorisation.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, fail, getNetlifyToken, getGhToken, netlify, github, describe, sleep } from './_lib.mjs';

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const STATE = join(process.cwd(), '.netlify', 'state.json');

function siteIdFromArgsOrState() {
  if (args['site-id']) return args['site-id'];
  if (existsSync(STATE)) {
    try {
      const s = JSON.parse(readFileSync(STATE, 'utf8'));
      if (s.siteId) return s.siteId;
    } catch { /* fall through */ }
  }
  fail('No site id given and no .netlify/state.json in this folder. Run this from the site project folder, or pass --site-id.');
}

function saveState(siteId) {
  mkdirSync(join(process.cwd(), '.netlify'), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ siteId }, null, 2) + '\n');
}

async function whoami() {
  const nf = netlify(getNetlifyToken());
  const u = await nf('GET', '/user');
  if (!u.ok) fail(`Netlify login does not work: ${describe(u)}. Run: netlify login`);
  const accts = await nf('GET', '/accounts');
  if (!accts.ok) fail(`Could not list Netlify teams: ${describe(accts)}`);
  console.log(JSON.stringify({
    netlifyUser: u.data.full_name || u.data.slug || '(no name set)',
    teams: accts.data.map((a) => ({ slug: a.slug, name: a.name, plan: a.type_name || a.type || null })),
  }, null, 2));
}

async function setup() {
  const repoFull = args.repo;
  const name = args.name;
  if (!repoFull || !repoFull.includes('/')) fail('--repo <owner/name> is required');
  if (!name) fail('--name <site-name> is required');
  const [owner, repo] = repoFull.split('/');
  const publish = typeof args.publish === 'string' ? args.publish : 'site';

  const nf = netlify(getNetlifyToken());
  const ghToken = getGhToken();
  const gh = github(ghToken);

  // 1. The GitHub repository must exist and be reachable.
  const r = await gh('GET', `/repos/${owner}/${repo}`);
  if (!r.ok) fail(`Could not find the GitHub repository ${repoFull}: ${describe(r)}`);
  const branch = r.data.default_branch;

  // 2. Create the Netlify site (or reuse one passed with --site-id).
  let site;
  if (args['site-id']) {
    const s = await nf('GET', `/sites/${args['site-id']}`);
    if (!s.ok) fail(`Could not find Netlify site ${args['site-id']}: ${describe(s)}`);
    site = s.data;
    console.log(`Reusing existing Netlify site ${site.name}.`);
  } else {
    const path = args.team ? `/${encodeURIComponent(args.team)}/sites` : '/sites';
    const s = await nf('POST', path, { name });
    if (s.status === 422) fail(`The site name "${name}" is already taken on Netlify. Choose another name.`);
    if (!s.ok) fail(`Could not create the Netlify site: ${describe(s)}`);
    site = s.data;
    console.log(`Created Netlify site ${site.name}.`);
  }
  saveState(site.id);

  // 3. Read-only deploy key: lets Netlify read (never change) the repository.
  const k = await nf('POST', '/deploy_keys');
  if (!k.ok) fail(`Could not create a Netlify deploy key: ${describe(k)}`);
  const addKey = await gh('POST', `/repos/${owner}/${repo}/keys`, {
    title: 'Netlify Deploy Key',
    key: k.data.public_key,
    read_only: true,
  });
  if (!addKey.ok) fail(`Could not add the deploy key to GitHub: ${describe(addKey)}`);
  console.log('Added a read-only Netlify deploy key to the repository.');

  // 4. Link the repository to the site, same shape as netlify init sends.
  const upd = await nf('PATCH', `/sites/${site.id}`, {
    repo: {
      id: r.data.id,
      provider: 'github',
      repo_path: r.data.full_name,
      repo_branch: branch,
      allowed_branches: [branch],
      deploy_key_id: k.data.id,
      dir: publish,
      cmd: typeof args['build-cmd'] === 'string' ? args['build-cmd'] : '',
    },
  });
  if (!upd.ok) fail(`Could not link the repository to the Netlify site: ${describe(upd)}`);
  const deployHook = upd.data.deploy_hook;
  if (!deployHook) fail('Netlify did not return a deploy hook URL after linking. Stop and report this.');
  console.log(`Linked ${repoFull} (branch ${branch}, publish folder "${publish}") to the site.`);

  // 5. GitHub webhook so Netlify hears about pushes and pull requests.
  const hooks = await gh('GET', `/repos/${owner}/${repo}/hooks?per_page=100`);
  const exists = hooks.ok && hooks.data.some((h) => h.config && h.config.url === deployHook);
  if (!exists) {
    const h = await gh('POST', `/repos/${owner}/${repo}/hooks`, {
      name: 'web',
      config: { url: deployHook, content_type: 'json' },
      events: ['push', 'pull_request', 'delete'],
      active: true,
    });
    if (!h.ok && !(h.data && JSON.stringify(h.data).includes('Hook already exists'))) {
      fail(`Could not create the GitHub webhook: ${describe(h)}`);
    }
  }
  console.log('GitHub will now tell Netlify about every change and every proposed change.');

  // 6. Optional: let Netlify post "preview ready" statuses on GitHub.
  // This hands Netlify a copy of the GitHub login token (netlify init does the same),
  // so it is off by default: the site owner never looks at GitHub anyway.
  if (args['commit-status']) {
    for (const event of ['deploy_created', 'deploy_failed', 'deploy_building']) {
      const h = await nf('POST', '/hooks', {
        site_id: site.id,
        type: 'github_commit_status',
        event,
        data: { access_token: ghToken },
      });
      if (!h.ok) fail(`Could not add the Netlify commit status hook for ${event}: ${describe(h)}`);
    }
    console.log('Netlify will post preview statuses on GitHub.');
  }

  console.log(JSON.stringify({
    siteId: site.id,
    siteName: site.name,
    netlifyAddress: site.ssl_url || `https://${site.name}.netlify.app`,
    adminUrl: site.admin_url,
  }, null, 2));
}

async function build() {
  const id = siteIdFromArgsOrState();
  const nf = netlify(getNetlifyToken());
  const b = await nf('POST', `/sites/${id}/builds`);
  if (!b.ok) fail(`Could not start a build: ${describe(b)}`);
  console.log('Build started.');
}

async function status() {
  const id = siteIdFromArgsOrState();
  const nf = netlify(getNetlifyToken());
  const s = await nf('GET', `/sites/${id}`);
  if (!s.ok) fail(describe(s));
  const d = await nf('GET', `/sites/${id}/deploys?per_page=5`);
  console.log(JSON.stringify({
    siteName: s.data.name,
    netlifyAddress: `https://${s.data.name}.netlify.app`,
    customDomain: s.data.custom_domain || null,
    domainAliases: s.data.domain_aliases || [],
    httpsUrl: s.data.ssl_url,
    latestDeploys: d.ok ? d.data.map((x) => ({ context: x.context, branch: x.branch, state: x.state, pr: x.review_id || null, created: x.created_at })) : [],
  }, null, 2));
}

async function domain() {
  const id = siteIdFromArgsOrState();
  const dom = String(args.domain || '').trim().toLowerCase().replace(/^www\./, '');
  if (!dom || !dom.includes('.')) fail('--domain <example.nl> is required (without www)');
  const nf = netlify(getNetlifyToken());
  const u = await nf('PATCH', `/sites/${id}`, { custom_domain: dom });
  if (!u.ok) fail(`Could not set the custom domain: ${describe(u)}`);
  console.log(JSON.stringify({ customDomain: u.data.custom_domain, domainAliases: u.data.domain_aliases || [] }, null, 2));
}

async function tls() {
  const id = siteIdFromArgsOrState();
  const nf = netlify(getNetlifyToken());
  if (args.provision) {
    const p = await nf('POST', `/sites/${id}/ssl`);
    if (!p.ok) fail(`Netlify could not issue the HTTPS certificate yet: ${describe(p)}`);
    console.log('Asked Netlify to issue the HTTPS certificate.');
  }
  const s = await nf('GET', `/sites/${id}/ssl`);
  if (s.status === 404) {
    console.log(JSON.stringify({ certificate: 'none yet' }, null, 2));
    return;
  }
  if (!s.ok) fail(describe(s));
  console.log(JSON.stringify({ state: s.data.state, domains: s.data.domains, expiresAt: s.data.expires_at }, null, 2));
}

async function preview() {
  const id = siteIdFromArgsOrState();
  const pr = Number(args.pr);
  if (!pr) fail('--pr <number> is required');
  const waitSec = Number(args.wait || 0);
  const nf = netlify(getNetlifyToken());
  const s = await nf('GET', `/sites/${id}`);
  if (!s.ok) fail(describe(s));
  const deadline = Date.now() + waitSec * 1000;
  for (;;) {
    const d = await nf('GET', `/sites/${id}/deploys?per_page=30`);
    if (!d.ok) fail(describe(d));
    const mine = d.data.filter((x) => x.context === 'deploy-preview' && Number(x.review_id) === pr);
    const latest = mine[0];
    if (latest && (latest.state === 'ready' || latest.state === 'error' || Date.now() > deadline)) {
      console.log(JSON.stringify({
        state: latest.state,
        previewUrl: `https://deploy-preview-${pr}--${s.data.name}.netlify.app`,
        permalink: latest.deploy_ssl_url,
        error: latest.error_message || null,
      }, null, 2));
      if (latest.state === 'error') process.exit(2);
      return;
    }
    if (Date.now() > deadline) {
      console.log(JSON.stringify({ state: 'not found yet', pr }, null, 2));
      process.exit(3);
    }
    await sleep(10000);
  }
}

async function count() {
  const id = siteIdFromArgsOrState();
  const nf = netlify(getNetlifyToken());
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let page = 1;
  let n = 0;
  for (;;) {
    const d = await nf('GET', `/sites/${id}/deploys?per_page=100&page=${page}`);
    if (!d.ok) fail(describe(d));
    const rows = d.data;
    for (const x of rows) {
      if (new Date(x.created_at) < monthStart) continue;
      if (x.context === 'production' && x.state === 'ready') n++;
    }
    const oldest = rows[rows.length - 1];
    if (rows.length < 100 || (oldest && new Date(oldest.created_at) < monthStart)) break;
    page++;
  }
  console.log(JSON.stringify({
    productionDeploysThisMonth: n,
    approxCreditsUsedByDeploys: n * 15,
    note: 'Netlify Free: 300 credits a month, 15 per production deploy. Bandwidth also uses credits. Check the real total in Netlify under Usage.',
  }, null, 2));
}

const commands = { whoami, setup, build, status, domain, tls, preview, count };
if (!commands[cmd]) fail(`Unknown command "${cmd || ''}". Use one of: ${Object.keys(commands).join(', ')}`);
commands[cmd]().catch((e) => fail(e.message));
