/**
 * Mixed-load stress test for the AP Emlaki application.
 *
 * Simulates N concurrent users who log in AND then immediately perform a burst
 * of normal "active" requests (dashboard, entity lists) while authenticated.
 * This measures whether the app can keep real users productive, not just
 * survive the login spike.
 *
 *   STRESS_TOTAL=1000 STRESS_CONCURRENCY=1000 node scripts/stress-mixed.mjs
 *
 * Env:
 *   STRESS_TOTAL        total users                          (default 1000)
 *   STRESS_CONCURRENCY  max in-flight users                  (default = total)
 *   STRESS_TIMEOUT      per-request timeout ms              (default 30000)
 *   STRESS_BURST        activity requests per user           (default 5)
 *   TEST_BASE_URL       target                              (default http://localhost:3000)
 *   TEST_USERNAME       login                               (default admin)
 *   TEST_PASSWORD       password                            (default Online@1234)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const username = process.env.TEST_USERNAME || 'admin';
const password = process.env.TEST_PASSWORD || 'Online@1234';
const TOTAL = Math.max(1, Number(process.env.STRESS_TOTAL || 1000));
const CONCURRENCY = Math.max(1, Number(process.env.STRESS_CONCURRENCY || TOTAL));
const TIMEOUT_MS = Number(process.env.STRESS_TIMEOUT || 30000);
const BURST = Math.max(1, Number(process.env.STRESS_BURST || 5));

// Light, read-only "active user" pages a logged-in user would open.
const ACTIVITY = ['/', '/objekte', '/adressen', '/einheiten', '/dashboard/heute', '/notizen'];

function csrfFrom(html) {
  return /name="_csrf"\s+value="([^"]+)"/.exec(html)?.[1]
    || /name="csrf-token"\s+content="([^"]+)"/.exec(html)?.[1]
    || '';
}

async function authedSession() {
  const jar = [];
  const setCookie = (res) => {
    const raw = res.headers.get('set-cookie');
    if (!raw) return;
    for (const part of raw.split(/,(?=\s*[^;,]+=)/)) {
      const c = part.split(';')[0].trim();
      const eq = c.indexOf('=');
      if (eq > 0) {
        const k = c.slice(0, eq), v = c.slice(eq + 1);
        const i = jar.findIndex((x) => x[0] === k);
        if (i >= 0) jar[i] = [k, v]; else jar.push([k, v]);
      }
    }
  };
  const cookie = () => jar.map(([k, v]) => `${k}=${v}`).join('; ');

  const getPage = await fetch(baseUrl + '/login', { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  setCookie(getPage);
  const token = csrfFrom(await getPage.text());
  if (!token || getPage.status !== 200) return { ok: false, reason: 'login-page' };

  const post = await fetch(baseUrl + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ Benutzername: username, Passwort: password, _csrf: token }),
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  setCookie(post);
  if (post.status !== 302 || post.headers.get('location') !== '/') return { ok: false, reason: `post-${post.status}` };
  return { ok: true, cookie: cookie() };
}

async function getPage(url, cookie) {
  const t0 = Date.now();
  try {
    const res = await fetch(baseUrl + url, { redirect: 'manual', headers: { cookie }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { ok: res.status < 400, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, reason: e.name === 'TimeoutError' ? 'timeout' : e.message };
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))];
}

async function run() {
  console.log('AP Emlaki mixed-load stress test');
  console.log(`  target       : ${baseUrl}`);
  console.log(`  users        : ${TOTAL}`);
  console.log(`  concurrency   : ${Math.min(CONCURRENCY, TOTAL)}`);
  console.log(`  burst/user   : ${BURST} activity pages`);
  console.log(`  activity urls : ${ACTIVITY.join(' ')}\n`);

  const started = Date.now();
  const loginOk = { ok: 0, fail: 0, reasons: {} };
  const activity = { ok: 0, fail: 0, reasons: {}, latencies: [], statuses: {} };

  let inFlight = 0, next = 0;

  await new Promise((resolve) => {
    function pump() {
      while (inFlight < Math.min(CONCURRENCY, TOTAL) && next < TOTAL) {
        const i = next++;
        inFlight++;
        (async () => {
          const sess = await authedSession();
          if (!sess.ok) {
            loginOk.fail++;
            loginOk.reasons[sess.reason] = (loginOk.reasons[sess.reason] || 0) + 1;
          } else {
            loginOk.ok++;
            for (let b = 0; b < BURST; b++) {
              const url = ACTIVITY[b % ACTIVITY.length];
              const r = await getPage(url, sess.cookie);
              activity.latencies.push(r.ms);
              activity.statuses[r.status] = (activity.statuses[r.status] || 0) + 1;
              if (r.ok) activity.ok++; else { activity.fail++; activity.reasons[r.reason || `http-${r.status}`] = (activity.reasons[r.reason || `http-${r.status}`] || 0) + 1; }
            }
          }
          inFlight--;
          if (next < TOTAL || inFlight > 0) pump(); else resolve();
        })();
      }
    }
    pump();
  });

  const elapsed = Date.now() - started;
  const lat = activity.latencies.sort((a, b) => a - b);
  const totalReq = TOTAL;
  const totalActivity = activity.ok + activity.fail;
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl, totalUsers: TOTAL, concurrency: Math.min(CONCURRENCY, TOTAL), burst: BURST,
    wallMs: elapsed,
    login: { ok: loginOk.ok, fail: loginOk.fail, successRate: +(loginOk.ok / totalReq * 100).toFixed(2), reasons: loginOk.reasons },
    activity: {
      requests: totalActivity,
      ok: activity.ok, fail: activity.fail,
      successRate: +(activity.ok / totalActivity * 100).toFixed(2),
      throughputPerSec: +(totalActivity / (elapsed / 1000)).toFixed(1),
      latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99), max: lat[lat.length - 1] || 0 },
      statuses: activity.statuses,
      reasons: activity.reasons,
    },
  };

  const out = path.join(ROOT, 'tests', 'stress-mixed-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');

  console.log('================ MIXED-LOAD RESULTS ================');
  console.log(`  wall time            : ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  LOGIN  ok/fail       : ${report.login.ok}/${report.login.fail}  (${report.login.successRate}%)`);
  if (loginOk.fail) console.log(`  LOGIN  failures       : ${JSON.stringify(loginOk.reasons)}`);
  console.log(`  ACTIVITY reqs         : ${report.activity.requests}`);
  console.log(`  ACTIVITY ok/fail      : ${report.activity.ok}/${report.activity.fail}  (${report.activity.successRate}%)`);
  console.log(`  ACTIVITY throughput   : ${report.activity.throughputPerSec} pages/sec`);
  console.log(`  ACTIVITY latency p50  : ${report.activity.latencyMs.p50}ms`);
  console.log(`  ACTIVITY latency p95  : ${report.activity.latencyMs.p95}ms`);
  console.log(`  ACTIVITY latency p99  : ${report.activity.latencyMs.p99}ms`);
  console.log(`  ACTIVITY latency max  : ${report.activity.latencyMs.max}ms`);
  if (activity.fail) console.log(`  ACTIVITY failures     : ${JSON.stringify(activity.reasons)}`);
  console.log(`  report               : ${path.relative(ROOT, out)}`);
}

run();
