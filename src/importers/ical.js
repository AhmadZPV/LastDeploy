function unfold(text) { return String(text || '').replace(/\r?\n[ \t]/g, ''); }
function field(lines, name) {
  const line = lines.find((entry) => entry.toUpperCase().startsWith(name.toUpperCase()));
  return line ? line.slice(line.indexOf(':') + 1).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';') : '';
}
function parseDate(value) {
  const m = String(value || '').match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
}

export function parseIcal(text) {
  return unfold(text).split(/BEGIN:VEVENT/i).slice(1).map((block) => {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const start = parseDate(field(lines, 'DTSTART'));
    const end = parseDate(field(lines, 'DTEND'));
    return {
      Titel: field(lines, 'SUMMARY'), Bemerkungen: field(lines, 'DESCRIPTION'), Termin: start,
      Dauer: start && end ? Math.max(0, Math.round((end - start) / 60000)) : 0,
    };
  }).filter((row) => row.Titel || row.Termin);
}
