import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const objekte = await prisma.objekte.findMany({ select: { ID: true, Bezeichnung: true, Team: true } });
const einheiten = await prisma.einheiten.findMany({ select: { ID: true, Bezeichnung: true, Objekt: true, Team: true, Wohnflaeche: true } });
const raumarten = await prisma.raumarten.findMany();
const user = await prisma.benutzer.findFirst({ select: { ID: true, Benutzername: true, Team: true } });
console.log('Objekte:', JSON.stringify(objekte, null, 2));
console.log('Einheiten:', JSON.stringify(einheiten, null, 2));
console.log('Raumarten:', JSON.stringify(raumarten, null, 2));
console.log('User:', JSON.stringify(user, null, 2));
await prisma.$disconnect();
