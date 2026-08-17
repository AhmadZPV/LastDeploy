import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const users = await prisma.benutzer.findMany({ select: { ID: true, Benutzername: true, Gruppe: true, Art: true, Team: true, active: true } });
console.log('Users:', JSON.stringify(users, null, 2));
const adressen = await prisma.adressen.count();
const korrespondenz = await prisma.korrespondenz.count();
const zaehler = await prisma.zaehler.count();
console.log('Adressen:', adressen, 'Korrespondenz:', korrespondenz, 'Zaehler:', zaehler);
await prisma.$disconnect();
