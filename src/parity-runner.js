import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function run(command, args, { cwd, input, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ ok: false, code: null, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
    if (input != null) child.stdin.end(input);
  });
}

export async function readFixture(file = 'tests/parity/fixtures/core.json') {
  return JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
}

export function compareJson(actual, expected, pathName = '$', differences = []) {
  if (typeof actual !== typeof expected || actual === null || expected === null) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) differences.push({ path: pathName, actual, expected });
    return differences;
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
      differences.push({ path: pathName, actual, expected });
      return differences;
    }
    actual.forEach((value, index) => compareJson(value, expected[index], `${pathName}[${index}]`, differences));
    return differences;
  }
  if (typeof actual === 'object') {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of keys) compareJson(actual[key], expected[key], `${pathName}.${key}`, differences);
    return differences;
  }
  if (actual !== expected) differences.push({ path: pathName, actual, expected });
  return differences;
}

export async function runParity({ php = process.env.PHP_BIN || 'php', phpScript = process.env.PHP_PARITY_SCRIPT, nodeScript = process.env.NODE_PARITY_SCRIPT || 'scripts/parity-node.mjs', fixture = 'tests/parity/fixtures/core.json', cwd = process.cwd() } = {}) {
  const input = await readFixture(fixture);
  const node = await run(process.execPath, [nodeScript, '--fixture', path.resolve(fixture)], { cwd, input: JSON.stringify(input) });
  const report = { fixture, node, php: null, status: 'blocked', differences: [] };
  if (!phpScript) {
    report.reason = 'PHP_PARITY_SCRIPT is not configured';
    return report;
  }
  report.php = await run(php, [phpScript, '--fixture', path.resolve(fixture)], { cwd, input: JSON.stringify(input) });
  if (!node.ok || !report.php.ok) {
    report.reason = 'One parity runner failed';
    return report;
  }
  let actual;
  let expected;
  try {
    actual = JSON.parse(node.stdout.trim());
    expected = JSON.parse(report.php.stdout.trim());
  } catch (error) {
    report.reason = `Runner output is not JSON: ${error.message}`;
    return report;
  }
  report.differences = compareJson(actual, expected);
  report.status = report.differences.length ? 'failed' : 'passed';
  return report;
}
