// Shared helpers for the launchmysite scripts.
// Rule for every script in this folder: a secret value is read into memory,
// used in a request header or body, and never printed, logged or written to a file.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function fail(message, code = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(code);
}

// Where the Netlify CLI keeps its login, per its source (src/lib/settings.ts uses
// env-paths('netlify', { suffix: '' }).config).
function netlifyConfigPath() {
  const p = platform();
  if (p === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'netlify', 'Config', 'config.json');
  }
  if (p === 'darwin') {
    return join(homedir(), 'Library', 'Preferences', 'netlify', 'config.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'netlify', 'config.json');
}

export function getNetlifyToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN.trim();
  const path = netlifyConfigPath();
  if (!existsSync(path)) {
    fail('Netlify is not logged in on this computer yet. Run: netlify login');
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('Could not read the Netlify login file. Run: netlify login');
  }
  const token = cfg?.users?.[cfg?.userId]?.auth?.token;
  if (!token) fail('Netlify is not logged in on this computer yet. Run: netlify login');
  return token;
}

export function getGhToken() {
  try {
    const t = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!t) throw new Error('empty');
    return t;
  } catch {
    fail('GitHub is not logged in on this computer yet. Run: gh auth login --web --git-protocol https');
  }
}

async function request(base, token, authScheme, method, path, body, extraHeaders = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: `${authScheme} ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'launchmysite',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

export const netlify = (token) => (method, path, body) =>
  request('https://api.netlify.com/api/v1', token, 'Bearer', method, path, body);

export const github = (token) => (method, path, body) =>
  request('https://api.github.com', token, 'Bearer', method, path, body, {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  });

// A short, safe description of an API error. Never includes request headers.
export function describe(res) {
  const d = res.data;
  const msg = (d && (d.message || d.errors && JSON.stringify(d.errors))) || (typeof d === 'string' ? d.slice(0, 300) : '');
  return `HTTP ${res.status}${msg ? `: ${msg}` : ''}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
