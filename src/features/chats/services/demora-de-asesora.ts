import { prisma } from "@/lib/prisma";
import { leerHorariosDeReparto, recibeEnEsteMomento } from "@/lib/horario-de-reparto";
import { sendPushToUser } from "@/lib/web-push";

import {
  PREFIJO_CONFIG_DEMORA,
  decidirDemora,
  dentroDeLaFranja,
  leerConfigDemoraDeTexto,
} from "../domain/demora-de-asesora";
import { cargarEsperaDelNegocio } from "./espera-de-chats";

export * from "../domain/demora-de-asesora";

/**
 * EL RELOJ DE LA DEMORA DE LA ASESORA (parte 1: solo el aviso). Lo llama /api/cron/follows en
 * cada vuelta (cada minuto). Las reglas están en domain/demora-de-asesora.ts.
 *
 * - Solo los negocios con `chats:demora-asesora:config:<negocio>` prendido. Apagado = no hace nada
 *   (y borra la hora de arranque, para que al volver a prenderla no avisen las esperas viejas).
 * - Solo chats en espera ASIGNADOS, del canal WhatsApp viejo y de una línea de ventas (purpose
 *   SALES). La línea oficial queda fuera: su asignación no deja nota con la hora.
 * - A una asesora fuera de su horario de reparto (Mi empresa -> Equipo) no se le avisa; si cuando
 *   entra a su horario el chat sigue esperando, ahí le llega.
 * - Un aviso por reloj: la marca guarda el inicio del reloj. Primero se marca y después se manda:
 *   si el push falla, no se insiste cada minuto.
 * - Máximo MAXIMO_AVISOS_POR_VUELTA avisos por vuelta.
 * - No cambia ninguna asignación ni le escribe nada al cliente.
 */

export const MAXIMO_AVISOS_POR_VUELTA = 15;

const claveArranque = (workspaceId: string) => `chats:demora-asesora:arranque:${workspaceId}`;
const claveAviso = (conversationId: string) => `chats:demora-asesora:aviso:${conversationId}`;

/** Cuándo se prendió la regla en el negocio (como desdeCuandoTrabaja en cliente-esperando.ts). */
async function desdeCuandoCorre(workspaceId: string, ahora: Date): Promise<number> {
  const key = claveArranque(workspaceId);
  const fila = await prisma.appSetting.findUnique({ where: { key } });
  const guardado = fila?.value ? Date.parse(fila.value) : Number.NaN;
  if (Number.isFinite(guardado)) {
    return guardado;
  }
  const valor = ahora.toISOString();
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: valor }, update: { value: valor } });
  return ahora.getTime();
}

/** La última asignación de cada chat a su asesora actual (nota SYSTEM kind="assigned"). */
async function ultimasAsignaciones(
  workspaceId: string,
  chats: Array<{ id: string; asesora: string; desde: number }>,
): Promise<Map<string, number>> {
  const resultado = new Map<string, number>();
  if (!chats.length) return resultado;
  // Las notas de antes de `desde` no mueven el reloj (gana el mayor): no hace falta leerlas.
  const masAntiguo = Math.min(...chats.map((chat) => chat.desde));
  const asesoraDe = new Map(chats.map((chat) => [chat.id, chat.asesora]));
  const notas = await prisma.message.findMany({
    where: {
      workspaceId,
      conversationId: { in: chats.map((chat) => chat.id) },
      type: "SYSTEM",
      createdAt: { gte: new Date(masAntiguo) },
      rawPayload: { path: ["kind"], equals: "assigned" },
    },
    select: { conversationId: true, createdAt: true, rawPayload: true },
    orderBy: { createdAt: "desc" },
  });
  for (const nota of notas) {
    if (!nota.conversationId || resultado.has(nota.conversationId)) continue;
    const payload = nota.rawPayload as { assigneeUserId?: unknown } | null;
    if (payload?.assigneeUserId === asesoraDe.get(nota.conversationId)) {
      resultado.set(nota.conversationId, nota.createdAt.getTime());
    }
  }
  return resultado;
}

export type ResultadoDeDemora = {
  negocios: number;
  revisados: number;
  avisados: number;
  fueraDeHorario: number;
  /** Ya pasaron los minutos de reasignar (la parte 2 los moverá; acá solo se cuentan). */
  paraReasignar: number;
};

export async function revisarDemorasDeAsesoras(ahora = new Date()): Promise<ResultadoDeDemora> {
  const resultado: ResultadoDeDemora = { negocios: 0, revisados: 0, avisados: 0, fueraDeHorario: 0, paraReasignar: 0 };

  const configuraciones = await prisma.appSetting.findMany({
    where: { key: { startsWith: PREFIJO_CONFIG_DEMORA } },
    select: { key: true, value: true },
  });

  for (const fila of configuraciones) {
    const workspaceId = fila.key.slice(PREFIJO_CONFIG_DEMORA.length);
    if (!workspaceId) continue;
    const config = leerConfigDemoraDeTexto(fila.value);
    if (!config.activo) {
      // Apagada: al volver a prenderla, el arranque es ese momento y no el de la vez anterior.
      await prisma.appSetting.deleteMany({ where: { key: claveArranque(workspaceId) } });
      continue;
    }
    resultado.negocios += 1;

    // El arranque se guarda aunque sea de noche: lo que llegó antes de prenderla no avisa.
    const arranque = await desdeCuandoCorre(workspaceId, ahora);
    if (!dentroDeLaFranja(ahora) || resultado.avisados >= MAXIMO_AVISOS_POR_VUELTA) continue;

    const [espera, lineasDeVentas] = await Promise.all([
      cargarEsperaDelNegocio(workspaceId),
      prisma.whatsAppChannel.findMany({ where: { workspaceId, purpose: "SALES" }, select: { id: true } }),
    ]);
    const ventas = new Set(lineasDeVentas.map((linea) => linea.id));

    // Primero sin la nota de asignación: la nota solo puede ATRASAR el reloj, así que lo que
    // todavía no llega al aviso no la necesita.
    const candidatos = espera
      .filter((chat) => !chat.oficial && chat.assignedToUserId && chat.channelId && ventas.has(chat.channelId))
      .map((chat) => ({
        id: chat.key.slice("agent:".length),
        asesora: chat.assignedToUserId as string,
        desde: chat.desde,
      }))
      .filter(
        (chat) =>
          decidirDemora({ config, desde: chat.desde, ultimaAsignacion: null, arranque, ahora }).tipo !== "nada",
      );
    resultado.revisados += candidatos.length;
    if (!candidatos.length) continue;

    const [asignaciones, horarios] = await Promise.all([
      ultimasAsignaciones(workspaceId, candidatos),
      leerHorariosDeReparto(workspaceId),
    ]);

    for (const chat of candidatos) {
      const decision = decidirDemora({
        config,
        desde: chat.desde,
        ultimaAsignacion: asignaciones.get(chat.id) ?? null,
        arranque,
        ahora,
      });
      if (decision.tipo === "nada") continue;
      if (decision.tipo === "reasignar") resultado.paraReasignar += 1;

      if (!recibeEnEsteMomento(horarios[chat.asesora], ahora)) {
        resultado.fueraDeHorario += 1;
        continue;
      }
      if (resultado.avisados >= MAXIMO_AVISOS_POR_VUELTA) continue;

      // Un aviso por reloj (la marca es el inicio del reloj de ESTA espera).
      const key = claveAviso(chat.id);
      const marca = new Date(decision.inicio).toISOString();
      const yaAvisado = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
      if (yaAvisado?.value === marca) continue;
      await prisma.appSetting.upsert({ where: { key }, create: { key, value: marca }, update: { value: marca } });

      const minutos = Math.floor((ahora.getTime() - decision.inicio) / 60_000);
      await sendPushToUser({
        userId: chat.asesora,
        payload: {
          title: "Tienes un cliente esperando",
          body: `Lleva ${minutos} min sin respuesta. Tócalo para abrir el chat.`,
          tag: `demora:${chat.id}`,
          url: `/cliente/chats?chatKey=agent:${chat.id}&assigned=all`,
        },
      }).catch((error) => {
        console.error("[demora-de-asesora] push error", error);
        return 0;
      });
      resultado.avisados += 1;
    }
  }

  return resultado;
}
