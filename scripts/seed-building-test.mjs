/**
 * Seed test data for the Building (Gebäude) section:
 * Raumarten, Einheitenarten, Raeume (rooms), and Flaechen (area dimensions).
 * This lets you test the full hierarchy: Objekt → Einheit → Raum → Flaechen
 * and the QM (Quadratmeter) area calculation.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const TEAM = 'Team';

// 1. Fix Team on existing Objekte and Einheiten that have null Team
await prisma.objekte.updateMany({ where: { Team: null }, data: { Team: TEAM } }).catch(() => {});
await prisma.einheiten.updateMany({ where: { Team: null }, data: { Team: TEAM } }).catch(() => {});
await prisma.benutzer.updateMany({ where: { Team: null }, data: { Team: TEAM } }).catch(() => {});

// 2. Seed Raumarten (room types) — replace the bad entry
await prisma.raumarten.deleteMany({});
await prisma.raumarten.createMany({ data: [
  { Bezeichnung: 'Wohnzimmer' },
  { Bezeichnung: 'Schlafzimmer' },
  { Bezeichnung: 'Küche' },
  { Bezeichnung: 'Badezimmer' },
  { Bezeichnung: 'Flur' },
  { Bezeichnung: 'Keller' },
  { Bezeichnung: 'Balkon' },
  { Bezeichnung: 'Gäste-WC' },
  { Bezeichnung: 'Lagerraum' },
  { Bezeichnung: 'Garage' },
]});
console.log('✓ Raumarten seeded (10 types)');

// 3. Seed Einheitenarten (unit types)
await prisma.einheitenarten.createMany({ data: [
  { Bezeichnung: 'Wohnung zur Vermietung' },
  { Bezeichnung: 'Wohnung zum Verkauf' },
  { Bezeichnung: 'Gewerbeeinheit zur Vermietung' },
  { Bezeichnung: 'Garage zur Vermietung' },
  { Bezeichnung: 'Büro zur Vermietung' },
]}).catch(() => {});
console.log('✓ Einheitenarten seeded (5 types)');

// 4. Seed Objektarten (property types)
await prisma.objektarten.createMany({ data: [
  { Bezeichnung: 'Wohnhaus' },
  { Bezeichnung: 'Mehrfamilienhaus' },
  { Bezeichnung: 'Gewerbehof' },
  { Bezeichnung: 'Bürohaus' },
]}).catch(() => {});
console.log('✓ Objektarten seeded (4 types)');

// 5. Update existing Einheiten with Einheitenart
await prisma.einheiten.updateMany({ where: { ID: 900001 }, data: { Einheitenart: 'Wohnung zur Vermietung', Zimmer: 3, Kaltmiete: 850, Nebenkosten: 180, Heizkosten: 70 } });
await prisma.einheiten.updateMany({ where: { ID: 900002 }, data: { Einheitenart: 'Wohnung zur Vermietung', Zimmer: 3, Kaltmiete: 920, Nebenkosten: 200, Heizkosten: 80 } });
await prisma.einheiten.updateMany({ where: { ID: 900003 }, data: { Einheitenart: 'Wohnung zur Vermietung', Zimmer: 2, Kaltmiete: 780, Nebenkosten: 160, Heizkosten: 65 } });
await prisma.einheiten.updateMany({ where: { ID: 900004 }, data: { Einheitenart: 'Gewerbeeinheit zur Vermietung', Kaltmiete: 1500, Nebenkosten: 350, Heizkosten: 120 } });
await prisma.einheiten.updateMany({ where: { ID: 900005 }, data: { Einheitenart: 'Büro zur Vermietung', Kaltmiete: 1200, Nebenkosten: 280, Heizkosten: 95 } });
await prisma.einheiten.updateMany({ where: { ID: 900006 }, data: { Einheitenart: 'Wohnung zur Vermietung', Zimmer: 4, Kaltmiete: 1100, Nebenkosten: 240, Heizkosten: 90 } });
await prisma.einheiten.updateMany({ where: { ID: 900007 }, data: { Einheitenart: 'Wohnung zur Vermietung', Zimmer: 3, Kaltmiete: 990, Nebenkosten: 210, Heizkosten: 85 } });
await prisma.einheiten.updateMany({ where: { ID: 900008 }, data: { Einheitenart: 'Garage zur Vermietung', Kaltmiete: 60 } });
console.log('✓ Einheiten updated with types, rent, rooms');

// 6. Get Raumarten IDs for reference
const raumarten = await prisma.raumarten.findMany();
const raumartMap = Object.fromEntries(raumarten.map(r => [r.Bezeichnung, r.ID]));

// 7. Seed Raeume (rooms) for units 900001–900003 (Objekt 900001: Wohnhaus Hauptstraße)
const raeume = [
  // Whg 1 links (Einheit 900001) — 3 Zimmer
  { Einheit: 900001, Objekt: 900001, Bezeichnung: 'Wohnzimmer',  Raumart: 'Wohnzimmer',  Nummer: '1.01', Team: TEAM },
  { Einheit: 900001, Objekt: 900001, Bezeichnung: 'Schlafzimmer', Raumart: 'Schlafzimmer', Nummer: '1.02', Team: TEAM },
  { Einheit: 900001, Objekt: 900001, Bezeichnung: 'Küche',       Raumart: 'Küche',       Nummer: '1.03', Team: TEAM },
  { Einheit: 900001, Objekt: 900001, Bezeichnung: 'Badezimmer',  Raumart: 'Badezimmer',  Nummer: '1.04', Team: TEAM },
  { Einheit: 900001, Objekt: 900001, Bezeichnung: 'Flur',         Raumart: 'Flur',         Nummer: '1.05', Team: TEAM },

  // Whg 1 rechts (Einheit 900002) — 3 Zimmer
  { Einheit: 900002, Objekt: 900001, Bezeichnung: 'Wohnzimmer',  Raumart: 'Wohnzimmer',  Nummer: '2.01', Team: TEAM },
  { Einheit: 900002, Objekt: 900001, Bezeichnung: 'Schlafzimmer', Raumart: 'Schlafzimmer', Nummer: '2.02', Team: TEAM },
  { Einheit: 900002, Objekt: 900001, Bezeichnung: 'Kinderzimmer', Raumart: 'Schlafzimmer', Nummer: '2.03', Team: TEAM },
  { Einheit: 900002, Objekt: 900001, Bezeichnung: 'Küche',       Raumart: 'Küche',       Nummer: '2.04', Team: TEAM },
  { Einheit: 900002, Objekt: 900001, Bezeichnung: 'Badezimmer',  Raumart: 'Badezimmer',  Nummer: '2.05', Team: TEAM },
  { Einheit: 900002, Objekt: 900001, Bezeichnung: 'Balkon',      Raumart: 'Balkon',      Nummer: '2.06', Team: TEAM },

  // Whg 2 OG (Einheit 900003) — 2 Zimmer
  { Einheit: 900003, Objekt: 900001, Bezeichnung: 'Wohnküche',   Raumart: 'Wohnzimmer',  Nummer: '3.01', Team: TEAM },
  { Einheit: 900003, Objekt: 900001, Bezeichnung: 'Schlafzimmer', Raumart: 'Schlafzimmer', Nummer: '3.02', Team: TEAM },
  { Einheit: 900003, Objekt: 900001, Bezeichnung: 'Badezimmer',  Raumart: 'Badezimmer',  Nummer: '3.03', Team: TEAM },

  // Whg Parkweg 1 (Einheit 900006) — 4 Zimmer
  { Einheit: 900006, Objekt: 900003, Bezeichnung: 'Wohnzimmer',  Raumart: 'Wohnzimmer',  Nummer: '1.01', Team: TEAM },
  { Einheit: 900006, Objekt: 900003, Bezeichnung: 'Schlafzimmer', Raumart: 'Schlafzimmer', Nummer: '1.02', Team: TEAM },
  { Einheit: 900006, Objekt: 900003, Bezeichnung: 'Kinderzimmer', Raumart: 'Schlafzimmer', Nummer: '1.03', Team: TEAM },
  { Einheit: 900006, Objekt: 900003, Bezeichnung: 'Küche',       Raumart: 'Küche',       Nummer: '1.04', Team: TEAM },
  { Einheit: 900006, Objekt: 900003, Bezeichnung: 'Badezimmer',  Raumart: 'Badezimmer',  Nummer: '1.05', Team: TEAM },
  { Einheit: 900006, Objekt: 900003, Bezeichnung: 'Gäste-WC',    Raumart: 'Gäste-WC',    Nummer: '1.06', Team: TEAM },
  { Einheit: 900006, Objekt: 900003, Bezeichnung: 'Flur',         Raumart: 'Flur',         Nummer: '1.07', Team: TEAM },
  { Einheit: 900006, Objekt: 900003, Bezeichnung: 'Keller',      Raumart: 'Keller',      Nummer: '1.08', Team: TEAM },

  // Whg Parkweg 2 (Einheit 900007) — 3 Zimmer
  { Einheit: 900007, Objekt: 900003, Bezeichnung: 'Wohnzimmer',  Raumart: 'Wohnzimmer',  Nummer: '2.01', Team: TEAM },
  { Einheit: 900007, Objekt: 900003, Bezeichnung: 'Schlafzimmer', Raumart: 'Schlafzimmer', Nummer: '2.02', Team: TEAM },
  { Einheit: 900007, Objekt: 900003, Bezeichnung: 'Küche',       Raumart: 'Küche',       Nummer: '2.03', Team: TEAM },
  { Einheit: 900007, Objekt: 900003, Bezeichnung: 'Badezimmer',  Raumart: 'Badezimmer',  Nummer: '2.04', Team: TEAM },
  { Einheit: 900007, Objekt: 900003, Bezeichnung: 'Balkon',      Raumart: 'Balkon',      Nummer: '2.05', Team: TEAM },
];

await prisma.raeume.createMany({ data: raeume });
console.log(`✓ Raeume seeded (${raeume.length} rooms)`);

// 8. Get all created rooms with IDs
const createdRooms = await prisma.raeume.findMany({
  where: { Team: TEAM },
  orderBy: { ID: 'asc' },
  select: { ID: true, Bezeichnung: true, Raumart: true, Einheit: true, Nummer: true },
});

// 9. Seed Flaechen (area dimensions) for each room
const flaechen = [
  // Whg 1 links (5 rooms)
  { Raum: createdRooms[0].ID,  Bezeichnung: 'Wohn-und Essbereich', Breite: 5.50, Tiefe: 6.80, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[1].ID,  Bezeichnung: 'Hauptschlafzimmer',    Breite: 3.80, Tiefe: 4.20, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[2].ID,  Bezeichnung: 'Einbauküche',         Breite: 2.80, Tiefe: 3.50, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[3].ID,  Bezeichnung: 'Duschbad',            Breite: 1.80, Tiefe: 2.40, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[4].ID,  Bezeichnung: 'Diele/Flur',          Breite: 1.20, Tiefe: 6.00, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },

  // Whg 1 rechts (6 rooms)
  { Raum: createdRooms[5].ID,  Bezeichnung: 'Wohnzimmer',          Breite: 5.00, Tiefe: 5.50, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[6].ID,  Bezeichnung: 'Schlafzimmer',       Breite: 3.60, Tiefe: 4.00, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[7].ID,  Bezeichnung: 'Kinderzimmer',       Breite: 3.00, Tiefe: 3.50, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[8].ID,  Bezeichnung: 'Küche',              Breite: 2.50, Tiefe: 3.80, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[9].ID,  Bezeichnung: 'Bad mit Wanne',      Breite: 1.90, Tiefe: 2.60, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[10].ID, Bezeichnung: 'Balkon',             Breite: 4.00, Tiefe: 1.50, Anrechenbarkeit: 0.25, Hoehe: 2.70, Team: TEAM },

  // Whg 2 OG (3 rooms)
  { Raum: createdRooms[11].ID, Bezeichnung: 'Wohnküche',          Breite: 4.50, Tiefe: 5.00, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[12].ID, Bezeichnung: 'Schlafzimmer',       Breite: 3.50, Tiefe: 3.80, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },
  { Raum: createdRooms[13].ID, Bezeichnung: 'Bad',               Breite: 1.70, Tiefe: 2.20, Anrechenbarkeit: 1.00, Hoehe: 2.70, Team: TEAM },

  // Whg Parkweg 1 (8 rooms)
  { Raum: createdRooms[14].ID, Bezeichnung: 'Großes Wohnzimmer',  Breite: 6.00, Tiefe: 6.50, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[15].ID, Bezeichnung: 'Master Bedroom',     Breite: 4.20, Tiefe: 4.50, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[16].ID, Bezeichnung: 'Kinderzimmer 1',    Breite: 3.20, Tiefe: 3.50, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[17].ID, Bezeichnung: 'Offene Küche',      Breite: 3.00, Tiefe: 4.00, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[18].ID, Bezeichnung: 'Familienbad',       Breite: 2.20, Tiefe: 2.80, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[19].ID, Bezeichnung: 'Gäste-WC',          Breite: 1.00, Tiefe: 1.80, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[20].ID, Bezeichnung: 'Flur',              Breite: 1.30, Tiefe: 7.00, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[21].ID, Bezeichnung: 'Abstellraum',      Breite: 1.80, Tiefe: 2.50, Anrechenbarkeit: 0.50, Hoehe: 2.80, Team: TEAM },

  // Whg Parkweg 2 (5 rooms)
  { Raum: createdRooms[22].ID, Bezeichnung: 'Wohnzimmer',         Breite: 5.20, Tiefe: 5.80, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[23].ID, Bezeichnung: 'Schlafzimmer',      Breite: 3.80, Tiefe: 4.20, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[24].ID, Bezeichnung: 'Küche',            Breite: 2.60, Tiefe: 3.60, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[25].ID, Bezeichnung: 'Bad',              Breite: 1.80, Tiefe: 2.40, Anrechenbarkeit: 1.00, Hoehe: 2.80, Team: TEAM },
  { Raum: createdRooms[26].ID, Bezeichnung: 'Balkon',           Breite: 3.50, Tiefe: 1.20, Anrechenbarkeit: 0.25, Hoehe: 2.80, Team: TEAM },
];

await prisma.flaechen.createMany({ data: flaechen });
console.log(`✓ Flaechen seeded (${flaechen.length} area records)`);

// 10. Calculate and report results
const allFlaechen = await prisma.flaechen.findMany({
  select: { Breite: true, Tiefe: true, Anrechenbarkeit: true, Hoehe: true, Raum: true },
});

const rooms = await prisma.raeume.findMany({ select: { ID: true, Einheit: true, Bezeichnung: true } });
const roomEinheitMap = Object.fromEntries(rooms.map(r => [r.ID, { einheit: r.Einheit, name: r.Bezeichnung }]));

const byEinheit = {};
for (const f of allFlaechen) {
  const info = roomEinheitMap[f.Raum];
  if (!info) continue;
  const qm = Number(f.Breite) * Number(f.Tiefe) * Number(f.Anrechenbarkeit);
  const kbm = Number(f.Breite) * Number(f.Tiefe) * Number(f.Anrechenbarkeit) * Number(f.Hoehe);
  if (!byEinheit[info.einheit]) byEinheit[info.einheit] = { rooms: 0, qm: 0, kbm: 0 };
  byEinheit[info.einheit].rooms++;
  byEinheit[info.einheit].qm += Math.round(qm * 100) / 100;
  byEinheit[info.einheit].kbm += Math.round(kbm * 100) / 100;
}

const einheitenNames = await prisma.einheiten.findMany({ select: { ID: true, Bezeichnung: true } });
const einheitNameMap = Object.fromEntries(einheitenNames.map(e => [e.ID, e.Bezeichnung]));

console.log('\n=== محاسبه مساحت کل هر واحد (از مجموع اتاق‌ها) ===');
for (const [eid, data] of Object.entries(byEinheit)) {
  console.log(`  Einheit ${eid} (${einheitNameMap[eid] || '?'}): ${data.rooms} اتاق → ${data.qm.toFixed(2)} m²  (${data.kbm.toFixed(2)} m³)`);
}

const totalQm = Object.values(byEinheit).reduce((s, d) => s + d.qm, 0);
console.log(`\n  مجموع کل: ${totalQm.toFixed(2)} m²`);

// 11. Update Wohnflaeche on Einheiten with calculated values
for (const [eid, data] of Object.entries(byEinheit)) {
  await prisma.einheiten.update({ where: { ID: +eid }, data: { Wohnflaeche: Math.round(data.qm * 100) / 100 } }).catch(() => {});
}
console.log('✓ Wohnflaeche در Einheiten بروزرسانی شد');

// 12. Update Objekte with total
const byObjekt = {};
const allEinheiten = await prisma.einheiten.findMany({ select: { ID: true, Objekt: true, Wohnflaeche: true } });
for (const e of allEinheiten) {
  if (!e.Objekt) continue;
  if (!byObjekt[e.Objekt]) byObjekt[e.Objekt] = 0;
  byObjekt[e.Objekt] += Number(e.Wohnflaeche || 0);
}
for (const [oid, qm] of Object.entries(byObjekt)) {
  await prisma.objekte.update({ where: { ID: +oid }, data: { Wohnflaeche: Math.round(qm * 100) / 100 } }).catch(() => {});
}
console.log('✓ Wohnflaeche در Objekte بروزرسانی شد');

console.log('\n✅ داده‌های تست با موفقیت وارد شد!');
console.log('   می‌توانید صفحات زیر را تست کنید:');
console.log('   /raeume   — لیست اتاق‌ها');
console.log('   /flaechen — لیست مساحت‌ها (با محاسبه خودکار Quadratmeter)');
console.log('   /einheiten — واحدها با مساحت به‌روزرسانی‌شده');
console.log('   /objekte  — املاک با مساحت کل');

await prisma.$disconnect();
