import cron from 'node-cron';

/** Calendar day of a DateTime / SQLite text value, in UTC. */
function bookingDay(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Identity of a recurring template vs its posted copy. Belegnummer and ID
 * differ on the copy, so they are excluded; the remaining business fields
 * plus the posting day uniquely identify "this template already ran today".
 */
function recurrenceKey(row) {
  return [
    row.Team ?? '',
    String(row.Betrag ?? ''),
    row.Betreff ?? '',
    row.Kategorie ?? '',
    row.Art ?? '',
    row.Abrechnung ?? '',
    row.Abrechnungskonto ?? '',
  ].join('\0');
}

export async function runAutoBookings(prisma, today = new Date()) {
  const iso = today.toISOString().slice(0, 10);
  const due = await prisma.kontobuch.findMany({ where: { Wiederholung: 1 } });
  let created = 0;
  const execute = async (db) => {
    const posted = await db.kontobuch.findMany({ where: { Wiederholung: 0 } });
    const postedToday = new Set(
      (posted || [])
        .filter((row) => bookingDay(row.Datum) === iso)
        .map(recurrenceKey),
    );
    for (const row of due) {
      if (row.Wiederholende && String(row.Wiederholende).slice(0, 10) <= iso) continue;
      const key = recurrenceKey(row);
      if (postedToday.has(key)) continue;
      const max = await db.kontobuch.aggregate({ _max: { Belegnummer: true }, where: { Team: row.Team } });
      const { ID, ...rest } = row;
      await db.kontobuch.create({ data: {
        ...rest, Datum: new Date(iso), Belegnummer: (max?._max?.Belegnummer || 0) + 1, Wiederholung: 0,
      } });
      postedToday.add(key);
      created += 1;
    }
  };
  if (typeof prisma.$transaction === 'function') await prisma.$transaction(execute);
  else await execute(prisma);
  return created;
}

export function startAutoBookings({ prisma, schedule = '0 2 1 * *' } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_CRON === '1') return null;
  return cron.schedule(schedule, () => runAutoBookings(prisma).catch((error) => {
    console.error('Autobuchungen failed:', error.message);
  }));
}
