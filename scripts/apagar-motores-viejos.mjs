// APAGAR LOS MOTORES VIEJOS (agente V1/V2) sin borrarlos (24-nov-2026).
//
// Por cada agente V1/V2 que esté activo, lo PAUSA (status PAUSED, isActive false: lo mismo que el botón de
// la pantalla Agentes) solo si TODAS sus líneas tienen el V3 (metadata.agenteV3 = true). Si alguna línea
// no lo tiene, no lo pausa y lo avisa. También cancela los seguimientos PENDIENTES de esas líneas que
// vinieron del V2 ("Sin responder …" y reglas AGENT_NODE). Los "Etapa …", los del V3 y los de una asesora
// no se tocan. Antes de escribir guarda cómo estaba todo en AppSetting "motores-viejos:respaldo:<workspaceId>".
//
// Uso:
//   node scripts/apagar-motores-viejos.mjs                 (= --revisar: solo muestra lo que haría)
//   node scripts/apagar-motores-viejos.mjs --aplicar
//   node scripts/apagar-motores-viejos.mjs --volver        (deja agentes y seguimientos como estaban)
//   ... --workspace <id>                                   (solo ese negocio)
// Lee DATABASE_URL del entorno (o de .env).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const dominio = cargar("src/features/seguimientos/dominio/motores-viejos.ts");
const {
  agenteActivo,
  claveDelRespaldo,
  esSeguimientoDelV2,
  lineaConV3,
  MARCA_CANCELADO_POR_MOTORES_VIEJOS,
  PREFIJO_RESPALDO_MOTORES_VIEJOS,
  PREFIJO_SIN_RESPONDER,
} = dominio;

export function leerArgumentos(argumentos) {
  const modo = argumentos.includes("--volver") ? "volver" : argumentos.includes("--aplicar") ? "aplicar" : "revisar";
  const indice = argumentos.indexOf("--workspace");
  const workspaceId = indice >= 0 ? (argumentos[indice + 1] ?? null) : null;
  return { modo, workspaceId };
}

function leerRespaldo(valor) {
  try {
    const crudo = JSON.parse(valor);
    return {
      agentes: Array.isArray(crudo?.agentes) ? crudo.agentes : [],
      follows: Array.isArray(crudo?.follows) ? crudo.follows : [],
    };
  } catch {
    return { agentes: [], follows: [] };
  }
}

/** Lo que haría --aplicar, por negocio. No escribe nada. */
async function planear(prisma, workspaceId) {
  const agentes = await prisma.agent.findMany({
    where: { agentType: { in: ["V1", "V2"] }, ...(workspaceId ? { workspaceId } : {}) },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      status: true,
      isActive: true,
      channels: { select: { id: true, name: true, metadata: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const porNegocio = new Map();
  for (const agente of agentes) {
    if (!agenteActivo(agente)) continue;
    const plan = porNegocio.get(agente.workspaceId) ?? { workspaceId: agente.workspaceId, pausar: [], noPausar: [], follows: [] };
    porNegocio.set(agente.workspaceId, plan);
    const sinV3 = agente.channels.filter((linea) => !lineaConV3(linea.metadata));
    if (sinV3.length) {
      plan.noPausar.push({ agente, lineasSinV3: sinV3 });
      continue;
    }
    plan.pausar.push(agente);
  }
  for (const plan of porNegocio.values()) {
    const lineas = plan.pausar.flatMap((agente) => agente.channels.map((linea) => linea.id));
    if (!lineas.length) continue;
    const pendientes = await prisma.follow.findMany({
      where: {
        workspaceId: plan.workspaceId,
        status: "PENDING",
        channelId: { in: lineas },
        OR: [{ name: { startsWith: PREFIJO_SIN_RESPONDER } }, { followRule: { is: { sourceType: "AGENT_NODE" } } }],
      },
      select: {
        id: true,
        name: true,
        status: true,
        cancelledAt: true,
        executionError: true,
        followRule: { select: { sourceType: true } },
      },
    });
    // Se vuelve a mirar con la misma regla que usa el envío (por si la consulta trae de más).
    plan.follows = pendientes.filter((follow) =>
      esSeguimientoDelV2({ nombre: follow.name, reglaSourceType: follow.followRule?.sourceType ?? null }),
    );
  }
  return [...porNegocio.values()];
}

function mostrarPlan(planes, log) {
  if (!planes.length) {
    log("No hay agentes V1/V2 activos: no hay nada que pausar.");
    return;
  }
  for (const plan of planes) {
    log(`Negocio ${plan.workspaceId}:`);
    for (const agente of plan.pausar) {
      log(`  - pausar "${agente.name}" (${agente.id}), líneas: ${agente.channels.map((l) => l.name).join(", ") || "ninguna"}`);
    }
    for (const { agente, lineasSinV3 } of plan.noPausar) {
      log(
        `  ! NO se pausa "${agente.name}" (${agente.id}): estas líneas no tienen el V3: ${lineasSinV3.map((l) => l.name).join(", ")}`,
      );
    }
    log(`  - seguimientos del V2 pendientes a cancelar: ${plan.follows.length}`);
  }
}

async function aplicar(prisma, planes, log) {
  const ahora = new Date();
  for (const plan of planes) {
    if (!plan.pausar.length) continue;
    const clave = claveDelRespaldo(plan.workspaceId);
    await prisma.$transaction(async (tx) => {
      // El respaldo primero. Si ya había uno (otro --aplicar), se suma: lo de antes es lo original.
      const previo = await tx.appSetting.findUnique({ where: { key: clave } });
      const respaldo = previo ? leerRespaldo(previo.value) : { agentes: [], follows: [] };
      const agentesYa = new Set(respaldo.agentes.map((fila) => fila.id));
      const followsYa = new Set(respaldo.follows.map((fila) => fila.id));
      for (const agente of plan.pausar) {
        if (!agentesYa.has(agente.id)) respaldo.agentes.push({ id: agente.id, status: agente.status, isActive: agente.isActive });
      }
      for (const follow of plan.follows) {
        if (!followsYa.has(follow.id)) {
          respaldo.follows.push({
            id: follow.id,
            status: follow.status,
            cancelledAt: follow.cancelledAt ? new Date(follow.cancelledAt).toISOString() : null,
            executionError: follow.executionError ?? null,
          });
        }
      }
      const valor = JSON.stringify({ guardadoEn: ahora.toISOString(), ...respaldo });
      await tx.appSetting.upsert({ where: { key: clave }, create: { key: clave, value: valor }, update: { value: valor } });

      for (const agente of plan.pausar) {
        await tx.agent.update({ where: { id: agente.id }, data: { status: "PAUSED", isActive: false } });
      }
      if (plan.follows.length) {
        await tx.follow.updateMany({
          where: { id: { in: plan.follows.map((follow) => follow.id) }, status: "PENDING" },
          data: {
            status: "CANCELLED",
            cancelledAt: ahora,
            executionError: MARCA_CANCELADO_POR_MOTORES_VIEJOS,
            lockedAt: null,
            lockedBy: null,
          },
        });
      }
    });
    log(`Negocio ${plan.workspaceId}: ${plan.pausar.length} agente(s) en pausa y ${plan.follows.length} seguimiento(s) cancelados. Respaldo en "${clave}".`);
  }
}

async function volver(prisma, workspaceId, log) {
  const respaldos = await prisma.appSetting.findMany({
    where: { key: workspaceId ? claveDelRespaldo(workspaceId) : { startsWith: PREFIJO_RESPALDO_MOTORES_VIEJOS } },
  });
  if (!respaldos.length) {
    log("No hay respaldo de motores viejos: no hay nada que volver.");
    return;
  }
  for (const fila of respaldos) {
    const respaldo = leerRespaldo(fila.value);
    await prisma.$transaction(async (tx) => {
      for (const agente of respaldo.agentes) {
        await tx.agent.update({ where: { id: agente.id }, data: { status: agente.status, isActive: agente.isActive } });
      }
      for (const follow of respaldo.follows) {
        // Solo los que canceló este script (con su marca): si después se cancelaron por otra cosa, no se reviven.
        await tx.follow.updateMany({
          where: { id: follow.id, status: "CANCELLED", executionError: MARCA_CANCELADO_POR_MOTORES_VIEJOS },
          data: {
            status: follow.status,
            cancelledAt: follow.cancelledAt ? new Date(follow.cancelledAt) : null,
            executionError: follow.executionError ?? null,
          },
        });
      }
      await tx.appSetting.delete({ where: { key: fila.key } });
    });
    log(`${fila.key}: ${respaldo.agentes.length} agente(s) y ${respaldo.follows.length} seguimiento(s) quedaron como estaban.`);
  }
}

/** Lo corre la línea de comandos y también la prueba (scripts/check-motores-viejos.mjs, con una base de mentira). */
export async function correr({ prisma, argumentos, log = console.log }) {
  const { modo, workspaceId } = leerArgumentos(argumentos);
  if (modo === "volver") {
    await volver(prisma, workspaceId, log);
    return { modo };
  }
  const planes = await planear(prisma, workspaceId);
  mostrarPlan(planes, log);
  if (modo === "aplicar") {
    await aplicar(prisma, planes, log);
  } else {
    log("Solo revisión: no se escribió nada. Para hacerlo, --aplicar.");
  }
  return { modo, planes };
}

const esLaLineaDeComandos = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esLaLineaDeComandos) {
  const requireNativo = createRequire(`${RAIZ}/package.json`);
  const { PrismaClient } = requireNativo("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await correr({ prisma, argumentos: process.argv.slice(2) });
  } catch (error) {
    console.error("apagar-motores-viejos falló:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
