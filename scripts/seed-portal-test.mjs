import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
const prisma = new PrismaClient();
const TEAM = 'Team';

// 1. Create a portal test user
const existingPortal = await prisma.benutzer.findFirst({ where: { Benutzername: 'kunde' } });
if (!existingPortal) {
  const userMax = await prisma.benutzer.aggregate({ _max: { ID: true } });
  await prisma.benutzer.create({
    data: {
      ID: (userMax?._max?.ID || 0) + 1,
      Benutzername: 'kunde',
      Passwort: await bcrypt.hash('kunde123', 10),
      Name: 'Max Mustermann',
      Email: 'kunde@test.de',
      Gruppe: 'Portal',
      Art: 'portal',
      Team: TEAM,
      active: 1,
    },
  });
  console.log('✓ Portal-Benutzer erstellt: kunde / kunde123');
} else {
  await prisma.benutzer.update({ where: { ID: existingPortal.ID }, data: { Art: 'portal', Gruppe: 'Portal', Passwort: await bcrypt.hash('kunde123', 10), active: 1 } });
  console.log('✓ Portal-Benutzer aktualisiert: kunde / kunde123');
}

// 2. Seed Mitteilungen (announcements via Korrespondenz with Postkorb=Mitteilungen)
const korrespondenzCount = await prisma.korrespondenz.count({ where: { Postkorb: 'Mitteilungen', Team: TEAM } });
if (korrespondenzCount === 0) {
  const maxId = await prisma.korrespondenz.aggregate({ _max: { ID: true } });
  let nextId = (maxId?._max?.ID || 0) + 1;
  const mitteilungen = [
    { Betreff: 'Willkommen im Kundenportal!', Text: 'Liebe Kundinnen und Kunden,\n\nwir freuen uns, Ihnen unser neues Kundenportal vorzustellen. Hier können Sie Ihre Zählerstände melden, Mitteilungen empfangen und Ihre Objekte einsehen.\n\nIhr Erwin Property Mgmt Team', Datum: new Date(Date.now() - 7 * 86400000) },
    { Betreff: 'Winterdienst — Schnee räumen', Text: 'Sehr geehrte Eigentümer,\n\nmit Beginn der Wintersaison erinnern wir daran, dass die Räumpflicht für Gehwege gemäß Straßenreinigungssatzung besteht.\n\nBitte stellen Sie sicher, dass Schnee und Eis rechtzeitig beseitigt werden.', Datum: new Date(Date.now() - 3 * 86400000) },
    { Betreff: 'Jahresabrechnung 2025', Text: 'Liebe Mieter,\n\ndie Jahresabrechnung 2025 wird voraussichtlich Ende des Monats versendet. Bitte prüfen Sie Ihre Kontaktdaten im Portal auf Richtigkeit.\n\nBei Fragen wenden Sie sich an die Hausverwaltung.', Datum: new Date(Date.now() - 1 * 86400000) },
    { Betreff: 'Wartungsarbeiten am System', Text: 'Am kommenden Wochenende werden Wartungsarbeiten am System durchgeführt. Das Portal kann am Samstag zwischen 02:00 und 04:00 Uhr kurzzeitig nicht erreichbar sein.', Datum: new Date(Date.now() - 6 * 3600000) },
  ];
  for (const m of mitteilungen) {
    await prisma.korrespondenz.create({
      data: { ID: nextId++, Betreff: m.Betreff, Text: m.Text, Postkorb: 'Mitteilungen', Team: TEAM, Art: 'Mitteilung' },
    });
    await prisma.$executeRaw`UPDATE Korrespondenz SET Datum = ${m.Datum.toISOString()} WHERE ID = ${nextId - 1}`;
  }
  console.log(`✓ ${mitteilungen.length} Mitteilungen erstellt`);
} else {
  console.log(`✓ ${korrespondenzCount} Mitteilungen bereits vorhanden`);
}

// 3. Seed Zaehler (meter readings)
const zaehlerCount = await prisma.zaehler.count({ where: { Team: TEAM } });
if (zaehlerCount === 0) {
  const maxId = await prisma.zaehler.aggregate({ _max: { ID: true } });
  let nextId = (maxId?._max?.ID || 0) + 1;
  const zaehler = [
    { Zaehlerart: 'Strom', Zaehlernummer: 'STROM-001', Zaehlerstand: '12543.5', Ablesedatum: new Date(Date.now() - 30 * 86400000) },
    { Zaehlerart: 'Gas', Zaehlernummer: 'GAS-002', Zaehlerstand: '8234.0', Ablesedatum: new Date(Date.now() - 30 * 86400000) },
    { Zaehlerart: 'Wasser', Zaehlernummer: 'WASSER-003', Zaehlerstand: '456', Ablesedatum: new Date(Date.now() - 60 * 86400000) },
    { Zaehlerart: 'Strom', Zaehlernummer: 'STROM-004', Zaehlerstand: '9876.2', Ablesedatum: new Date(Date.now() - 90 * 86400000) },
  ];
  for (const z of zaehler) {
    await prisma.zaehler.create({ data: { ID: nextId++, Team: TEAM, Zaehlerart: z.Zaehlerart, Zaehlernummer: z.Zaehlernummer, Zaehlerstand: z.Zaehlerstand } });
    await prisma.$executeRaw`UPDATE Zaehler SET Ablesedatum = ${z.Ablesedatum.toISOString()} WHERE ID = ${nextId - 1}`;
  }
  console.log(`✓ ${zaehler.length} Zählerstände erstellt`);
} else {
  console.log(`✓ ${zaehlerCount} Zählerstände bereits vorhanden`);
}

console.log('\n✅ Portal-Testdaten fertig!');
console.log('   Anmeldedaten: kunde / kunde123');
console.log('   Portal-URL: http://localhost:3000/portal');
await prisma.$disconnect();
