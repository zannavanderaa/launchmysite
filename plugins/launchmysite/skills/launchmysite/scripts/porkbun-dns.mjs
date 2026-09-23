#!/usr/bin/env node
// Points a Porkbun domain at a Netlify site. Changes exactly two names, the bare domain
// and www, and nothing else: mail records, TXT records and other subdomains are never touched.
//
// Usage:
//   node porkbun-dns.mjs --domain example.nl --netlify-site my-site-name [--dry-run]
//
// Keys: read from the environment variables PORKBUN_API_KEY and PORKBUN_SECRET_API_KEY,
// or, when those are not set and this runs in a real terminal, asked for with hidden input.
// The keys are kept in memory only. They are never printed, logged or written to a file.
//
// Porkbun API reference: https://porkbun.com/api/json/v3/spec (v3, checked 2026-09-23).
// Netlify external DNS: bare domain ALIAS to apex-loadbalancer.netlify.com (preferred),
// www CNAME to <site>.netlify.app.

import readline from 'node:readline';
import { parseArgs, fail } from './_lib.mjs';

const API = 'https://api.porkbun.com/api/json/v3';
const APEX_TARGET = 'apex-loadbalancer.netlify.com';

const args = parseArgs(process.argv.slice(2));
const domain = String(args.domain || '').trim().toLowerCase().replace(/^www\./, '');
const site = String(args['netlify-site'] || '').trim().toLowerCase().replace(/\.netlify\.app$/, '');
const dryRun = Boolean(args['dry-run']);
if (!domain.includes('.')) fail('--domain <example.nl> is required');
if (!site) fail('--netlify-site <site-name> is required (the part before .netlify.app)');
const WWW_TARGET = `${site}.netlify.app`;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(question); };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function getKeys() {
  let apikey = (process.env.PORKBUN_API_KEY || '').trim();
  let secretapikey = (process.env.PORKBUN_SECRET_API_KEY || '').trim();
  if ((!apikey || !secretapikey) && process.stdin.isTTY) {
    console.log('Paste your Porkbun keys. What you paste stays invisible, that is expected.');
    if (!apikey) apikey = await askHidden('API key (starts with pk1_): ');
    if (!secretapikey) secretapikey = await askHidden('Secret key (starts with sk1_): ');
  }
  if (!apikey || !secretapikey) {
    fail('No Porkbun keys found. Set PORKBUN_API_KEY and PORKBUN_SECRET_API_KEY, or run this in a terminal so it can ask.');
  }
  if (!apikey.startsWith('pk1_') || !secretapikey.startsWith('sk1_')) {
    fail('Those do not look like Porkbun keys. The API key starts with pk1_ and the secret key with sk1_.');
  }
  return { apikey, secretapikey };
}

let KEYS;
async function pb(path, extra = {}) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'launchmysite' },
    body: JSON.stringify({ ...KEYS, ...extra }),
  });
  let data;
  try { data = await res.json(); } catch { data = { status: 'ERROR', message: `HTTP ${res.status}` }; }
  return data;
}

function explain(data) {
  const code = data.code || '';
  const hint = data.next_action && data.next_action.hint ? ` (${data.next_action.hint})` : '';
  return `${code ? code + ': ' : ''}${data.message || 'unknown error'}${hint}`;
}

async function list(type, sub) {
  const r = await pb(`/dns/retrieveByNameType/${domain}/${type}/${sub}`);
  if (r.status !== 'SUCCESS') throw new Error(`reading ${type} ${sub || '@'}: ${explain(r)}`);
  return r.records || [];
}

async function main() {
  KEYS = await getKeys();

  const ping = await pb('/ping');
  if (ping.status !== 'SUCCESS') fail(`Porkbun did not accept the keys: ${explain(ping)}`);

  // The domain must be in the account and opted in to API access.
  const probe = await pb(`/dns/retrieve/${domain}`);
  if (probe.status !== 'SUCCESS') {
    fail(`Porkbun refused access to ${domain}: ${explain(probe)}. Check that the domain is in this account and that "API Access" is switched on for it under Domain Management, Details.`);
  }
  const all = probe.records || [];

  // CAA: only report, never change.
  const caa = all.filter((r) => r.type === 'CAA' && (r.name === domain));
  const caaBlocks = caa.length > 0 && !caa.some((r) => /letsencrypt\.org/i.test(r.content));

  // Anything unusual on the two names we manage (for example a Porkbun parking or
  // forwarding record of a type this script does not handle): report, never guess.
  const handled = new Set(['A', 'AAAA', 'CNAME', 'ALIAS', 'MX', 'TXT', 'NS', 'CAA', 'SRV']);
  const unusual = all.filter((r) => (r.name === domain || r.name === `www.${domain}`) && !handled.has(r.type));

  const plan = [];
  // Bare domain: remove A, AAAA, CNAME and any other ALIAS, then ensure one ALIAS to Netlify.
  for (const type of ['A', 'AAAA', 'CNAME', 'ALIAS']) {
    for (const r of await list(type, '')) {
      if (type === 'ALIAS' && r.content.replace(/\.$/, '') === APEX_TARGET) continue;
      plan.push({ action: 'delete', id: r.id, name: domain, type, content: r.content });
    }
  }
  const apexOk = (await list('ALIAS', '')).some((r) => r.content.replace(/\.$/, '') === APEX_TARGET);
  if (!apexOk) plan.push({ action: 'create', name: '', type: 'ALIAS', content: APEX_TARGET });

  // www: remove A, AAAA, ALIAS and any other CNAME, then ensure one CNAME to the site.
  for (const type of ['A', 'AAAA', 'ALIAS', 'CNAME']) {
    for (const r of await list(type, 'www')) {
      if (type === 'CNAME' && r.content.replace(/\.$/, '') === WWW_TARGET) continue;
      plan.push({ action: 'delete', id: r.id, name: `www.${domain}`, type, content: r.content });
    }
  }
  const wwwOk = (await list('CNAME', 'www')).some((r) => r.content.replace(/\.$/, '') === WWW_TARGET);
  if (!wwwOk) plan.push({ action: 'create', name: 'www', type: 'CNAME', content: WWW_TARGET });

  console.log(`Plan for ${domain} (only the bare domain and www are touched):`);
  if (plan.length === 0) console.log('  nothing to change, already pointing at Netlify');
  for (const p of plan) {
    const label = p.action === 'create' ? (p.name ? `${p.name}.${domain}` : domain) : p.name;
    console.log(`  ${p.action.padEnd(6)} ${p.type.padEnd(5)} ${label} -> ${p.content}`);
  }
  if (caaBlocks) {
    console.log(`WARNING: ${domain} has a CAA record that does not allow letsencrypt.org, so Netlify cannot issue HTTPS. Not changed by this script. Stop and report.`);
  }
  for (const r of unusual) {
    console.log(`NOTE: ${r.name} also has a ${r.type} record (${r.content}) that this script does not change. If the site does not show up later, this is the first suspect.`);
  }
  if (dryRun) {
    console.log('Dry run: nothing changed.');
    return;
  }

  for (const p of plan) {
    if (p.action === 'delete') {
      const r = await pb(`/dns/delete/${domain}/${p.id}`);
      if (r.status !== 'SUCCESS') fail(`Could not remove ${p.type} ${p.name}: ${explain(r)}`);
    } else {
      const r = await pb(`/dns/create/${domain}`, { name: p.name, type: p.type, content: p.content, ttl: 600 });
      if (r.status !== 'SUCCESS') fail(`Could not create ${p.type} ${p.name || '@'}: ${explain(r)}`);
    }
  }

  // Read back and verify.
  const apexNow = await list('ALIAS', '');
  const wwwNow = await list('CNAME', 'www');
  const strayApex = [...await list('A', ''), ...await list('AAAA', ''), ...await list('CNAME', '')];
  const strayWww = [...await list('A', 'www'), ...await list('AAAA', 'www'), ...await list('ALIAS', 'www')];
  const ok = apexNow.length === 1 && apexNow[0].content.replace(/\.$/, '') === APEX_TARGET
    && wwwNow.length === 1 && wwwNow[0].content.replace(/\.$/, '') === WWW_TARGET
    && strayApex.length === 0 && strayWww.length === 0;
  if (!ok) {
    fail('After the change the records are not exactly as intended. Stop and report; do not retry blindly.');
  }
  console.log(`Done. ${domain} -> ALIAS ${APEX_TARGET}, www.${domain} -> CNAME ${WWW_TARGET}.`);
}

main().catch((e) => fail(e.message));
