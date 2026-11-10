import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { calcularReparto } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { filtrarSinPausaManual } from "@/lib/en-linea";
import { filtrarPorHorario, leerHorariosDeReparto, recibeEnEsteMomento } from "@/lib/horario-de-reparto";
import { ORIGENES_HUMANOS, claseDelEvento } from "@/lib/turno-de-la-conversacion";
import { sendPushToUser } from "@/lib/web-push";

import {
  ORIGEN_REASIGNACION_POR_DEMORA,
  PREFIJO_CONFIG_DEMORA,
  decidirDemora,
  dentroDeLaFranja,
  elegirAsesoraActiva,
  leerConfigDemoraDeTexto,
  topeDeReasignacionAlcanzado,
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
 * - A los 5 min (AVISO): push a la asesora. A una asesora fuera de su horario de reparto (Mi empresa
 *   -> Equipo) no se le avisa; si cuando entra a su horario el chat sigue esperando, ahí le llega.
 *   Un aviso por reloj: la marca guarda el inicio del reloj. Primero se marca y después se manda:
 *   si el push falla, no se insiste cada minuto. Máximo MAXIMO_AVISOS_POR_VUELTA por vuelta.
 * - A los 10 min (REASIGNAR, aunque la original esté fuera de su horario): el chat pasa a una
 *   asesora ACTIVA (escribió desde el CRM en los últimos `minutosActiva`) que recibe reparto en esa
 *   línea, es miembro activo, está en su horario y no está en pausa manual. Nota en el chat y push a
 *   las dos. Una sola vez por espera; sin activa, o con la reasignación ya usada, el chat se queda y
 *   se avisa a dueños y administradores (una vez por espera). Máximo MAXIMO_REASIGNACIONES_POR_VUELTA.
 *   No mueve la rueda del reparto normal ni cambia estado, etapa ni el bot.
 * - Nunca le escribe nada al cliente.
 */

export const MAXIMO_AVISOS_POR_VUELTA = 15;
export const MAXIMO_REASIGNACIONES_POR_VUELTA = 15;

const claveArranque = (workspaceId: string) => `chats:demora-asesora:arranque:${workspaceId}`;
const claveAviso = (conversationId: string) => `chats:demora-asesora:aviso:${conversationId}`;
const claveSinActiva = (conversationId: string) => `chats:demora-asesora:sin-activa:${conversationId}`;

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
  /** La última asignación del chat a su asesora actual (ms). */
  ultimaAsignacion: Map<string, number>;
  /** Las reasignaciones de esta regla de cada chat, dentro de SU espera (ms). */
  reasignaciones: Map<string, number[]>;
};

/** Las notas SYSTEM kind="assigned" de los chats, desde el `desde` de cada uno. */
async function notasDeAsignacion(
  workspaceId: string,
  chats: Array<{ id: string; asesora: string; desde: number }>,
): Promise<NotasDeAsignacion> {
  const resultado: NotasDeAsignacion = { ultimaAsignacion: new Map(), reasignaciones: new Map() };
  if (!chats.length) return resultado;
  // Las notas de antes de `desde` no mueven el reloj (gana el mayor) ni cuentan para el tope:
  // se piden desde el más antiguo y cada chat se recorta con su propio `desde`.
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
  for (const nota of notas) {
    const chat = nota.conversationId ? porId.get(nota.conversationId) : undefined;
    if (!chat) continue;
    const en = nota.createdAt.getTime();
    const payload = nota.rawPayload as { assigneeUserId?: unknown; origen?: unknown } | null;
    if (payload?.origen === ORIGEN_REASIGNACION_POR_DEMORA && en >= chat.desde) {
      resultado.reasignaciones.set(chat.id, [...(resultado.reasignaciones.get(chat.id) ?? []), en]);
    }
    if (!resultado.ultimaAsignacion.has(chat.id) && payload?.assigneeUserId === chat.asesora) {
      resultado.ultimaAsignacion.set(chat.id, en);
    }
  }
  return resultado;
}

/**
 * Las ACTIVAS del negocio: el último mensaje que cada persona escribió desde el CRM dentro de
 * `minutosActiva`. Una consulta agrupada (índice workspaceId + createdAt), sin traer `rawPayload`.
 * Los del celular (source=instance) no guardan autor y no cuentan.
 */
export function sqlActivasDelNegocio(input: { workspaceId: string; desde: Date }): Prisma.Sql {
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

async function activasDelNegocio(workspaceId: string, config: ConfigDemora, ahora: Date): Promise<Map<string, number>> {
  const filas = await prisma.$queryRaw<Array<{ userId: string | null; ultimo: Date }>>(
    sqlActivasDelNegocio({ workspaceId, desde: new Date(ahora.getTime() - config.minutosActiva * 60_000) }),
  );
  const activas = new Map<string, number>();
  for (const fila of filas) {
    if (fila.userId) activas.set(fila.userId, new Date(fila.ultimo).getTime());
  }
  return activas;
}

/**
 * Las que pueden recibir el chat en una línea, en el orden de la rueda (empieza después de la
 * última asignada, sin moverla): reparto (sin pausadas ni monitoras), miembros activos, en su
 * horario y sin pausa manual. Igual que autoAssignConversationToCollaborator.
 */
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
  const lista = enHorario.filter((id) => sinPausa.has(id));
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const ultima = typeof meta.lastAutoAssignedUserId === "string" ? reparto.indexOf(meta.lastAutoAssignedUserId) : -1;
  if (ultima < 0) return lista;
  // El turno sigue después de la última asignada: rotar por su lugar en la rueda completa.
  const lugar = (id: string) => (reparto.indexOf(id) - ultima - 1 + reparto.length) % reparto.length;
  return [...lista].sort((a, b) => lugar(a) - lugar(b));
}

/** ¿Le contestó una persona después de `desde`? (mensaje humano o llamada atendida, sin fallos). */
async function respondioUnaPersona(workspaceId: string, conversationId: string, desde: number): Promise<boolean> {
  const eventos = await prisma.message.findMany({
    where: {
      workspaceId,
      conversationId,
      createdAt: { gt: new Date(desde) },
      isStatusBroadcast: false,
      OR: [
        ...ORIGENES_HUMANOS.map((origen) => ({
          direction: "OUTBOUND" as const,
          type: { not: "SYSTEM" as const },
          status: { not: "FAILED" as const },
          failedAt: null,
          rawPayload: { path: ["source"], equals: origen },
        })),
        { type: "SYSTEM" as const, rawPayload: { path: ["source"], equals: "llamada" } },
      ],
    },
    select: { direction: true, type: true, content: true, createdAt: true, rawPayload: true },
  });
  return eventos.some((evento) => {
    const origen = (evento.rawPayload as { source?: unknown } | null)?.source;
    const clase = claseDelEvento({
      direccion: evento.direction === "INBOUND" ? "IN" : "OUT",
      tipo: evento.type,
      origen: typeof origen === "string" ? origen : null,
      texto: evento.type === "SYSTEM" ? evento.content : null,
      en: evento.createdAt,
    });
    return clase === "humano" || clase === "llamada_atendida";
  });
}

function nombreDe(usuario: { name: string | null; email: string | null } | undefined): string {
  return usuario?.name?.trim() || usuario?.email || "Colaborador";
}

/** Push sin esperar y sin lanzar: un push caído no frena la vuelta. */
function pushSinBloquear(userId: string, payload: Parameters<typeof sendPushToUser>[0]["payload"]): void {
  void sendPushToUser({ userId, payload }).catch((error) => {
    console.error("[demora-de-asesora] push error", error);
    return 0;
  });
}

const urlDelChat = (conversationId: string) => `/cliente/chats?chatKey=agent:${conversationId}&assigned=all`;

/**
 * Sin activa o con la reasignación ya usada: push a dueños y administradores activos, una vez por
 * espera (la marca guarda el `desde` de la espera). El chat no cambia. true = se avisó ahora.
 */
async function avisarJefesDeLaDemora(input: {
  workspaceId: string;
  conversationId: string;
  desde: number;
  motivo: "sin-activa" | "tope";
  cliente: string;
  asesora: string;
  minutos: number;
}): Promise<boolean> {
  const key = claveSinActiva(input.conversationId);
  const marca = new Date(input.desde).toISOString();
  const yaAvisado = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
  if (yaAvisado?.value === marca) return false;
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: marca }, update: { value: marca } });

  const jefes = await prisma.workspaceMember.findMany({
    where: { workspaceId: input.workspaceId, isActive: true, role: { in: ["OWNER", "ADMIN"] } },
    select: { userId: true },
  });
  const body =
    input.motivo === "tope"
      ? `${input.cliente} sigue sin respuesta: ya se reasignó una vez y ${input.asesora} tampoco contesta.`
      : `${input.cliente} lleva ${input.minutos} min sin respuesta y no hay otra asesora activa. Sigue con ${input.asesora}.`;
  for (const jefe of jefes) {
    pushSinBloquear(jefe.userId, {
      title: "Un cliente sigue esperando",
      body,
      tag: `demora-jefes:${input.conversationId}`,
      url: urlDelChat(input.conversationId),
    });
  }
  return true;
}

export type ResultadoDeDemora = {
  negocios: number;
  revisados: number;
  avisados: number;
  fueraDeHorario: number;
  /** Ya pasaron los minutos de reasignar. */
  paraReasignar: number;
  /** Chats que pasaron a otra asesora en esta vuelta. */
  reasignados: number;
  /** Sin activa a quién pasarlo: se avisó (o ya se había avisado) al dueño. */
  sinActiva: number;
  /** Ya se usó la reasignación de esa espera: se avisó (o ya se había avisado) al dueño. */
  topeAlcanzado: number;
  /** Chats en los que algo falló (no frenan a los demás). */
  errores: number;
};

type ChatDemorado = { id: string; asesora: string; segunda: string | null; channelId: string; desde: number };

export async function revisarDemorasDeAsesoras(ahora = new Date()): Promise<ResultadoDeDemora> {
  const resultado: ResultadoDeDemora = {
    negocios: 0,
    revisados: 0,
    avisados: 0,
    fueraDeHorario: 0,
    paraReasignar: 0,
    reasignados: 0,
    sinActiva: 0,
    topeAlcanzado: 0,
    errores: 0,
  };
  // Los avisos al dueño también tienen tope por vuelta (a las 7:10 llegan muchas esperas juntas).
  const vuelta = { avisosAJefes: 0 };

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
    // Solo se salta el negocio si ya no queda nada que hacer en esta vuelta (ni avisos ni reasignaciones).
    if (resultado.avisados >= MAXIMO_AVISOS_POR_VUELTA && resultado.reasignados >= MAXIMO_REASIGNACIONES_POR_VUELTA) {
      continue;
    }

    const [espera, lineasDeVentas] = await Promise.all([
      cargarEsperaDelNegocio(workspaceId),
      prisma.whatsAppChannel.findMany({ where: { workspaceId, purpose: "SALES" }, select: { id: true, metadata: true } }),
    ]);
    const metadataDeLinea = new Map(lineasDeVentas.map((linea) => [linea.id, linea.metadata]));

    // Primero sin la nota de asignación: la nota solo puede ATRASAR el reloj, así que lo que
    // todavía no llega al aviso no la necesita.
    const candidatos: ChatDemorado[] = espera
      .filter(
        (chat) => !chat.oficial && chat.assignedToUserId && chat.channelId && metadataDeLinea.has(chat.channelId),
      )
      .map((chat) => ({
        id: chat.key.slice("agent:".length),
        asesora: chat.assignedToUserId as string,
        segunda: chat.segundoAsesorId,
        channelId: chat.channelId as string,
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

    const porReasignar: Array<ChatDemorado & { inicio: number }> = [];
    for (const chat of candidatos) {
      const decision = decidirDemora({
        config,
        desde: chat.desde,
        ultimaAsignacion: notas.ultimaAsignacion.get(chat.id) ?? null,
        arranque,
        ahora,
      });
      if (decision.tipo === "nada") continue;
      // A los 10 min el camino es otro: reasignar (o avisar al dueño), no el push de los 5.
      if (decision.tipo === "reasignar") {
        resultado.paraReasignar += 1;
        porReasignar.push({ ...chat, inicio: decision.inicio });
        continue;
      }

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
          url: urlDelChat(chat.id),
        },
      }).catch((error) => {
        console.error("[demora-de-asesora] push error", error);
        return 0;
      });
      resultado.avisados += 1;
    }

    if (porReasignar.length) {
      await reasignarDemorados({
        workspaceId,
        config,
        ahora,
        espera,
        metadataDeLinea,
        notas,
        porReasignar,
        resultado,
        vuelta,
      });
    }
  }

  return resultado;
}

/** Cuántos chats esperando tiene cada asesora como principal (de la misma lista ya cargada). */
function esperandoPorAsesora(espera: ChatEnEspera[]): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const chat of espera) {
    if (chat.assignedToUserId) cuenta.set(chat.assignedToUserId, (cuenta.get(chat.assignedToUserId) ?? 0) + 1);
  }
  return cuenta;
}

async function reasignarDemorados(input: {
  workspaceId: string;
  config: ConfigDemora;
  ahora: Date;
  espera: ChatEnEspera[];
  metadataDeLinea: Map<string, unknown>;
  notas: NotasDeAsignacion;
  porReasignar: Array<ChatDemorado & { inicio: number }>;
  resultado: ResultadoDeDemora;
  vuelta: { avisosAJefes: number };
}): Promise<void> {
  const { workspaceId, config, ahora, resultado } = input;
  // Lo que se lee una vez por negocio (activas) o por línea (candidatas), solo si hace falta.
  let activas: Map<string, number> | null = null;
  const candidatasPorLinea = new Map<string, string[]>();
  // La carga se ajusta en la misma vuelta: si no, los 15 chats le caerían a la misma asesora.
  const carga = esperandoPorAsesora(input.espera);

  for (const chat of input.porReasignar) {
    try {
      const tope = topeDeReasignacionAlcanzado(input.notas.reasignaciones.get(chat.id) ?? [], chat.desde);
      if (!tope && resultado.reasignados >= MAXIMO_REASIGNACIONES_POR_VUELTA) continue;

      let nueva: string | null = null;
      if (!tope) {
        activas ??= await activasDelNegocio(workspaceId, config, ahora);
        let candidatas = candidatasPorLinea.get(chat.channelId);
        if (!candidatas) {
          candidatas = await candidatasDeLaLinea(workspaceId, input.metadataDeLinea.get(chat.channelId), ahora);
          candidatasPorLinea.set(chat.channelId, candidatas);
        }
        nueva = elegirAsesoraActiva({
          candidatas,
          ultimoMensajePorAsesora: activas,
          esperandoPorAsesora: carga,
          original: chat.asesora,
          segunda: chat.segunda,
        });
      }

      // Antes de escribir o avisar: ¿contestó alguien en este rato?
      if (await respondioUnaPersona(workspaceId, chat.id, chat.desde)) continue;

      const conversacion = await prisma.conversation.findUnique({
        where: { id: chat.id },
        select: { channelId: true, contactId: true, contact: { select: { name: true, phoneNumber: true } } },
      });
      if (!conversacion) continue;
      const cliente = conversacion.contact?.name?.trim() || conversacion.contact?.phoneNumber || "un cliente";
      const usuarios = await prisma.user.findMany({
        where: { id: { in: [chat.asesora, ...(nueva ? [nueva] : [])] } },
        select: { id: true, name: true, email: true },
      });
      const nombre = (id: string) => nombreDe(usuarios.find((usuario) => usuario.id === id));

      if (!nueva) {
        if (tope) resultado.topeAlcanzado += 1;
        else resultado.sinActiva += 1;
        if (input.vuelta.avisosAJefes >= MAXIMO_AVISOS_POR_VUELTA) continue;
        const avisado = await avisarJefesDeLaDemora({
          workspaceId,
          conversationId: chat.id,
          desde: chat.desde,
          motivo: tope ? "tope" : "sin-activa",
          cliente,
          asesora: nombre(chat.asesora),
          minutos: Math.floor((ahora.getTime() - chat.inicio) / 60_000),
        });
        if (avisado) input.vuelta.avisosAJefes += 1;
        continue;
      }

      // Solo si sigue siendo de la original y abierto: si contestó o alguien lo movió a mano, nada.
      // No mueve la rueda (lastAutoAssignedUserId) ni cambia estado, etapa ni automationPaused.
      const movido = await prisma.conversation.updateMany({
        where: { id: chat.id, assignedToUserId: chat.asesora, status: { in: ["OPEN", "PENDING"] } },
        data: { assignedToUserId: nueva },
      });
      if (movido.count === 0) continue;
      resultado.reasignados += 1;
      carga.set(chat.asesora, Math.max(0, (carga.get(chat.asesora) ?? 0) - 1));
      carga.set(nueva, (carga.get(nueva) ?? 0) + 1);

      await recordConversationActivity({
        workspaceId,
        conversationId: chat.id,
        channelId: conversacion.channelId,
        contactId: conversacion.contactId,
        kind: "assigned",
        assigneeUserId: nueva,
        reasignadoDeUserId: chat.asesora,
        origen: ORIGEN_REASIGNACION_POR_DEMORA,
        actorUserId: null,
        text: `Reasignado de ${nombre(chat.asesora)} a ${nombre(nueva)} por no responder en ${config.minutosReasignar} min`,
      });

      pushSinBloquear(nueva, {
        title: "Te pasaron un chat",
        body: `Te pasaron un chat que lleva ${config.minutosReasignar} min esperando`,
        tag: `demora:${chat.id}`,
        url: urlDelChat(chat.id),
      });
      pushSinBloquear(chat.asesora, {
        title: "Chat reasignado",
        body: `Se reasignó el chat de ${cliente} a ${nombre(nueva)}`,
        tag: `demora-reasignado:${chat.id}`,
        url: urlDelChat(chat.id),
      });
    } catch (error) {
      // Un chat que falla no frena a los demás.
      resultado.errores += 1;
      console.error("[demora-de-asesora] reasignacion error", chat.id, error);
    }
  }
}
