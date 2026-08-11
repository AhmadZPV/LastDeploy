import cron from 'node-cron';

export async function runAutoBookings(prisma, today = new Date()) {
  const iso = today.toISOString().slice(0, 10);
  const due = await prisma.kontobuch.findMany({ where: { Wiederholung: 1 } });
  let created = 0;
  const execute = async (db) => {
    for (const row of due) {
      if (row.Wiederholende && String(row.Wiederholende).slice(0, 10) <= iso) continue;
      const max = await db.kontobuch.aggregate({ _max: { Belegnummer: true }, where: { Team: row.Team } });
      const { ID, ...rest } = row;
      await db.kontobuch.create({ data: {
        ...rest, Datum: new Date(iso), Belegnummer: (max?._max?.Belegnummer || 0) + 1, Wiederholung: 0,
      } });
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
