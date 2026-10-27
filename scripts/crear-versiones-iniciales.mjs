// CREAR LA "V1 - embudo inicial" DE TODOS LOS PRODUCTOS (Embudo 3). Correrlo una vez al subir.
//
// Por defecto SIMULA: solo muestra qué productos no tienen versión todavía. Con --escribir guarda
// la V1 de cada uno (lo que tiene el embudo en este momento). Idempotente: un producto que ya
// tiene alguna versión no se toca. Solo escribe en EmbudoVersion.
//
// Uso:
//   node scripts/crear-versiones-iniciales.mjs                (simula)
//   node scripts/crear-versiones-iniciales.mjs --escribir
//   node scripts/crear-versiones-iniciales.mjs --workspace <id> --escribir
// Lee DATABASE_URL del entorno (o de .env).
import { createRequire } from "node:module";

import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const requireNativo = createRequire(`${RAIZ}/package.json`);
const { PrismaClient } = requireNativo("@prisma/client");
const prisma = new PrismaClient();

const argumentos = process.argv.slice(2);
const escribir = argumentos.includes("--escribir");
const indice = argumentos.indexOf("--workspace");
const workspaceId = indice >= 0 ? argumentos[indice + 1] : null;

const versiones = cargar("src/features/embudo/servicios/versiones.ts", { "@/lib/prisma": { prisma } });

try {
  const playbooks = await prisma.productPlaybook.findMany({
    where: workspaceId ? { workspaceId } : {},
    select: { workspaceId: true, productId: true, product: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  let creadas = 0;
  let yaTenian = 0;
  let fallaron = 0;
  for (const playbook of playbooks) {
    const existe = await prisma.embudoVersion.findFirst({ where: { productId: playbook.productId }, select: { id: true } });
    if (existe) {
      yaTenian += 1;
      continue;
    }
    if (!escribir) {
      console.log(`[simulacion] crearía la V1 de ${playbook.product.name} (${playbook.productId})`);
      creadas += 1;
      continue;
    }
    try {
      await versiones.asegurarVersionInicial(playbook.workspaceId, playbook.productId, { nombre: "Subida de Embudo 3" });
      console.log(`V1 creada: ${playbook.product.name}`);
      creadas += 1;
    } catch (error) {
      fallaron += 1;
      console.error(`FALLÓ ${playbook.product.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`\n${escribir ? "Creadas" : "Se crearían"}: ${creadas}. Ya tenían versión: ${yaTenian}. Fallaron: ${fallaron}.`);
  if (fallaron) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
