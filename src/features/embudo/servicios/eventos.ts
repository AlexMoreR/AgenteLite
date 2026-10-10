import { Prisma } from "@prisma/client";
import { after } from "next/server";

import { prisma } from "@/lib/prisma";

import { productoDeEntrada } from "../dominio/combo";
import {
  aplicarEvento,
  eventosDeSenales,
  eventosDelTurno,
  type ContextoDelLead,
  type EventoDelEmbudo,
  type FotoDelLead,
  type OrigenDeEvento,
  type TrazaDelTurno,
} from "../dominio/eventos";
import { claveDeProductoDelV3, embudoActivo, leerConfigEmbudo } from "./config";

/**
 * EL REGISTRO DEL EMBUDO (F1: medir sin cambiar nada).
 *
 * La regla de oro: nada de esto puede cambiar lo que el bot o el reparto hacen, ni demorar la
 * respuesta al cliente. Por eso:
 *  - todo corre en segundo plano (`enSegundoPlano`: after() de Next, o una promesa suelta);
 *  - ninguna función de este archivo lanza: cualquier error se anota en el log y se sigue;
 *  - con `embudo:activo:<workspaceId>` = "false" no se escribe nada (ver config.ts).
 *
 * Cada evento se guarda en EmbudoEvento (los que solo pasan una vez llevan `claveUnica` y no se
 * repiten) y actualiza la foto del lead en EmbudoLead con la regla pura de dominio/eventos.ts.
 */

type BaseDelEvento = {
  workspaceId: string;
  conversationId: string;
  contactId?: string | null;
  channelId?: string | null;
};

/** Eventos que solo quedan en EmbudoEvento: no tocan EmbudoLead. */
const SOLO_REGISTRO = new Set<string>(["SEGUIMIENTO_FRENADO", "TAREA_REPARTIDA"]);

function anotarError(donde: string, error: unknown, extra: Record<string, unknown> = {}) {
  console.warn(`[embudo] ${donde}`, { ...extra, error: error instanceof Error ? error.message : String(error) });
}

/**
 * Corre `tarea` sin que nadie la espere. Dentro de un pedido de Next usa after() (corre al
 * terminar la respuesta); fuera de un pedido (un reloj, un script) queda como promesa suelta.
 * Nunca lanza.
 */
export function enSegundoPlano(tarea: () => Promise<unknown>): void {
  const segura = async () => {
    try {
      await tarea();
    } catch (error) {
      anotarError("tarea en segundo plano", error);
    }
  };
  try {
    after(segura);
  } catch {
    void segura();
  }
}

async function contextoDeLaCharla(base: BaseDelEvento): Promise<ContextoDelLead | null> {
  const conversacion = await prisma.conversation.findUnique({
    where: { id: base.conversationId },
    select: { workspaceId: true, contactId: true, channelId: true, startedAt: true },
  });
  if (!conversacion || conversacion.workspaceId !== base.workspaceId) {
    return null;
  }
  return {
    conversationId: base.conversationId,
    workspaceId: base.workspaceId,
    contactId: base.contactId || conversacion.contactId,
    channelId: base.channelId || conversacion.channelId || "",
    inicioDeLaCharla: conversacion.startedAt,
  };
}

function comoFoto(fila: Record<string, unknown> | null): FotoDelLead | null {
  if (!fila) return null;
  const foto = fila as unknown as FotoDelLead;
  const accionDatos = fila.accionDatos && typeof fila.accionDatos === "object" && !Array.isArray(fila.accionDatos) ? (fila.accionDatos as Record<string, unknown>) : null;
  return { ...foto, accionDatos, senales: Array.isArray(fila.senales) ? (fila.senales as FotoDelLead["senales"]) : null };
}

function datosDeLaFoto(foto: FotoDelLead) {
  return {
    contactId: foto.contactId,
    workspaceId: foto.workspaceId,
    channelId: foto.channelId,
    productoEntrada: foto.productoEntrada,
    productoActual: foto.productoActual,
    mezcla: foto.mezcla,
    anuncioId: foto.anuncioId,
    anuncioTitulo: foto.anuncioTitulo,
    anuncioRed: foto.anuncioRed,
    entradaEn: foto.entradaEn,
    libroVersionEntrada: foto.libroVersionEntrada,
    pasoActual: foto.pasoActual,
    pasoMaximo: foto.pasoMaximo,
    temperatura: foto.temperatura,
    puntaje: foto.puntaje,
    motivo: foto.motivo,
    senales: foto.senales ? (foto.senales as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    transferencia: foto.transferencia,
    asignadaA: foto.asignadaA,
    asignadaEn: foto.asignadaEn,
    primeraRespuestaAsesoraEn: foto.primeraRespuestaAsesoraEn,
    ultimoClienteEn: foto.ultimoClienteEn,
    ultimoBotEn: foto.ultimoBotEn,
    cotizacionRef: foto.cotizacionRef,
    cotizacionEn: foto.cotizacionEn,
    anticipoEn: foto.anticipoEn,
    ventaEn: foto.ventaEn,
    // F2 (seguimiento inteligente). `undefined` = no se toca la columna.
    productoInteres: foto.productoInteres,
    temperaturaEn: foto.temperaturaEn,
    accion: foto.accion,
    accionDatos:
      foto.accionDatos === undefined ? undefined : foto.accionDatos ? (foto.accionDatos as Prisma.InputJsonValue) : Prisma.DbNull,
    accionEn: foto.accionEn,
    tareaPrioridad: foto.tareaPrioridad,
    tareaVence: foto.tareaVence,
    mensajesUtiles: foto.mensajesUtiles,
    exterior: foto.exterior,
    dormidoHasta: foto.dormidoHasta,
    fechaCompra: foto.fechaCompra,
  };
}

/**
 * Aplica los eventos nuevos a la foto del lead. Con candado optimista (`version`): si otro
 * proceso la cambió entre la lectura y la escritura, se vuelve a leer y a aplicar (3 intentos).
 */
async function actualizarLead(contexto: ContextoDelLead, eventos: EventoDelEmbudo[]): Promise<void> {
  for (let intento = 0; intento < 3; intento += 1) {
    const fila = await prisma.embudoLead.findUnique({ where: { conversationId: contexto.conversationId } });
    const anterior = comoFoto(fila as unknown as Record<string, unknown> | null);
    let foto: FotoDelLead | null = anterior;
    for (const evento of eventos) {
      foto = aplicarEvento(foto, evento, contexto);
    }
    if (!foto) return;

    if (!fila) {
      try {
        await prisma.embudoLead.create({ data: { conversationId: contexto.conversationId, ...datosDeLaFoto(foto) } });
        return;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue; // Otro proceso lo creó primero: se reintenta como actualización.
        }
        throw error;
      }
    }

    const { count } = await prisma.embudoLead.updateMany({
      where: { conversationId: contexto.conversationId, version: fila.version },
      data: { ...datosDeLaFoto(foto), version: { increment: 1 } },
    });
    if (count > 0) return;
  }
  anotarError("no se pudo actualizar el lead tras 3 intentos", null, { conversationId: contexto.conversationId });
}

/**
 * Guarda eventos de una charla y actualiza su lead. Nunca lanza. Respeta el interruptor.
 * Los eventos con `claveUnica` repetida se ignoran (y no vuelven a tocar el lead).
 */
export async function registrarEventos(base: BaseDelEvento, eventos: EventoDelEmbudo[]): Promise<number> {
  try {
    if (!eventos.length || !base.conversationId || !(await embudoActivo(base.workspaceId))) {
      return 0;
    }
    const contexto = await contextoDeLaCharla(base);
    if (!contexto) return 0;

    const nuevos: EventoDelEmbudo[] = [];
    for (const evento of eventos) {
      const { count } = await prisma.embudoEvento.createMany({
        data: [
          {
            workspaceId: base.workspaceId,
            conversationId: base.conversationId,
            contactId: contexto.contactId,
            channelId: contexto.channelId || null,
            producto: evento.producto ?? null,
            paso: evento.paso ?? null,
            tipo: evento.tipo,
            reglaId: evento.reglaId ?? null,
            reglaNombre: evento.reglaNombre ?? null,
            libroVersion: evento.libroVersion ?? null,
            origen: evento.origen,
            datos: evento.datos ? (evento.datos as Prisma.InputJsonValue) : Prisma.DbNull,
            claveUnica: evento.claveUnica ?? null,
            ...(evento.createdAt ? { createdAt: evento.createdAt } : {}),
          },
        ],
        skipDuplicates: true,
      });
      if (count > 0) nuevos.push(evento);
    }
    // Los que solo se registran (un frenado) no cambian la foto del lead: ni la crean.
    const paraLaFoto = nuevos.filter((evento) => !SOLO_REGISTRO.has(evento.tipo));
    if (paraLaFoto.length) {
      await actualizarLead(contexto, paraLaFoto);
    }
    return nuevos.length;
  } catch (error) {
    anotarError("no se pudo registrar", error, { conversationId: base.conversationId, tipos: eventos.map((e) => e.tipo) });
    return 0;
  }
}

/** Lo mismo, en segundo plano: para llamarlo desde el camino del cliente sin esperar. */
export function registrarEnSegundoPlano(base: BaseDelEvento, eventos: EventoDelEmbudo[] | (() => Promise<EventoDelEmbudo[]>)): void {
  if (!base?.workspaceId || !base.conversationId) return;
  enSegundoPlano(async () => {
    const lista = typeof eventos === "function" ? await eventos() : eventos;
    await registrarEventos(base, lista);
  });
}

/* ------------------------------------------------------------------------------------------------
   PUNTOS DE EMISIÓN
------------------------------------------------------------------------------------------------ */

/** Mensajes nuestros (no notas, no de una asesora) que salieron en la charla desde `desde`. */
async function mensajesDelBotDesde(conversationId: string, desde: Date): Promise<number> {
  const filas = await prisma.message.findMany({
    where: { conversationId, direction: "OUTBOUND", type: { not: "SYSTEM" }, createdAt: { gte: desde } },
    select: { rawPayload: true },
    take: 50,
  });
  return filas.filter((fila) => {
    const fuente = (fila.rawPayload as { source?: unknown } | null)?.source;
    return fuente !== "manual" && fuente !== "instance";
  }).length;
}

/**
 * Un turno del Agente V3 (webhook o "retomar"): BIENVENIDA, RESPONDIÓ, PASO, RECOMENDACIÓN,
 * SEÑALES y TURNO. Se llama desde `registrarTraza`, que el motor invoca al terminar; esto solo
 * agenda el trabajo y vuelve.
 */
export function registrarTurnoV3(input: BaseDelEvento & {
  traza: TrazaDelTurno;
  atendido: boolean;
  mensajeCliente: string;
  tipoMensaje?: string | null;
  origen?: OrigenDeEvento;
}): void {
  registrarEnSegundoPlano(input, async () => {
    if (!(await embudoActivo(input.workspaceId))) return [];
    // Los mensajes que salieron por el redactor no pasan por enviarPaso: se cuentan en la base.
    const enLaBase = await mensajesDelBotDesde(input.conversationId, new Date(input.traza.cuando)).catch(() => 0);
    const traza = { ...input.traza, mensajesEnviados: Math.max(input.traza.mensajesEnviados, enLaBase) };
    const ids = [traza.antes?.producto ?? null, traza.despues?.producto ?? null];
    const claves = new Map<string, string | null>();
    for (const id of ids) {
      if (id && !claves.has(id)) claves.set(id, await claveDeProductoDelV3(input.workspaceId, id));
    }
    return eventosDelTurno({
      conversationId: input.conversationId,
      traza,
      atendido: input.atendido,
      mensajeCliente: input.mensajeCliente,
      tipoMensaje: input.tipoMensaje,
      claveProducto: (id) => (id ? claves.get(id) ?? id : null),
      origen: input.origen ?? "motor",
      // Las señales de texto ya salen por mensaje en el webhook; acá solo las de un audio transcrito.
      incluirSenales: (input.tipoMensaje ?? "").toUpperCase() === "AUDIO",
    });
  });
}

/**
 * SEÑALES de UN mensaje entrante, se atienda o no el bot (con una asesora el bot está en pausa y
 * justo ahí aparecen "¿cómo separo?" o "¿a qué cuenta?"). Paso y producto: los de la foto del
 * lead en ese momento. Idempotente por id del mensaje de WhatsApp.
 */
export function registrarSenalesDelMensaje(input: BaseDelEvento & {
  externalId: string | null;
  texto: string | null;
  cuando?: Date;
}): void {
  registrarEnSegundoPlano(input, async () => {
    if (!input.texto?.trim() || !(await embudoActivo(input.workspaceId))) return [];
    const lead = await prisma.embudoLead.findUnique({
      where: { conversationId: input.conversationId },
      select: { pasoActual: true, productoActual: true },
    });
    return eventosDeSenales({
      conversationId: input.conversationId,
      texto: input.texto,
      paso: lead?.pasoActual ?? null,
      producto: lead?.productoActual ?? null,
      origen: "webhook",
      idDelMensaje: input.externalId,
      cuando: input.cuando ?? new Date(),
    });
  });
}

/**
 * ENTRADA: el primer mensaje de la clienta en esta charla. Solo si ESTE mensaje es el primero
 * entrante del chat (así un chat viejo que vuelve a escribir no cuenta como lead nuevo).
 */
export function registrarEntradaSiEsNueva(input: BaseDelEvento & {
  externalId: string | null;
  primerMensaje: string | null;
  anuncio: { titulo: string; red: string; id: string } | null;
}): void {
  registrarEnSegundoPlano(input, async () => {
    if (!(await embudoActivo(input.workspaceId))) return [];
    const primero = await prisma.message.findFirst({
      where: { conversationId: input.conversationId, direction: "INBOUND", type: { not: "SYSTEM" } },
      orderBy: { createdAt: "asc" },
      select: { externalId: true, createdAt: true },
    });
    if (!primero || !input.externalId || primero.externalId !== input.externalId) {
      return [];
    }
    const config = await leerConfigEmbudo(input.workspaceId);
    const producto = productoDeEntrada(
      { anuncio: input.anuncio ? { titulo: input.anuncio.titulo, id: input.anuncio.id } : null, primerMensaje: input.primerMensaje },
      config,
    );
    return [
      {
        tipo: "ENTRADA",
        origen: "webhook",
        paso: null,
        producto,
        claveUnica: `ENTRADA:${input.conversationId}`,
        createdAt: primero.createdAt,
        datos: {
          anuncioTitulo: input.anuncio?.titulo || null,
          anuncioRed: input.anuncio?.red || null,
          anuncioId: input.anuncio?.id || null,
          porAnuncio: Boolean(input.anuncio),
        },
      },
    ];
  });
}

/**
 * ASESORA_RESPONDIO: la primera vez que una persona (desde el CRM o desde su celular) le escribe
 * al cliente en esta charla. Una sola por charla (claveUnica). Se fecha con el primer mensaje
 * manual que haya en la base, no con la hora de la llamada.
 */
export function registrarAsesoraRespondio(input: BaseDelEvento & { userId?: string | null; via: "crm" | "celular" }): void {
  registrarEnSegundoPlano(input, async () => {
    if (!(await embudoActivo(input.workspaceId))) return [];
    const [candidatos, inicio] = await Promise.all([
      prisma.message.findMany({
        where: {
          conversationId: input.conversationId,
          direction: "OUTBOUND",
          type: { not: "SYSTEM" },
          OR: [
            { rawPayload: { path: ["source"], equals: "manual" } },
            { rawPayload: { path: ["source"], equals: "instance" } },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: { createdAt: true, rawPayload: true },
      }),
      prisma.message.findFirst({
        where: { conversationId: input.conversationId },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    /*
      Desde el celular, lo que sale en el primer minuto de un chat recién abierto es el mensaje
      automático de la línea ante un lead de anuncio, no una persona (mismo corte que la pausa
      automática del webhook).
    */
    const primero = candidatos.find((mensaje) => {
      const fuente = (mensaje.rawPayload as { source?: unknown } | null)?.source;
      if (fuente !== "instance" || !inicio) return true;
      return mensaje.createdAt.getTime() - inicio.createdAt.getTime() >= 60_000;
    });
    if (!primero) return [];
    const payload = (primero.rawPayload ?? {}) as { enviadoPorUserId?: unknown; source?: unknown };
    return [
      {
        tipo: "ASESORA_RESPONDIO",
        origen: "asesora",
        claveUnica: `ASESORA_RESPONDIO:${input.conversationId}`,
        createdAt: primero.createdAt,
        datos: {
          asesora: typeof payload.enviadoPorUserId === "string" ? payload.enviadoPorUserId : input.userId ?? null,
          via: payload.source === "instance" ? "celular" : "crm",
        },
      },
    ];
  });
}

/** ESCALADO: el agente (o un reloj) pidió una asesora. */
export function registrarEscalado(input: BaseDelEvento & { motivo: string }): void {
  registrarEnSegundoPlano(input, async () => [
    { tipo: "ESCALADO", origen: "motor", datos: { motivo: String(input.motivo ?? "").slice(0, 300) } },
  ]);
}

/** De dónde salió una asignación, leído de la nota que deja quien asigna. */
function origenDeLaAsignacion(input: { origen?: string | null; text: string; actorUserId?: string | null }): string {
  if (input.origen) return input.origen;
  const texto = input.text.toLowerCase();
  if (texto.includes("por la campa")) return "campana";
  if (texto.includes("respaldo")) return "respaldo";
  if (texto.includes("madrugada")) return "madrugada";
  if (texto.includes("al responder")) return "tomo_al_responder";
  if (texto.includes("auto-asignado")) return "turno";
  return input.actorUserId ? "manual" : "automatico";
}

/**
 * ASIGNADA y ETAPA_CRM, desde la nota de actividad que ya deja toda asignación y todo cambio de
 * etapa (recordConversationActivity). Es el único punto por el que pasan TODAS: el reparto por
 * turno, la campaña, el respaldo, la madrugada, la que toma el chat al responder y la manual.
 */
export function registrarDesdeActividad(input: {
  workspaceId: string;
  conversationId: string;
  channelId?: string | null;
  contactId?: string | null;
  kind: string;
  text: string;
  actorUserId?: string | null;
  assigneeUserId?: string | null;
  origen?: string | null;
}): void {
  if (input.kind !== "assigned" && input.kind !== "stage_changed") return;
  registrarEnSegundoPlano(input, async () => {
    if (!(await embudoActivo(input.workspaceId))) return [];
    if (input.kind === "assigned") {
      const asesora = input.assigneeUserId ?? null;
      // La carga: cuántos chats abiertos tiene ya asignados (índice workspaceId+assignedToUserId).
      const carga = asesora
        ? await prisma.conversation
            .count({ where: { workspaceId: input.workspaceId, assignedToUserId: asesora, status: "OPEN" } })
            .catch(() => null)
        : null;
      return [
        {
          tipo: "ASIGNADA",
          origen: input.actorUserId ? "asesora" : "motor",
          datos: { asesora, origenReparto: origenDeLaAsignacion(input), carga, actor: input.actorUserId ?? null },
        },
      ];
    }
    const contacto = input.contactId
      ? await prisma.contact.findUnique({ where: { id: input.contactId }, select: { crmStage: true } }).catch(() => null)
      : await prisma.conversation
          .findUnique({ where: { id: input.conversationId }, select: { contact: { select: { crmStage: true } } } })
          .then((charla) => charla?.contact ?? null)
          .catch(() => null);
    return [
      {
        tipo: "ETAPA_CRM",
        origen: input.actorUserId ? "asesora" : "motor",
        datos: { etapa: contacto?.crmStage ?? null, nota: input.text.slice(0, 200), actor: input.actorUserId ?? null },
      },
    ];
  });
}

/** VENTA: una persona marcó GANADO con su número de cotización de Gestión. */
export function registrarVenta(input: BaseDelEvento & { cotizacion: string; ventaEn?: Date | null; actorUserId?: string | null }): void {
  registrarEnSegundoPlano(input, async () => [
    {
      tipo: "VENTA",
      origen: "asesora",
      claveUnica: `VENTA:${input.conversationId}:${input.cotizacion}`,
      // La fecha real de la venta (wonAt), que puede ser de otro día que el clic.
      ...(input.ventaEn ? { createdAt: input.ventaEn } : {}),
      datos: { cotizacion: input.cotizacion, actor: input.actorUserId ?? null, ventaEn: input.ventaEn?.toISOString() ?? null },
    },
  ]);
}

/**
 * SEGUIMIENTO_ENVIADO: salió un recordatorio (reloj del V3 o motor de seguimientos).
 * Si no se sabe la charla, se busca la más reciente del contacto en esa línea.
 */
export function registrarSeguimientoEnviado(input: {
  workspaceId: string;
  conversationId?: string | null;
  contactId: string;
  channelId?: string | null;
  motor: "v3" | "follow";
  paso?: string | null;
  productoV3?: string | null;
  reglaId?: string | null;
  reglaNombre?: string | null;
  datos?: Record<string, unknown>;
}): void {
  enSegundoPlano(async () => {
    if (!(await embudoActivo(input.workspaceId))) return;
    let conversationId = input.conversationId ?? null;
    if (!conversationId) {
      const charla = await prisma.conversation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          ...(input.channelId ? { channelId: input.channelId } : {}),
        },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      });
      conversationId = charla?.id ?? null;
    }
    if (!conversationId) return;
    const producto = await claveDeProductoDelV3(input.workspaceId, input.productoV3 ?? null);
    await registrarEventos(
      { workspaceId: input.workspaceId, conversationId, contactId: input.contactId, channelId: input.channelId },
      [
        {
          tipo: "SEGUIMIENTO_ENVIADO",
          origen: "reloj",
          paso: input.paso ?? null,
          producto,
          reglaId: input.reglaId ?? null,
          reglaNombre: input.reglaNombre ?? null,
          datos: { motor: input.motor, ...(input.datos ?? {}) },
        },
      ],
    );
  });
}

/**
 * SEGUIMIENTO_FRENADO: un automático que no salió (cancelado) o que se corrió (reprogramado), con
 * el motivo: el freno de siempre (no_leido, dos_sin_respuesta) o el anti-bloqueo (tope, horario,
 * dueño, apagado, espaciado). Es lo que permite medir el antes y el después.
 *
 * Una sola vez por `claveUnica` (el reloj del V3 vuelve a mirar el mismo chat cada minuto). Solo
 * se registra: no toca la foto del lead. Respeta el interruptor del embudo y nunca lanza.
 */
export function registrarSeguimientoFrenado(input: {
  workspaceId: string;
  conversationId?: string | null;
  contactId: string;
  channelId?: string | null;
  motor: "v3" | "follow";
  motivo: string;
  claveUnica: string;
  reglaId?: string | null;
  reglaNombre?: string | null;
  paso?: string | null;
  reprogramadoPara?: Date | null;
  datos?: Record<string, unknown>;
}): void {
  enSegundoPlano(async () => {
    if (!(await embudoActivo(input.workspaceId))) return;
    let conversationId = input.conversationId ?? null;
    if (!conversationId) {
      const charla = await prisma.conversation.findFirst({
        where: {
          workspaceId: input.workspaceId,
          contactId: input.contactId,
          ...(input.channelId ? { channelId: input.channelId } : {}),
        },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      });
      conversationId = charla?.id ?? null;
    }
    if (!conversationId) return;
    await registrarEventos(
      { workspaceId: input.workspaceId, conversationId, contactId: input.contactId, channelId: input.channelId },
      [
        {
          tipo: "SEGUIMIENTO_FRENADO",
          origen: "reloj",
          // Sin paso ni producto a propósito: es un registro, no un avance del lead.
          paso: null,
          producto: null,
          reglaId: input.reglaId ?? null,
          reglaNombre: input.reglaNombre ?? null,
          claveUnica: `FRENADO:${input.claveUnica}`.slice(0, 400),
          datos: {
            motor: input.motor,
            motivo: input.motivo,
            pasoDelLead: input.paso ?? null,
            reprogramadoPara: input.reprogramadoPara?.toISOString() ?? null,
            ...(input.datos ?? {}),
          },
        },
      ],
    );
  });
}
