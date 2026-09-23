#!/usr/bin/env node
// Checks from the outside whether a domain reaches its Netlify site: DNS at two public
// resolvers, then HTTPS on the bare domain and on www. Needs no keys.
//
// Usage:
//   node check-site.mjs --domain example.nl --netlify-site my-site-name [--wait <seconds>]
//
// Exit code 0 means everything is live. With --wait it rechecks every 60 seconds until
// live or the time runs out.

import { parseArgs, fail, sleep } from './_lib.mjs';

const args = parseArgs(process.argv.slice(2));
const domain = String(args.domain || '').trim().toLowerCase().replace(/^www\./, '');
const site = String(args['netlify-site'] || '').trim().toLowerCase().replace(/\.netlify\.app$/, '');
if (!domain.includes('.')) fail('--domain <example.nl> is required');
if (!site) fail('--netlify-site <site-name> is required');
const waitSec = Number(args.wait || 0);

const RESOLVERS = {
  google: (n, t) => `https://dns.google/resolve?name=${n}&type=${t}`,
  cloudflare: (n, t) => `https://cloudflare-dns.com/dns-query?name=${n}&type=${t}`,
};

async function doh(resolver, name, type) {
  try {
    const res = await fetch(RESOLVERS[resolver](name, type), { headers: { accept: 'application/dns-json' } });
    const j = await res.json();
    return (j.Answer || []).map((a) => ({ type: a.type, data: String(a.data).replace(/\.$/, '') }));
  } catch {
    return null;
  }
}

async function https(url) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual' });
    return { status: res.status, server: res.headers.get('server'), location: res.headers.get('location') };
  } catch (e) {
    return { error: e.cause && e.cause.code ? e.cause.code : e.message };
  }
}

async function once() {
  const report = { domain, dns: {}, https: {} };
  const netlifyIps = new Set(((await doh('google', 'apex-loadbalancer.netlify.com', 'A')) || []).filter((a) => a.type === 1).map((a) => a.data));
  let dnsOk = true;
  for (const r of Object.keys(RESOLVERS)) {
    const apex = (await doh(r, domain, 'A')) || [];
    const apexA = apex.filter((a) => a.type === 1).map((a) => a.data);
    const www = (await doh(r, `www.${domain}`, 'CNAME')) || [];
    const wwwC = www.filter((a) => a.type === 5).map((a) => a.data);
    const apexToNetlify = apexA.length > 0 && apexA.every((ip) => netlifyIps.has(ip) || ip === '75.2.60.5');
    const wwwToNetlify = wwwC.includes(`${site}.netlify.app`);
    report.dns[r] = { apexA, apexToNetlify, wwwCname: wwwC, wwwToNetlify };
    if (!apexToNetlify || !wwwToNetlify) dnsOk = false;
  }
  const apexHttps = await https(`https://${domain}/`);
  const wwwHttps = await https(`https://www.${domain}/`);
  report.https.apex = apexHttps;
  report.https.www = wwwHttps;
  const httpsOk = [apexHttps, wwwHttps].every((h) => h.status && h.status < 400);
  report.dnsOk = dnsOk;
  report.httpsOk = httpsOk;
  report.live = dnsOk && httpsOk;
  return report;
}

const deadline = Date.now() + waitSec * 1000;
for (;;) {
  const r = await once();
  if (r.live || Date.now() > deadline) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.live ? 0 : 1);
  }
  console.log(`${new Date().toISOString()} not live yet (dns ${r.dnsOk ? 'ok' : 'waiting'}, https ${r.httpsOk ? 'ok' : 'waiting'}), checking again in 60 s`);
  await sleep(60000);
}
