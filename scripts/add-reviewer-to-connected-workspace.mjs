// Agrega al usuario demo del revisor de Meta (meta.reviewer@aizenbot.com) como
// miembro del workspace que ya tiene la conexion de API oficial CONNECTED, y
// desactiva su membresia en el workspace demo vacio para que el login lo lleve
// directo al workspace con WhatsApp funcionando.
//
// No imprime tokens ni secretos. Autorizado por el usuario (2026-07-11).
//
// Uso:  node scripts/add-reviewer-to-connected-workspace.mjs

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const REVIEWER_EMAIL = "meta.reviewer@aizenbot.com";
const DEMO_SLUG = "demo-meta-review";

async function main() {
  const reviewer = await prisma.user.findUnique({
    where: { email: REVIEWER_EMAIL },
    select: { id: true, email: true },
  });
  if (!reviewer) {
    throw new Error("No existe el usuario " + REVIEWER_EMAIL + " (corre antes create-meta-review-user.mjs)");
  }

  const configs = await prisma.$queryRawUnsafe(`
    SELECT c."workspaceId", w."name", w."slug", c."phoneNumberId"
    FROM "OfficialApiClientConfig" c
    JOIN "Workspace" w ON w."id" = c."workspaceId"
    WHERE c."status" = 'CONNECTED' AND w."slug" <> '${DEMO_SLUG}'
    ORDER BY c."updatedAt" DESC
  `);

  if (configs.length === 0) {
    throw new Error("No hay ninguna configuracion de API oficial en estado CONNECTED");
  }

  console.log("Workspaces con API oficial CONNECTED:");
  for (const c of configs) {
    console.log("- " + c.name + " (" + c.slug + ") phoneNumberId=" + c.phoneNumberId);
  }

  const target = configs[0];
  if (configs.length > 1) {
    console.log("\nHay varios; se usa el mas reciente: " + target.name);
  }

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: target.workspaceId, userId: reviewer.id } },
    update: { isActive: true, acceptedAt: new Date(), deactivatedAt: null },
    create: {
      workspaceId: target.workspaceId,
      userId: reviewer.id,
      role: "ADMIN",
      isActive: true,
      acceptedAt: new Date(),
    },
  });
  console.log("\nMembresia creada/activada: " + REVIEWER_EMAIL + " -> " + target.name + " (" + target.slug + ")");

  const demo = await prisma.workspace.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true } });
  if (demo) {
    const updated = await prisma.workspaceMember.updateMany({
      where: { workspaceId: demo.id, userId: reviewer.id, isActive: true },
      data: { isActive: false, deactivatedAt: new Date() },
    });
    if (updated.count > 0) {
      console.log("Membresia del workspace demo vacio desactivada (login ira directo al workspace conectado).");
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
