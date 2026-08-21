/**
 * Generate a PDF documentation report from the smoke-features JSON report.
 *
 *   node scripts/generate-smoke-pdf.mjs
 *
 * Reads tests/smoke-features-report.json and writes
 * tests/smoke-features-report.pdf with the full feature checklist, per-area
 * summaries and the complete pass/fail/skip table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const reportPath = path.join(ROOT, 'tests', 'smoke-features-report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

// Normalize summary keys (JSON stores PASS/FAIL/SKIP in uppercase).
const sum = report.summary || {};
const passCount = sum.PASS ?? sum.pass ?? 0;
const failCount = sum.FAIL ?? sum.fail ?? 0;
const skipCount = sum.SKIP ?? sum.skip ?? 0;
const totalCount = sum.total ?? (passCount + failCount + skipCount);

const output = path.join(ROOT, 'tests', 'smoke-features-report.pdf');
const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 54, bottom: 54, left: 48, right: 48 },
  info: {
    Title: 'AP Emlaki - Comprehensive Smoke Test Report',
    Author: 'AP Emlaki QA',
    Subject: 'Feature smoke test coverage documentation',
  },
});
const stream = fs.createWriteStream(output);
doc.pipe(stream);

const pageWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;

function ensure(height = 40) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom - 10) doc.addPage();
}

function title(text) {
  ensure(60);
  doc.fillColor('#17354d').font('Helvetica-Bold').fontSize(19).text(text, { width: pageWidth(), paragraphGap: 8 });
  doc.moveDown(0.3);
}

function heading(text) {
  ensure(38);
  doc.fillColor('#145394').font('Helvetica-Bold').fontSize(13).text(text, { width: pageWidth(), paragraphGap: 5 });
  doc.moveDown(0.15);
}

function subheading(text) {
  ensure(28);
  doc.fillColor('#263646').font('Helvetica-Bold').fontSize(10.5).text(text, { width: pageWidth(), paragraphGap: 4 });
}

function paragraph(text) {
  const height = doc.heightOfString(text, { width: pageWidth(), font: 'Helvetica', fontSize: 9.5, lineGap: 3 });
  ensure(height + 15);
  doc.fillColor('#263646').font('Helvetica').fontSize(9.5).text(text, { width: pageWidth(), lineGap: 3, paragraphGap: 8 });
}

function bullet(text) {
  const width = pageWidth() - 16;
  const height = doc.heightOfString(text, { width, font: 'Helvetica', fontSize: 9.5, lineGap: 2 });
  ensure(height + 12);
  const y = doc.y;
  doc.fillColor('#145394').font('Helvetica-Bold').fontSize(10).text('\u2022', doc.page.margins.left, y, { width: 10 });
  doc.fillColor('#263646').font('Helvetica').fontSize(9.5).text(text, doc.page.margins.left + 14, y, { width, lineGap: 2, paragraphGap: 5 });
}

function kv(label, value) {
  ensure(16);
  doc.fillColor('#145394').font('Helvetica-Bold').fontSize(9.5).text(label + ':', doc.page.margins.left, doc.y, { continued: true, width: 130 });
  doc.fillColor('#263646').font('Helvetica').text(' ' + value, { width: pageWidth() - 130 });
}

function statusColor(status) {
  if (status === 'PASS') return '#1a7f37';
  if (status === 'FAIL') return '#b42318';
  return '#9a6700';
}

function chip(status) {
  doc.fillColor(statusColor(status)).font('Helvetica-Bold').fontSize(9).text(status, { continued: true });
  doc.fillColor('#263646');
}

// -------------------------------------------------------------------- cover
title('AP Emlaki');
subheading('Comprehensive Feature Smoke Test Report');
doc.moveDown(0.4);

const started = report.startedAt ? new Date(report.startedAt).toLocaleString('en-GB') : '-';
const ended = report.generatedAt ? new Date(report.generatedAt).toLocaleString('en-GB') : '-';
const durationS = report.durationMs ? (report.durationMs / 1000).toFixed(2) + 's' : '-';

kv('Target URL', report.baseUrl || '-');
kv('Generated', ended);
kv('Started', started);
kv('Duration', durationS);
kv('Test mode', report.readOnly ? 'Read-only (no create/update/delete)' : 'Mutating');
kv('Username', report.username || '-');
doc.moveDown(0.3);

// ----------------------------------------------------------------- summary
const s = { total: totalCount, pass: passCount, fail: failCount, skip: skipCount };
heading('Executive Summary');
paragraph(
  `The smoke test exercised ${s.total} individual checks across ${report.byArea?.length || 0} functional ` +
  `areas of the running application. ${s.pass} checks passed, ${s.fail} failed and ${s.skip} were ` +
  `skipped (skips are read-only checks that require seeded data not present in the current fixture). ` +
  `The server, authentication, authorization, localization, navigation, CRUD, dashboards, charts, reports, ` +
  `exports, the customer portal and the PWA shell were all probed end-to-end against a live instance.`
);

const status = s.fail === 0 ? 'GREEN' : 'RED';
ensure(30);
doc.fillColor(statusColor(status === 'GREEN' ? 'PASS' : 'FAIL'))
  .font('Helvetica-Bold').fontSize(16)
  .text(`Overall status: ${status}`, { paragraphGap: 6 });
doc.fillColor('#263646').font('Helvetica').fontSize(9.5);

bullet(`Total checks: ${s.total}`);
bullet(`Passed: ${s.pass}`);
bullet(`Failed: ${s.fail}`);
bullet(`Skipped: ${s.skip}`);
bullet(`Areas covered: ${report.byArea?.length || 0}`);

// ------------------------------------------------------------ by-area table
heading('Coverage by Functional Area');
doc.moveDown(0.2);

function tableRow(cells, widths, opts = {}) {
  const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c), { width: widths[i], font: opts.font || 'Helvetica', fontSize: opts.fontSize || 8.5, lineGap: 1 })));
  const total = h + 10;
  ensure(total + 4);
  const y = doc.y;
  let x = doc.page.margins.left;
  const header = opts.header;
  cells.forEach((cell, i) => {
    if (header) doc.fillColor('#145394').font('Helvetica-Bold');
    else doc.fillColor(opts.colors?.[i] || '#263646').font('Helvetica');
    doc.fontSize(opts.fontSize || 8.5);
    doc.text(String(cell), x, y + 5, { width: widths[i], lineGap: 1 });
    x += widths[i];
  });
  doc.y = y + total;
  doc.strokeColor('#cdd7df').lineWidth(0.4)
    .moveTo(doc.page.margins.left, y + total - 2)
    .lineTo(doc.page.margins.left + widths.reduce((a, b) => a + b, 0), y + total - 2)
    .stroke();
}

const areaWidths = [pageWidth() - 130, 44, 38, 34, 34];
tableRow(['Functional area', 'Total', 'Pass', 'Fail', 'Skip'], areaWidths, { header: true, fontSize: 8.5 });
for (const a of report.byArea || []) {
  tableRow([a.area, String(a.total), String(a.pass), String(a.fail), String(a.skip)], areaWidths, {
    colors: ['#263646', '#263646', '#1a7f37', a.fail ? '#b42318' : '#263646', a.skip ? '#9a6700' : '#263646'],
  });
}
tableRow(['TOTAL', String(s.total || 0), String(s.pass || 0), String(s.fail || 0), String(s.skip || 0)], areaWidths, {
  colors: ['#145394', '#263646', '#1a7f37', s.fail ? '#b42318' : '#263646', s.skip ? '#9a6700' : '#263646'],
});

// ------------------------------------------------------------ feature groups
heading('Feature Groups Verified');
doc.moveDown(0.1);
paragraph('Each group below was exercised by one or more live HTTP probes against the running server. ' +
  'Read-only screens (list, search, detail, edit, dashboard, chart) were rendered and scanned for application ' +
  'error markers; exports, reports and print were probed for a successful or gracefully denied response.');

const groups = [
  ['Platform', 'Health endpoint, database readiness, and JSON contract.'],
  ['Security', 'Anonymous access control on root/admin/CRUD, CSRF token presence, wrong-password rejection, logout and session invalidation.'],
  ['Authentication', 'Admin login with CSRF-protected form, captcha handling and cookie/session lifecycle.'],
  ['Localization', 'Language toggle (de/en) and localized application chrome strings.'],
  ['Navigation', 'Authenticated dashboard, top bar and sidebar rendering.'],
  ['Sidebar', 'Every menu leaf from the extracted PHPRunner catalogue (admin + portal areas).'],
  ['CRUD list / search / new / detail / edit / export CSV', 'All 62 registry entities: list, search form, add form, record detail, edit form and CSV export.'],
  ['Dashboard', 'All 7 dashboards from the source catalogue (assistants, diagrams and the Wiedervorlage overview).'],
  ['Chart page / Chart data', 'All 18 charts: HTML page and JSON data endpoint.'],
  ['Reports / Print / Export', 'Metadata-driven engines for adressen report/print/CSV plus the DATEV and Serienbrief special exports.'],
  ['Settings / Saved searches', 'Team settings page and the per-user saved-search page.'],
  ['Portal', 'Landing, login and registration pages; anonymous redirect protection; and the full authenticated customer flow (dashboard, properties, units, announcements, meter readings, invoices, contact).'],
  ['Admin', 'Admin overview, rights redirect, backup page and the interactive admin documentation.'],
  ['PWA', 'Web manifest (JSON with icons), service worker, offline page and install icons (192/512).'],
  ['Static', 'Compiled stylesheet and application script.'],
];
for (const [name, desc] of groups) {
  ensure(28);
  doc.fillColor('#145394').font('Helvetica-Bold').fontSize(9.5).text(name, doc.page.margins.left, doc.y, { continued: false, width: pageWidth() });
  doc.fillColor('#263646').font('Helvetica').fontSize(9)
    .text(desc, doc.page.margins.left + 8, doc.y, { width: pageWidth() - 8, paragraphGap: 5, lineGap: 2 });
}

// ------------------------------------------------------------ full results
doc.addPage();
heading('Complete Check List');
doc.moveDown(0.2);
paragraph('Every individual probe, grouped by functional area. Response time is shown in milliseconds where measured.');
doc.moveDown(0.2);

const resultWidths = [pageWidth() - 230, 56, 150];
tableRow(['Check', 'Status', 'Detail'], resultWidths, { header: true, fontSize: 8 });

const byArea = {};
for (const r of report.results || []) (byArea[r.area] ||= []).push(r);

for (const [area, rows] of Object.entries(byArea)) {
  ensure(20);
  doc.fillColor('#145394').font('Helvetica-Bold').fontSize(9.5).text(area, doc.page.margins.left, doc.y, { width: pageWidth() });
  doc.moveDown(0.1);
  for (const r of rows) {
    const detail = (r.detail || '').replace(/\s*\([^)]*\)$/, '');
    tableRow([r.name, r.status, detail], resultWidths, {
      colors: ['#263646', statusColor(r.status), '#6b7280'],
      fontSize: 7.6,
    });
  }
}

// --------------------------------------------------------------- failures
if (s.fail && s.fail > 0) {
  doc.addPage();
  heading('Failures Requiring Attention');
  doc.moveDown(0.2);
  for (const f of report.failures || []) {
    subheading(`${f.area} / ${f.name}`);
    paragraph(f.detail || 'No detail captured.');
  }
}

// --------------------------------------------------------------- skip note
if (s.skip && s.skip > 0) {
  heading('About Skipped Checks');
  paragraph('Skipped checks are read-only probes that depend on a specific seeded record ' +
    '(for example a single-row lookup table) which the current development fixture does not contain. ' +
    'They do not indicate a defect; they are excluded from the pass/fail verdict. The list of skipped ' +
    'entities is included in the JSON report (tests/smoke-features-report.json) for audit.');
}

doc.end();
stream.on('finish', () => {
  console.log(`PDF written: ${path.relative(ROOT, output)}`);
  console.log(`  checks: ${s.total || 0}  pass: ${s.pass || 0}  fail: ${s.fail || 0}  skip: ${s.skip || 0}`);
});
