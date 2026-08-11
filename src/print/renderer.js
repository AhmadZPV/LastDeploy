/**
 * Phase 5 - print renderer.
 *
 * Replaces the 80 generated *_print.php pages and buildpdf.php's print HTML.
 * The per-page printer settings of the source are honoured:
 *   printerPageOrientation   portrait | landscape
 *   nPrinterPageScale        zoom factor
 *   nPrinterSplitRecords     page break after N records (HTML print)
 *   nPrinterPDFSplitRecords  same for the PDF variant
 *
 * All cell content is escaped at render time — print output is HTML and a
 * Bemerkung containing markup must never become markup.
 */
import { fieldLabel } from '../meta-store.js';
import { formatCell } from '../exporters/index.js';

/** Split a row list into pages of n; 0 or a bad value means one single page. */
export function paginate(rows, perPage) {
  const list = Array.isArray(rows) ? rows : [];
  const n = Number(perPage);
  if (!Number.isFinite(n) || n <= 0) return [list];
  const pages = [];
  for (let i = 0; i < list.length; i += n) pages.push(list.slice(i, i + n));
  return pages.length ? pages : [[]];
}

/**
 * The printer settings of an entity, with the source defaults applied.
 * Works with a null manifest so the generic route still prints.
 */
export function printOptions(meta) {
  const p = (meta && meta.print) || {};
  const orientation =
    p.printerPageOrientation === 1 || p.printerPageOrientation === 'portrait'
      ? 'portrait'
      : 'landscape';
  return {
    orientation,
    scale: Number(p.nPrinterPageScale) > 0 ? Number(p.nPrinterPageScale) : 100,
    splitRecords: Number(p.nPrinterSplitRecords) || 0,
    pdfSplitRecords: Number(p.nPrinterPDFSplitRecords) || 0,
  };
}

/**
 * Normalise a print request into { title, headers, rows } where each row is
 * an array of raw cell values aligned with the headers. Formatting happens
 * in renderPrintHtml, not here, so numbers stay sortable/summable until the
 * last moment.
 */
export function buildPrintTable(meta, columns, rows, title) {
  const cols = Array.isArray(columns) ? columns : [];
  const headers = cols.map((c) => ({
    key: c.prismaField,
    label: meta ? fieldLabel(meta, c.meta) : (c.meta && c.meta.name) || c.prismaField,
  }));
  const body = (rows || []).map((row) => cols.map((c) => row[c.prismaField]));
  return { title: title || (meta && meta.entity) || '', headers, rows: body };
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The printable HTML document. Carries an @page rule so the browser's own
 * print dialog honours orientation, repeats the header on every split page,
 * and escapes every cell.
 */
export function renderPrintHtml(table, options = {}, extra = {}) {
  const opts = { orientation: 'landscape', scale: 100, splitRecords: 0, ...options };
  const pages = paginate(table.rows, opts.splitRecords);

  const headerRow = table.headers.map((h) => `<th>${esc(h.label)}</th>`).join('');
  const pageHtml = pages.map((pageRows) => {
    const bodyRows = pageRows
      .map((cells) =>
        '<tr>' + cells.map((c) => `<td>${esc(formatCell(c))}</td>`).join('') + '</tr>')
      .join('\n');
    return `<table class="print-page"><thead><tr>${headerRow}</tr></thead>\n<tbody>\n${bodyRows}\n</tbody></table>`;
  }).join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="de"><head>',
    '<meta charset="utf-8">',
    `<title>${esc(table.title)}</title>`,
    '<style>',
    `@page { size: A4 ${opts.orientation}; margin: 12mm; }`,
    `body { font-family: Arial, sans-serif; font-size: ${opts.scale}%; }`,
    'table.print-page { border-collapse: collapse; width: 100%; page-break-after: always; }',
    'table.print-page:last-child { page-break-after: auto; }',
    'th, td { border: 1px solid #666; padding: 2px 5px; text-align: left; vertical-align: top; }',
    'th { background: #ddd; }',
    'h1 { font-size: 140%; }',
    '</style>',
    '</head><body>',
    `<h1>${esc(table.title)}</h1>`,
    pageHtml,
    '</body></html>',
  ].join('\n');
}

export default { paginate, printOptions, buildPrintTable, renderPrintHtml };
