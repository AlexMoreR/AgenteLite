// Backfill del numero real (display_phone_number) para canales de WhatsApp API oficial.
// Los canales creados antes del fix guardaron el Phone Number ID de Meta en "phoneNumber"
// en vez del numero E.164. Este script pide el numero real a la Graph API y lo corrige.
//
// Uso:  node scripts/backfill-official-api-phone.mjs         (aplica los cambios)
//       node scripts/backfill-official-api-phone.mjs --dry   (solo muestra, no escribe)

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});
const DRY_RUN = process.argv.includes("--dry");

function normalize(value) {
  return (value ?? "").replace(/\D/g, "");
}

async function fetchDisplayNumber(phoneNumberId, accessToken) {
  const response = await fetch(
    `https://graph.facebook.com/v23.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  }
  return normalize(payload?.display_phone_number);
}

async function main() {
  const channels = await prisma.whatsAppChannel.findMany({
    where: { provider: "OFFICIAL_API" },
    select: { id: true, name: true, workspaceId: true, phoneNumber: true, metadata: true },
  });

  if (channels.length === 0) {
    console.log("No hay canales OFFICIAL_API.");
    return;
  }

  // Config oficial por workspace (accessToken + phoneNumberId).
  const workspaceIds = [...new Set(channels.map((c) => c.workspaceId))];
  const configs = await prisma.$queryRawUnsafe(
    `SELECT "workspaceId", "accessToken", "phoneNumberId"
     FROM "OfficialApiClientConfig"
     WHERE "workspaceId" = ANY($1::text[])`,
    workspaceIds,
  );
  const configByWorkspace = new Map(configs.map((row) => [row.workspaceId, row]));

  let updated = 0;
  for (const channel of channels) {
    const config = configByWorkspace.get(channel.workspaceId);
    // phoneNumberId a usar: el de la config, o el del metadata del canal.
    const metaPhoneId =
      config?.phoneNumberId ||
      (channel.metadata && typeof channel.metadata === "object" ? channel.metadata.phoneNumberId : null);
    const accessToken = config?.accessToken;

    if (!metaPhoneId || !accessToken) {
      console.log(`- ${channel.name}: sin config oficial, se omite.`);
      continue;
    }

    // Solo corregir si el phoneNumber guardado NO parece un numero real (coincide con el ID).
    const current = normalize(channel.phoneNumber);
    if (current && current !== normalize(metaPhoneId)) {
      console.log(`- ${channel.name}: ya tiene numero (${channel.phoneNumber}), se omite.`);
      continue;
    }

    try {
      const realNumber = await fetchDisplayNumber(metaPhoneId, accessToken);
      if (!realNumber) {
        console.log(`- ${channel.name}: Meta no devolvio display_phone_number, se omite.`);
        continue;
      }
      console.log(`- ${channel.name}: ${channel.phoneNumber} -> ${realNumber}${DRY_RUN ? " (dry)" : ""}`);
      if (!DRY_RUN) {
        await prisma.whatsAppChannel.update({
          where: { id: channel.id },
          data: { phoneNumber: realNumber },
        });
      }
      updated += 1;
    } catch (error) {
      console.log(`- ${channel.name}: error consultando Meta -> ${error.message}`);
    }
  }

  console.log(`\n${DRY_RUN ? "Se actualizarian" : "Actualizados"} ${updated} canal(es).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
