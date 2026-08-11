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
  get xlsx() {
    return {
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
