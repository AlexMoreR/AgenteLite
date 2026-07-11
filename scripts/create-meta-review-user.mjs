// Crea (o repara) el usuario demo para el revisor de Meta App Review.
// Usuario CLIENTE con email verificado + workspace demo con plan activo.
//
// Uso:  node scripts/create-meta-review-user.mjs
//
// Credenciales resultantes (para las notas de la solicitud de revision):
//   email:    meta.reviewer@aizenbot.com
//   password: la que se pase en REVIEWER_PASSWORD o la de abajo por defecto

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const EMAIL = process.env.REVIEWER_EMAIL || "meta.reviewer@aizenbot.com";
const PASSWORD = process.env.REVIEWER_PASSWORD;
if (!PASSWORD) {
  console.error("Define REVIEWER_PASSWORD en el entorno antes de ejecutar este script.");
  process.exit(1);
}
const WORKSPACE_NAME = "Demo Meta Review";
const WORKSPACE_SLUG = "demo-meta-review";

async function main() {
  const hashedPassword = await bcrypt.hash(PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {
      password: hashedPassword,
      emailVerified: new Date(),
      role: "CLIENTE",
    },
    create: {
      name: "Meta Reviewer",
      email: EMAIL,
      password: hashedPassword,
      role: "CLIENTE",
      emailVerified: new Date(),
    },
    select: { id: true, email: true },
  });

  const planExpiresAt = new Date();
  planExpiresAt.setDate(planExpiresAt.getDate() + 90);

  const workspace = await prisma.workspace.upsert({
    where: { slug: WORKSPACE_SLUG },
    update: {
      ownerId: user.id,
      isActive: true,
      planTier: "AVANZADO",
      planExpiresAt,
    },
    create: {
      name: WORKSPACE_NAME,
      slug: WORKSPACE_SLUG,
      ownerId: user.id,
      isActive: true,
      planTier: "AVANZADO",
      planStartedAt: new Date(),
      planExpiresAt,
    },
    select: { id: true, slug: true },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { isActive: true, acceptedAt: new Date() },
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "ADMIN",
      isActive: true,
      acceptedAt: new Date(),
    },
  });

  console.log("Usuario demo listo:");
  console.log("  email:      " + user.email);
  console.log("  userId:     " + user.id);
  console.log("  workspace:  " + workspace.slug + " (" + workspace.id + ")");
  console.log("  login:      https://app.aizenbot.com/login");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
