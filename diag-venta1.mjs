import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
const { Pool } = pkg;
const env = readFileSync("./.env", "utf8");
for (const line of env.split(/\r?\n/)) { const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m){let v=m[2].trim(); if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1); if(!process.env[m[1]])process.env[m[1]]=v;} }
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
try {
  const chs = await prisma.$queryRawUnsafe(
    `SELECT "id","name","provider","status","evolutionInstanceName","metadata" FROM "WhatsAppChannel"
     WHERE "workspaceId" = (SELECT "workspaceId" FROM "WhatsAppChannel" WHERE "id"='cmrnntccq00002gqot2axqi47')
     ORDER BY "createdAt" DESC LIMIT 6`);
  for (const c of chs) {
    const md = c.metadata ?? {};
    const mark = c.id === "cmrnntccq00002gqot2axqi47" ? "  <<< VENTA1 (el del problema)" : "";
    console.log(`\n• ${c.name} [${c.id}]${mark}`);
    console.log(`   provider=${c.provider} status=${c.status} instancia=${c.evolutionInstanceName}`);
    console.log(`   metadata.gateway = ${JSON.stringify(md.gateway)}`);
    const keys = Object.keys(md).filter(k=>/gateway|api|url|socket|ws|token/i.test(k));
    if (keys.length) console.log(`   otras claves relevantes: ${keys.join(", ")}`);
  }
} finally { await prisma.$disconnect(); }
