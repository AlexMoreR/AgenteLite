import type { Prisma } from "@prisma/client";

import { leerColaboradores } from "@/lib/channel-collaborators";
import { prisma } from "@/lib/prisma";
import {
  MAXIMO_POR_EJECUCION,
  limpiarAutomatizacion,
  type AutomatizacionDeAsignacion,
  type UltimaEjecucion,
} from "./tipos";

function claveDe(workspaceId: string) {
  return `crm:automatizaciones:${workspaceId}`;
}

export async function leerAutomatizaciones(workspaceId: string): Promise<AutomatizacionDeAsignacion[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDe(workspaceId) } });
  if (!fila?.value) {
    return [];
  }
  try {
    const datos = JSON.parse(fila.value);
    if (!Array.isArray(datos)) {
      return [];
    }
    return datos.flatMap((item): AutomatizacionDeAsignacion[] => {
      const limpia = limpiarAutomatizacion(item);
      const id = item && typeof item.id === "string" ? item.id : "";
      if (!limpia || !id) {
        return [];
      }
      const ultima = item.ultimaEjecucion as UltimaEjecucion | null | undefined;
      return [
        {
          ...limpia,
          id,
          ultimaEjecucion:
            ultima && typeof ultima.fecha === "string" && typeof ultima.asignados === "number"
              ? { fecha: ultima.fecha, asignados: ultima.asignados, por: String(ultima.por ?? "") }
              : null,
        },
      ];
    });
  } catch {
    // Un valor ilegible no puede dejar la pantalla sin abrir: se empieza de cero.
    return [];
  }
}

export async function guardarAutomatizaciones(workspaceId: string, lista: AutomatizacionDeAsignacion[]) {
  const value = JSON.stringify(lista);
  await prisma.appSetting.upsert({
    where: { key: claveDe(workspaceId) },
    create: { key: claveDe(workspaceId), value },
    update: { value },
  });
}

type Criterios = Omit<AutomatizacionDeAsignacion, "id" | "ultimaEjecucion" | "nombre">;

/**
 * Que conversaciones toma una automatizacion.
 *
 * Nunca toma las que ya son de la persona destino: "asignarle 20" tiene que darle 20 NUEVOS, no
 * contarle los que ya tenia.
 */
export function dondeDeLaAutomatizacion(workspaceId: string, criterios: Criterios): Prisma.ConversationWhereInput {
  const condiciones: Prisma.ConversationWhereInput[] = [
    // Con OR y no con `not`: en SQL "distinto de X" deja afuera a los que no tienen dueno.
    { OR: [{ assignedToUserId: null }, { assignedToUserId: { not: criterios.asignarA } }] },
  ];
  if (criterios.soloAbiertas) {
    condiciones.push({ status: { in: ["OPEN", "PENDING"] } });
  }
  if (criterios.canalId) {
    condiciones.push({ channelId: criterios.canalId });
  }
  if (criterios.dueno === "sin_asignar") {
    condiciones.push({ assignedToUserId: null });
  } else if (criterios.dueno.startsWith("de:")) {
    condiciones.push({ assignedToUserId: criterios.dueno.slice(3) });
  }
  if (criterios.etapas.length > 0) {
    condiciones.push({ contact: { crmStage: { in: criterios.etapas } } });
  }
  if (criterios.diasSinMensajes) {
    // "Sin mensajes de nadie": el ultimo mensaje del chat, venga del cliente o nuestro.
    condiciones.push({ lastMessageAt: { lt: new Date(Date.now() - criterios.diasSinMensajes * 86_400_000) } });
  }
  return { workspaceId, AND: condiciones };
}

/**
 * Cuantos leads tomaria ahora, y cuantos de esos la persona destino NO podria ver.
 *
 * El segundo numero existe porque un canal con colaboradores solo se le muestra a ellos: asignarle
 * a alguien un chat de un canal donde no trabaja lo deja con un lead que no aparece en su bandeja.
 */
export async function contarLeads(workspaceId: string, criterios: Criterios) {
  const where = dondeDeLaAutomatizacion(workspaceId, criterios);
  const [porCanal, canales] = await Promise.all([
    prisma.conversation.groupBy({ by: ["channelId"], where, _count: { _all: true } }),
    prisma.whatsAppChannel.findMany({ where: { workspaceId }, select: { id: true, metadata: true } }),
  ]);

  const total = porCanal.reduce((suma, fila) => suma + fila._count._all, 0);
  const noLoVeria = porCanal.reduce((suma, fila) => {
    const canal = canales.find((item) => item.id === fila.channelId);
    const colaboradores = canal ? leerColaboradores(canal.metadata) : [];
    return colaboradores.length > 0 && !colaboradores.includes(criterios.asignarA)
      ? suma + fila._count._all
      : suma;
  }, 0);

  const tope = Math.min(criterios.cantidad ?? MAXIMO_POR_EJECUCION, MAXIMO_POR_EJECUCION);
  return { total, tomaria: Math.min(total, tope), noLoVeria };
}

/**
 * Asigna los leads y deja la nota en cada chat, igual que el boton Asignar.
 *
 * Toma primero los que tuvieron movimiento mas reciente: son los que todavia se pueden recuperar.
 * Todo va en una transaccion: o quedan asignados con su nota, o no cambia nada.
 */
export async function ejecutarAsignacion(input: {
  workspaceId: string;
  criterios: Criterios;
  textoDeLaNota: string;
}): Promise<number> {
  const tope = Math.min(input.criterios.cantidad ?? MAXIMO_POR_EJECUCION, MAXIMO_POR_EJECUCION);
  const filas = await prisma.conversation.findMany({
    where: dondeDeLaAutomatizacion(input.workspaceId, input.criterios),
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
    take: tope,
    select: { id: true, channelId: true, contactId: true },
  });
  if (filas.length === 0) {
    return 0;
  }

  await prisma.$transaction([
    prisma.conversation.updateMany({
      where: { id: { in: filas.map((fila) => fila.id) }, workspaceId: input.workspaceId },
      data: { assignedToUserId: input.criterios.asignarA },
    }),
    prisma.message.createMany({
      data: filas.map((fila) => ({
        workspaceId: input.workspaceId,
        conversationId: fila.id,
        channelId: fila.channelId,
        contactId: fila.contactId,
        direction: "OUTBOUND" as const,
        type: "SYSTEM" as const,
        status: "SENT" as const,
        content: input.textoDeLaNota,
        rawPayload: { source: "activity", kind: "assigned" },
      })),
    }),
  ]);

  return filas.length;
}
