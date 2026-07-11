// Solo lectura: lista las configuraciones de API oficial y canales OFFICIAL_API
// para saber qué copiar al workspace demo del revisor de Meta.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

function mask(value) {
  if (!value) return "(vacio)";
  return value.slice(0, 6) + "..." + value.slice(-4) + " (" + value.length + " chars)";
}

async function main() {
  const configs = await prisma.$queryRawUnsafe(`
    SELECT c."id", c."workspaceId", w."name" as "workspaceName", w."slug",
           c."accessToken", c."phoneNumberId", c."wabaId", c."appSecret",
           c."webhookVerifyToken", c."status"::text as status, c."lastValidatedAt"
    FROM "OfficialApiClientConfig" c
    JOIN "Workspace" w ON w."id" = c."workspaceId"
    ORDER BY c."updatedAt" DESC
  `);

  console.log("OfficialApiClientConfig (" + configs.length + "):");
  for (const c of configs) {
    console.log("- workspace: " + c.workspaceName + " (" + c.slug + ") id=" + c.workspaceId);
    console.log("  status=" + c.status + " phoneNumberId=" + (c.phoneNumberId || "(vacio)") + " wabaId=" + (c.wabaId || "(vacio)"));
    console.log("  accessToken=" + mask(c.accessToken) + " appSecret=" + mask(c.appSecret) + " verifyToken=" + (c.webhookVerifyToken ? "si" : "no"));
  }

  const channels = await prisma.whatsAppChannel.findMany({
    where: { provider: "OFFICIAL_API" },
    select: { id: true, workspaceId: true, name: true, phoneNumber: true, isActive: true, metadata: true },
  });
  console.log("\nWhatsAppChannel OFFICIAL_API (" + channels.length + "):");
  for (const ch of channels) {
    console.log("- " + ch.name + " workspaceId=" + ch.workspaceId + " phone=" + ch.phoneNumber + " active=" + ch.isActive);
    console.log("  metadata=" + JSON.stringify(ch.metadata));
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
