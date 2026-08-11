function unfold(text) { return String(text || '').replace(/\r?\n[ \t]/g, ''); }
function value(lines, prefix) {
  const line = lines.find((entry) => entry.toUpperCase().startsWith(prefix.toUpperCase()));
  return line ? line.slice(line.indexOf(':') + 1).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';') : '';
}

export function parseVcards(text) {
  return unfold(text).split(/BEGIN:VCARD/i).slice(1).map((block) => {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const n = value(lines, 'N');
    const parts = n.split(';');
    const fn = value(lines, 'FN');
    const adr = value(lines, 'ADR').split(';');
    return {
      Vorname: parts[1] || (fn.split(' ')[0] || ''), Nachname: parts[0] || fn.split(' ').slice(1).join(' '),
      Firma: value(lines, 'ORG'), Stellung: value(lines, 'TITLE'), Email: value(lines, 'EMAIL'),
      Telefon: value(lines, 'TEL'), Website: value(lines, 'URL'), Strasse: adr[2] || '', Ort: adr[3] || '',
      PLZ: adr[5] || '',
    };
  }).filter((row) => Object.values(row).some(Boolean));
}
