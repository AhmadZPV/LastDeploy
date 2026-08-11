import fs from 'node:fs';
import path from 'node:path';

const source = process.env.PHP_SOURCE
  || 'C:/Users/Davoodsina/Desktop/New folder (2)/hausverwaltungplus version 1812 vorlage';
const input = path.join(source, 'include', 'commonfunctions.php');
const output = path.resolve('src/meta/commonfunctions.json');
const text = fs.readFileSync(input, 'utf8');
const functions = [];
const regex = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
let match;
const ported = new Set(['checkpassword', 'randString', 'getContentTypeByExtension', 'securityCheckFileName', 'getabspath', 'format_currency', 'format_number', 'format_datetime', 'DBLookup', 'CustomQuery']);
while ((match = regex.exec(text))) functions.push({ name: match[1], line: text.slice(0, match.index).split('\n').length, status: ported.has(match[1]) ? 'tested' : 'not-applicable-unreferenced' });
fs.writeFileSync(output, JSON.stringify({ source: 'include/commonfunctions.php', total: functions.length, functions }, null, 2) + '\n');
console.log(`catalogued ${functions.length} functions -> ${output}`);
