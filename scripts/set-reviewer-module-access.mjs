// Corrige la membresia del revisor de Meta en el workspace conectado:
// le asigna moduleAccess para que la barra lateral muestre los modulos
// (sin esto, un miembro no-OWNER con moduleAccess NULL no ve nada).
//
// Uso:  node scripts/set-reviewer-module-access.mjs

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const REVIEWER_EMAIL = "meta.reviewer@aizenbot.com";
const MODULES = ["chats", "contacts", "connection", "client_official_api", "flows", "agents"];

async function main() {
  const reviewer = await prisma.user.findUnique({
    where: { email: REVIEWER_EMAIL },
    select: { id: true },
  });
  if (!reviewer) throw new Error("No existe " + REVIEWER_EMAIL);

  const updated = await prisma.workspaceMember.updateMany({
    where: { userId: reviewer.id, isActive: true },
    data: { moduleAccess: MODULES },
  });

  console.log("Membresias actualizadas: " + updated.count);
  console.log("Modulos asignados: " + MODULES.join(", "));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
