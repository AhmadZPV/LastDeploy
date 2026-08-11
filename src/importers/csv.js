export function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(cell); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows.shift().map((h) => String(h).trim());
  return { headers, rows: rows.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])) ) };
}

export function detectDelimiter(text) {
  const first = String(text || '').split(/\r?\n/, 1)[0] || '';
  return (first.split(';').length > first.split(',').length) ? ';' : ',';
}

export async function parseXlsx(buffer) {
  const module = await import('exceljs');
  const Workbook = module.Workbook || module.default?.Workbook;
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const values = [];
  sheet.eachRow({ includeEmpty: false }, (row) => values.push(row.values.slice(1).map((value) => value instanceof Date ? value.toISOString() : String(value ?? ''))));
  if (!values.length) return { headers: [], rows: [] };
  const headers = values.shift();
  return { headers, rows: values.map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? '']))) };
}
