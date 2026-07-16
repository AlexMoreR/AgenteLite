// Diagnóstico: llama UNA vez a /user/avatar de evogo y muestra la respuesta CRUDA
// (status + cuerpo, base64 truncado) para saber el formato exacto que devuelve.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

function truncateDeep(value, depth = 0) {
  if (typeof value === "string") return value.length > 80 ? value.slice(0, 80) + `...[${value.length} chars]` : value;
  if (Array.isArray(value)) return value.map((v) => truncateDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = truncateDeep(v, depth + 1);
    return out;
  }
  return value;
}

async function getSetting(key) {
  const rows = await prisma.$queryRawUnsafe(`SELECT "value" FROM "AppSetting" WHERE "key" = $1 LIMIT 1`, key);
  return rows[0]?.value ?? null;
}

async function main() {
  const apiBaseUrl = (await getSetting("evolutionApiBaseUrl")) || process.env.EVOLUTION_API_BASE_URL || "";
  const apiToken = (await getSetting("evolutionApiToken")) || process.env.EVOLUTION_API_TOKEN || "";
  console.log("apiBaseUrl:", apiBaseUrl || "(vacío)");
  console.log("apiToken:  ", apiToken ? apiToken.slice(0, 6) + "..." : "(vacío)");

  const channel = await prisma.whatsAppChannel.findFirst({
    where: { provider: "EVOLUTION", evolutionInstanceName: "agente-lite-10" },
    select: { evolutionInstanceName: true, metadata: true, phoneNumber: true },
  });
  const instanceName = channel?.evolutionInstanceName;
  const meta = channel?.metadata && typeof channel.metadata === "object" ? channel.metadata : {};
  const instanceToken = meta.instanceToken || meta.token || null;
  console.log("instanceName:", instanceName, "| instanceToken:", instanceToken ? String(instanceToken).slice(0, 6) + "..." : "(ninguno)");

  // Un contacto real con nombre (probable que tenga foto).
  const contact = await prisma.contact.findFirst({
    where: { avatarUrl: null, NOT: { name: null } },
    select: { name: true, phoneNumber: true },
    orderBy: { updatedAt: "desc" },
  });
  const number = contact?.phoneNumber;
  console.log("Probando foto de:", contact?.name, number, "\n");

  if (!apiBaseUrl || !number) { console.log("Falta config o número"); return; }

  const headers = { "Content-Type": "application/json", apikey: instanceToken || apiToken };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${apiBaseUrl}/user/avatar`, {
      method: "POST",
      headers,
      body: JSON.stringify({ number, preview: true }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    console.log("HTTP status:", res.status);
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    console.log("Respuesta (base64 truncado):");
    console.log(JSON.stringify(truncateDeep(parsed), null, 2));
  } catch (e) {
    clearTimeout(t);
    console.log("Error/timeout:", e?.name, e?.message);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
