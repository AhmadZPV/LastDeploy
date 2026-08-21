/**
 * Login stress test for the AP Emlaki application.
 *
 * Simulates N concurrent users performing a full login flow (GET /login,
 * extract CSRF, POST /login with credentials, follow the 302). Each user has
 * its own cookie jar so the server treats them as independent sessions.
 *
 * This is a CONTROLLED LOCAL test. It measures what the current dev setup
 *   (single Node process, native bcrypt, file-based sessions, SQLite) can
 * sustain. It is NOT a proof of internet-facing production capacity.
 *
 *   STRESS_TOTAL=1000 STRESS_CONCURRENCY=1000 node scripts/stress-login.mjs
 *
 * Env:
 *   STRESS_TOTAL        total logins to attempt        (default 1000)
 *   STRESS_CONCURRENCY  max in-flight at once           (default = total)
 *   STRESS_TIMEOUT      per-request timeout ms          (default 30000)
 *   STRESS_THINK        ms pause before each POST       (default 0)
 *   TEST_BASE_URL       target                          (default http://localhost:3000)
 *   TEST_USERNAME       login                           (default admin)
 *   TEST_PASSWORD       password                        (default Online@1234)
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
const THINK_MS = Number(process.env.STRESS_THINK || 0);

function csrfFrom(html) {
  return /name="_csrf"\s+value="([^"]+)"/.exec(html)?.[1]
    || /name="csrf-token"\s+content="([^"]+)"/.exec(html)?.[1]
    || '';
}

async function oneLogin(index) {
  const jar = [];
  const headers = new Headers();
  const setCookie = (res) => {
    const raw = res.headers.get('set-cookie');
    if (!raw) return;
    for (const part of raw.split(/,(?=\s*[^;,]+=)/)) {
      const c = part.split(';')[0].trim();
      const eq = c.indexOf('=');
      if (eq > 0) {
        const k = c.slice(0, eq);
        const v = c.slice(eq + 1);
        const i = jar.findIndex((x) => x[0] === k);
        if (i >= 0) jar[i] = [k, v]; else jar.push([k, v]);
      }
    }
  };
  const cookie = () => jar.map(([k, v]) => `${k}=${v}`).join('; ');

  const t0 = Date.now();
  try {
    const getPage = await fetch(baseUrl + '/login', {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    setCookie(getPage);
    const pageHtml = await getPage.text();
    const token = csrfFrom(pageHtml);
    if (!token) return { ok: false, reason: 'no-csrf', ms: Date.now() - t0 };
    if (getPage.status !== 200) return { ok: false, reason: `login-page-${getPage.status}`, ms: Date.now() - t0 };

    if (THINK_MS) await new Promise((r) => setTimeout(r, THINK_MS));

    const body = new URLSearchParams({ Benutzername: username, Passwort: password, _csrf: token });
    const post = await fetch(baseUrl + '/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    setCookie(post);
    const ms = Date.now() - t0;
    const loc = post.headers.get('location');
    if (post.status === 302 && loc === '/') return { ok: true, ms };
    if (post.status === 429) return { ok: false, reason: 'throttled-429', ms };
    return { ok: false, reason: `post-${post.status}${loc ? ':' + loc : ''}`, ms };
  } catch (e) {
    return { ok: false, reason: e.name === 'TimeoutError' ? 'timeout' : e.message, ms: Date.now() - t0 };
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

async function run() {
  console.log('AP Emlaki login stress test');
  console.log(`  target       : ${baseUrl}`);
  console.log(`  users        : ${TOTAL}`);
  console.log(`  concurrency   : ${Math.min(CONCURRENCY, TOTAL)}`);
  console.log(`  credentials   : ${username} / (hidden)`);
  console.log(`  timeout      : ${TIMEOUT_MS}ms\n`);

  const started = Date.now();
  const results = [];
  let inFlight = 0;
  let next = 0;
  const reasons = {};
  let ok = 0;

  await new Promise((resolve) => {
    function pump() {
      while (inFlight < Math.min(CONCURRENCY, TOTAL) && next < TOTAL) {
        const i = next++;
        inFlight++;
        oneLogin(i).then((r) => {
          results.push(r);
          if (r.ok) ok++;
          else reasons[r.reason] = (reasons[r.reason] || 0) + 1;
          inFlight--;
          if (next < TOTAL || inFlight > 0) pump();
          else resolve();
        });
      }
    }
    pump();
  });

  const elapsed = Date.now() - started;
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const failed = results.length - ok;
  const tput = (results.length / (elapsed / 1000)).toFixed(1);

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    total: TOTAL,
    concurrency: Math.min(CONCURRENCY, TOTAL),
    elapsedMs: elapsed,
    throughputPerSec: Number(tput),
    ok,
    failed,
    successRate: +(ok / results.length * 100).toFixed(2),
    latencyMs: {
      min: latencies[0] ?? 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies[latencies.length - 1] ?? 0,
    },
    failuresByReason: reasons,
  };

  const out = path.join(ROOT, 'tests', 'stress-login-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');

  console.log('================ STRESS RESULTS ================');
  console.log(`  total            : ${report.total}`);
  console.log(`  ok / failed       : ${report.ok} / ${report.failed}`);
  console.log(`  success rate      : ${report.successRate}%`);
  console.log(`  throughput        : ${report.throughputPerSec} logins/sec`);
  console.log(`  wall time         : ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  latency ms  p50   : ${report.latencyMs.p50}`);
  console.log(`  latency ms  p95   : ${report.latencyMs.p95}`);
  console.log(`  latency ms  p99   : ${report.latencyMs.p99}`);
  console.log(`  latency ms  max   : ${report.latencyMs.max}`);
  if (failed) console.log(`  failures          : ${JSON.stringify(reasons)}`);
  console.log(`  report           : ${path.relative(ROOT, out)}`);
}

run();
