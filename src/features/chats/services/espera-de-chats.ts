import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { CacheConTtl } from "@/lib/cache-en-memoria";
import { canalesDelNegocio } from "@/lib/canales-del-negocio";
import { esDeQuien } from "@/lib/chats-asignacion-compartida";
import { normalizarEtiqueta } from "@/lib/llamada-pide-resultado";
import {
  ORIGENES_HUMANOS,
  claseDelEvento,
  turnoDeLaConversacion,
  type EventoDelChat,
  type TurnoDeLaConversacion,
} from "@/lib/turno-de-la-conversacion";
import { esCaliente } from "@/features/supervisor/dominio/detectores-atencion";

import {
  VENTANA_DE_ESPERA_MS,
  ordenarEsperando,
  type ChatEsperando,
  type EsperaDeChats,
} from "../domain/espera-de-chats";

export * from "../domain/espera-de-chats";

/**
 * QUE CHATS ESTAN ESPERANDO RESPUESTA DE UNA PERSONA, y desde cuando.
 *
 * Entra un chat abierto o pendiente si el cliente escribio en las ultimas 72 horas y despues de
 * eso no le contesto una PERSONA. Es respuesta de una persona:
 *  - un mensaje nuestro con `rawPayload.source` manual o instance (desde el CRM o el celular) que
 *    no haya fallado,
 *  - una llamada atendida (la misma regla de lib/turno-de-la-conversacion.ts: claseDelEvento).
 * NO lo son el bot, los seguimientos automaticos, las notas internas (type SYSTEM) ni un envio
 * fallido. Quedan fuera los estados de WhatsApp, los contactos bloqueados u ocultos del CRM, los
 * pospuestos y los del equipo o proveedores (etiqueta EQUIPO o PROVEEDOR).
 *
 * Y SOLO SI ES TURNO DE MAGILUS (Alex, 10-11-2026), con la misma regla del Supervisor
 * (lib/turno-de-la-conversacion.ts): si el agente ya contesto sin pedir asesora, el turno es del
 * cliente y el chat no espera. Espera si nadie contesto, si el agente pidio o prometio una asesora,
 * si no entendio, si el cliente dio una señal fuerte (separar, "ya pague", eligio color...) o si
 * es un caliente al que nunca le escribio una persona. Caso: el agente mando fotos y pregunto el
 * color, y a los 10 min el chat se le quito a Ingrid "por no responder". La linea oficial no tiene
 * agente: sigue la regla de arriba sola.
 *
 * EL RELOJ arranca en el PRIMER mensaje del cliente que quedo sin respuesta de una persona, pero
 * SOLO se mira dentro de las 72 horas: si la demora empezo antes (el cliente escribio hace cuatro
 * dias y nadie le contesto desde entonces), el reloj cuenta desde su primer mensaje DENTRO de la
 * ventana, no desde el de hace cuatro dias. Es la consecuencia del limite aprobado: mirar mas
 * atras volveria lenta la consulta y lo de hace dias ya no es trabajo de hoy.
 *
 * COMO SE CALCULA, para que sea barato (se pide cada 60 s desde cada bandeja abierta):
 *  1. Se arranca por `Conversation.lastMessageAt` (indice workspaceId + lastMessageAt): solo los
 *     chats con movimiento en la ventana.
 *  2. Se agrupan las FECHAS de los mensajes del cliente de esos chats, sin abrir `rawPayload`
 *     (como idsSinResponder en filtros-de-bandeja.ts). Los que no tienen ninguno, afuera.
 *  3. Solo para esos candidatos se abre `rawPayload`, y solo de NUESTROS mensajes y llamadas
 *     dentro de la ventana, para saber cuales son de una persona.
 *  4. Lo demas (la regla de la llamada atendida, las etiquetas, el reloj) se decide en JS con las
 *     mismas funciones que usa el resto del sistema.
 * Es UNA consulta por negocio (mas la equivalente de la linea oficial) y se guarda 60 s para todo
 * el negocio: lo que ve cada persona se recorta en JS, sin volver a la base.
 */

/** Etiquetas (ya normalizadas) de contactos que no son clientes: no esperan respuesta de venta. */
const ETIQUETAS_FUERA_DE_ESPERA: readonly string[] = ["equipo", "proveedor", "proveedores"];

/** Un chat esperando, con lo necesario para recortarlo por persona. */
export type ChatEnEspera = {
  key: string;
  /** Primer mensaje del cliente sin respuesta de una persona (ms). */
  desde: number;
  /** Canal del chat (null en la linea oficial). */
  channelId: string | null;
  oficial: boolean;
  assignedToUserId: string | null;
  segundoAsesorId: string | null;
};

/** Una fila de cualquiera de las dos consultas. */
export type FilaDeEspera = {
  id: string;
  channelId: string | null;
  assignedToUserId: string | null;
  segundoAsesorId: string | null;
  /** Fechas de los mensajes del cliente en la ventana (texto sin zona = UTC). */
  clientes: string[] | null;
  /** Nuestros mensajes de persona y las llamadas en la ventana. */
  respuestas: Array<{ d: string; t: string; o: string | null; x: string | null; en: string }> | null;
  /** [nombre, slug] de cada etiqueta de la ficha del CRM. */
  etiquetas: Array<[string | null, string | null]> | null;
};

/** Un timestamp de Postgres "sin zona" dentro de un JSON es UTC. */
function fechaUtc(texto: string): number {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(texto) ? texto : `${texto}Z`).getTime();
}

const LIMITES = (ahora: Date) => ({
  desde: new Date(ahora.getTime() - VENTANA_DE_ESPERA_MS),
  // Los pospuestos: la fecha vive en metadata como texto ISO, se compara tal cual (igual que /counts).
  ahoraIso: ahora.toISOString(),
});

/*
  MATERIALIZED en los tres pasos (10-nov-2026): sin eso, Postgres metia `respuestas` dentro de un Nested Loop y la
  repetia una vez por chat (711 veces): 22 s y la base al 100 %. Con cada paso calculado una sola vez, 0,4 s.
  No quitarlo sin medir con EXPLAIN ANALYZE sobre la base real.
*/

/** La consulta del canal viejo (Conversation / Message). Separada de la que la corre, para probarla. */
export function sqlEsperaDeChats(input: { workspaceId: string; ahora: Date }): Prisma.Sql {
  const { desde, ahoraIso } = LIMITES(input.ahora);
  return Prisma.sql`
    WITH candidatas AS MATERIALIZED (
      SELECT c."id", c."channelId", c."assignedToUserId", c."segundoAsesorId", c."contactId"
        FROM "Conversation" c
        JOIN "Contact" ct ON ct."id" = c."contactId"
       WHERE c."workspaceId" = ${input.workspaceId}
         AND c."lastMessageAt" > ${desde}
         AND c."status"::text IN ('OPEN', 'PENDING')
         AND ct."bloqueadoEn" IS NULL
         AND ct."excludedFromCrm" = false
         AND NOT COALESCE((ct."metadata"->>'snoozedUntil') > ${ahoraIso}, false)
    ),
    clientes AS MATERIALIZED (
      SELECT m."conversationId" AS "id", json_agg(m."createdAt" ORDER BY m."createdAt") AS "clientes"
        FROM "Message" m
        JOIN candidatas k ON k."id" = m."conversationId"
       WHERE m."workspaceId" = ${input.workspaceId}
         AND m."createdAt" > ${desde}
         AND m."direction"::text = 'INBOUND'
         AND m."type"::text <> 'SYSTEM'
         AND m."deletedAt" IS NULL
         AND m."isStatusBroadcast" = false
       GROUP BY m."conversationId"
    ),
    respuestas AS MATERIALIZED (
      SELECT m."conversationId" AS "id",
             json_agg(json_build_object(
               'd', m."direction"::text, 't', m."type"::text, 'o', m."rawPayload"->>'source',
               'x', CASE WHEN m."type"::text = 'SYSTEM' THEN left(m."content", 200) END,
               'en', m."createdAt") ORDER BY m."createdAt") AS "respuestas"
        FROM "Message" m
        JOIN clientes k ON k."id" = m."conversationId"
       WHERE m."workspaceId" = ${input.workspaceId}
         AND m."createdAt" > ${desde}
         AND m."isStatusBroadcast" = false
         AND (
           (m."direction"::text = 'OUTBOUND' AND m."type"::text <> 'SYSTEM'
             AND m."status"::text <> 'FAILED' AND m."failedAt" IS NULL
             AND m."rawPayload"->>'source' IN (${Prisma.join(ORIGENES_HUMANOS)}))
           OR (m."type"::text = 'SYSTEM' AND m."rawPayload"->>'source' = 'llamada')
         )
       GROUP BY m."conversationId"
    )
    SELECT v."id", v."channelId", v."assignedToUserId", v."segundoAsesorId", k."clientes", r."respuestas",
           (SELECT json_agg(json_build_array(t."name", t."slug"))
              FROM "ContactTag" ctg JOIN "Tag" t ON t."id" = ctg."tagId"
             WHERE ctg."contactId" = v."contactId") AS "etiquetas"
      FROM clientes k
      JOIN candidatas v ON v."id" = k."id"
      LEFT JOIN respuestas r ON r."id" = k."id"
  `;
}

/**
 * La misma consulta para la linea oficial (OfficialApiConversation / OfficialApiMessage). La ficha
 * del CRM -bloqueo, oculto, pospuesto y etiquetas- se alcanza por `crmContactId`; sin ficha, el
 * chat entra igual.
 */
export function sqlEsperaOficial(input: { workspaceId: string; ahora: Date }): Prisma.Sql {
  const { desde, ahoraIso } = LIMITES(input.ahora);
  return Prisma.sql`
    WITH candidatas AS MATERIALIZED (
      SELECT c."id", c."assignedToUserId", ct."id" AS "crmContactId"
        FROM "OfficialApiConversation" c
        JOIN "OfficialApiClientConfig" cfg ON cfg."id" = c."configId"
        JOIN "OfficialApiContact" oc ON oc."id" = c."contactId"
        LEFT JOIN "Contact" ct ON ct."id" = oc."crmContactId" AND ct."workspaceId" = ${input.workspaceId}
       WHERE cfg."workspaceId" = ${input.workspaceId}
         AND c."lastMessageAt" > ${desde}
         AND c."status"::text IN ('OPEN', 'PENDING')
         AND (ct."id" IS NULL OR (
           ct."bloqueadoEn" IS NULL
           AND ct."excludedFromCrm" = false
           AND NOT COALESCE((ct."metadata"->>'snoozedUntil') > ${ahoraIso}, false)
         ))
    ),
    clientes AS MATERIALIZED (
      SELECT m."conversationId" AS "id", json_agg(m."createdAt" ORDER BY m."createdAt") AS "clientes"
        FROM "OfficialApiMessage" m
        JOIN candidatas k ON k."id" = m."conversationId"
       WHERE m."createdAt" > ${desde}
         AND m."direction"::text = 'INBOUND'
         AND m."type"::text <> 'SYSTEM'
       GROUP BY m."conversationId"
    ),
    respuestas AS MATERIALIZED (
      SELECT m."conversationId" AS "id",
             json_agg(json_build_object(
               'd', m."direction"::text, 't', m."type"::text, 'o', m."rawPayload"->>'source',
               'x', CASE WHEN m."type"::text = 'SYSTEM' THEN left(m."content", 200) END,
               'en', m."createdAt") ORDER BY m."createdAt") AS "respuestas"
        FROM "OfficialApiMessage" m
        JOIN clientes k ON k."id" = m."conversationId"
       WHERE m."createdAt" > ${desde}
         AND (
           (m."direction"::text = 'OUTBOUND' AND m."type"::text <> 'SYSTEM'
             AND m."status"::text <> 'FAILED' AND m."failedAt" IS NULL
             AND m."rawPayload"->>'source' IN (${Prisma.join(ORIGENES_HUMANOS)}))
           OR (m."type"::text = 'SYSTEM' AND m."rawPayload"->>'source' = 'llamada')
         )
       GROUP BY m."conversationId"
    )
    SELECT v."id", NULL::text AS "channelId", v."assignedToUserId", NULL::text AS "segundoAsesorId",
           k."clientes", r."respuestas",
           (SELECT json_agg(json_build_array(t."name", t."slug"))
              FROM "ContactTag" ctg JOIN "Tag" t ON t."id" = ctg."tagId"
             WHERE ctg."contactId" = v."crmContactId") AS "etiquetas"
      FROM clientes k
      JOIN candidatas v ON v."id" = k."id"
      LEFT JOIN respuestas r ON r."id" = k."id"
  `;
}

function esDelEquipoOProveedor(etiquetas: FilaDeEspera["etiquetas"]): boolean {
  return (etiquetas ?? []).some((par) =>
    (par ?? []).some((texto) => ETIQUETAS_FUERA_DE_ESPERA.includes(normalizarEtiqueta(texto))),
  );
}

/** Las filas de una consulta, ya decididas: solo los chats que de verdad esperan. */
export function chatsEnEsperaDeLasFilas(filas: FilaDeEspera[], oficial: boolean): ChatEnEspera[] {
  const chats: ChatEnEspera[] = [];
  for (const fila of filas) {
    if (esDelEquipoOProveedor(fila.etiquetas)) continue;

    // La ultima respuesta de una persona en la ventana (mensaje manual/instance o llamada atendida).
    let ultimaHumana = Number.NEGATIVE_INFINITY;
    for (const r of fila.respuestas ?? []) {
      const clase = claseDelEvento({
        direccion: r.d === "INBOUND" ? "IN" : "OUT",
        tipo: r.t,
        origen: r.o,
        texto: r.x,
        en: new Date(fechaUtc(r.en)),
      });
      if (clase === "humano" || clase === "llamada_atendida") {
        ultimaHumana = Math.max(ultimaHumana, fechaUtc(r.en));
      }
    }

    // El reloj: el primer mensaje del cliente despues de esa respuesta (dentro de la ventana).
    const pendientes = (fila.clientes ?? []).map(fechaUtc).filter((en) => en > ultimaHumana);
    if (!pendientes.length) continue;

    chats.push({
      key: `${oficial ? "official" : "agent"}:${fila.id}`,
      desde: Math.min(...pendientes),
      channelId: oficial ? null : fila.channelId,
      oficial,
      assignedToUserId: fila.assignedToUserId,
      segundoAsesorId: oficial ? null : fila.segundoAsesorId,
    });
  }
  return chats;
}

/* ------------------------------------------------------------------------------------------------
   EL TURNO de los candidatos (solo el canal viejo, que es donde contesta el agente)
------------------------------------------------------------------------------------------------ */

/** Cuantos mensajes y notas se leen por chat: los mismos que el Supervisor. */
export const EVENTOS_DEL_TURNO = 40;

/** Lo que hace falta para el turno de un candidato. */
export type FilaDeTurno = {
  id: string;
  etapa: string | null;
  temperatura: string | null;
  /** Los ultimos mensajes y notas de la ventana (sin envios fallidos ni borrados). */
  eventos: Array<{ d: string; t: string; o: string | null; x: string | null; en: string }> | null;
};

/**
 * Los ultimos mensajes y notas de los candidatos, con la etapa y la temperatura. Va DESPUES de la
 * consulta de la espera y solo con sus candidatos (los chats sin respuesta de una persona), asi que
 * no toca lo que se midio en sqlEsperaDeChats. Es la misma lectura del Supervisor (LIMIT 40 por chat,
 * indice conversationId + createdAt).
 */
export function sqlTurnoDeLaEspera(input: { workspaceId: string; ids: string[]; ahora: Date }): Prisma.Sql {
  const { desde } = LIMITES(input.ahora);
  return Prisma.sql`
    SELECT c."id", ct."crmStage"::text AS "etapa", l."temperatura", turno_de_la_espera."eventos"
      FROM "Conversation" c
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "EmbudoLead" l ON l."conversationId" = c."id"
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('d', e."d", 't', e."t", 'o', e."o", 'x', e."x", 'en', e."createdAt")
                        ORDER BY e."createdAt") AS "eventos"
          FROM (
            SELECT m."direction"::text AS "d", m."type"::text AS "t", m."rawPayload"->>'source' AS "o",
                   left(coalesce(nullif(m."transcripcion", ''), m."content", ''), 400) AS "x", m."createdAt"
              FROM "Message" m
             WHERE m."conversationId" = c."id"
               AND m."createdAt" > ${desde}
               AND m."isStatusBroadcast" = false
               AND m."deletedAt" IS NULL
               AND NOT (m."direction"::text = 'OUTBOUND' AND m."type"::text <> 'SYSTEM'
                        AND (m."status"::text = 'FAILED' OR m."failedAt" IS NOT NULL))
             ORDER BY m."createdAt" DESC
             LIMIT ${EVENTOS_DEL_TURNO}
          ) e
      ) turno_de_la_espera ON true
     WHERE c."workspaceId" = ${input.workspaceId}
       AND c."id" IN (${Prisma.join(input.ids)})
  `;
}

function eventosDeLaFila(fila: FilaDeTurno): EventoDelChat[] {
  return (fila.eventos ?? []).map((e) => ({
    direccion: e.d === "INBOUND" ? "IN" : "OUT",
    tipo: e.t,
    origen: e.o,
    texto: e.x,
    en: new Date(fechaUtc(e.en)),
  }));
}

/**
 * Desde cuando es turno de Magilus: el primer mensaje de la ultima tanda del cliente (lo que escribio
 * desde nuestra ultima respuesta, del bot o de una persona). Una tanda vieja que el agente ya contesto
 * no cuenta. Una llamada perdida sin mensajes despues de nuestra respuesta: la hora de la llamada.
 */
export function inicioDelTurno(eventos: EventoDelChat[], turno: TurnoDeLaConversacion): number | null {
  const orden = [...eventos].sort((a, b) => a.en.getTime() - b.en.getTime());
  const clases = orden.map(claseDelEvento);
  let i = clases.lastIndexOf("cliente");
  let inicio: number | null = null;
  for (; i >= 0; i -= 1) {
    const clase = clases[i];
    if (clase === "bot" || clase === "humano" || clase === "llamada_atendida") break;
    if (clase === "cliente") inicio = orden[i].en.getTime();
  }
  if (inicio === null && turno.motivo === "llamada_perdida") return turno.ultimoClienteEn?.getTime() ?? null;
  return inicio;
}

/**
 * Deja solo los candidatos del canal viejo en los que es turno de Magilus, con el reloj desde que lo es.
 * Sin fila, o si en los ultimos 40 eventos no aparece el cliente, el chat queda como antes: es mejor
 * que sobre uno a que se pierda uno que de verdad espera.
 */
export function chatsConTurnoDeMagilus(chats: ChatEnEspera[], filas: FilaDeTurno[]): ChatEnEspera[] {
  const porId = new Map(filas.map((fila) => [fila.id, fila]));
  const resultado: ChatEnEspera[] = [];
  for (const chat of chats) {
    const fila = chat.oficial ? undefined : porId.get(chat.key.slice("agent:".length));
    if (!fila) {
      resultado.push(chat);
      continue;
    }
    const eventos = eventosDeLaFila(fila);
    const turno = turnoDeLaConversacion(eventos, {
      caliente: esCaliente({ etapa: fila.etapa, temperatura: fila.temperatura }),
      asignada: Boolean(chat.assignedToUserId),
    });
    if (turno.motivo === "cliente_no_ha_escrito") {
      resultado.push(chat);
      continue;
    }
    if (turno.de !== "MAGILUS") continue;
    const inicio = inicioDelTurno(eventos, turno);
    resultado.push(inicio === null ? chat : { ...chat, desde: Math.max(chat.desde, inicio) });
  }
  return resultado;
}

/**
 * Corre las consultas del negocio, SIN la memoria de 60 s. La usa directo el reloj de la demora
 * de la asesora (services/demora-de-asesora.ts), para no decidir con datos de hace un minuto.
 */
export async function cargarEsperaDelNegocio(workspaceId: string): Promise<ChatEnEspera[]> {
  const ahora = new Date();
  const [viejo, oficial] = await Promise.all([
    prisma.$queryRaw<FilaDeEspera[]>(sqlEsperaDeChats({ workspaceId, ahora })),
    prisma.$queryRaw<FilaDeEspera[]>(sqlEsperaOficial({ workspaceId, ahora })),
  ]);
  const candidatos = chatsEnEsperaDeLasFilas(viejo, false);
  const ids = candidatos.map((chat) => chat.key.slice("agent:".length));
  const turnos = ids.length ? await prisma.$queryRaw<FilaDeTurno[]>(sqlTurnoDeLaEspera({ workspaceId, ids, ahora })) : [];
  return [...chatsConTurnoDeMagilus(candidatos, turnos), ...chatsEnEsperaDeLasFilas(oficial, true)].sort(
    (a, b) => a.desde - b.desde,
  );
}

/**
 * Un minuto de memoria por negocio. Comparte la carga entre pedidos simultaneos (todas las
 * bandejas refrescando a la vez) y un error no se guarda: el pedido siguiente vuelve a intentar.
 */
const cacheDeEspera = new CacheConTtl<ChatEnEspera[]>({ ttlMs: 60_000, maxEntradas: 50 });

/** Los chats que esperan en TODO el negocio (de la memoria si tiene menos de un minuto). */
export function esperaDelNegocio(workspaceId: string): Promise<ChatEnEspera[]> {
  return cacheDeEspera.obtener(workspaceId, () => cargarEsperaDelNegocio(workspaceId));
}

/** Para las pruebas. */
export function vaciarCacheDeEspera() {
  cacheDeEspera.vaciar();
}

/** Lo que ve una persona, para recortar la lista del negocio sin volver a la base. */
export type QuienMira = {
  userId: string;
  /** Canales del canal viejo que ve (null = todos). */
  canales: string[] | null;
  /** La asesora solo cuenta sus chats (principal o segunda). */
  soloMios: boolean;
  /** El canal elegido en la bandeja, si hay uno. */
  canalElegido: string | null;
  /** Si la linea oficial entra (igual que countOfficialConversations en /counts). */
  incluirOficial: boolean;
};

/** El recorte por persona. Funcion pura: la prueba la llama directo. */
export function esperaParaPersona(chats: ChatEnEspera[], quien: QuienMira): EsperaDeChats {
  const visibles = chats.filter((chat) => {
    const mia = esDeQuien(chat, quien.userId);
    if (quien.soloMios && !mia) return false;
    if (chat.oficial) return quien.incluirOficial;
    if (quien.canalElegido && chat.channelId !== quien.canalElegido) return false;
    if (quien.canales && !(chat.channelId && quien.canales.includes(chat.channelId))) return false;
    return true;
  });
  const lista = visibles.map((chat) => ({
    key: chat.key,
    desde: new Date(chat.desde).toISOString(),
    mia: esDeQuien(chat, quien.userId),
  }));
  return { mine: lista.filter((chat) => chat.mia).length, all: lista.length, chats: lista };
}

/**
 * La lista "Esperando" de la bandeja (GET /api/cliente/chats/list?espera=1), ya ordenada.
 *
 * Sale de la MISMA memoria de 60 s y del MISMO recorte por persona que el numero de /counts, para
 * que el numero y las filas coincidan. Encima se aplica la pestaña: Mias (solo lo suyo), Sin
 * asignar o una asesora (`user:<ids>`, como en el canal viejo: solo la principal); Todas no recorta.
 * Las condiciones y el estado no cuentan: solo entran abiertos o pendientes.
 *
 * Si la base falla, tira el error: quien llama decide que responder.
 */
export async function listaDeEsperaDeLaBandeja(input: {
  workspaceId: string;
  /** La conexion ya resuelta (resolverConexionElegida): "" o "channel:<id>". */
  conexionElegida: string;
  quien: Omit<QuienMira, "canalElegido" | "incluirOficial">;
  /** "all" | "mine" | "unassigned" | "user:<id>,<id>". */
  asignacion: string;
}): Promise<ChatEsperando[]> {
  // La linea elegida y si la oficial entra: igual que calcularEspera en /counts.
  const canalElegido = input.conexionElegida.startsWith("channel:")
    ? input.conexionElegida.slice("channel:".length)
    : null;
  let incluirOficial = !input.conexionElegida;
  if (canalElegido) {
    const canales = await canalesDelNegocio(input.workspaceId);
    incluirOficial = canales.find((canal) => canal.id === canalElegido)?.provider === "OFFICIAL_API";
  }

  const asesorasPedidas = input.asignacion.startsWith("user:")
    ? input.asignacion.slice("user:".length).split(",")
    : null;
  const chats = (await esperaDelNegocio(input.workspaceId)).filter((chat) => {
    if (input.asignacion === "unassigned") return !chat.assignedToUserId;
    if (asesorasPedidas) return Boolean(chat.assignedToUserId && asesorasPedidas.includes(chat.assignedToUserId));
    return true;
  });
  const { chats: visibles } = esperaParaPersona(chats, { ...input.quien, canalElegido, incluirOficial });
  return ordenarEsperando(input.asignacion === "mine" ? visibles.filter((chat) => chat.mia) : visibles);
}
