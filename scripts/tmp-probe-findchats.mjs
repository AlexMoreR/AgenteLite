// Read-only: mira el canal y reproduce el findChats del scan de "Sincronizar chats".
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
const CHANNEL_ID = process.argv[2] || "cmscpgxvb000m2howqfupw798";

async function main() {
  const channel = await prisma.whatsAppChannel.findUnique({
    where: { id: CHANNEL_ID },
    select: { id: true, name: true, provider: true, status: true, evolutionInstanceName: true, metadata: true },
  });
  if (!channel) { console.log("No existe el canal", CHANNEL_ID); return; }
  const meta = channel.metadata && typeof channel.metadata === "object" ? channel.metadata : {};
  console.log("canal:", channel.name, "| provider:", channel.provider, "| status:", channel.status, "| instancia:", channel.evolutionInstanceName);
  console.log("metadata keys:", Object.keys(meta));
  console.log("gateway:", JSON.stringify(meta.gateway ?? null));

  const gw = meta.gateway && typeof meta.gateway === "object" ? meta.gateway : null;
  const baseUrl = (gw?.baseUrl || process.env.EVOLUTION_API_BASE_URL || "").replace(/\/+$/, "");
  const apiToken = gw?.apiKey || gw?.apiToken || process.env.EVOLUTION_API_TOKEN || "";
  console.log("baseUrl:", baseUrl, "| token?", apiToken ? `si (${String(apiToken).slice(0, 4)}...)` : "NO");
  if (!baseUrl || !apiToken) return;

  const url = `${baseUrl}/chat/findChats/${channel.evolutionInstanceName}`;
  console.log("POST", url);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { apikey: String(apiToken), "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    console.log(`HTTP ${res.status} en ${Date.now() - started}ms`);
    console.log("body (800):", text.slice(0, 800));
  } catch (e) {
    clearTimeout(t);
    console.log("Error tras", Date.now() - started, "ms:", e?.name, e?.message);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
