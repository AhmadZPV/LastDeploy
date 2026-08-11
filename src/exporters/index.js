/**
 * Phase 4 - export engine.
 *
 * One metadata-driven writer set standing in for the 85 generated
 * *_export.php pages. The German conventions of the source are honoured:
 * dates print d.m.Y, decimals use the comma with a dot thousands separator,
 * booleans print Ja/Nein, and BLOBs are summarised as [n bytes] rather than
 * dumped into a spreadsheet cell.
 *
 * csv and xml are dependency-free so the unit tests run offline; excel, word
 * and pdf load their libraries lazily so the module imports cleanly even
 * before `npm install` has run.
 */

/** German d.m.Y date. */
function fmtDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const de2 = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/**
 * One exported cell, the way the PHP pages printed it.
 * Whole numbers pass through untouched (a count is "42", not "42,00");
 * only true decimals get the two-place German rendering.
 */
export function formatCell(value, field) {
  if (value === null || value === undefined) return '';
  if (Buffer.isBuffer(value)) return `[${value.length} bytes]`;
  if (value instanceof Date) return fmtDate(value);
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : de2.format(value);
  }
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    return formatCell(value.toNumber(), field);
  }
  return String(value);
}

function sendHeaders(res, contentType, fileName) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDisposition(fileName));
}

/** RFC 5987 disposition, so umlaut file names survive the download. */
export function contentDisposition(fileName, { inline = false } = {}) {
  const name = String(fileName || 'export');
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const enc = encodeURIComponent(name);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${enc}`;
}

// ------------------------------------------------------------------ CSV

/**
 * CSV with the UTF-8 BOM Excel needs and the entity's own delimiter
 * (`;` by default, matching the German Excel the source targeted).
 * Values are quoted only when they contain the delimiter, a quote or a
 * line break — never because of an innocent letter like Q (regression:
 * the old /\Q/ pattern matched the letter Q, quoting "Quelle GmbH").
 */
export function exportCsv(res, table, options = {}) {
  const delimiter = options.delimiter || ';';
  const esc = (v) => {
    const s = String(v ?? '');
    return s.includes(delimiter) || /["\n\r]/.test(s)
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  const lines = [table.headers.map((h) => esc(h.label)).join(delimiter)];
  for (const row of table.rows) {
    lines.push(table.headers.map((h) => esc(row[h.key])).join(delimiter));
  }
  sendHeaders(res, 'text/csv; charset=utf-8', `${table.title}.csv`);
  res.write(Buffer.from([0xef, 0xbb, 0xbf])); // BOM: Excel detects UTF-8
  res.end(lines.join('\r\n'));
}

// ------------------------------------------------------------------ XML

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlName(key) {
  const clean = String(key).replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(clean) ? clean : 'F_' + clean;
}

/** Well-formed XML: every value escapes markup, always. */
export function exportXml(res, table, options = {}) {
  const root = xmlName(table.title || 'Export');
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>`, `<${root}>`];
  for (const row of table.rows) {
    lines.push('  <row>');
    for (const h of table.headers) {
      lines.push(`    <${xmlName(h.key)}>${xmlEscape(row[h.key])}</${xmlName(h.key)}>`);
    }
    lines.push('  </row>');
  }
  lines.push(`</${root}>`);
  sendHeaders(res, 'application/xml; charset=utf-8', `${table.title}.xml`);
  res.end(lines.join('\n'));
}

// ------------------------------------------------------------------ Excel

/** Excel via exceljs: frozen header row + autofilter, like the PHPExcel output. */
export async function exportExcel(res, table, options = {}) {
  const module = await import('exceljs');
  const Workbook = module.Workbook || module.default?.Workbook;
  const wb = new Workbook();
  const ws = wb.addWorksheet(String(table.title || 'Export').slice(0, 31));
  ws.columns = table.headers.map((h) => ({ header: h.label, key: h.key, width: 22 }));
  for (const row of table.rows) ws.addRow(row);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(1, table.headers.length) },
  };
  sendHeaders(
    res,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    `${table.title}.xlsx`,
  );
  const buf = await wb.xlsx.writeBuffer();
  res.end(Buffer.from(buf));
}

// ------------------------------------------------------------------ Word

/** Word export the way PHPRunner did it: an HTML table saved as .doc. */
export function exportWord(res, table, options = {}) {
  const esc = xmlEscape;
  const parts = [
    '<html xmlns:w="urn:schemas-microsoft-com:office:word"><head>',
    '<meta charset="utf-8"></head><body>',
    `<h1>${esc(table.title)}</h1>`,
    '<table border="1" cellspacing="0" cellpadding="3"><thead><tr>',
    ...table.headers.map((h) => `<th>${esc(h.label)}</th>`),
    '</tr></thead><tbody>',
  ];
  for (const row of table.rows) {
    parts.push('<tr>' + table.headers.map((h) => `<td>${esc(row[h.key])}</td>`).join('') + '</tr>');
  }
  parts.push('</tbody></table></body></html>');
  sendHeaders(res, 'application/msword; charset=utf-8', `${table.title}.doc`);
  res.end(parts.join(''));
}

// ------------------------------------------------------------------ PDF

/** Server-side PDF via pdfkit (the DOMPDF/buildpdf.php replacement). */
export async function exportPdf(res, table, options = {}) {
  const { default: PDFDocument } = await import('pdfkit');
  const landscape = options.orientation !== 'portrait';
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margin: 40 });
  sendHeaders(res, 'application/pdf', `${table.title}.pdf`);
  const chunks = [];
  doc.on('data', (c) => chunks.push(Buffer.from(c)));
  const done = new Promise((resolve) => doc.on('end', resolve));
  doc.fontSize(14).text(String(table.title || ''), { underline: true });
  doc.moveDown();
  doc.fontSize(8);
  doc.text(table.headers.map((h) => h.label).join(' | '));
  doc.moveDown(0.5);
  for (const row of table.rows) {
    doc.text(table.headers.map((h) => String(row[h.key] ?? '')).join(' | '));
  }
  doc.end();
  await done;
  res.end(Buffer.concat(chunks));
}

/** format -> writer. Every declared export format of the source has one. */
export const FORMATS = {
  csv: exportCsv,
  excel: exportExcel,
  word: exportWord,
  xml: exportXml,
  pdf: exportPdf,
};

export default { FORMATS, formatCell, exportCsv, exportXml, exportExcel, exportWord, exportPdf };
