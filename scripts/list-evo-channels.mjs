import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
const chans = await prisma.whatsAppChannel.findMany({
  where: { provider: "EVOLUTION" },
  select: { evolutionInstanceName: true, isActive: true, metadata: true },
});
for (const c of chans) {
  const m = c.metadata && typeof c.metadata === "object" ? c.metadata : {};
  const tok = m.instanceToken || m.token;
  console.log(`${c.evolutionInstanceName} | active=${c.isActive} | token=${tok ? String(tok).slice(0,8)+"..." : "(ninguno)"} | metaKeys=${Object.keys(m).join(",")}`);
}
await prisma.$disconnect();
