// Diagnostico SOLO LECTURA: por que un canal OFFICIAL_API no muestra chats en la bandeja.
// No escribe nada. Muestra la config oficial (sin exponer secretos) y los conteos de
// contactos/conversaciones/mensajes/eventos de webhook por workspace.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

function mask(value) {
  if (!value) return null;
  return `len=${value.length} ...${value.slice(-4)}`;
}

const channels = await prisma.whatsAppChannel.findMany({
  where: { provider: "OFFICIAL_API" },
  select: { id: true, name: true, workspaceId: true, phoneNumber: true, status: true, metadata: true },
});

for (const ch of channels) {
  console.log(`\n=== Canal ${ch.name} (${ch.id}) ===`);
  console.log("  status:", ch.status, "| phoneNumber:", ch.phoneNumber, "| workspaceId:", ch.workspaceId);
  console.log("  metadata.phoneNumberId:", ch.metadata?.phoneNumberId, "| metadata.wabaId:", ch.metadata?.wabaId);

  const [config] = await prisma.$queryRawUnsafe(
    `SELECT "id","accessToken","phoneNumberId","wabaId","status"::text as status
     FROM "OfficialApiClientConfig" WHERE "workspaceId" = $1`,
    ch.workspaceId,
  );

  if (!config) {
    console.log("  >> NO hay OfficialApiClientConfig para este workspace. La bandeja devolvera [].");
    continue;
  }

  const hasAll = Boolean(config.accessToken && config.phoneNumberId && config.wabaId);
  console.log("  config.id:", config.id, "| status:", config.status);
  console.log("  config.accessToken:", mask(config.accessToken));
  console.log("  config.phoneNumberId:", config.phoneNumberId, "| config.wabaId:", config.wabaId);
  console.log("  >> pasa gate hasOfficialApiBaseCredentials:", hasAll, hasAll ? "" : "<-- SI ES false, la bandeja devuelve []");

  const [counts] = await prisma.$queryRawUnsafe(
    `SELECT
        (SELECT COUNT(*) FROM "OfficialApiContact"      WHERE "configId" = $1) AS contacts,
        (SELECT COUNT(*) FROM "OfficialApiConversation" WHERE "configId" = $1) AS conversations,
        (SELECT COUNT(*) FROM "OfficialApiMessage"      WHERE "configId" = $1) AS messages,
        (SELECT COUNT(*) FROM "OfficialApiWebhookEvent" WHERE "configId" = $1) AS webhook_events`,
    config.id,
  );
  console.log("  conteos por configId:", {
    contacts: Number(counts.contacts),
    conversations: Number(counts.conversations),
    messages: Number(counts.messages),
    webhook_events: Number(counts.webhook_events),
  });

  const events = await prisma.$queryRawUnsafe(
    `SELECT "eventType","status"::text as status,"errorMessage","createdAt"
     FROM "OfficialApiWebhookEvent" WHERE "configId" = $1
     ORDER BY "createdAt" DESC LIMIT 5`,
    config.id,
  );
  console.log("  ultimos webhook events:", events.length ? events : "(ninguno)");
}

await prisma.$disconnect();
