import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  armarPromptDeHabilidad,
  contraentregaSoloNegada,
  elegirHabilidades,
  esContraentregaRespetada,
  etapaDelTipo,
  redaccionValida,
  unaCosaAMejorarDe,
} from "../habilidad";
import { POLITICA_COACH } from "../politica";
import {
  apellidosDe,
  armarPromptDelLote,
  costoUsd,
  decidirCorrida,
  detectarEsperas,
  diaEnBogota,
  ejeVelocidad,
  esDescartePrematuro,
  esNotaDeDescarte,
  etapaDeVentaEn,
  huboCotizacion,
  limpiarDatosPersonales,
  mencionaContraentrega,
  mensajeSugeridoValido,
  normalizarMensajes,
  parsearRespuestaDelLote,
  primerNombre,
  promedioDeEjes,
  puntajePonderado,
  rangoDelDia,
  transcripcionParaIA,
  ultimos4,
  type AnalisisDeChat,
  type DecisionDeCorrida,
  type Ejes,
  type FichaParaIA,
  type MensajeCoach,
  type MensajeCrudo,
  type MotivoDeNoCierre,
  type ResumenDeAsesora,
} from "../reglas";
import type {
  AciertoDelCoach,
  ErrorDelCoach,
  EtapaDeVenta,
  HabilidadDelDia,
  PendienteDelCoach,
  PuntajesDelCoach,
  ResumenDeAsesoraGuardado,
  ResumenDelEquipo,
} from "../tipos";

/**
 * EL COACH DE VENTAS: cada noche lee los chats del dia de cada asesora y deja su informe.
 *
 * 1. Selecciona los chats de lineas de VENTAS con movimiento hoy (canal viejo y API oficial), mas
 *    los Calientes/Tibios quietos de la ultima semana (solo para la lista de pendientes).
 * 2. Mide sin IA lo que es un dato: demoras en horario, clientes sin respuesta, cotizaciones,
 *    descartes antes de 72 h.
 * 3. Manda a la IA, en lotes por asesora, solo el texto necesario (sin notas del bot, sin
 *    telefonos, cada turno recortado) para lo que es lectura: necesidad, avance, seguimiento,
 *    comunicacion, errores de politica y el siguiente mensaje sugerido.
 * 4. Guarda un CoachInforme por negocio y dia (idempotente) y un CoachAsesora por asesora, con
 *    los tokens y el costo estimado.
 *
 * NUNCA manda nada a un cliente ni toca el bot, las etapas o el reparto: solo lee y escribe sus
 * dos tablas.
 */

const ETAPA: Record<string, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Frío",
  PROPUESTA: "Tibio",
  NEGOCIACION: "Caliente",
  GANADO: "Ganado",
  PERDIDO: "Descartado",
};

type FilaDeMensaje = {
  id: string;
  conversationId: string;
  direction: string;
  type: string;
  content: string | null;
  transcripcion: string | null;
  createdAt: Date;
  isStatusBroadcast: boolean | null;
  deletedAt: Date | null;
  source: string | null;
  enviadoPorUserId: string | null;
  kind: string | null;
  actorUserId: string | null;
  assigneeUserId: string | null;
};

/** Un chat de cualquiera de las dos tablas, con lo que el coach necesita. */
type ChatDelDia = {
  fuente: "agent" | "official";
  id: string;
  numero: number | null;
  assignedToUserId: string | null;
  nombre: string;
  telefono: string;
  crmStage: string;
  ganadoHoy: boolean;
  quieto: boolean;
  creadoHoy: boolean;
  mensajes: MensajeCoach[];
};

/** El chat ya medido y atribuido. */
type ChatMedido = ChatDelDia & {
  ref: string;
  ultimos4: string;
  asesoraId: string | null;
  atribucionSegura: boolean;
  esperas: ReturnType<typeof detectarEsperas>;
  cotizacion: boolean;
  hechos: string[];
  erroresDuros: Array<{
    userId: string;
    tipo: "sin_respuesta" | "demora" | "descarte_prematuro";
    detalle: string;
    etapa: EtapaDeVenta;
    minutos: number | null;
  }>;
};

type ErrorDuroConChat = ChatMedido["erroresDuros"][number] & { chat: ChatMedido };

type ResultadoIA = { contenido: string | null; entrada: number; salida: number };

type Contadores = { llamadas: number; entrada: number; salida: number };

export type ResultadoDelCoach = {
  decision: DecisionDeCorrida | "error";
  informeId?: string;
  error?: string;
};

/* ------------------------------------------------------------------------------------------------
   IA
------------------------------------------------------------------------------------------------ */

export function modeloDelCoach() {
  return process.env.COACH_MODEL?.trim() || POLITICA_COACH.ia.modelo;
}

async function llamarIA(sistema: string, usuario: string, maxTokens: number, contadores: Contadores): Promise<ResultadoIA> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { contenido: null, entrada: 0, salida: 0 };
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modeloDelCoach(),
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sistema },
        { role: "user", content: usuario },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  contadores.llamadas += 1;
  if (!response.ok) {
    throw new Error(`OpenAI respondio ${response.status}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const entrada = data.usage?.prompt_tokens ?? 0;
  const salida = data.usage?.completion_tokens ?? 0;
  contadores.entrada += entrada;
  contadores.salida += salida;
  return { contenido: data.choices?.[0]?.message?.content ?? null, entrada, salida };
}

/* ------------------------------------------------------------------------------------------------
   Lectura de la base (solo lectura)
------------------------------------------------------------------------------------------------ */

function aCrudo(fila: FilaDeMensaje): MensajeCrudo {
  return {
    id: fila.id,
    direction: fila.direction,
    type: fila.type,
    content: fila.content,
    transcripcion: fila.transcripcion,
    createdAt: fila.createdAt,
    isStatusBroadcast: fila.isStatusBroadcast,
    deletedAt: fila.deletedAt,
    // Solo las claves que usa el coach: el rawPayload completo trae el mensaje de WhatsApp entero.
    rawPayload: {
      source: fila.source,
      enviadoPorUserId: fila.enviadoPorUserId,
      kind: fila.kind,
      actorUserId: fila.actorUserId,
      assigneeUserId: fila.assigneeUserId,
    },
  };
}

async function mensajesDelCanalViejo(ids: string[], desde: Date, hasta: Date) {
  if (!ids.length) return [] as FilaDeMensaje[];
  const [delDia, contexto] = await Promise.all([
    prisma.$queryRaw<FilaDeMensaje[]>`
      SELECT m."id", m."conversationId", m."direction"::text AS "direction", m."type"::text AS "type",
             m."content", m."transcripcion", m."createdAt", m."isStatusBroadcast", m."deletedAt",
             m."rawPayload"->>'source' AS "source", m."rawPayload"->>'enviadoPorUserId' AS "enviadoPorUserId",
             m."rawPayload"->>'kind' AS "kind", m."rawPayload"->>'actorUserId' AS "actorUserId",
             m."rawPayload"->>'assigneeUserId' AS "assigneeUserId"
      FROM "Message" m
      WHERE m."conversationId" = ANY(${ids}) AND m."createdAt" >= ${desde} AND m."createdAt" < ${hasta}
      ORDER BY m."createdAt" ASC
    `,
    prisma.$queryRaw<FilaDeMensaje[]>`
      SELECT x.* FROM unnest(${ids}::text[]) AS c(id)
      CROSS JOIN LATERAL (
        SELECT m."id", m."conversationId", m."direction"::text AS "direction", m."type"::text AS "type",
               m."content", m."transcripcion", m."createdAt", m."isStatusBroadcast", m."deletedAt",
               m."rawPayload"->>'source' AS "source", m."rawPayload"->>'enviadoPorUserId' AS "enviadoPorUserId",
               m."rawPayload"->>'kind' AS "kind", m."rawPayload"->>'actorUserId' AS "actorUserId",
               m."rawPayload"->>'assigneeUserId' AS "assigneeUserId"
        FROM "Message" m
        WHERE m."conversationId" = c.id AND m."createdAt" < ${desde}
          AND m."isStatusBroadcast" = false AND m."type" <> 'SYSTEM'
        ORDER BY m."createdAt" DESC
        LIMIT ${POLITICA_COACH.ia.turnosDeContexto}
      ) x
    `,
  ]);
  return [...contexto, ...delDia];
}

async function mensajesDeLaApiOficial(ids: string[], desde: Date, hasta: Date) {
  if (!ids.length) return [] as FilaDeMensaje[];
  const [delDia, contexto] = await Promise.all([
    prisma.$queryRaw<FilaDeMensaje[]>`
      SELECT m."id", m."conversationId", m."direction"::text AS "direction", m."type"::text AS "type",
             m."content", NULL::text AS "transcripcion", m."createdAt", false AS "isStatusBroadcast",
             NULL::timestamp AS "deletedAt",
             m."rawPayload"->>'source' AS "source", m."rawPayload"->>'enviadoPorUserId' AS "enviadoPorUserId",
             m."rawPayload"->>'kind' AS "kind", m."rawPayload"->>'actorUserId' AS "actorUserId",
             m."rawPayload"->>'assigneeUserId' AS "assigneeUserId"
      FROM "OfficialApiMessage" m
      WHERE m."conversationId" = ANY(${ids}) AND m."createdAt" >= ${desde} AND m."createdAt" < ${hasta}
      ORDER BY m."createdAt" ASC
    `,
    prisma.$queryRaw<FilaDeMensaje[]>`
      SELECT x.* FROM unnest(${ids}::text[]) AS c(id)
      CROSS JOIN LATERAL (
        SELECT m."id", m."conversationId", m."direction"::text AS "direction", m."type"::text AS "type",
               m."content", NULL::text AS "transcripcion", m."createdAt", false AS "isStatusBroadcast",
               NULL::timestamp AS "deletedAt",
               m."rawPayload"->>'source' AS "source", m."rawPayload"->>'enviadoPorUserId' AS "enviadoPorUserId",
               m."rawPayload"->>'kind' AS "kind", m."rawPayload"->>'actorUserId' AS "actorUserId",
               m."rawPayload"->>'assigneeUserId' AS "assigneeUserId"
        FROM "OfficialApiMessage" m
        WHERE m."conversationId" = c.id AND m."createdAt" < ${desde} AND m."type"::text <> 'SYSTEM'
        ORDER BY m."createdAt" DESC
        LIMIT ${POLITICA_COACH.ia.turnosDeContexto}
      ) x
    `,
  ]);
  return [...contexto, ...delDia];
}

function agrupar(filas: FilaDeMensaje[]) {
  const porChat = new Map<string, MensajeCrudo[]>();
  for (const fila of filas) {
    if (!porChat.has(fila.conversationId)) porChat.set(fila.conversationId, []);
    porChat.get(fila.conversationId)!.push(aCrudo(fila));
  }
  return porChat;
}

async function chatsDelDia(workspaceId: string, desde: Date, hasta: Date): Promise<ChatDelDia[]> {
  const rango = { gte: desde, lt: hasta };
  const conMovimiento = { createdAt: rango, isStatusBroadcast: false, type: { not: "SYSTEM" as const } };
  const contactoValido = { excludedFromCrm: false, bloqueadoEn: null };
  const lineaDeVentas = { OR: [{ channelId: null }, { channel: { purpose: "SALES" } }] };
  const contactoSelect = { id: true, name: true, phoneNumber: true, crmStage: true, wonAt: true } as const;

  const viejos = await prisma.conversation.findMany({
    where: { workspaceId, contact: contactoValido, ...lineaDeVentas, messages: { some: conMovimiento } },
    orderBy: { lastMessageAt: "desc" },
    take: POLITICA_COACH.ia.maxChats,
    select: { id: true, numero: true, assignedToUserId: true, createdAt: true, contact: { select: contactoSelect } },
  });

  const quietos = await prisma.conversation.findMany({
    where: {
      workspaceId,
      id: { notIn: viejos.map((chat) => chat.id) },
      assignedToUserId: { not: null },
      lastMessageAt: { gte: new Date(desde.getTime() - 7 * 24 * 3_600_000), lt: desde },
      contact: { ...contactoValido, crmStage: { in: ["NEGOCIACION", "PROPUESTA"] } },
      ...lineaDeVentas,
    },
    orderBy: { lastMessageAt: "desc" },
    take: POLITICA_COACH.ia.maxChatsQuietos,
    select: { id: true, numero: true, assignedToUserId: true, createdAt: true, contact: { select: contactoSelect } },
  });

  const config = await prisma.officialApiClientConfig.findUnique({ where: { workspaceId }, select: { id: true } });
  const oficiales = config
    ? await prisma.officialApiConversation.findMany({
        where: { configId: config.id, messages: { some: { createdAt: rango } } },
        orderBy: { lastMessageAt: "desc" },
        take: Math.max(0, POLITICA_COACH.ia.maxChats - viejos.length),
        select: {
          id: true,
          numero: true,
          assignedToUserId: true,
          createdAt: true,
          contact: { select: { name: true, phoneNumber: true, waId: true, crmContactId: true } },
        },
      })
    : [];
  const fichasCrm = new Map(
    (
      await prisma.contact.findMany({
        where: { id: { in: oficiales.map((c) => c.contact.crmContactId).filter((id): id is string => Boolean(id)) } },
        select: { ...contactoSelect, excludedFromCrm: true, bloqueadoEn: true },
      })
    ).map((contacto) => [contacto.id, contacto]),
  );

  const [crudosViejos, crudosOficiales] = await Promise.all([
    mensajesDelCanalViejo([...viejos, ...quietos].map((chat) => chat.id), desde, hasta),
    mensajesDeLaApiOficial(oficiales.map((chat) => chat.id), desde, hasta),
  ]);
  const porChatViejo = agrupar(crudosViejos);
  const porChatOficial = agrupar(crudosOficiales);

  const ganadoHoy = (contacto: { crmStage: string; wonAt: Date | null } | null | undefined) =>
    Boolean(contacto && contacto.crmStage === "GANADO" && contacto.wonAt && contacto.wonAt >= desde && contacto.wonAt < hasta);

  const salida: ChatDelDia[] = [];
  for (const [lista, quieto] of [
    [viejos, false],
    [quietos, true],
  ] as const) {
    for (const chat of lista) {
      salida.push({
        fuente: "agent",
        id: chat.id,
        numero: chat.numero,
        assignedToUserId: chat.assignedToUserId,
        nombre: chat.contact.name ?? "",
        telefono: chat.contact.phoneNumber,
        crmStage: chat.contact.crmStage,
        ganadoHoy: ganadoHoy(chat.contact),
        quieto,
        creadoHoy: chat.createdAt >= desde && chat.createdAt < hasta,
        mensajes: normalizarMensajes(porChatViejo.get(chat.id) ?? []),
      });
    }
  }
  for (const chat of oficiales) {
    const ficha = chat.contact.crmContactId ? fichasCrm.get(chat.contact.crmContactId) : undefined;
    if (ficha && (ficha.excludedFromCrm || ficha.bloqueadoEn)) continue;
    salida.push({
      fuente: "official",
      id: chat.id,
      numero: chat.numero,
      assignedToUserId: chat.assignedToUserId,
      nombre: chat.contact.name ?? "",
      telefono: chat.contact.phoneNumber ?? chat.contact.waId,
      crmStage: ficha?.crmStage ?? "NUEVO",
      ganadoHoy: ganadoHoy(ficha),
      quieto: false,
      creadoHoy: chat.createdAt >= desde && chat.createdAt < hasta,
      mensajes: normalizarMensajes(porChatOficial.get(chat.id) ?? []),
    });
  }
  return salida;
}

/* ------------------------------------------------------------------------------------------------
   Medir y atribuir (sin IA)
------------------------------------------------------------------------------------------------ */

const HORA_BOGOTA = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });

function medirChat(chat: ChatDelDia, asesoras: Set<string>, desde: Date, corte: Date): ChatMedido {
  const delDia = chat.mensajes.filter((m) => m.en >= desde);

  // A quien se le cuenta: la que mas escribio hoy desde el CRM; si nadie, la asignada (incierta).
  const conteo = new Map<string, number>();
  for (const mensaje of delDia) {
    if (mensaje.autor === "asesora" && mensaje.userId && asesoras.has(mensaje.userId)) {
      conteo.set(mensaje.userId, (conteo.get(mensaje.userId) ?? 0) + 1);
    }
  }
  const masActiva = [...conteo].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const asignada = chat.assignedToUserId && asesoras.has(chat.assignedToUserId) ? chat.assignedToUserId : null;
  const asesoraId = masActiva ?? asignada;

  // Responde desde que el chat le cayo hoy (si le cayo hoy); si ya era suyo, desde el inicio del dia.
  const asignacion = delDia.find((m) => m.nota?.kind === "assigned" && asesoraId && m.nota.assigneeUserId === asesoraId);
  const responsableDesde = asignacion ? asignacion.en : desde;
  const esperas = chat.quieto
    ? { eventos: [], primeraRespuestaMin: null, huboEspera: false }
    : detectarEsperas({ mensajes: chat.mensajes, desde: responsableDesde, corte });
  const cotizacion = huboCotizacion(chat.mensajes, desde);
  const ref = chat.numero ? `#${chat.numero}` : `#${chat.id.slice(-6)}`;

  const hechos: string[] = [];
  const erroresDuros: ChatMedido["erroresDuros"] = [];
  if (chat.quieto) {
    const ultimo = chat.mensajes.at(-1);
    if (ultimo) {
      const dias = Math.max(1, Math.round((corte.getTime() - ultimo.en.getTime()) / 86_400_000));
      hechos.push(`sin mensajes hoy; el último fue hace ${dias} día(s), de ${ultimo.autor === "cliente" ? "el cliente" : ultimo.autor === "asesora" ? "la asesora" : "el bot"}`);
    }
  } else {
    if (esperas.primeraRespuestaMin !== null) hechos.push(`primera respuesta humana: ${esperas.primeraRespuestaMin} min laborales`);
    for (const evento of esperas.eventos) {
      // Si la espera empezo al inicio de la ventana, el cliente venia esperando de antes (de ayer).
      const deAntes = evento.desde.getTime() <= responsableDesde.getTime();
      const hora = HORA_BOGOTA.format(evento.desde);
      const desdeTexto = deAntes ? "desde antes de abrir (venía de ayer)" : `desde las ${hora}`;
      const etapa = etapaDeVentaEn(chat.mensajes, evento.desde);
      if (evento.tipo === "demora") {
        hechos.push(`demora de ${evento.minutos} min laborales (${deAntes ? "venía de ayer" : `desde ${hora}`})`);
        if (asesoraId) {
          erroresDuros.push({
            userId: asesoraId,
            tipo: "demora",
            detalle: `El cliente esperó ${evento.minutos} min en horario (${desdeTexto}).`,
            etapa,
            minutos: evento.minutos,
          });
        }
      } else {
        hechos.push(`el cliente quedó SIN RESPUESTA humana ${deAntes ? "desde ayer" : `desde ${hora}`} (${evento.minutos} min laborales)`);
        if (asesoraId) {
          erroresDuros.push({
            userId: asesoraId,
            tipo: "sin_respuesta",
            detalle: `El cliente escribió ${deAntes ? "antes de abrir (venía de ayer)" : `a las ${hora}`} y nadie le respondió (${evento.minutos} min en horario).`,
            etapa,
            minutos: evento.minutos,
          });
        }
      }
    }
    if (asesoraId && !masActiva && !delDia.some((m) => m.autor === "asesora")) {
      hechos.push("ninguna persona escribió hoy en este chat");
    } else if (!masActiva && delDia.some((m) => m.autor === "asesora" && m.desdeCelular)) {
      hechos.push("lo escrito hoy salió del celular de la línea (no se sabe qué asesora)");
    }
  }
  hechos.push(cotizacion ? "se detectó una cotización enviada hoy" : "no se detectó cotización enviada hoy");
  if (chat.ganadoHoy) hechos.push("GANADO hoy (venta cerrada hoy: seguimiento no aplica)");
  if (esContraentregaRespetada(ultimos4(chat.telefono))) {
    hechos.push("chat con contraentrega YA prometida antes de la suspensión: se respeta, no es error");
  } else if (delDia.some((m) => m.autor === "asesora" && mencionaContraentrega(m.texto))) {
    hechos.push(
      contraentregaSoloNegada(delDia)
        ? "la asesora mencionó la contraentrega solo para decir que no se maneja (no es error)"
        : "la asesora escribió la palabra 'contraentrega' (revisa si la ofreció)",
    );
  }

  // Descartes antes de 72 h: cuentan para quien descarto, aunque el chat fuera de otra.
  for (const mensaje of delDia) {
    if (!esNotaDeDescarte(mensaje) || !mensaje.nota?.actorUserId || !asesoras.has(mensaje.nota.actorUserId)) continue;
    const ultimoDelCliente = [...chat.mensajes].reverse().find((m) => m.autor === "cliente" && m.en < mensaje.en);
    if (esDescartePrematuro({ descartadoEn: mensaje.en, ultimoMensajeDelClienteEn: ultimoDelCliente?.en ?? null })) {
      const horas = ultimoDelCliente ? Math.round((mensaje.en.getTime() - ultimoDelCliente.en.getTime()) / 3_600_000) : 0;
      erroresDuros.push({
        userId: mensaje.nota.actorUserId,
        tipo: "descarte_prematuro",
        detalle: `Se descartó ${horas < 1 ? "a menos de 1 h" : `a las ${horas} h`} del último mensaje del cliente (mínimo ${POLITICA_COACH.horasMinimasParaDescartar} h).`,
        etapa: "seguimiento",
        minutos: null,
      });
      hechos.push("se descartó antes de 72 h desde el último mensaje del cliente");
    }
  }

  return {
    ...chat,
    ref,
    ultimos4: ultimos4(chat.telefono),
    asesoraId,
    atribucionSegura: Boolean(masActiva),
    esperas,
    cotizacion,
    hechos,
    erroresDuros,
  };
}

/* ------------------------------------------------------------------------------------------------
   Por asesora
------------------------------------------------------------------------------------------------ */

function mediana(valores: number[]) {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[medio] : Math.round((orden[medio - 1] + orden[medio]) / 2);
}

function refDe(chat: ChatMedido) {
  return { ref: chat.ref, numero: chat.numero, ultimos4: chat.ultimos4, nombre: primerNombre(chat.nombre) };
}

async function analizarAsesora(input: {
  nombre: string;
  dia: string;
  chats: ChatMedido[];
  desde: Date;
  nombres: Record<string, string>;
  contadores: Contadores;
}): Promise<{
  analisis: Map<string, AnalisisDeChat>;
  resumen: ResumenDeAsesora | null;
  iaUsada: boolean;
  transcripciones: Map<string, string>;
}> {
  const analisis = new Map<string, AnalisisDeChat>();
  const transcripciones = new Map<string, string>();
  if (!process.env.OPENAI_API_KEY?.trim() || !input.chats.length) {
    return { analisis, resumen: null, iaUsada: false, transcripciones };
  }
  const fichas: FichaParaIA[] = input.chats.map((chat) => ({
    ref: chat.ref,
    ultimos4: chat.ultimos4,
    nombre: primerNombre(chat.nombre),
    etapa: ETAPA[chat.crmStage] ?? chat.crmStage,
    soloPendiente: chat.quieto,
    hechos: chat.hechos,
    transcripcion: transcripcionParaIA(chat.mensajes, {
      inicioDelDia: input.desde,
      nombres: input.nombres,
      ocultar: apellidosDe(chat.nombre),
    }),
  }));

  for (const ficha of fichas) transcripciones.set(ficha.ref, ficha.transcripcion);

  const lotes: FichaParaIA[][] = [];
  for (let i = 0; i < fichas.length; i += POLITICA_COACH.ia.chatsPorLote) {
    lotes.push(fichas.slice(i, i + POLITICA_COACH.ia.chatsPorLote));
  }
  const resumenes: ResumenDeAsesora[] = [];
  for (const lote of lotes) {
    try {
      const { sistema, usuario } = armarPromptDelLote({ asesora: input.nombre, dia: input.dia, fichas: lote });
      const respuesta = await llamarIA(sistema, usuario, 350 * lote.length + 300, input.contadores);
      const parseado = parsearRespuestaDelLote(respuesta.contenido, lote.map((f) => f.ref));
      for (const [ref, valor] of parseado.chats) analisis.set(ref, valor);
      if (parseado.resumen) resumenes.push(parseado.resumen);
    } catch (error) {
      // Un lote que falla no tumba el informe: esos chats quedan solo con lo medido.
      console.error("[COACH] lote_fallido", input.nombre, error instanceof Error ? error.message : error);
    }
  }

  let resumen = resumenes[0] ?? null;
  if (resumenes.length > 1) {
    // Varios lotes: una llamada corta junta lo que hizo bien. Lo que tiene que mejorar NO lo elige
    // la IA: lo elige el codigo con los conteos (habilidad.ts). Antes esta llamada lo elegia sin
    // ver ningun conteo y salia lo mismo para todas (contraentrega/envio, 9-oct).
    try {
      const respuesta = await llamarIA(
        'Eres el coach de ventas de Magilus. Recibes frases parciales con lo que una asesora hizo bien hoy y devuelves SOLO un JSON {"loQueHizoBien":"..."}: 1 o 2 frases con lo mejor, concreto. Español de Colombia, tono que enseña.',
        JSON.stringify(resumenes.map((r) => r.loQueHizoBien).filter(Boolean)),
        200,
        input.contadores,
      );
      const datos = JSON.parse(respuesta.contenido ?? "{}") as Record<string, unknown>;
      if (typeof datos.loQueHizoBien === "string" && datos.loQueHizoBien.trim()) {
        resumen = { loQueHizoBien: limpiarDatosPersonales(datos.loQueHizoBien).slice(0, 400), unaCosaAMejorar: "", ejemplo: "" };
      }
    } catch (error) {
      console.error("[COACH] resumen_fallido", input.nombre, error instanceof Error ? error.message : error);
    }
  }
  return { analisis, resumen, iaUsada: true, transcripciones };
}

/**
 * La IA redacta (c) que hacer diferente y (d) el mensaje modelo de la habilidad que YA eligio el
 * codigo, con los chats de la evidencia. Si no hay IA o lo que devuelve no respeta la politica,
 * queda la plantilla.
 */
async function redactarHabilidad(input: {
  asesora: string;
  habilidad: HabilidadDelDia;
  transcripciones: Map<string, string>;
  contadores: Contadores;
}): Promise<HabilidadDelDia> {
  if (!process.env.OPENAI_API_KEY?.trim()) return input.habilidad;
  const chats = input.habilidad.evidencia
    .map((e) => ({ ref: e.ref, transcripcion: (input.transcripciones.get(e.ref) ?? "").slice(-3000) }))
    .filter((c) => c.transcripcion);
  try {
    const { sistema, usuario } = armarPromptDeHabilidad({ asesora: input.asesora, habilidad: input.habilidad, chats });
    const respuesta = await llamarIA(sistema, usuario, 350, input.contadores);
    const redaccion = redaccionValida(respuesta.contenido);
    return redaccion ? { ...input.habilidad, ...redaccion, redactadoPor: "ia" } : input.habilidad;
  } catch (error) {
    console.error("[COACH] redaccion_fallida", input.asesora, error instanceof Error ? error.message : error);
    return input.habilidad;
  }
}

/** La temperatura de un chat: la que leyo la IA o, si no hay, la de la etapa del CRM. */
function temperaturaDe(chat: ChatMedido, lectura: AnalisisDeChat | undefined) {
  return lectura?.temperatura ?? (chat.crmStage === "NEGOCIACION" ? "caliente" : chat.crmStage === "PROPUESTA" ? "tibio" : "frio");
}

function armarParteDeAsesora(input: {
  chats: ChatMedido[];
  erroresDuros: ErrorDuroConChat[];
  analisis: Map<string, AnalisisDeChat>;
  resumen: ResumenDeAsesora | null;
  desde: Date;
}) {
  const juzgados = input.chats.filter((chat) => !chat.quieto);
  const porChat: PuntajesDelCoach["porChat"] = [];
  const listaDeEjes: Ejes[] = [];
  const aciertos: AciertoDelCoach[] = [];
  const errores: ErrorDelCoach[] = [];
  const pendientes: PendienteDelCoach[] = [];

  for (const error of input.erroresDuros) {
    errores.push({
      ...refDe(error.chat),
      tipo: error.tipo,
      detalle: error.detalle,
      etapa: error.etapa,
      minutos: error.minutos,
      temperatura: temperaturaDe(error.chat, input.analisis.get(error.chat.ref)),
    });
  }

  for (const chat of input.chats) {
    const lectura = input.analisis.get(chat.ref);
    const sinRespuesta = chat.esperas.eventos.some((e) => e.tipo === "sin_respuesta");

    if (!chat.quieto) {
      const ejes: Ejes = {
        V: ejeVelocidad(chat.esperas),
        N: lectura?.ejes.N ?? null,
        A: lectura?.ejes.A ?? null,
        // Seguimiento no aplica si la venta cerro hoy mismo (Fase A, seccion 6).
        S: chat.ganadoHoy ? null : lectura?.ejes.S ?? null,
        C: lectura?.ejes.C ?? null,
      };
      listaDeEjes.push(ejes);
      porChat.push({ ref: chat.ref, ejes, puntaje: puntajePonderado(ejes) });
      for (const texto of lectura?.aciertos ?? []) aciertos.push({ ...refDe(chat), texto });
      const delDia = chat.mensajes.filter((m) => m.en >= input.desde);
      for (const error of lectura?.errores ?? []) {
        // Los de reloj ya estan medidos; la IA no los repite.
        if (error.tipo === "sin_respuesta" || error.tipo === "demora") continue;
        // Contraentrega que NO es error: chat respetado, o la asesora solo dijo que no se maneja.
        if (error.tipo === "contraentrega" && (esContraentregaRespetada(chat.ultimos4) || contraentregaSoloNegada(delDia))) continue;
        errores.push({
          ...refDe(chat),
          tipo: error.tipo,
          detalle: error.detalle,
          etapa: etapaDelTipo(error.tipo),
          minutos: null,
          temperatura: temperaturaDe(chat, lectura),
        });
      }
    }

    const temperatura = temperaturaDe(chat, lectura);
    const vale = !chat.ganadoHoy && temperatura !== "cerrado" && temperatura !== "no_perseguir";
    if (vale && (sinRespuesta || temperatura === "caliente" || temperatura === "tibio")) {
      pendientes.push({
        ...refDe(chat),
        temperatura,
        urgente: sinRespuesta,
        etapa: ETAPA[chat.crmStage] ?? chat.crmStage,
        porque: lectura?.porque || (sinRespuesta ? "Quedó esperando respuesta." : chat.hechos[0] ?? ""),
        siguienteMensaje: mensajeSugeridoValido(lectura?.siguienteMensaje ?? ""),
      });
    }
  }

  const orden = { caliente: 0, tibio: 1, frio: 2, cerrado: 3, no_perseguir: 4 } as const;
  pendientes.sort((a, b) => Number(b.urgente) - Number(a.urgente) || orden[a.temperatura] - orden[b.temperatura]);

  const ejes = promedioDeEjes(listaDeEjes);
  const ganados = juzgados.filter((chat) => chat.ganadoHoy).length;
  const puntajes: PuntajesDelCoach = { ejes, ganados, porChat };
  const resumen: ResumenDeAsesoraGuardado = {
    loQueHizoBien: input.resumen?.loQueHizoBien ?? "",
    unaCosaAMejorar: input.resumen?.unaCosaAMejorar ?? "",
    ejemplo: input.resumen?.ejemplo ?? "",
    metricas: {
      chats: juzgados.length,
      chatsQuietos: input.chats.length - juzgados.length,
      demoras: juzgados.reduce((n, c) => n + c.esperas.eventos.filter((e) => e.tipo === "demora").length, 0),
      sinRespuesta: juzgados.filter((c) => c.esperas.eventos.some((e) => e.tipo === "sin_respuesta")).length,
      primeraRespuestaMedianaMin: mediana(
        juzgados.map((c) => c.esperas.primeraRespuestaMin).filter((v): v is number => v !== null),
      ),
      cotizaciones: juzgados.filter((c) => c.cotizacion).length,
      ganados,
      atribucionIncierta: juzgados.filter((c) => !c.atribucionSegura).length,
    },
  };

  return {
    chats: juzgados.length,
    puntaje: puntajePonderado(ejes),
    puntajes,
    aciertos: aciertos.slice(0, 8),
    errores: errores.slice(0, 30),
    pendientes: pendientes.slice(0, 30),
    resumen,
  };
}

/* ------------------------------------------------------------------------------------------------
   Resumen del equipo
------------------------------------------------------------------------------------------------ */

async function resumirEquipo(input: {
  base: Omit<ResumenDelEquipo, "resumen" | "fallasDelSistema">;
  fallas: Array<{ texto: string; ref: string | null }>;
  contadores: Contadores;
}): Promise<ResumenDelEquipo> {
  let resumen = "";
  let fallas = input.fallas;
  if (process.env.OPENAI_API_KEY?.trim()) {
    try {
      const respuesta = await llamarIA(
        [
          "Eres el coach de ventas de Magilus. Recibes las cifras del día del equipo de ventas y la lista de fallas del sistema/bot detectadas en los chats.",
          'Devuelve SOLO un JSON {"resumen":"...","fallas":[{"texto":"...","ref":"#123 o null"}]}.',
          "resumen: 3 o 4 frases para el dueño: cómo fue el día, por qué no se cerró más y qué atacar mañana. Separa lo que es error de las asesoras de lo que es falla del sistema o del bot.",
          "Lo que viene en cifras.problemasDelEquipo es del equipo o de un cambio de política del día: nómbralo una sola vez y no se lo atribuyas a ninguna asesora.",
          "fallas: agrupa las fallas repetidas en una sola línea (di cuántas veces), máximo 10, la más grave primero.",
        ].join("\n"),
        JSON.stringify({ cifras: input.base, fallas: input.fallas.slice(0, 60) }),
        700,
        input.contadores,
      );
      const datos = JSON.parse(respuesta.contenido ?? "{}") as { resumen?: unknown; fallas?: unknown };
      if (typeof datos.resumen === "string") resumen = limpiarDatosPersonales(datos.resumen).slice(0, 900);
      if (Array.isArray(datos.fallas) && datos.fallas.length) {
        fallas = datos.fallas
          .map((f) => {
            const fila = (f && typeof f === "object" ? f : {}) as { texto?: unknown; ref?: unknown };
            return {
              texto: typeof fila.texto === "string" ? limpiarDatosPersonales(fila.texto).slice(0, 240) : "",
              ref: typeof fila.ref === "string" && fila.ref.startsWith("#") ? fila.ref : null,
            };
          })
          .filter((f) => f.texto)
          .slice(0, 10);
      }
    } catch (error) {
      console.error("[COACH] resumen_equipo_fallido", error instanceof Error ? error.message : error);
    }
  }
  if (!resumen) {
    const b = input.base;
    resumen = `${b.chatsConActividad} chats con movimiento, ${b.leads} leads nuevos, ${b.ventas} venta(s) y ${b.cotizaciones} cotización(es) detectada(s). ${b.sinAsesora} chat(s) sin asesora.`;
  }
  return { ...input.base, resumen, fallasDelSistema: fallas.slice(0, 20) };
}

/* ------------------------------------------------------------------------------------------------
   La corrida
------------------------------------------------------------------------------------------------ */

/** Intentos del dia (sin migracion: un AppSetting por negocio y dia). */
const CLAVE_INTENTOS = (workspaceId: string, dia: string) => `coach:intentos:${workspaceId}:${dia}`;

async function intentosDelDia(workspaceId: string, dia: string) {
  const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_INTENTOS(workspaceId, dia) } });
  const n = Number(fila?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function sumarIntento(workspaceId: string, dia: string) {
  const n = (await intentosDelDia(workspaceId, dia)) + 1;
  await prisma.appSetting.upsert({
    where: { key: CLAVE_INTENTOS(workspaceId, dia) },
    create: { key: CLAVE_INTENTOS(workspaceId, dia), value: String(n) },
    update: { value: String(n) },
  });
}

/**
 * Un EN_CURSO de mas de 30 min ya no esta corriendo (el servidor se reinicio a mitad): se marca
 * ERROR para que la pantalla no diga "Generando…" para siempre y el dueño pueda rehacerlo. Lo
 * llama el reloj en cada pasada (es un UPDATE sobre una tabla chica).
 */
export async function marcarCorridasColgadas(ahora = new Date()) {
  const limite = new Date(ahora.getTime() - POLITICA_COACH.reloj.minutosColgado * 60_000);
  const { count } = await prisma.coachInforme.updateMany({
    where: { estado: "EN_CURSO", iniciadoEn: { lt: limite } },
    data: {
      estado: "ERROR",
      error: "Se interrumpió a mitad (el servidor se reinició). Toca «Generar ahora» para rehacerlo.",
      terminadoEn: ahora,
    },
  });
  if (count) console.warn("[COACH] corridas_colgadas_marcadas", count);
  return count;
}

async function tomarTurno(
  workspaceId: string,
  dia: string,
  clave: Date,
  force: boolean,
  origen: string,
): Promise<ResultadoDelCoach> {
  const existente = await prisma.coachInforme.findUnique({
    where: { workspaceId_fecha: { workspaceId, fecha: clave } },
    select: { id: true, estado: true, iniciadoEn: true },
  });
  const intentos = force ? 0 : await intentosDelDia(workspaceId, dia);
  const decision = decidirCorrida(existente, { force, intentos });
  if (decision !== "generar") return { decision, informeId: existente?.id };
  await sumarIntento(workspaceId, dia);

  const ahora = new Date();
  if (existente) {
    // Toma el turno solo si nadie lo tomo entre la lectura y aca.
    const tomado = await prisma.coachInforme.updateMany({
      where: { id: existente.id, estado: existente.estado, iniciadoEn: existente.iniciadoEn },
      data: { estado: "EN_CURSO", origen, iniciadoEn: ahora, terminadoEn: null, error: null, versionPolitica: POLITICA_COACH.version },
    });
    return tomado.count ? { decision, informeId: existente.id } : { decision: "omitir_en_curso", informeId: existente.id };
  }
  try {
    const creado = await prisma.coachInforme.create({
      data: { workspaceId, fecha: clave, estado: "EN_CURSO", origen, versionPolitica: POLITICA_COACH.version, iniciadoEn: ahora },
      select: { id: true },
    });
    return { decision, informeId: creado.id };
  } catch (error) {
    // Otra pasada del reloj lo creo en el mismo instante (@@unique negocio + dia).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { decision: "omitir_en_curso" };
    }
    throw error;
  }
}

export async function generarCoachDelDia(
  workspaceId: string,
  dia: string,
  opciones: { force?: boolean; origen?: "reloj" | "manual" } = {},
): Promise<ResultadoDelCoach> {
  const { clave, desde, hasta } = rangoDelDia(dia);
  const turno = await tomarTurno(workspaceId, dia, clave, Boolean(opciones.force), opciones.origen ?? "reloj");
  if (turno.decision !== "generar" || !turno.informeId) return turno;
  const informeId = turno.informeId;
  const contadores: Contadores = { llamadas: 0, entrada: 0, salida: 0 };
  const modelo = modeloDelCoach();

  try {
    const ahora = new Date();
    const corte = hasta < ahora ? hasta : ahora;

    const [workspace, miembros] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } }),
      prisma.workspaceMember.findMany({
        where: { workspaceId, isActive: true },
        select: { userId: true, role: true, user: { select: { name: true, email: true } } },
      }),
    ]);
    // Las asesoras: todo el equipo menos la cuenta del dueño (sus chats cuentan como "sin asesora").
    const equipo = miembros.filter((m) => m.role !== "OWNER" && m.userId !== workspace?.ownerId);
    const nombres: Record<string, string> = Object.fromEntries(
      equipo.map((m) => [m.userId, m.user?.name?.trim() || m.user?.email?.split("@")[0] || "Asesora"]),
    );
    const nombresCortos: Record<string, string> = Object.fromEntries(
      Object.entries(nombres).map(([id, nombre]) => [id, primerNombre(nombre) || nombre]),
    );
    const asesoras = new Set(Object.keys(nombres));

    const chats = (await chatsDelDia(workspaceId, desde, hasta)).map((chat) => medirChat(chat, asesoras, desde, corte));

    // Errores de reloj, agrupados por quien los cometio (un descarte puede ser de otra asesora).
    const erroresDurosPorAsesora = new Map<string, ErrorDuroConChat[]>();
    for (const chat of chats) {
      for (const error of chat.erroresDuros) {
        if (!erroresDurosPorAsesora.has(error.userId)) erroresDurosPorAsesora.set(error.userId, []);
        erroresDurosPorAsesora.get(error.userId)!.push({ ...error, chat });
      }
    }

    const porAsesora = new Map<string, ChatMedido[]>();
    for (const chat of chats) {
      if (!chat.asesoraId) continue;
      if (!porAsesora.has(chat.asesoraId)) porAsesora.set(chat.asesoraId, []);
      porAsesora.get(chat.asesoraId)!.push(chat);
    }

    await prisma.coachAsesora.deleteMany({ where: { informeId } });

    const todasLasLecturas = new Map<string, AnalisisDeChat>();
    const erroresPorAsesora: ResumenDelEquipo["erroresDeAsesoras"] = [];
    let iaDisponible = false;
    const partes: Array<{ userId: string; parte: ReturnType<typeof armarParteDeAsesora>; transcripciones: Map<string, string> }> = [];
    for (const userId of new Set([...porAsesora.keys(), ...erroresDurosPorAsesora.keys()])) {
      const suyos = porAsesora.get(userId) ?? [];
      const { analisis, resumen, iaUsada, transcripciones } = await analizarAsesora({
        nombre: nombresCortos[userId] ?? "Asesora",
        dia,
        chats: suyos,
        desde,
        nombres: nombresCortos,
        contadores,
      });
      iaDisponible ||= iaUsada;
      for (const [ref, valor] of analisis) todasLasLecturas.set(ref, valor);
      const parte = armarParteDeAsesora({
        chats: suyos,
        erroresDuros: erroresDurosPorAsesora.get(userId) ?? [],
        analisis,
        resumen,
        desde,
      });
      const porTipo: Record<string, number> = {};
      for (const error of parte.errores) porTipo[error.tipo] = (porTipo[error.tipo] ?? 0) + 1;
      erroresPorAsesora.push({ userId, nombre: nombres[userId] ?? "Asesora", total: parte.errores.length, porTipo });
      partes.push({ userId, parte, transcripciones });
    }

    // La habilidad del dia: la elige el CODIGO con los errores de cada una (politica.ts, habilidad);
    // lo que es del equipo sale una sola vez en el resumen. La IA solo redacta la elegida.
    const { porAsesora: habilidades, problemasDelEquipo } = elegirHabilidades(
      partes.map(({ userId, parte }) => ({
        userId,
        nombre: nombres[userId] ?? "Asesora",
        errores: parte.errores,
        puntajes: parte.puntajes,
        pendientes: parte.pendientes,
        metricas: parte.resumen.metricas,
      })),
      dia,
    );

    for (const { userId, parte, transcripciones } of partes) {
      const elegida = habilidades.get(userId) ?? null;
      const habilidad = elegida
        ? await redactarHabilidad({ asesora: nombresCortos[userId] ?? "Asesora", habilidad: elegida, transcripciones, contadores })
        : null;
      parte.resumen.habilidad = habilidad;
      parte.resumen.unaCosaAMejorar = unaCosaAMejorarDe(habilidad);
      parte.resumen.ejemplo = habilidad?.ejemplo ?? "";

      await prisma.coachAsesora.create({
        data: {
          informeId,
          workspaceId,
          userId,
          nombre: nombres[userId] ?? "Asesora",
          chats: parte.chats,
          puntaje: parte.puntaje === null ? null : new Prisma.Decimal(parte.puntaje),
          puntajes: parte.puntajes as unknown as Prisma.InputJsonValue,
          aciertos: parte.aciertos as unknown as Prisma.InputJsonValue,
          errores: parte.errores as unknown as Prisma.InputJsonValue,
          pendientes: parte.pendientes as unknown as Prisma.InputJsonValue,
          resumen: parte.resumen as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // Fallas del sistema: lo que la IA vio del bot y los chats sin asesora con el cliente esperando.
    const fallas: Array<{ texto: string; ref: string | null }> = [];
    for (const chat of chats) {
      for (const texto of todasLasLecturas.get(chat.ref)?.fallasDelSistema ?? []) fallas.push({ texto, ref: chat.ref });
      if (!chat.asesoraId && !chat.quieto) {
        const espera = detectarEsperas({ mensajes: chat.mensajes, desde, corte });
        const sin = espera.eventos.find((e) => e.tipo === "sin_respuesta");
        if (sin) {
          fallas.push({
            texto: `Chat sin asesora: el cliente escribió a las ${HORA_BOGOTA.format(sin.desde)} y ninguna persona respondió (${sin.minutos} min en horario).`,
            ref: chat.ref,
          });
        }
      }
    }

    const motivos = new Map<MotivoDeNoCierre, number>();
    let calientes = 0;
    let tibios = 0;
    for (const chat of chats) {
      const lectura = todasLasLecturas.get(chat.ref);
      const temperatura = lectura?.temperatura ?? (chat.crmStage === "NEGOCIACION" ? "caliente" : chat.crmStage === "PROPUESTA" ? "tibio" : null);
      if (temperatura === "caliente") calientes += 1;
      if (temperatura === "tibio") tibios += 1;
      if (lectura && !chat.ganadoHoy && lectura.motivoNoCierre !== "vendida") {
        motivos.set(lectura.motivoNoCierre, (motivos.get(lectura.motivoNoCierre) ?? 0) + 1);
      }
    }

    const ventas = await prisma.contact.count({ where: { workspaceId, crmStage: "GANADO", wonAt: { gte: desde, lt: hasta } } });
    const activos = chats.filter((c) => !c.quieto);
    const resumenEquipo = await resumirEquipo({
      base: {
        dia,
        iaDisponible,
        leads: activos.filter((c) => c.creadoHoy).length,
        chatsConActividad: activos.length,
        sinAsesora: activos.filter((c) => !c.asesoraId).length,
        calientes,
        tibios,
        cotizaciones: activos.filter((c) => c.cotizacion).length,
        ventas,
        motivos: [...motivos].map(([motivo, casos]) => ({ motivo, casos })).sort((a, b) => b.casos - a.casos),
        erroresDeAsesoras: erroresPorAsesora.sort((a, b) => b.total - a.total),
        problemasDelEquipo,
      },
      fallas,
      contadores,
    });

    await prisma.coachInforme.update({
      where: { id: informeId },
      data: {
        estado: "LISTO",
        modelo: contadores.llamadas ? modelo : null,
        versionPolitica: POLITICA_COACH.version,
        resumenEquipo: resumenEquipo as unknown as Prisma.InputJsonValue,
        chatsLeidos: chats.length,
        llamadasIA: contadores.llamadas,
        tokensEntrada: contadores.entrada,
        tokensSalida: contadores.salida,
        costoUsd: new Prisma.Decimal(costoUsd(modelo, contadores.entrada, contadores.salida)),
        terminadoEn: new Date(),
        error: null,
      },
    });
    console.log("[COACH] listo", { workspaceId, dia, chats: chats.length, ...contadores });
    return { decision: "generar", informeId };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error("[COACH] fallo", workspaceId, dia, mensaje);
    await prisma.coachInforme
      .update({
        where: { id: informeId },
        data: {
          estado: "ERROR",
          error: mensaje.slice(0, 500),
          llamadasIA: contadores.llamadas,
          tokensEntrada: contadores.entrada,
          tokensSalida: contadores.salida,
          costoUsd: new Prisma.Decimal(costoUsd(modelo, contadores.entrada, contadores.salida)),
          terminadoEn: new Date(),
        },
      })
      .catch(() => {});
    return { decision: "error", informeId, error: mensaje };
  }
}

/* ------------------------------------------------------------------------------------------------
   El reloj y el interruptor
------------------------------------------------------------------------------------------------ */

const CLAVE_ACTIVO = (workspaceId: string) => `coach:activo:${workspaceId}`;

/** ¿Corre solo cada noche? Se prende desde la pantalla del coach (dueño). Apagado por defecto. */
export async function coachNocturnoActivo(workspaceId: string) {
  const fila = await prisma.appSetting.findUnique({ where: { key: CLAVE_ACTIVO(workspaceId) } });
  return fila?.value === "1";
}

export async function guardarCoachNocturno(workspaceId: string, activo: boolean) {
  await prisma.appSetting.upsert({
    where: { key: CLAVE_ACTIVO(workspaceId) },
    create: { key: CLAVE_ACTIVO(workspaceId), value: activo ? "1" : "0" },
    update: { value: activo ? "1" : "0" },
  });
}

/** Lo llama el reloj del informe diario entre las 23:30 y las 23:58: genera el dia de hoy. */
export async function generarCoachDeNegociosActivos(ahora = new Date()) {
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: "coach:activo:" }, value: "1" },
    select: { key: true },
  });
  const dia = diaEnBogota(ahora);
  await marcarCorridasColgadas(ahora).catch((error) => console.error("[COACH] colgadas_fallo", error));
  const resultados: Array<{ workspaceId: string } & ResultadoDelCoach> = [];
  for (const fila of filas) {
    const workspaceId = fila.key.slice("coach:activo:".length);
    try {
      resultados.push({ workspaceId, ...(await generarCoachDelDia(workspaceId, dia, { origen: "reloj" })) });
    } catch (error) {
      resultados.push({ workspaceId, decision: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return resultados;
}
