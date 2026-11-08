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
  alcanzoElTopeDeReasignaciones,
  decidirDemora,
  dentroDeLaFranja,
  elegirAsesoraActiva,
  leerConfigDemoraDeTexto,
  type ConfigDemora,
} from "../domain/demora-de-asesora";
import { cargarEsperaDelNegocio, type ChatEnEspera } from "./espera-de-chats";

export * from "../domain/demora-de-asesora";

/**
 * EL RELOJ DE LA DEMORA DE LA ASESORA (parte 1: el aviso; parte 2: la reasignación). Lo llama
 * /api/cron/follows en cada vuelta (cada minuto). Las reglas están en domain/demora-de-asesora.ts.
 *
 * - Solo los negocios con `chats:demora-asesora:config:<negocio>` prendido. Apagado = no hace nada
 *   (y borra la hora de arranque, para que al volver a prenderla no avisen las esperas viejas).
 * - Solo chats en espera ASIGNADOS, del canal WhatsApp viejo y de una línea de ventas (purpose
 *   SALES). La línea oficial queda fuera: su asignación no deja nota con la hora.
 * - AVISO (5 min): a una asesora fuera de su horario de reparto (Mi empresa -> Equipo) no se le
 *   avisa; si cuando entra a su horario el chat sigue esperando, ahí le llega. Un aviso por reloj:
 *   la marca guarda el inicio del reloj. Primero se marca y después se manda: si el push falla, no
 *   se insiste cada minuto. Máximo MAXIMO_AVISOS_POR_VUELTA avisos por vuelta.
 * - REASIGNAR (10 min), camino aparte del aviso: el chat pasa a una asesora ACTIVA (mandó desde
 *   el CRM un mensaje escrito por ella en `minutosActiva`) que recibe reparto en esa línea, es
 *   miembro activo, está en su horario y no está en pausa manual. Se reasigna aunque la original
 *   esté fuera de su horario (el cliente está esperando). Una sola vez por espera; sin activa, o
 *   con el tope ya usado, el chat no se mueve y se avisa a dueños y administradores una vez por
 *   espera. No mueve la rueda del reparto, ni el estado, ni la etapa, ni el bot. Máximo
 *   MAXIMO_REASIGNACIONES_POR_VUELTA por vuelta; un error en un chat no frena los demás.
 * - Nunca le escribe nada al cliente: solo notas internas y push al equipo.
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

type NotasDeAsignacion = {
  /** La última asignación de cada chat a su asesora actual (ms). */
  ultimas: Map<string, number>;
  /** Las reasignaciones por demora de cada chat desde el `desde` de SU espera (ms), para el tope. */
  reasignaciones: Map<string, number[]>;
};

/** Las notas SYSTEM kind="assigned" de los chats: la última a su asesora actual y las de la demora. */
async function notasDeAsignacion(
  workspaceId: string,
  chats: Array<{ id: string; asesora: string; desde: number }>,
): Promise<NotasDeAsignacion> {
  const resultado: NotasDeAsignacion = { ultimas: new Map(), reasignaciones: new Map() };
  if (!chats.length) return resultado;
  // Las notas de antes de `desde` no mueven el reloj (gana el mayor) ni cuentan para el tope: no
  // hace falta leerlas. Cada chat se recorta después con SU `desde`.
  const masAntiguo = Math.min(...chats.map((chat) => chat.desde));
  const chatPorId = new Map(chats.map((chat) => [chat.id, chat]));
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
    const chat = nota.conversationId ? chatPorId.get(nota.conversationId) : undefined;
    if (!chat) continue;
    const payload = nota.rawPayload as { assigneeUserId?: unknown; origen?: unknown } | null;
    const en = nota.createdAt.getTime();
    if (payload?.origen === ORIGEN_REASIGNACION_POR_DEMORA && en >= chat.desde) {
      resultado.reasignaciones.set(chat.id, [...(resultado.reasignaciones.get(chat.id) ?? []), en]);
    }
    if (!resultado.ultimas.has(chat.id) && payload?.assigneeUserId === chat.asesora) {
      resultado.ultimas.set(chat.id, en);
    }
  }
  return resultado;
}

/**
 * La consulta de las ACTIVAS de un negocio: la última vez que cada persona mandó desde el CRM un
 * mensaje escrito por ella (source "manual" con autor; los de source "instance", del celular, no
 * tienen autor y no cuentan). Agrupada por autor y sin traer `rawPayload` entero (índice
 * workspaceId + createdAt). Separada de la que la corre, para probarla.
 */
export function sqlAsesorasActivas(input: { workspaceId: string; desde: Date }): Prisma.Sql {
  return Prisma.sql`
    SELECT m."rawPayload"->>'enviadoPorUserId' AS "userId", MAX(m."createdAt") AS "ultimo"
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
  const desde = new Date(ahora.getTime() - config.minutosActiva * 60_000);
  const filas = await prisma.$queryRaw<Array<{ userId: string | null; ultimo: Date }>>(
    sqlAsesorasActivas({ workspaceId, desde }),
  );
  const activas = new Map<string, number>();
  for (const fila of filas) {
    if (fila.userId) activas.set(fila.userId, new Date(fila.ultimo).getTime());
  }
  return activas;
}

/**
 * Quiénes pueden recibir un chat de esta línea AHORA, en el orden de la rueda: las del reparto
 * (sin pausadas ni monitoras), miembros activos, en su horario y sin pausa manual. Igual que el
 * reparto normal, sin tocar su rueda.
 */
async function candidatasDeLaLinea(workspaceId: string, metadata: unknown, ahora: Date): Promise<string[]> {
  const reparto = calcularReparto(metadata);
  if (!reparto.length) return [];
  const miembros = await prisma.workspaceMember.findMany({
    where: { workspaceId, isActive: true, userId: { in: reparto } },
    select: { userId: true },
  });
  const activos = new Set(miembros.map((m) => m.userId));
  const enHorario = await filtrarPorHorario(
    workspaceId,
    reparto.filter((id) => activos.has(id)),
    ahora,
  );
  const sinPausa = await filtrarSinPausaManual(workspaceId, enHorario, ahora);
  return enHorario.filter((id) => sinPausa.has(id));
}

/**
 * Antes de mover: ¿llegó una respuesta de una persona desde `desde`? Un mensaje humano (manual o
 * instance) que no falló, o una llamada atendida: la misma regla de la espera (claseDelEvento).
 */
async function respondioUnaPersona(workspaceId: string, conversationId: string, desde: number): Promise<boolean> {
  const filas = await prisma.$queryRaw<
    Array<{ d: string; t: string; o: string | null; x: string | null; en: Date }>
  >(Prisma.sql`
    SELECT m."direction"::text AS "d", m."type"::text AS "t", m."rawPayload"->>'source' AS "o",
           CASE WHEN m."type"::text = 'SYSTEM' THEN left(m."content", 200) END AS "x", m."createdAt" AS "en"
      FROM "Message" m
     WHERE m."workspaceId" = ${workspaceId}
       AND m."conversationId" = ${conversationId}
       AND m."createdAt" >= ${new Date(desde)}
       AND m."isStatusBroadcast" = false
       AND (
         (m."direction"::text = 'OUTBOUND' AND m."type"::text <> 'SYSTEM'
           AND m."status"::text <> 'FAILED' AND m."failedAt" IS NULL)
         OR (m."type"::text = 'SYSTEM' AND m."rawPayload"->>'source' = 'llamada')
       )
  `);
  return filas.some((fila) => {
    const clase = claseDelEvento({
      direccion: fila.d === "INBOUND" ? "IN" : "OUT",
      tipo: fila.t,
      origen: fila.o,
      texto: fila.x,
      en: new Date(fila.en),
    });
    return clase === "humano" || clase === "llamada_atendida";
  });
}

/** Push sin esperar ni lanzar: un push caído no frena el reloj. */
function pushSinBloquear(userId: string, payload: Parameters<typeof sendPushToUser>[0]["payload"]) {
  void sendPushToUser({ userId, payload }).catch((error) => {
    console.error("[demora-de-asesora] push error", error);
    return 0;
  });
}

/** Nombre de persona como en el reparto: name o email. */
function nombreDe(usuario: { name: string | null; email: string | null } | undefined, porDefecto: string) {
  return usuario?.name?.trim() || usuario?.email || porDefecto;
}

/** ¿Ya se avisó al dueño en ESTA espera? La marca guarda el `desde` (no el inicio del reloj). */
async function jefesYaAvisados(chat: { id: string; desde: number }): Promise<boolean> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveSinActiva(chat.id) }, select: { value: true } });
  return fila?.value === new Date(chat.desde).toISOString();
}

/**
 * Sin activa o con el tope usado: push a los OWNER/ADMIN activos (como avisarJefesDelRespaldo),
 * una sola vez por espera (la marca guarda el `desde` de la espera). El chat no cambia.
 * Devuelve true si avisó.
 */
async function avisarJefesDeLaDemora(input: {
  workspaceId: string;
  chat: { id: string; asesora: string; desde: number };
  motivo: "sin-activa" | "tope";
  minutos: number;
}): Promise<boolean> {
  if (await jefesYaAvisados(input.chat)) return false;
  const key = claveSinActiva(input.chat.id);
  const marca = new Date(input.chat.desde).toISOString();
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: marca }, update: { value: marca } });

  const [jefes, conversacion, asesora] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId, isActive: true, role: { in: ["OWNER", "ADMIN"] } },
      select: { userId: true },
    }),
    prisma.conversation.findUnique({
      where: { id: input.chat.id },
      select: { contact: { select: { name: true, phoneNumber: true } } },
    }),
    prisma.user.findUnique({ where: { id: input.chat.asesora }, select: { name: true, email: true } }),
  ]);
  const cliente = conversacion?.contact?.name?.trim() || conversacion?.contact?.phoneNumber || "Un cliente";
  const nombre = nombreDe(asesora ?? undefined, "su asesora");
  const body =
    input.motivo === "tope"
      ? `${cliente} sigue sin respuesta con ${nombre} (ya se reasignó una vez). Tócalo para abrir el chat.`
      : `${cliente} lleva ${input.minutos} min sin respuesta de ${nombre} y no hay otra asesora activa.`;
  for (const jefe of jefes) {
    pushSinBloquear(jefe.userId, {
      title: "Chat sin respuesta de la asesora",
      body,
      tag: `demora-jefes:${input.chat.id}`,
      url: urlDelChat(input.chat.id),
    });
  }
  return true;
}

/**
 * La escritura: pasa el chat de la original a la nueva SOLO si sigue siendo de la original y está
 * abierto o pendiente. count=0 = la asesora contestó o alguien lo movió a mano: no se hace nada más.
 */
async function reasignarChat(input: {
  workspaceId: string;
  chat: { id: string; asesora: string };
  nueva: string;
  minutos: number;
}): Promise<boolean> {
  const movido = await prisma.conversation.updateMany({
    where: { id: input.chat.id, assignedToUserId: input.chat.asesora, status: { in: ["OPEN", "PENDING"] } },
    data: { assignedToUserId: input.nueva },
  });
  if (movido.count === 0) return false;

  const [conversacion, usuarios] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: input.chat.id },
      select: { channelId: true, contactId: true, contact: { select: { name: true, phoneNumber: true } } },
    }),
    prisma.user.findMany({
      where: { id: { in: [input.chat.asesora, input.nueva] } },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const porId = new Map(usuarios.map((u) => [u.id, u]));
  const original = nombreDe(porId.get(input.chat.asesora), "Colaborador");
  const nueva = nombreDe(porId.get(input.nueva), "Colaborador");
  const cliente = conversacion?.contact?.name?.trim() || conversacion?.contact?.phoneNumber || "un cliente";

  await recordConversationActivity({
    workspaceId: input.workspaceId,
    conversationId: input.chat.id,
    channelId: conversacion?.channelId ?? null,
    contactId: conversacion?.contactId ?? null,
    kind: "assigned",
    assigneeUserId: input.nueva,
    reasignadoDeUserId: input.chat.asesora,
    origen: ORIGEN_REASIGNACION_POR_DEMORA,
    actorUserId: null,
    text: `Reasignado de ${original} a ${nueva} por no responder en ${input.minutos} min`,
  });

  pushSinBloquear(input.nueva, {
    title: "Te pasaron un chat",
    body: `Te pasaron un chat que lleva ${input.minutos} min esperando`,
    tag: `asignado:${input.chat.id}`,
    url: urlDelChat(input.chat.id),
  });
  pushSinBloquear(input.chat.asesora, {
    title: "Chat reasignado",
    body: `Se reasignó el chat de ${cliente} a ${nueva}`,
    tag: `demora:${input.chat.id}`,
    url: urlDelChat(input.chat.id),
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
  /** Los que se pasaron a una asesora activa. */
  reasignados: number;
  /** Los que se quedaron (sin activa o tope usado) y se le avisó al dueño. */
  avisosAJefes: number;
  /** Chats en los que algo falló (no frenan a los demás). */
  errores: number;
};

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
    // Se salta el negocio solo si ya no queda cupo ni de avisos ni de reasignaciones.
    if (
      resultado.avisados >= MAXIMO_AVISOS_POR_VUELTA &&
      resultado.reasignados >= MAXIMO_REASIGNACIONES_POR_VUELTA
    ) {
      continue;
    }

    const [espera, lineasDeVentas] = await Promise.all([
      cargarEsperaDelNegocio(workspaceId),
      prisma.whatsAppChannel.findMany({
        where: { workspaceId, purpose: "SALES" },
        select: { id: true, metadata: true },
      }),
    ]);
    const metadataDeLinea = new Map(lineasDeVentas.map((linea) => [linea.id, linea.metadata]));

    // Primero sin la nota de asignación: la nota solo puede ATRASAR el reloj, así que lo que
    // todavía no llega al aviso no la necesita.
    const candidatos = espera
      .filter(
        (chat): chat is ChatEnEspera & { assignedToUserId: string; channelId: string } =>
          !chat.oficial && Boolean(chat.assignedToUserId) && Boolean(chat.channelId) && metadataDeLinea.has(chat.channelId as string),
      )
      .map((chat) => ({
        id: chat.key.slice("agent:".length),
        asesora: chat.assignedToUserId,
        segunda: chat.segundoAsesorId,
        channelId: chat.channelId,
        desde: chat.desde,
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

    // La CARGA: chats esperando por asesora (como principal), con la misma lista ya cargada. Se
    // ajusta al mover cada chat, para que los de esta vuelta no le caigan todos a la misma.
    const esperandoPorAsesora = new Map<string, number>();
    for (const chat of espera) {
      if (chat.assignedToUserId) {
        esperandoPorAsesora.set(chat.assignedToUserId, (esperandoPorAsesora.get(chat.assignedToUserId) ?? 0) + 1);
      }
    }
    // Las activas y las candidatas de cada línea se leen una sola vez, y solo si hace falta.
    let activas: Map<string, number> | null = null;
    const candidatasPorLinea = new Map<string, string[]>();

    for (const chat of candidatos) {
      try {
        const decision = decidirDemora({
          config,
          desde: chat.desde,
          ultimaAsignacion: notas.ultimas.get(chat.id) ?? null,
          arranque,
          ahora,
        });
        if (decision.tipo === "nada") continue;
        const minutos = Math.floor((ahora.getTime() - decision.inicio) / 60_000);

        if (decision.tipo === "reasignar") {
          // Camino aparte del aviso de los 5 minutos.
          resultado.paraReasignar += 1;
          if (resultado.reasignados >= MAXIMO_REASIGNACIONES_POR_VUELTA) continue;

          const topeUsado = alcanzoElTopeDeReasignaciones(notas.reasignaciones.get(chat.id) ?? [], chat.desde);
          let nueva: string | null = null;
          if (!topeUsado) {
            activas ??= await asesorasActivas(workspaceId, config, ahora);
            let candidatas = candidatasPorLinea.get(chat.channelId);
            if (!candidatas) {
              candidatas = await candidatasDeLaLinea(workspaceId, metadataDeLinea.get(chat.channelId), ahora);
              candidatasPorLinea.set(chat.channelId, candidatas);
            }
            nueva = elegirAsesoraActiva({
              candidatas,
              ultimoMensajePorAsesora: activas,
              esperandoPorAsesora,
              original: chat.asesora,
              segunda: chat.segunda,
            });
          }

          // Ya se le avisó al dueño en esta espera: no hay nada más que hacer (ni que consultar).
          if (!nueva && (await jefesYaAvisados(chat))) continue;
          // Antes de escribir o avisar: ¿contestó una persona mientras tanto?
          if (await respondioUnaPersona(workspaceId, chat.id, chat.desde)) continue;

          if (!nueva) {
            if (resultado.avisosAJefes >= MAXIMO_REASIGNACIONES_POR_VUELTA) continue;
            const avisado = await avisarJefesDeLaDemora({
              workspaceId,
              chat,
              motivo: topeUsado ? "tope" : "sin-activa",
              minutos,
            });
            if (avisado) resultado.avisosAJefes += 1;
            continue;
          }

          if (await reasignarChat({ workspaceId, chat, nueva, minutos: config.minutosReasignar })) {
            resultado.reasignados += 1;
            esperandoPorAsesora.set(chat.asesora, Math.max(0, (esperandoPorAsesora.get(chat.asesora) ?? 0) - 1));
            esperandoPorAsesora.set(nueva, (esperandoPorAsesora.get(nueva) ?? 0) + 1);
          }
          continue;
        }

        // AVISO de los 5 minutos.
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
        // Un error en un chat no frena los demás.
        resultado.errores += 1;
        console.error("[demora-de-asesora] error en un chat", {
          conversationId: chat.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return resultado;
}
