import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { calcularReparto } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { filtrarSinPausaManual } from "@/lib/en-linea";
import { filtrarPorHorario, leerHorariosDeReparto, recibeEnEsteMomento } from "@/lib/horario-de-reparto";
import { claseDelEvento } from "@/lib/turno-de-la-conversacion";
import { sendPushToUser } from "@/lib/web-push";

import {
  ORIGEN_REASIGNACION_POR_DEMORA,
  PREFIJO_CONFIG_DEMORA,
  accionAlReasignar,
  decidirDemora,
  dentroDeLaFranja,
  leerConfigDemoraDeTexto,
  textoDeReasignacion,
  type ConfigDemora,
} from "../domain/demora-de-asesora";
import { cargarEsperaDelNegocio, type ChatEnEspera } from "./espera-de-chats";

export * from "../domain/demora-de-asesora";

/**
 * EL RELOJ DE LA DEMORA DE LA ASESORA (partes 1 y 2: el aviso y la reasignación). Lo llama
 * /api/cron/follows en cada vuelta (cada minuto). Las reglas están en domain/demora-de-asesora.ts.
 *
 * - Solo los negocios con `chats:demora-asesora:config:<negocio>` prendido. Apagado = no hace nada
 *   (y borra la hora de arranque, para que al volver a prenderla no avisen las esperas viejas).
 * - Solo chats en espera ASIGNADOS, del canal WhatsApp viejo y de una línea de ventas (purpose
 *   SALES). La línea oficial queda fuera: su asignación no deja nota con la hora.
 * - AVISO (a los 5 min): push a la asesora. A una asesora fuera de su horario de reparto (Mi
 *   empresa -> Equipo) no se le avisa; si cuando entra a su horario el chat sigue esperando, ahí le
 *   llega. Un aviso por reloj: la marca guarda el inicio del reloj. Primero se marca y después se
 *   manda: si el push falla, no se insiste cada minuto. Máximo MAXIMO_AVISOS_POR_VUELTA por vuelta.
 * - REASIGNACIÓN (a los 10 min): el chat pasa a una asesora ACTIVA de esa línea (aunque la original
 *   esté fuera de su horario), con nota en el chat y push a las dos. Sin activa, o si ya se
 *   reasignó una vez en esta espera, el chat no cambia y se avisa a dueños y administradores una
 *   sola vez por espera. Máximo MAXIMO_REASIGNACIONES_POR_VUELTA por vuelta (reasignaciones y avisos
 *   a los jefes). Un error en un chat no frena los demás.
 * - No mueve la rueda del reparto normal, ni el estado, la etapa o el bot del chat, y no le escribe
 *   nada al cliente.
 */

export const MAXIMO_AVISOS_POR_VUELTA = 15;
export const MAXIMO_REASIGNACIONES_POR_VUELTA = 15;

const claveArranque = (workspaceId: string) => `chats:demora-asesora:arranque:${workspaceId}`;
const claveAviso = (conversationId: string) => `chats:demora-asesora:aviso:${conversationId}`;
const claveSinActiva = (conversationId: string) => `chats:demora-asesora:sin-activa:${conversationId}`;

const urlDelChat = (conversationId: string) => `/cliente/chats?chatKey=agent:${conversationId}&assigned=all`;

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

type ChatConDemora = { id: string; asesora: string; desde: number; segunda: string | null; channelId: string };

type NotasDelChat = {
  /** La última asignación del chat a su asesora actual (ms). */
  ultimaAsignacion?: number;
  /** Reasignaciones por demora desde el `desde` de ESTA espera. */
  reasignaciones: number;
};

/** Las notas de asignación (SYSTEM kind="assigned") de cada chat, desde su `desde`. */
async function notasDeAsignacion(workspaceId: string, chats: ChatConDemora[]): Promise<Map<string, NotasDelChat>> {
  const resultado = new Map<string, NotasDelChat>(chats.map((chat) => [chat.id, { reasignaciones: 0 }]));
  if (!chats.length) return resultado;
  // Las notas de antes de `desde` no mueven el reloj (gana el mayor) ni cuentan para el tope.
  const masAntiguo = Math.min(...chats.map((chat) => chat.desde));
  const porId = new Map(chats.map((chat) => [chat.id, chat]));
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
  const vistas = new Set<string>();
  for (const nota of notas) {
    const chat = nota.conversationId ? porId.get(nota.conversationId) : undefined;
    const delChat = chat ? resultado.get(chat.id) : undefined;
    if (!chat || !delChat) continue;
    const payload = nota.rawPayload as { assigneeUserId?: unknown; origen?: unknown } | null;
    const en = nota.createdAt.getTime();
    // El tope mira TODAS las reasignaciones por demora desde el `desde` de ESTE chat.
    if (payload?.origen === ORIGEN_REASIGNACION_POR_DEMORA && en >= chat.desde) {
      delChat.reasignaciones += 1;
    }
    // El reloj: solo la nota más reciente, y si es a la asesora actual.
    if (vistas.has(chat.id)) continue;
    vistas.add(chat.id);
    if (payload?.assigneeUserId === chat.asesora) {
      delChat.ultimaAsignacion = en;
    }
  }
  return resultado;
}

/**
 * ACTIVAS: el último mensaje escrito desde el CRM por cada asesora en los últimos `minutosActiva`.
 * Agrupada por autor y sin traer rawPayload (como sqlEsperaDeChats). Los de source=instance no
 * tienen autor y no cuentan. Separada de quien la corre, para probarla.
 */
export function sqlAsesorasActivas(input: { workspaceId: string; desde: Date }): Prisma.Sql {
  return Prisma.sql`
    SELECT m."rawPayload"->>'enviadoPorUserId' AS "userId", max(m."createdAt") AS "ultimo"
      FROM "Message" m
     WHERE m."workspaceId" = ${input.workspaceId}
       AND m."createdAt" > ${input.desde}
       AND m."direction"::text = 'OUTBOUND'
       AND m."type"::text <> 'SYSTEM'
       AND m."status"::text <> 'FAILED'
       AND m."failedAt" IS NULL
       AND m."isStatusBroadcast" = false
       AND m."rawPayload"->>'source' = 'manual'
       AND m."rawPayload"->>'enviadoPorUserId' IS NOT NULL
     GROUP BY 1
  `;
}

async function asesorasActivas(workspaceId: string, config: ConfigDemora, ahora: Date): Promise<Map<string, number>> {
  const filas = await prisma.$queryRaw<Array<{ userId: string | null; ultimo: Date }>>(
    sqlAsesorasActivas({ workspaceId, desde: new Date(ahora.getTime() - config.minutosActiva * 60_000) }),
  );
  const activas = new Map<string, number>();
  for (const fila of filas) {
    if (fila.userId) activas.set(fila.userId, new Date(fila.ultimo).getTime());
  }
  return activas;
}

/** CANDIDATAS de una línea, en el orden de la rueda: como el reparto normal (reparto-de-leads.ts). */
async function candidatasDeLaLinea(workspaceId: string, metadata: unknown, ahora: Date): Promise<string[]> {
  const reparto = calcularReparto(metadata);
  if (!reparto.length) return [];
  const miembros = await prisma.workspaceMember.findMany({
    where: { workspaceId, isActive: true, userId: { in: reparto } },
    select: { userId: true },
  });
  const activos = new Set(miembros.map((miembro) => miembro.userId));
  const enHorario = await filtrarPorHorario(
    workspaceId,
    reparto.filter((id) => activos.has(id)),
    ahora,
  );
  const sinPausa = await filtrarSinPausaManual(workspaceId, enHorario, ahora);
  return enHorario.filter((id) => sinPausa.has(id));
}

/**
 * ANTES DE ESCRIBIR: ¿llegó una respuesta humana después de `desde`? Mensaje de una persona o
 * llamada atendida (claseDelEvento), sin contar envíos fallidos.
 */
async function yaRespondioUnaPersona(conversationId: string, desde: number): Promise<boolean> {
  const eventos = await prisma.message.findMany({
    where: {
      conversationId,
      createdAt: { gt: new Date(desde) },
      isStatusBroadcast: false,
      OR: [
        { direction: "OUTBOUND", type: { not: "SYSTEM" }, status: { not: "FAILED" }, failedAt: null },
        { type: "SYSTEM", rawPayload: { path: ["source"], equals: "llamada" } },
      ],
    },
    select: { direction: true, type: true, content: true, rawPayload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return eventos.some((evento) => {
    const origen = (evento.rawPayload as { source?: unknown } | null)?.source;
    const clase = claseDelEvento({
      direccion: evento.direction === "INBOUND" ? "IN" : "OUT",
      tipo: evento.type,
      origen: typeof origen === "string" ? origen : null,
      texto: evento.content,
      en: evento.createdAt,
    });
    return clase === "humano" || clase === "llamada_atendida";
  });
}

async function nombresDe(ids: string[]): Promise<Map<string, string>> {
  const usuarios = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  return new Map(usuarios.map((usuario) => [usuario.id, usuario.name?.trim() || usuario.email || "Asesora"]));
}

/** Push sin await bloqueante y sin lanzar. */
function pushSinEsperar(userId: string, payload: { title: string; body: string; tag: string; url: string }) {
  void sendPushToUser({ userId, payload }).catch((error) => {
    console.error("[demora-de-asesora] push error", error);
    return 0;
  });
}

/** SIN ACTIVA o TOPE: push a los OWNER/ADMIN activos, una sola vez por espera. Devuelve si avisó. */
async function avisarJefes(input: {
  workspaceId: string;
  chat: ChatConDemora;
  motivo: "sin-activa" | "tope";
  config: ConfigDemora;
}): Promise<boolean> {
  const key = claveSinActiva(input.chat.id);
  // La marca es el `desde` de la espera (no el inicio del reloj, que cambia a las 7:00 y al reasignar).
  const marca = new Date(input.chat.desde).toISOString();
  const ya = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  if (ya?.value === marca) return false;
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: marca }, update: { value: marca } });

  const [jefes, conversacion, nombres] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId, isActive: true, role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true },
    }),
    prisma.conversation.findUnique({
      where: { id: input.chat.id },
      select: { contact: { select: { name: true, phoneNumber: true } } },
    }),
    nombresDe([input.chat.asesora]),
  ]);
  const cliente = conversacion?.contact?.name?.trim() || conversacion?.contact?.phoneNumber || "un cliente";
  const asesora = nombres.get(input.chat.asesora) ?? "su asesora";
  const body =
    input.motivo === "tope"
      ? `El chat de ${cliente} ya se reasignó una vez y sigue sin respuesta (lo tiene ${asesora}).`
      : `No hay otra asesora activa para pasarle el chat de ${cliente}. Sigue con ${asesora}.`;
  for (const jefe of jefes) {
    pushSinEsperar(jefe.userId, {
      title: `Cliente esperando más de ${input.config.minutosReasignar} min`,
      body,
      tag: `demora-sin-activa:${input.chat.id}`,
      url: urlDelChat(input.chat.id),
    });
  }
  return true;
}

/** ESCRITURA de una reasignación. Devuelve si el chat se movió. */
async function reasignar(input: {
  workspaceId: string;
  chat: ChatConDemora;
  nueva: string;
  config: ConfigDemora;
}): Promise<boolean> {
  const { chat, nueva } = input;
  if (await yaRespondioUnaPersona(chat.id, chat.desde)) return false;

  const movido = await prisma.conversation.updateMany({
    where: { id: chat.id, assignedToUserId: chat.asesora, status: { in: ["OPEN", "PENDING"] } },
    data: { assignedToUserId: nueva },
  });
  // La asesora contestó, alguien lo movió a mano o se cerró: no se hace nada más.
  if (movido.count === 0) return false;

  const [conversacion, nombres] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: chat.id },
      select: { contactId: true, contact: { select: { name: true, phoneNumber: true } } },
    }),
    nombresDe([chat.asesora, nueva]),
  ]);
  const de = nombres.get(chat.asesora) ?? "Asesora";
  const a = nombres.get(nueva) ?? "Asesora";
  const cliente = conversacion?.contact?.name?.trim() || conversacion?.contact?.phoneNumber || "un cliente";

  await recordConversationActivity({
    workspaceId: input.workspaceId,
    conversationId: chat.id,
    channelId: chat.channelId,
    contactId: conversacion?.contactId ?? null,
    kind: "assigned",
    assigneeUserId: nueva,
    reasignadoDeUserId: chat.asesora,
    origen: ORIGEN_REASIGNACION_POR_DEMORA,
    actorUserId: null,
    text: textoDeReasignacion(de, a, input.config.minutosReasignar),
  });

  pushSinEsperar(nueva, {
    title: `Te pasaron un chat que lleva ${input.config.minutosReasignar} min esperando`,
    body: `${cliente} espera respuesta. Tócalo para abrir el chat.`,
    tag: `demora:${chat.id}`,
    url: urlDelChat(chat.id),
  });
  pushSinEsperar(chat.asesora, {
    title: `Se reasignó el chat de ${cliente} a ${a}`,
    body: `No tuvo respuesta en ${input.config.minutosReasignar} min.`,
    tag: `demora-reasignado:${chat.id}`,
    url: urlDelChat(chat.id),
  });
  return true;
}

export type ResultadoDeDemora = {
  negocios: number;
  revisados: number;
  avisados: number;
  fueraDeHorario: number;
  /** Ya pasaron los minutos de reasignar. */
  paraReasignar: number;
  reasignados: number;
  /** Avisos a dueños y administradores (sin activa o tope alcanzado). */
  avisosAJefes: number;
  errores: number;
};

/** Cuántos chats esperando tiene cada asesora como principal (la CARGA). */
function cargaPorAsesora(espera: ChatEnEspera[]): Map<string, number> {
  const carga = new Map<string, number>();
  for (const chat of espera) {
    if (chat.assignedToUserId) carga.set(chat.assignedToUserId, (carga.get(chat.assignedToUserId) ?? 0) + 1);
  }
  return carga;
}

export async function revisarDemorasDeAsesoras(ahora = new Date()): Promise<ResultadoDeDemora> {
  const resultado: ResultadoDeDemora = {
    negocios: 0,
    revisados: 0,
    avisados: 0,
    fueraDeHorario: 0,
    paraReasignar: 0,
    reasignados: 0,
    avisosAJefes: 0,
    errores: 0,
  };
  const reasignacionesHechas = () => resultado.reasignados + resultado.avisosAJefes;

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
    if (!dentroDeLaFranja(ahora)) continue;
    // Se salta el negocio solo si ya no queda lugar ni para avisos ni para reasignaciones.
    if (resultado.avisados >= MAXIMO_AVISOS_POR_VUELTA && reasignacionesHechas() >= MAXIMO_REASIGNACIONES_POR_VUELTA) {
      continue;
    }

    const [espera, lineasDeVentas] = await Promise.all([
      cargarEsperaDelNegocio(workspaceId),
      prisma.whatsAppChannel.findMany({ where: { workspaceId, purpose: "SALES" }, select: { id: true, metadata: true } }),
    ]);
    const metadataDe = new Map(lineasDeVentas.map((linea) => [linea.id, linea.metadata]));

    // Primero sin la nota de asignación: la nota solo puede ATRASAR el reloj, así que lo que
    // todavía no llega al aviso no la necesita.
    const candidatos: ChatConDemora[] = espera
      .filter((chat) => !chat.oficial && chat.assignedToUserId && chat.channelId && metadataDe.has(chat.channelId))
      .map((chat) => ({
        id: chat.key.slice("agent:".length),
        asesora: chat.assignedToUserId as string,
        desde: chat.desde,
        segunda: chat.segundoAsesorId,
        channelId: chat.channelId as string,
      }))
      .filter(
        (chat) =>
          decidirDemora({ config, desde: chat.desde, ultimaAsignacion: null, arranque, ahora }).tipo !== "nada",
      );
    resultado.revisados += candidatos.length;
    if (!candidatos.length) continue;

    const [notas, horarios] = await Promise.all([
      notasDeAsignacion(workspaceId, candidatos),
      leerHorariosDeReparto(workspaceId),
    ]);

    const porReasignar: Array<{ chat: ChatConDemora; reasignaciones: number }> = [];
    for (const chat of candidatos) {
      const delChat = notas.get(chat.id);
      const decision = decidirDemora({
        config,
        desde: chat.desde,
        ultimaAsignacion: delChat?.ultimaAsignacion ?? null,
        arranque,
        ahora,
      });
      if (decision.tipo === "nada") continue;

      // El camino de reasignar va aparte: a los 10 min ya no se manda el aviso de los 5.
      if (decision.tipo === "reasignar") {
        resultado.paraReasignar += 1;
        porReasignar.push({ chat, reasignaciones: delChat?.reasignaciones ?? 0 });
        continue;
      }

      if (!recibeEnEsteMomento(horarios[chat.asesora], ahora)) {
        resultado.fueraDeHorario += 1;
        continue;
      }
      if (resultado.avisados >= MAXIMO_AVISOS_POR_VUELTA) continue;

      try {
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
            url: urlDelChat(chat.id),
          },
        }).catch((error) => {
          console.error("[demora-de-asesora] push error", error);
          return 0;
        });
        resultado.avisados += 1;
      } catch (error) {
        resultado.errores += 1;
        console.error("[demora-de-asesora] aviso error", { conversationId: chat.id, error });
      }
    }

    if (!porReasignar.length || reasignacionesHechas() >= MAXIMO_REASIGNACIONES_POR_VUELTA) continue;

    // ACTIVAS: una consulta por negocio, solo si hay algún chat por reasignar.
    let activas: Map<string, number>;
    try {
      activas = await asesorasActivas(workspaceId, config, ahora);
    } catch (error) {
      resultado.errores += 1;
      console.error("[demora-de-asesora] activas error", { workspaceId, error });
      continue;
    }
    const carga = cargaPorAsesora(espera);
    // CANDIDATAS: una vez por línea en cada vuelta.
    const candidatasPorLinea = new Map<string, Promise<string[]>>();

    for (const { chat, reasignaciones } of porReasignar) {
      if (reasignacionesHechas() >= MAXIMO_REASIGNACIONES_POR_VUELTA) break;
      try {
        let candidatas = candidatasPorLinea.get(chat.channelId);
        if (!candidatas) {
          candidatas = candidatasDeLaLinea(workspaceId, metadataDe.get(chat.channelId), ahora);
          candidatasPorLinea.set(chat.channelId, candidatas);
        }
        const accion = accionAlReasignar({
          candidatas: await candidatas,
          ultimoMensajePorAsesora: activas,
          esperandoPorAsesora: carga,
          original: chat.asesora,
          segunda: chat.segunda,
          reasignacionesEnEstaEspera: reasignaciones,
        });
        if (accion.tipo === "avisar-jefes") {
          if (await avisarJefes({ workspaceId, chat, motivo: accion.motivo, config })) {
            resultado.avisosAJefes += 1;
          }
          continue;
        }
        if (await reasignar({ workspaceId, chat, nueva: accion.a, config })) {
          resultado.reasignados += 1;
          // La carga se mueve dentro de la vuelta: si no, todos le caerían a la misma.
          carga.set(chat.asesora, Math.max(0, (carga.get(chat.asesora) ?? 0) - 1));
          carga.set(accion.a, (carga.get(accion.a) ?? 0) + 1);
        }
      } catch (error) {
        resultado.errores += 1;
        // Si falló la lista de candidatas de la línea, el próximo chat de esa línea la vuelve a pedir.
        candidatasPorLinea.delete(chat.channelId);
        console.error("[demora-de-asesora] reasignación error", { conversationId: chat.id, error });
      }
    }
  }

  return resultado;
}
