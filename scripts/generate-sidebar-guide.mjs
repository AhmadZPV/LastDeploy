import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { loadCatalogue } from '../src/menu.js';
import { createTranslator } from '../src/i18n.js';
import { loadMeta } from '../src/meta-store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'Erwin-Property-Mgmt-Sidebar-Guide.pdf');
const { items } = loadCatalogue();
const tx = createTranslator('en').tx;
const nodes = items.filter((item) => item.menu !== 'adminarea' && item.type !== 'Separator');
const byParent = new Map();
for (const item of nodes) {
  const parent = String(item.parent || '0');
  if (!byParent.has(parent)) byParent.set(parent, []);
  byParent.get(parent).push(item);
}

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 54, bottom: 54, left: 54, right: 54 },
  bufferPages: true,
  info: {
    Title: 'Erwin Property Mgmt - Sidebar and Module Guide',
    Author: 'Erwin Property Mgmt',
    Subject: 'Professional operating guide for all sidebar modules',
  },
});
const stream = fs.createWriteStream(output);
doc.pipe(stream);
const width = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;

function ensure(height = 42) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function h1(text) {
  ensure(58);
  doc.fillColor('#122530').font('Helvetica-Bold').fontSize(20).text(text, { width: width() });
  doc.moveDown(.35);
}

function h2(text) {
  ensure(54);
  doc.moveDown(.35);
  doc.fillColor('#086f83').font('Helvetica-Bold').fontSize(14).text(text, { width: width() });
  doc.moveDown(.35);
}

function h3(text) {
  ensure(42);
  doc.fillColor('#243c48').font('Helvetica-Bold').fontSize(11.5).text(text, { width: width() });
  doc.moveDown(.25);
}

function p(text, options = {}) {
  const fontSize = options.fontSize || 9.2;
  const height = doc.heightOfString(text, { width: width(), fontSize, lineGap: 2 });
  ensure(height + 10);
  doc.fillColor(options.color || '#344b57').font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(fontSize).text(text, { width: width(), lineGap: 3, paragraphGap: 8 });
}

function label(name, value) {
  ensure(18);
  doc.fillColor('#667b84').font('Helvetica-Bold').fontSize(8.5).text(`${name}: `, { continued: true });
  doc.fillColor('#243c48').font('Helvetica').text(String(value || '-'));
}

function pagePurpose(item) {
  const purposes = {
    List: 'Inspect, search and manage operational records in a structured list.',
    Report: 'Produce a controlled business report for review, reconciliation or delivery.',
    Chart: 'Reveal trends and distributions that are difficult to identify in row-level data.',
    Dashboard: 'Combine related indicators and work queues into one decision-making workspace.',
    Add: 'Capture a focused transaction or request without exposing the full underlying table.',
    Edit: 'Maintain a dedicated configuration or import record through a focused workflow.',
    AdminArea: 'Manage security identities, memberships and authorization rules.',
  };
  return purposes[item.pageType] || 'Open the corresponding business workflow.';
}

function domainFor(item, ancestors) {
  const text = [...ancestors, item.title, item.table].join(' ').toLowerCase();
  if (/buch|konto|datev|saldo|bank|einnah|kosten|steuer|finanz/.test(text)) return 'Accounting and financial control';
  if (/abrechnung|heiz|umlage|vorauszahlung/.test(text)) return 'Settlement and cost allocation';
  if (/objekt|einheit|raum|flae|gebäude|mieter|eigent/.test(text)) return 'Property, unit and occupancy management';
  if (/inventar|ausleih|hersteller|kategor/.test(text)) return 'Inventory and asset control';
  if (/adresse|kontakt|telefon|klassifikation/.test(text)) return 'Contact and stakeholder management';
  if (/dokument|foto|bild|brief|korrespondenz|mail/.test(text)) return 'Documents and communications';
  if (/termin|kalender|aufgabe|notiz|wiedervorlage/.test(text)) return 'Work planning and follow-up';
  if (/admin|benutzer|gruppe|recht|einstellung|werteliste/.test(text)) return 'Configuration and governance';
  return 'Operational support';
}

function reasonFor(item, domain) {
  const typeReason = {
    List: 'A shared list creates one authoritative operational record and avoids fragmented spreadsheets or duplicate local files.',
    Report: 'A repeatable report provides consistent totals, grouping and presentation for internal control and external communication.',
    Chart: 'Visual aggregation supports faster comparison, exception detection and management decisions.',
    Dashboard: 'A dashboard reduces navigation time by placing related work and indicators in one context.',
    Add: 'A dedicated entry screen reduces mistakes by presenting only the fields required for this transaction.',
    Edit: 'A dedicated maintenance screen protects configuration data from unrelated changes.',
    AdminArea: 'Central administration is required for least-privilege access and traceable responsibility.',
  };
  return `${typeReason[item.pageType] || 'This module centralizes a repeatable business process.'} Its business domain is ${domain.toLowerCase()}.`;
}

function usageFor(item) {
  const actions = {
    List: 'Open the module, use quick or advanced search, inspect a record, then create or edit entries only when your role permits it.',
    Report: 'Open the report, apply the required scope or filters, verify totals and context, then print or export the approved result.',
    Chart: 'Open the chart, confirm its reporting scope and use the values as an analytical signal; verify material decisions against source records.',
    Dashboard: 'Review alerts and indicators first, then follow links into the underlying records to complete the work.',
    Add: 'Complete the visible required fields, attach supporting material where applicable and submit once the information has been verified.',
    Edit: 'Open the page, review the current configuration, change only the intended fields and save the result.',
    AdminArea: 'Limit use to administrators; verify the target user or group before changing permissions or membership.',
  };
  return actions[item.pageType] || 'Open the page and follow the available actions according to your assigned role.';
}

function accessFor(item) {
  if (item.external) return 'External link; availability and access are controlled by the destination service.';
  if (item.menu === 'adminarea' || item.pageType === 'AdminArea') return 'Administrator only.';
  if (item.pageType === 'Add') return 'Requires Add permission on the underlying data source.';
  if (item.pageType === 'Edit') return 'Requires Edit permission on the underlying data source.';
  return 'Requires signed-in access and Read permission; additional actions require their corresponding access-mask letters.';
}

function moduleBlock(item, ancestors) {
  const meta = item.slug ? loadMeta(item.slug) : null;
  const domain = domainFor(item, ancestors);
  // Keep the heading and most of its explanation together. This avoids dense
  // orphan headings and gives each module a clear visual start.
  ensure(225);
  if (doc.y > doc.page.margins.top + 20) {
    doc.moveDown(.55);
    doc.strokeColor('#d8e3e7').lineWidth(.6)
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + width(), doc.y).stroke();
    doc.moveDown(.7);
  }
  h3(`${tx(item.title)}  [${item.title}]`);
  label('Navigation path', [...ancestors.map(tx), tx(item.title)].join(' > '));
  label('Application route', item.href || 'No direct route');
  label('Page type', item.pageType || 'Unspecified');
  label('Business domain', domain);
  label('Data source', meta?.baseTable || item.table || (item.external ? 'External service' : 'No table'));
  p(`Purpose: ${pagePurpose(item)}`);
  p(`How to use it: ${usageFor(item)}`);
  p(`Why it exists: ${reasonFor(item, domain)}`);
  p(`Access and control: ${accessFor(item)}`);
  doc.moveDown(.8);
}

function renderTree(parentId = '0', ancestors = [], depth = 0) {
  for (const item of byParent.get(String(parentId)) || []) {
    if (item.type === 'Group') {
      const translated = tx(item.title);
      if (depth === 0) h2(`${translated}  [${item.title}]`);
      else h3(`${translated}  [${item.title}]`);
      p(`This section groups related ${domainFor(item, ancestors).toLowerCase()} workflows so users can move from data entry to analysis and configuration in a predictable order.`, { color: '#667b84' });
      doc.moveDown(.5);
      renderTree(item.id, [...ancestors, item.title], depth + 1);
    } else {
      moduleBlock(item, ancestors);
    }
  }
}

h1('Erwin Property Mgmt');
doc.fillColor('#086f83').font('Helvetica-Bold').fontSize(15)
  .text('Professional Sidebar and Module Guide', { width: width() });
doc.moveDown(.6);
p('This guide explains every operational entry exposed by the application sidebar. It describes what each module does, how it should be used, why it exists in a professional property-management workflow, which data source it represents and which access controls apply. German labels are retained in brackets to make each documented item easy to match with a German-language installation.');
label('Application', 'Erwin Property Mgmt');
label('Document scope', `${nodes.filter((item) => item.type === 'Group').length} navigation groups and ${nodes.filter((item) => item.type === 'Leaf').length} operational entries`);
label('Generated from', 'src/meta/menu.json and entity metadata');
label('Application URL', 'http://localhost:3000');

h2('How to Read the Sidebar');
p('The sidebar is organized by business domain. Most domains follow a consistent sequence: data entry (Erfassung), analysis and reporting (Auswertung), and configuration (Einstellungen). List pages maintain source records; reports provide repeatable business outputs; charts provide analytical summaries; dashboards combine related work; focused Add/Edit pages simplify a specific transaction.');
p('Visibility does not imply permission to change data. The application evaluates the signed-in user, group access mask and Team scope. Read, Add, Edit, Delete, Export, Print and Import capabilities are checked independently. Administrators should assign only the permissions needed for each role.');

h2('Recommended Operating Discipline');
p('Create and maintain master data before posting dependent transactions. Verify identifiers, dates, amounts, allocation keys and Team ownership before saving. Use list searches to confirm that a record does not already exist. Treat charts as analytical summaries and reconcile important decisions against source lists or reports. Export only data that the recipient is authorized to receive.');

doc.addPage();
h1('Sidebar Reference');
renderTree();

doc.addPage();
h1('Governance and Support Notes');
h2('Permissions');
p('A module may be visible while a specific action remains unavailable. This is intentional: access masks separate reading from adding, editing, deleting, exporting, printing and importing. When a user cannot complete a task, administrators should review the user group and table rights rather than sharing a more privileged account.');
h2('Team Scope');
p('Operational records are commonly restricted by Team. Users normally work only with records assigned to their Team, while administrators may have cross-Team visibility. Team ownership should be reviewed whenever staff responsibilities change.');
h2('Data Quality');
p('Reports and charts inherit the quality of their source records. Consistent dates, classifications, account assignments, property links, contact links and status values are essential. Correct master data first instead of compensating for errors in a report or export.');
h2('Issue Reporting');
p('When reporting a problem, include the sidebar path, route URL, user role, expected result, actual result and timestamp. Do not include passwords, session cookies, private documents or API credentials. A screenshot is useful when it does not expose confidential information.');

const finished = new Promise((resolve, reject) => {
  stream.on('finish', resolve);
  stream.on('error', reject);
});
doc.end();
await finished;
console.log(output);
