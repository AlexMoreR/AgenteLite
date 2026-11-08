import { Prisma } from "@prisma/client";

import { calcularReparto } from "@/lib/channel-collaborators";
import { recordConversationActivity } from "@/lib/conversation-activity";
import { filtrarSinPausaManual } from "@/lib/en-linea";
import { filtrarPorHorario, leerHorariosDeReparto, recibeEnEsteMomento } from "@/lib/horario-de-reparto";
import { prisma } from "@/lib/prisma";
import { ORIGENES_HUMANOS, claseDelEvento } from "@/lib/turno-de-la-conversacion";
import { sendPushToUser } from "@/lib/web-push";

import {
  ORIGEN_REASIGNACION_POR_DEMORA,
  PREFIJO_CONFIG_DEMORA,
  alcanzoElTopeDeReasignaciones,
  decidirDemora,
  dentroDeLaFranja,
  elegirAsesoraActiva,
  leerConfigDemoraDeTexto,
  ordenDeLaRueda,
  textoDeReasignacion,
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
 * - A una asesora fuera de su horario de reparto (Mi empresa -> Equipo) no se le avisa; si cuando
 *   entra a su horario el chat sigue esperando, ahí le llega.
 * - Un aviso por reloj: la marca guarda el inicio del reloj. Primero se marca y después se manda:
 *   si el push falla, no se insiste cada minuto.
 * - Máximo MAXIMO_AVISOS_POR_VUELTA avisos por vuelta.
 *
 * LA REASIGNACIÓN (a los `minutosReasignar`, camino aparte del aviso: ese chat ya no recibe el push
 * de los 5 minutos):
 * - Se reasigna aunque la asesora original esté fuera de su horario (decisión del dueño: el cliente
 *   está esperando).
 * - Pasa a una asesora ACTIVA de la línea (ver `elegirAsesoraActiva`). Activa = mandó desde el CRM
 *   un mensaje escrito por ella en los últimos `minutosActiva` (los del celular, source=instance,
 *   no guardan autor y no cuentan).
 * - Una sola vez por espera. Sin activa, o con esa vez ya usada, el chat no se mueve y se avisa a
 *   dueños y administradores, una vez por espera.
 * - Solo cambia `assignedToUserId`: no mueve la rueda del reparto, no cambia estado ni etapa ni
 *   toca el bot. Deja una nota interna y manda push al equipo. Al cliente no le escribe nada.
 * - Máximo MAXIMO_REASIGNACIONES_POR_VUELTA por vuelta. Un error en un chat no frena los demás.
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

type ChatRevisado = { id: string; asesora: string; segunda: string | null; channelId: string; desde: number };

/**
 * De las notas SYSTEM kind="assigned" de cada chat:
 * - `ultima`: la última asignación a su asesora actual (mueve el reloj),
 * - `reasignaciones`: cuántas reasignaciones por demora hubo desde el `desde` de ESA espera (el tope).
 */
async function notasDeAsignacion(
  workspaceId: string,
  chats: ChatRevisado[],
): Promise<{ ultima: Map<string, number>; reasignaciones: Map<string, number> }> {
  const ultima = new Map<string, number>();
  const reasignaciones = new Map<string, number>();
  if (!chats.length) return { ultima, reasignaciones };
  // Las notas de antes de `desde` no mueven el reloj ni cuentan para el tope: no hace falta leerlas.
  const masAntiguo = Math.min(...chats.map((chat) => chat.desde));
  const porId = new Map(chats.map((chat) => [chat.id, chat]));
  const vistos = new Set<string>();
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
    const payload = nota.rawPayload as { assigneeUserId?: unknown; origen?: unknown } | null;
    // El tope mira TODAS las notas de la reasignación desde el `desde` de este chat.
    if (payload?.origen === ORIGEN_REASIGNACION_POR_DEMORA && nota.createdAt.getTime() >= chat.desde) {
      reasignaciones.set(chat.id, (reasignaciones.get(chat.id) ?? 0) + 1);
    }
    // El reloj: solo la nota más reciente, y si es a la asesora actual.
    if (vistos.has(chat.id)) continue;
    vistos.add(chat.id);
    if (payload?.assigneeUserId === chat.asesora) {
      ultima.set(chat.id, nota.createdAt.getTime());
    }
  }
  return { ultima, reasignaciones };
}

/**
 * Las asesoras ACTIVAS del negocio y su último mensaje: mandaron desde el CRM (source=manual, con
 * autor en enviadoPorUserId) un mensaje que no falló en los últimos `minutosActiva`. Agrupada por
 * asesora y sin traer rawPayload (índice workspaceId + createdAt).
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
  const desde = new Date(ahora.getTime() - config.minutosActiva * 60_000);
  const filas = await prisma.$queryRaw<Array<{ userId: string | null; ultimo: Date | string }>>(
    sqlAsesorasActivas({ workspaceId, desde }),
  );
  const activas = new Map<string, number>();
  for (const fila of filas) {
    const ultimo = new Date(fila.ultimo).getTime();
    if (fila.userId && Number.isFinite(ultimo)) activas.set(fila.userId, ultimo);
  }
  return activas;
}

/** Los mensajes humanos y las llamadas de UN chat desde `desde` (la misma regla que la espera). */
export function sqlRespuestasDelChat(input: { workspaceId: string; conversationId: string; desde: Date }): Prisma.Sql {
  return Prisma.sql`
    SELECT m."direction"::text AS "d", m."type"::text AS "t", m."rawPayload"->>'source' AS "o",
           CASE WHEN m."type"::text = 'SYSTEM' THEN left(m."content", 200) END AS "x", m."createdAt" AS "en"
      FROM "Message" m
     WHERE m."workspaceId" = ${input.workspaceId}
       AND m."conversationId" = ${input.conversationId}
       AND m."createdAt" >= ${input.desde}
       AND m."isStatusBroadcast" = false
       AND (
         (m."direction"::text = 'OUTBOUND' AND m."type"::text <> 'SYSTEM'
           AND m."status"::text <> 'FAILED' AND m."failedAt" IS NULL
           AND m."rawPayload"->>'source' IN (${Prisma.join(ORIGENES_HUMANOS)}))
         OR (m."type"::text = 'SYSTEM' AND m."rawPayload"->>'source' = 'llamada')
       )
  `;
}

/** Justo antes de mover el chat: ¿le contestó una persona (mensaje o llamada atendida) desde `desde`? */
async function yaRespondioUnaPersona(workspaceId: string, conversationId: string, desde: number): Promise<boolean> {
  const filas = await prisma.$queryRaw<Array<{ d: string; t: string; o: string | null; x: string | null; en: Date }>>(
    sqlRespuestasDelChat({ workspaceId, conversationId, desde: new Date(desde) }),
  );
  return filas.some((r) => {
    const clase = claseDelEvento({
      direccion: r.d === "INBOUND" ? "IN" : "OUT",
      tipo: r.t,
      origen: r.o,
      texto: r.x,
      en: new Date(r.en),
    });
    return clase === "humano" || clase === "llamada_atendida";
  });
}

/** Push sin esperar y sin lanzar: un push caído no frena la vuelta. */
function pushSinBloquear(userId: string, payload: { title: string; body: string; tag: string; url: string }) {
  void sendPushToUser({ userId, payload }).catch((error) => {
    console.error("[demora-de-asesora] push error", error);
    return 0;
  });
}

/** Nombre de una persona como en el reparto: `name` o `email`. */
function nombreDe(usuario: { name: string | null; email: string | null } | null | undefined): string {
  return usuario?.name?.trim() || usuario?.email || "Colaborador";
}

export type ResultadoDeDemora = {
  negocios: number;
  revisados: number;
  avisados: number;
  fueraDeHorario: number;
  /** Ya pasaron los minutos de reasignar. */
  paraReasignar: number;
  /** Chats que se pasaron a otra asesora. */
  reasignados: number;
  /** Avisos a dueños/administradores (sin activa o con la única reasignación ya usada). */
  avisosAJefes: number;
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
  };
  const topeDeReasignar = () => resultado.reasignados + resultado.avisosAJefes >= MAXIMO_REASIGNACIONES_POR_VUELTA;

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
    // El negocio se salta solo si ya no cabe ni un aviso ni una reasignación más en esta vuelta.
    if (!dentroDeLaFranja(ahora) || (resultado.avisados >= MAXIMO_AVISOS_POR_VUELTA && topeDeReasignar())) continue;

    const [espera, lineasDeVentas] = await Promise.all([
      cargarEsperaDelNegocio(workspaceId),
      prisma.whatsAppChannel.findMany({
        where: { workspaceId, purpose: "SALES" },
        select: { id: true, metadata: true },
      }),
    ]);
    const ventas = new Map(lineasDeVentas.map((linea) => [linea.id, linea.metadata]));

    // Primero sin la nota de asignación: la nota solo puede ATRASAR el reloj, así que lo que
    // todavía no llega al aviso no la necesita.
    const candidatos = espera
      .filter((chat) => !chat.oficial && chat.assignedToUserId && chat.channelId && ventas.has(chat.channelId))
      .map(
        (chat): ChatRevisado => ({
          id: chat.key.slice("agent:".length),
          asesora: chat.assignedToUserId as string,
          segunda: chat.segundoAsesorId,
          channelId: chat.channelId as string,
          desde: chat.desde,
        }),
      )
      .filter(
        (chat) =>
          decidirDemora({ config, desde: chat.desde, ultimaAsignacion: null, arranque, ahora }).tipo !== "nada",
      );
    resultado.revisados += candidatos.length;
    if (!candidatos.length) continue;

    const [asignaciones, horarios] = await Promise.all([
      notasDeAsignacion(workspaceId, candidatos),
      leerHorariosDeReparto(workspaceId),
    ]);

    const porReasignar: ChatRevisado[] = [];
    for (const chat of candidatos) {
      const decision = decidirDemora({
        config,
        desde: chat.desde,
        ultimaAsignacion: asignaciones.ultima.get(chat.id) ?? null,
        arranque,
        ahora,
      });
      if (decision.tipo === "nada") continue;
      // Camino aparte: el chat que ya va para reasignar no recibe también el push de los 5 minutos.
      if (decision.tipo === "reasignar") {
        resultado.paraReasignar += 1;
        porReasignar.push(chat);
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

    if (porReasignar.length && !topeDeReasignar()) {
      await reasignarDelNegocio({
        workspaceId,
        config,
        ahora,
        espera,
        lineas: ventas,
        porReasignar,
        reasignaciones: asignaciones.reasignaciones,
        resultado,
        topeDeReasignar,
      });
    }
  }

  return resultado;
}

/** Los chats de un negocio que ya pasaron los minutos de reasignar. */
async function reasignarDelNegocio(input: {
  workspaceId: string;
  config: ConfigDemora;
  ahora: Date;
  espera: ChatEnEspera[];
  lineas: Map<string, Prisma.JsonValue>;
  porReasignar: ChatRevisado[];
  reasignaciones: Map<string, number>;
  resultado: ResultadoDeDemora;
  topeDeReasignar: () => boolean;
}): Promise<void> {
  const { workspaceId, config, ahora, resultado } = input;

  // ACTIVAS: una consulta por negocio, y solo porque hay algo por reasignar.
  const activas = await asesorasActivas(workspaceId, config, ahora);

  // CARGA: chats en espera por asesora, con la misma lista ya cargada. Se ajusta al mover, para que
  // en una misma vuelta no le caigan todos a la misma.
  const carga = new Map<string, number>();
  for (const chat of input.espera) {
    if (chat.assignedToUserId) carga.set(chat.assignedToUserId, (carga.get(chat.assignedToUserId) ?? 0) + 1);
  }

  // CANDIDATAS: una vez por línea en esta vuelta, en el orden de la rueda.
  const candidatasPorLinea = new Map<string, string[]>();
  let miembrosActivos: Set<string> | null = null;
  async function candidatasDe(channelId: string): Promise<string[]> {
    const guardadas = candidatasPorLinea.get(channelId);
    if (guardadas) return guardadas;
    const metadata = input.lineas.get(channelId) ?? null;
    const reparto = calcularReparto(metadata);
    let lista: string[] = [];
    if (reparto.length) {
      miembrosActivos ??= new Set(
        (
          await prisma.workspaceMember.findMany({ where: { workspaceId, isActive: true }, select: { userId: true } })
        ).map((miembro) => miembro.userId),
      );
      const activosDelNegocio = miembrosActivos;
      const enHorario = await filtrarPorHorario(
        workspaceId,
        reparto.filter((id) => activosDelNegocio.has(id)),
        ahora,
      );
      const sinPausa = await filtrarSinPausaManual(workspaceId, enHorario, ahora);
      const ultima =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? (metadata as Record<string, unknown>).lastAutoAssignedUserId
          : null;
      lista = ordenDeLaRueda(
        enHorario.filter((id) => sinPausa.has(id)),
        typeof ultima === "string" ? ultima : null,
      );
    }
    candidatasPorLinea.set(channelId, lista);
    return lista;
  }

  // Dueños y administradores activos, una sola consulta por negocio (solo si hace falta).
  let jefes: string[] | null = null;

  for (const chat of input.porReasignar) {
    if (input.topeDeReasignar()) break;
    try {
      // Antes de nada: si ya le contestó una persona, la espera terminó.
      if (await yaRespondioUnaPersona(workspaceId, chat.id, chat.desde)) continue;

      const conversacion = await prisma.conversation.findUnique({
        where: { id: chat.id },
        select: { contactId: true, contact: { select: { name: true, phoneNumber: true } } },
      });
      if (!conversacion) continue;
      const cliente = conversacion.contact?.name?.trim() || conversacion.contact?.phoneNumber || "un cliente";

      const topeUsado = alcanzoElTopeDeReasignaciones(input.reasignaciones.get(chat.id) ?? 0);
      const nueva = topeUsado
        ? null
        : elegirAsesoraActiva({
            candidatas: await candidatasDe(chat.channelId),
            ultimoMensajePorAsesora: activas,
            esperandoPorAsesora: carga,
            original: chat.asesora,
            segunda: chat.segunda,
          });

      if (!nueva) {
        // SIN ACTIVA o TOPE: el chat no cambia; se avisa a los jefes una vez por espera.
        const key = claveSinActiva(chat.id);
        const marca = new Date(chat.desde).toISOString();
        const yaAvisado = await prisma.appSetting.findUnique({ where: { key }, select: { value: true } });
        if (yaAvisado?.value === marca) continue;
        await prisma.appSetting.upsert({ where: { key }, create: { key, value: marca }, update: { value: marca } });
        jefes ??= (
          await prisma.workspaceMember.findMany({
            where: { workspaceId, isActive: true, role: { in: ["OWNER", "ADMIN"] } },
            select: { userId: true },
          })
        ).map((jefe) => jefe.userId);
        const minutos = Math.max(0, Math.floor((ahora.getTime() - chat.desde) / 60_000));
        const body = topeUsado
          ? `El chat de ${cliente} ya se pasó a otra asesora y sigue sin respuesta (${minutos} min).`
          : `El chat de ${cliente} lleva ${minutos} min sin respuesta y no hay otra asesora activa para pasárselo.`;
        for (const jefe of jefes) {
          pushSinBloquear(jefe, {
            title: "Un cliente sigue esperando",
            body,
            tag: `demora-sin-activa:${chat.id}`,
            url: urlDelChat(chat.id),
          });
        }
        resultado.avisosAJefes += 1;
        continue;
      }

      // ESCRITURA: solo si sigue con la misma asesora y abierto o pendiente. No toca la rueda, el
      // estado, la etapa ni el bot.
      const movido = await prisma.conversation.updateMany({
        where: { id: chat.id, assignedToUserId: chat.asesora, status: { in: ["OPEN", "PENDING"] } },
        data: { assignedToUserId: nueva },
      });
      // La asesora contestó o alguien lo movió a mano: no se hace nada más.
      if (movido.count === 0) continue;
      resultado.reasignados += 1;
      carga.set(chat.asesora, Math.max(0, (carga.get(chat.asesora) ?? 0) - 1));
      carga.set(nueva, (carga.get(nueva) ?? 0) + 1);

      const personas = await prisma.user.findMany({
        where: { id: { in: [chat.asesora, nueva] } },
        select: { id: true, name: true, email: true },
      });
      const nombreOriginal = nombreDe(personas.find((persona) => persona.id === chat.asesora));
      const nombreNueva = nombreDe(personas.find((persona) => persona.id === nueva));

      await recordConversationActivity({
        workspaceId,
        conversationId: chat.id,
        channelId: chat.channelId,
        contactId: conversacion.contactId,
        kind: "assigned",
        text: textoDeReasignacion(nombreOriginal, nombreNueva, config.minutosReasignar),
        actorUserId: null,
        assigneeUserId: nueva,
        reasignadoDeUserId: chat.asesora,
        origen: ORIGEN_REASIGNACION_POR_DEMORA,
      });

      pushSinBloquear(nueva, {
        title: "Te pasaron un chat",
        body: `Te pasaron un chat que lleva ${config.minutosReasignar} min esperando`,
        tag: `demora-reasignado:${chat.id}`,
        url: urlDelChat(chat.id),
      });
      pushSinBloquear(chat.asesora, {
        title: "Se reasignó un chat",
        body: `Se reasignó el chat de ${cliente} a ${nombreNueva}`,
        tag: `demora-reasignado:${chat.id}`,
        url: urlDelChat(chat.id),
      });
    } catch (error) {
      // Un error en un chat no frena los demás.
      console.error("[demora-de-asesora] reasignación error", {
        conversationId: chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
