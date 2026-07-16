// FASE 1: dispara un history-sync en evogo para un chat, usando un mensaje de referencia
// real de la BD. El resultado (historial) llega async al webhook de AgenteLite, que lo
// loguea como [HISTORY_SYNC_CAPTURE]. Requiere que el webhook con esa captura esté desplegado.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });

const BASE_URL = "https://evogo-1.magilus.com";
const INSTANCE = "agente-lite-10";
const COUNT = 20;

async function main() {
  const channel = await prisma.whatsAppChannel.findFirst({
    where: { provider: "EVOLUTION", evolutionInstanceName: INSTANCE },
    select: { id: true, metadata: true },
  });
  const meta = channel?.metadata && typeof channel.metadata === "object" ? channel.metadata : {};
  const token = meta.instanceToken || meta.token;
  if (!token) { console.log("Sin instanceToken para", INSTANCE); return; }

  // Mensaje de referencia: el MÁS RECIENTE (la sesión de cifrado está más viva en chats activos).
  const ref = await prisma.message.findFirst({
    where: { channelId: channel.id, externalId: { not: null }, contactId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      externalId: true, direction: true, createdAt: true,
      contact: { select: { phoneNumber: true, name: true } },
    },
  });
  if (!ref?.externalId || !ref.contact?.phoneNumber) { console.log("No hallé mensaje de referencia con externalId"); return; }

  const chatJid = `${ref.contact.phoneNumber}@s.whatsapp.net`;
  const body = {
    count: COUNT,
    messageInfo: {
      Chat: chatJid,
      IsFromMe: ref.direction === "OUTBOUND",
      IsGroup: false,
      ID: ref.externalId,
      Timestamp: ref.createdAt.toISOString(),
    },
  };
  console.log("Disparando history-sync para:", ref.contact.name, chatJid);
  console.log("Body:", JSON.stringify(body));

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${BASE_URL}/chat/history-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: String(token) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(t);
    console.log("HTTP status:", res.status);
    console.log("Respuesta:", (await res.text()).slice(0, 500));
    console.log("\n>> Ahora revisa los logs de AgenteLite y busca [HISTORY_SYNC_CAPTURE] (llega en unos segundos).");
  } catch (e) {
    clearTimeout(t);
    console.log("Error/timeout:", e?.name, e?.message);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
