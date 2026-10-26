// CREA LA "V1 - EMBUDO INICIAL" de todos los productos que ya tienen embudo (Embudo 3).
//
// Por defecto SIMULA: solo cuenta. Para escribir hay que pasar --escribir.
// Solo agrega filas en EmbudoVersion; no toca el embudo ni manda mensajes. Se puede correr varias
// veces: un producto que ya tiene versiones se salta.
//
// Uso (al subir, con DATABASE_URL en el entorno):
//   node scripts/crear-versiones-iniciales.mjs                      (simula, todos los negocios)
//   node scripts/crear-versiones-iniciales.mjs --escribir
//   node scripts/crear-versiones-iniciales.mjs --workspace <id> --escribir
import { createRequire } from "node:module";
import { cargar } from "./supervisor-cargar.mjs";

const requerir = createRequire(import.meta.url);
const { PrismaClient } = requerir("@prisma/client");
const { armarFoto, huellaDeFoto } = cargar("src/features/embudo/dominio/versiones.ts");

const args = process.argv.slice(2);
const escribir = args.includes("--escribir");
const indice = args.indexOf("--workspace");
const soloWorkspace = indice >= 0 ? args[indice + 1] : null;

const prisma = new PrismaClient();
let creadas = 0;
let saltadas = 0;
try {
  const playbooks = await prisma.productPlaybook.findMany({
    where: soloWorkspace ? { workspaceId: soloWorkspace } : {},
    select: {
      workspaceId: true,
      productId: true,
      stages: {
        select: {
          stage: true,
          goal: true,
          script: true,
          stuckAfterMessages: true,
          followUps: {
            select: { sortOrder: true, timeType: true, timeValue: true, content: true, flowId: true, cancelOnActivity: true, isActive: true },
          },
        },
      },
    },
  });
  for (const playbook of playbooks) {
    if (await prisma.embudoVersion.findFirst({ where: { productId: playbook.productId }, select: { id: true } })) {
      saltadas += 1;
      continue;
    }
    const fila = await prisma.appSetting.findUnique({ where: { key: `producto:embudo:quitadas:${playbook.productId}` } });
    let quitadas = [];
    try {
      const guardado = JSON.parse(fila?.value ?? "[]");
      quitadas = Array.isArray(guardado) ? guardado.filter((x) => typeof x === "string") : [];
    } catch {
      quitadas = [];
    }
    const foto = armarFoto(playbook.stages, quitadas);
    if (escribir) {
      try {
        await prisma.embudoVersion.create({
          data: {
            workspaceId: playbook.workspaceId,
            productId: playbook.productId,
            numero: 1,
            nota: "Embudo inicial",
            origen: "inicial",
            huella: huellaDeFoto(foto),
            contenido: foto,
          },
        });
      } catch (error) {
        if (error?.code === "P2002") {
          saltadas += 1; // Otro proceso la creó primero.
          continue;
        }
        throw error;
      }
    }
    creadas += 1;
  }
  console.log(`${escribir ? "Creadas" : "Se crearían"}: ${creadas} V1. Ya tenían versiones: ${saltadas}.${escribir ? "" : " (simulación: usá --escribir)"}`);
} finally {
  await prisma.$disconnect();
}
