// Borra el mensaje de prueba fallido ("Prueba tecnica", status FAILED) creado
// durante la preparacion de los videos del App Review, para que la conversacion
// se vea limpia en la grabacion. Solo toca ese registro puntual.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

async function main() {
  const deleted = await prisma.$executeRaw`
    DELETE FROM "OfficialApiMessage"
    WHERE "content" = 'Prueba tecnica'
      AND "status" = 'FAILED'
      AND "direction" = 'OUTBOUND'
  `;
  console.log("Mensajes fallidos borrados: " + deleted);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
