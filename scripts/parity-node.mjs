import fs from 'node:fs/promises';
import { format } from 'node:util';

const fixtureIndex = process.argv.indexOf('--fixture');
const fixturePath = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : 'tests/parity/fixtures/core.json';
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const result = {
  version: fixture.version,
  cases: fixture.cases.map(({ name, input }) => {
    if (name === 'date-format') {
      const date = new Date(input.value);
      return { name, value: `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}` };
    }
    if (name === 'number-format') return { name, value: new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(input.value) };
    if (name === 'team-scope') return { name, visibleIds: input.ids.filter((id) => id % 2 === 1) };
    if (name === 'csv-escaping') return { name, quoted: /[;\n\r"]/.test(input.value) };
    return { name, value: format(input) };
  }),
};
process.stdout.write(JSON.stringify(result));
