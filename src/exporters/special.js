function datevDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}`;
}

export async function datevRows(prisma, where = {}) {
  const rows = await prisma.buchungen.findMany({
    where, orderBy: { Belegnummer: 'desc' },
    include: { rel_Kontenrahmen_Konto: true, rel_Kontenrahmen_Gegenkonto: true },
  });
  return rows.map((row) => ({
    Belegnummer: row.Belegnummer, Betreff: row.Betreff, DATEVDatum: datevDate(row.Datum),
    DATEVBetrag: Math.round(Number(row.Betrag || 0) * 100), Kontonummer: row.Konto,
    Konto: row.rel_Kontenrahmen_Konto?.Kontobezeichnung || '', Gegenkontonummer: row.Gegenkonto,
    Gegenkonto: row.rel_Kontenrahmen_Gegenkonto?.Kontobezeichnung || '',
    DATEVBetragskennzeichen: row.DATEV_Betragskennzeichen || '', DATEVSteuerschluessel: row.DATEV_Steuerschluessel || '',
    DATEVFestschreibekennzeichen: 0,
  }));
}

const addressAliases = {
  'Eindeutiger Bezeichner': 'Kurzname', Firma: 'Firma', Abteilung: 'Abteilung', Vorname: 'Vorname',
  Nachname: 'Nachname', 'Adresse 1': 'Strasse', PLZ: 'PLZ', Ort: 'Ort',
  'Bundesland/Kanton': 'Bundesland', 'Land/Region': 'Staat', 'Telefon Büro': 'Telefon',
  'Telefon (privat)': 'Handy', 'E-Mail-Adresse': 'Email', Webseite: 'Website', 'Fax Büro': 'Telefax',
  Anrede: 'Anrede', Titel: 'Titel', Position: 'Stellung', Kundennummer: 'Kundennummer',
};

export async function addressMailMergeRows(prisma, where = {}) {
  const rows = await prisma.adressen.findMany({ where, orderBy: { Kurzname: 'asc' } });
  return rows.map((row) => Object.fromEntries(Object.entries(addressAliases).map(([header, field]) => [header, row[field] ?? ''])));
}

export async function salesMailMergeRows(prisma, where = {}) {
  const sales = await prisma.verkauf.findMany({
    where, orderBy: { ID: 'asc' },
    include: { rel_Adressen_Kunde: true, rel_Positionen_Verkaufsvorgang: true },
  });
  const out = [];
  for (const sale of sales) for (const position of (sale.rel_Positionen_Verkaufsvorgang.length ? sale.rel_Positionen_Verkaufsvorgang : [{}])) {
    const address = sale.rel_Adressen_Kunde || {};
    const amount = Number(position.Menge || 0) * Number(position.Listenpreis || 0);
    const taxRate = Number(position.Mwst_Satz || 0);
    out.push({
      ID: sale.ID, Anrede: address.Anrede, Strasse_Liefer: address.Strasse_Liefer, PLZ_Liefer: address.PLZ_Liefer,
      Ort_Liefer: address.Ort_Liefer, Staat_Liefer: address.Staat_Liefer, Menge: position.Menge,
      Listenpreis: position.Listenpreis, Leistungscode: position.Leistungscode, Mwst_Satz: position.Mwst_Satz,
      Bemerkungen_Pos: position.Bemerkungen, Netto: Math.round(amount * 100) / 100,
      Brutto: Math.round(amount * (1 + taxRate / 100) * 100) / 100,
      Mwst: Math.round(amount * taxRate) / 100, Datum: sale.Datum,
      Art: sale.Art, Nummer: sale.Nummer, Bezeichnung: position.Bezeichnung, Kunde: sale.Kunde,
      Firma: address.Firma, Abteilung: address.Abteilung, Vorname: address.Vorname,
      Rechnungsdatum: sale.Rechnungsdatum, Nachname: address.Nachname, Einheit: position.Einheit,
      Zahlungsbedingungen: sale.Zahlungsbedingungen, Strasse: address.Strasse, Leistungsdatum: sale.Leistungsdatum,
      PLZ: address.PLZ, Lieferbedingungen: sale.Lieferbedingungen, Ort: address.Ort, Bemerkungen: sale.Bemerkungen,
    });
  }
  return out;
}

export { datevDate, addressAliases };
