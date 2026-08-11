/**
 * pdfkit stub for the offline test runner.
 * Emits a minimal but valid single-page PDF containing every text() call, so
 * tests can assert %PDF magic bytes and German text presence without the
 * real dependency.
 */
import { EventEmitter } from 'node:events';

function escapePdfText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

class PDFDocument extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.fontSizeValue = 12;
    this.parts = [];
    this.y = 60;
  }
  fontSize(n) { this.fontSizeValue = n; return this; }
  text(str) {
    this.parts.push(`BT /F1 ${this.fontSizeValue} Tf 40 ${this.y} Td (${escapePdfText(str)}) Tj ET`);
    this.y += this.fontSizeValue + 6;
    return this;
  }
  moveDown(n = 1) { this.y += this.fontSizeValue * n; return this; }
  end() {
    const stream = this.parts.join('\n');
    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
    const layout = this.options.layout === 'landscape' ? [842, 595] : [595, 842];
    objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${layout[0]} ${layout[1]}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`;
    objects[4] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

    let pdf = '%PDF-1.4\n';
    const offsets = [];
    for (let i = 1; i <= 5; i++) {
      offsets.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefPos = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 6\n0000000000 65535 f \n`;
    for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n';
    pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

    const buf = Buffer.from(pdf, 'latin1');
    process.nextTick(() => {
      this.emit('data', buf);
      this.emit('end');
    });
  }
}

export default PDFDocument;
