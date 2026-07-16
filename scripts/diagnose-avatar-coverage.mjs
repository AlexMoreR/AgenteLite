// Solo lectura: cuántos contactos tienen avatarUrl (foto descargada) vs total,
// y muestra unos ejemplos con/ sin foto. Diagnóstico del sistema de avatares.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

async function main() {
  const total = await prisma.contact.count();
  const withAvatar = await prisma.contact.count({ where: { NOT: { avatarUrl: null } } });

  console.log("Contactos totales:        " + total);
  console.log("Con foto (avatarUrl):     " + withAvatar);
  console.log("Sin foto (iniciales):     " + (total - withAvatar));
  console.log("Cobertura:                " + (total ? Math.round((withAvatar / total) * 100) : 0) + "%");

  const conFoto = await prisma.contact.findMany({
    where: { NOT: { avatarUrl: null } },
    select: { name: true, phoneNumber: true, avatarUrl: true, metadata: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  console.log("\nEjemplos CON foto (más recientes):");
  for (const c of conFoto) {
    const meta = c.metadata && typeof c.metadata === "object" ? c.metadata : {};
    const fetchedAt = meta.avatarFetchedAt ?? "(sin marca)";
    console.log("  - " + (c.name || c.phoneNumber) + " | fetchedAt=" + fetchedAt + " | url=" + String(c.avatarUrl).slice(0, 60) + "...");
  }

  // De los que NO tienen foto, cuántos ya se intentaron (tienen avatarFetchedAt) vs nunca.
  const sinFoto = await prisma.contact.findMany({
    where: { avatarUrl: null },
    select: { metadata: true },
    take: 2000,
  });
  let intentados = 0;
  for (const c of sinFoto) {
    const meta = c.metadata && typeof c.metadata === "object" ? c.metadata : {};
    if (typeof meta.avatarFetchedAt === "string") intentados += 1;
  }
  console.log("\nDe los SIN foto (muestra " + sinFoto.length + "): ya intentados=" + intentados + ", nunca intentados=" + (sinFoto.length - intentados));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
