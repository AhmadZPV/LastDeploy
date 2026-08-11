import fs from 'node:fs/promises';
import path from 'node:path';
import { runParity } from '../src/parity-runner.js';

const report = await runParity({
  php: process.env.PHP_BIN || 'php',
  phpScript: process.env.PHP_PARITY_SCRIPT || 'scripts/parity-php.php',
});
const output = path.resolve('tests/parity/latest-report.json');
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, differences: report.differences.length, report: output, reason: report.reason }, null, 2));
process.exitCode = report.status === 'passed' ? 0 : 1;
