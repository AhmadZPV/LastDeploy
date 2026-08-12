/**
 * exceljs stub for the offline test runner.
 * Builds a real zip container (stored entries, correct local headers +
 * central directory + EOCD) holding the worksheet XML, so tests can assert
 * the xlsx magic bytes and the presence of labels without the dependency.
 */

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function xmlEscape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

class Worksheet {
  constructor(name) {
    this.name = name;
    this.columns = [];
    this.data = [];
  }
  addRow(row) { this.data.push(row); return this; }
  /**
   * Mirrors the real API: row.values is 1-based, so index 0 is a hole.
   */
  eachRow(options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const includeEmpty = options && options.includeEmpty;
    let number = 0;
    for (const entry of this.data) {
      const cells = Array.isArray(entry) ? entry : Object.values(entry);
      number += 1;
      const isEmpty = cells.every((c) => c === undefined || c === null || c === '');
      if (isEmpty && !includeEmpty) continue;
      callback({ values: [null, ...cells], number, getCell: (i) => ({ value: cells[i - 1] }) }, number);
    }
  }
}

/** Reads back the STORED (uncompressed) zip that writeBuffer produces. */
function unzipStore(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const files = new Map();
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const size = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.slice(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    if (method !== 0) throw new Error('exceljs stub: only stored zip entries are supported');
    files.set(name, buf.slice(dataStart, dataStart + size).toString('utf8'));
    offset = dataStart + size;
  }
  return files;
}

function xmlUnescape(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export class Workbook {
  constructor() {
    this.sheets = [];
  }
  addWorksheet(name) {
    const ws = new Worksheet(name);
    this.sheets.push(ws);
    return ws;
  }
  get worksheets() {
    return this.sheets;
  }
  getWorksheet(id) {
    if (id === undefined) return this.sheets[0];
    if (typeof id === 'number') return this.sheets[id - 1];
    return this.sheets.find((s) => s.name === id);
  }
  get xlsx() {
    return {
      load: async (buffer) => {
        const files = unzipStore(buffer);
        this.sheets = [];
        const sheetNames = [...files.keys()].filter((n) => /^xl\/worksheets\/.+\.xml$/.test(n));
        for (const name of sheetNames.length ? sheetNames : []) {
          const xml = files.get(name);
          const sheet = new Worksheet(name.replace(/^.*\/(.*)\.xml$/, '$1'));
          const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
          let rowMatch;
          while ((rowMatch = rowRe.exec(xml)) !== null) {
            const cells = [];
            const cellRe = /<c[^>]*>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g;
            let cellMatch;
            while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
              cells.push(cellMatch[1] === undefined ? '' : xmlUnescape(cellMatch[1]));
            }
            sheet.addRow(cells);
          }
          this.sheets.push(sheet);
        }
        return this;
      },
      readFile: async (path) => {
        const { readFileSync } = await import('node:fs');
        return this.xlsx.load(readFileSync(path));
      },
      writeBuffer: async () => {
        const sheet = this.sheets[0] || new Worksheet('Sheet1');
        const rows = [];
        if (sheet.columns.length) {
          rows.push('<row>' + sheet.columns.map((c) => `<c t="s"><v>${xmlEscape(c.header)}</v></c>`).join('') + '</row>');
        }
        for (const data of sheet.data) {
          const cells = (sheet.columns.length ? sheet.columns.map((c) => data[c.key]) : Object.values(data))
            .map((v) => `<c><v>${xmlEscape(v)}</v></c>`).join('');
          rows.push('<row>' + cells + '</row>');
        }
        const sheetXml = '<?xml version="1.0" encoding="UTF-8"?>'
          + `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;
        return zipStore([
          ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'],
          ['xl/worksheets/sheet1.xml', sheetXml],
        ]);
      },
    };
  }
}

export default { Workbook };
