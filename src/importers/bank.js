function num(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function importedAmount(row) {
  let amount = num(row.Betrag);
  if (row.Haben != null && row.Haben !== '') amount = Math.abs(num(row.Haben) || 0);
  if (row.Soll != null && row.Soll !== '') amount = Math.abs(num(row.Soll) || 0);
  return Math.abs(amount || 0);
}

function subject(row) {
  return [row.Verwendungszweck1, row.Verwendungszweck2, row.Verwendungszweck3, row.Verwendungszweck4]
    .filter(Boolean).join(' ').trim();
}

async function nextNumber(delegate, team) {
  const max = await delegate.aggregate({ _max: { Belegnummer: true }, where: { Team: team } });
  return (max?._max?.Belegnummer || 0) + 1;
}

export async function applyBankImport({ prisma, entity, row, session, now = new Date() }) {
  const slug = String(entity || '').toLowerCase();
  const team = session?.Team || row.Team || 'Team';
  const user = session?.Benutzername || session?.UserName || '';

  if (slug === 'buchungsimport') {
    const account = async (number) => prisma.kontenrahmen.findFirst({
      where: { Buchfuehrung: String(row.Buchfuehrung ?? ''), Nummer: String(number ?? '') },
      orderBy: { ID: 'desc' },
    });
    const [debit, credit, Belegnummer] = await Promise.all([
      account(row.Konto), account(row.Gegenkonto), nextNumber(prisma.buchungen, team),
    ]);
    return prisma.buchungen.create({ data: {
      Buchfuehrung: num(row.Buchfuehrung), Konto: debit?.ID || null, Gegenkonto: credit?.ID || null,
      Datum: row.Datum instanceof Date ? row.Datum : new Date(row.Datum), Betrag: num(row.Betrag),
      Betreff: row.Betreff || '', Belegnummer, Erfasser: user, Erfassungsdatum: now, Team: team,
    } });
  }

  if (slug === 'kontoauszuege') {
    const key = row.Verwendungszweck1 || '';
    const previous = await prisma.buchungen.findFirst({ where: { Betreff: key, Team: team }, orderBy: { ID: 'desc' } });
    return prisma.buchungen.create({ data: {
      Buchfuehrung: previous?.Buchfuehrung || null, Konto: previous?.Konto || null,
      Gegenkonto: previous?.Gegenkonto || null, Datum: now, Betrag: importedAmount(row),
      Betreff: subject(row), Belegnummer: await nextNumber(prisma.buchungen, team),
      Erfasser: user, Erfassungsdatum: now, Team: team,
    } });
  }

  if (slug === 'kontoauszuege2') {
    const key = row.Verwendungszweck1 || '';
    const previous = await prisma.kontobuch.findFirst({ where: { Betreff: key, Team: team }, orderBy: { ID: 'desc' } });
    return prisma.kontobuch.create({ data: {
      Datum: row.Buchungstag instanceof Date ? row.Buchungstag : new Date(row.Buchungstag || now),
      Betrag: importedAmount(row), Betreff: subject(row), Kategorie: previous?.Kategorie || null,
      Art: previous?.Art || null, Miete: previous?.Miete || null, Nebenkosten: previous?.Nebenkosten || null,
      Heizkosten: previous?.Heizkosten || null, Garagenmiete: previous?.Garagenmiete || null,
      Abrechnung: previous?.Abrechnung || null, Abrechnungskonto: previous?.Abrechnungskonto || null,
      Ruecklage: previous?.Ruecklage || null, P35aArt: previous?.P35aArt || null, P35a: previous?.P35a || null,
      Erfassungsdatum: now, Belegnummer: await nextNumber(prisma.kontobuch, team), Team: team,
    } });
  }
  return null;
}

export { importedAmount, subject };
