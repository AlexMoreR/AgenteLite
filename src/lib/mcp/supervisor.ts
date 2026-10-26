import { Prisma } from "@prisma/client";

import { idDeIncidente, ESTADOS_ACTIVOS, ETIQUETA_DE_ESTADO, type Accion, type Atendidas, type EstadoAccionable } from "@/features/supervisor-accionable/dominio/reglas";
import { leerAtendidas, leerConfigAccionable, leerEstadoAccionable } from "@/features/supervisor-accionable/servicios/accionable";
import type { Incidente } from "@/features/supervisor/dominio/alertas";
import { filaDelChat, idsDeChatsDeLaAlerta, type DatosDelChat } from "@/features/supervisor/dominio/chats-de-la-alerta";
import { ETIQUETA_DE_SEVERIDAD, type Hallazgo } from "@/features/supervisor/dominio/tipos";
import { leerAlertasRecientes } from "@/features/supervisor/servicios/almacen-alertas";
import { leerDatosDeChats } from "@/features/supervisor/servicios/chats-de-alertas";
import { puedeSupervisar } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";

/*
  VER EL SUPERVISOR DESDE CLAUDE (solo lectura).

  Claude no podía ver la pantalla del Supervisor: Alex le mandaba capturas y Claude le armaba los
  mensajes para las asesoras a pedazos (a María Camila le llegaron 3 o 4 el mismo día, 22-oct-2026).
  Esta herramienta le entrega lo mismo que tiene guardado el Supervisor, agrupado POR ASESORA y con
  el teléfono COMPLETO, para que arme UN solo mensaje por cada una en la hora de ventas y en los
  chequeos de 2:00 y 6:00 p. m.

  No escribe nada, no manda mensajes y no marca nada como atendido. Reusa las mismas lecturas de la
  pantalla (alertas, estado del accionable, lo atendido, datos de los chats); lo único propio es la
  consulta de los chats Caliente/Tibio con más de 24 h sin mensaje de la asesora.

  Lo pueden usar las mismas personas que ven la pantalla: dueño, administradores y supervisora.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

const HORA = 3_600_000;
const DIA = 24 * HORA;
/** Más de esto sin mensaje de la asesora = chat olvidado. */
const HORAS_SIN_MENSAJE = 24;
/** Solo chats con movimiento reciente: sin esto saldrían chats muertos de hace meses. */
const DIAS_CON_MOVIMIENTO = 14;
/** Tope por asesora en cada lista, para que la respuesta no se vuelva inmanejable. */
export const MAX_POR_ASESORA = 30;
export const SIN_ASESORA = "sin asesora";

export const HERRAMIENTAS_MCP_SUPERVISOR = [
  {
    name: "ver_supervisor",
    title: "Ver los avisos del Supervisor",
    description:
      "Lo que tiene abierto el Supervisor, AGRUPADO POR ASESORA para armar UN solo mensaje por cada una (no varios sueltos en el dia). Por asesora: (1) sus avisos abiertos con gravedad, motivo, lo ultimo que dijo el cliente, cuanto lleva esperando, telefono COMPLETO, id de la conversacion, que intento el Supervisor (aviso, plazo, segundo aviso, escalada) y la solucion recomendada con el mensaje sugerido; (2) sus chats Caliente y Tibio con mas de 24 h sin mensaje de ella. Aparte van 'sin_asesora' y 'para_alexander' (avisos del bot, del embudo o del libro: no son de ninguna asesora, no meterlos en sus mensajes). Lo que Alexander ya marco como atendido no sale. Solo lectura: no manda mensajes ni marca nada. Usar en la hora de ventas y en los chequeos de 2:00 y 6:00 p. m.",
    inputSchema: {
      type: "object",
      properties: {
        asesora: {
          type: "string",
          description: "Solo esta asesora: un pedazo del nombre ('maria camila', sin importar tildes ni mayusculas) o su id. 'sin asesora' trae solo los chats sin duena.",
        },
        desde: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Solo avisos detectados y chats con mensaje del cliente desde ese dia." },
        hasta: { type: "string", description: "AAAA-MM-DD (hora de Colombia), incluido. Sin fechas trae todo lo abierto." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_SUPERVISOR.map((herramienta) => herramienta.name));

export function esHerramientaDelSupervisor(nombre: string) {
  return NOMBRES.has(nombre);
}

// ---------------------------------------------------------------------------------------------
// Partes puras (se prueban sin la base: scripts/check-mcp-supervisor.mjs)
// ---------------------------------------------------------------------------------------------

const FECHA_BOGOTA = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** "2026-09-14 15:40" en hora de Colombia: es la hora que ve el negocio. */
function hora(fecha: Date | string | null | undefined) {
  if (!fecha) return null;
  const valor = typeof fecha === "string" ? new Date(fecha) : fecha;
  return Number.isFinite(valor.getTime()) ? FECHA_BOGOTA.format(valor) : null;
}

// Colombia no tiene horario de verano: el desfase es fijo.
const BOGOTA_OFFSET_MS = 5 * HORA;

/** El comienzo (en UTC) del día "AAAA-MM-DD" de Colombia. `fin` toma el día entero. */
export function diaBogota(valor: string, fin: boolean): Date | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim());
  if (!partes) return null;
  const [anio, mes, dia] = partes.slice(1).map(Number);
  // Date.UTC corre las fechas que no existen ("2026-02-31" sería 3 de marzo): se rechazan.
  const exacta = new Date(Date.UTC(anio, mes - 1, dia));
  if (exacta.getUTCFullYear() !== anio || exacta.getUTCMonth() !== mes - 1 || exacta.getUTCDate() !== dia) return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia + (fin ? 1 : 0)) + BOGOTA_OFFSET_MS);
  return Number.isFinite(fecha.getTime()) ? fecha : null;
}

/** Para comparar nombres: sin tildes, sin mayúsculas y con los espacios normalizados. */
export function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type Filtros = { asesora: string | null; desde: Date | null; hasta: Date | null };

/** ¿Este grupo entra con el filtro de asesora? Por pedazo del nombre o por id exacto. */
export function coincideAsesora(filtro: string | null, grupo: { nombre: string; id: string | null }): boolean {
  if (!filtro) return true;
  if (grupo.id && grupo.id === filtro.trim()) return true;
  const buscado = normalizar(filtro);
  return Boolean(buscado) && normalizar(grupo.nombre).includes(buscado);
}

export function enRango(fecha: Date | null | undefined, filtros: Pick<Filtros, "desde" | "hasta">): boolean {
  if (!filtros.desde && !filtros.hasta) return true;
  if (!fecha) return false;
  if (filtros.desde && fecha.getTime() < filtros.desde.getTime()) return false;
  if (filtros.hasta && fecha.getTime() >= filtros.hasta.getTime()) return false;
  return true;
}

/** Lo que se lee de la base por cada chat candidato a "olvidado". */
export type FilaChatCandidato = {
  conversationId: string;
  numero: number | null;
  status: string;
  lastMessageAt: Date | null;
  startedAt: Date;
  asesoraId: string | null;
  asesoraNombre: string | null;
  nombre: string | null;
  telefono: string | null;
  crmStage: string | null;
  temperatura: string | null;
  ultimoClienteEn: Date | null;
  ultimoTextoCliente: string | null;
  ultimaRespuestaHumanaEn: Date | null;
  /** Las mismas exclusiones del Supervisor y del seguimiento: dormido, exterior, bloqueado, línea administrativa. */
  dormidoHasta?: Date | null;
  exterior?: boolean | null;
  bloqueadoEn?: Date | null;
  lineaProposito?: string | null;
};

/**
 * Caliente o Tibio, con la misma convención del resto del CRM: la temperatura del seguimiento
 * inteligente o la etapa (Negociación = Caliente, Propuesta = Tibio).
 */
export function temperaturaDelChat(fila: Pick<FilaChatCandidato, "temperatura" | "crmStage">): "CALIENTE" | "TIBIO" | null {
  const temperatura = (fila.temperatura ?? "").toUpperCase();
  if (temperatura === "CALIENTE" || fila.crmStage === "NEGOCIACION") return "CALIENTE";
  if (temperatura === "TIBIO" || fila.crmStage === "PROPUESTA") return "TIBIO";
  return null;
}

/**
 * ¿El chat está olvidado? Abierto, ni ganado ni perdido, Caliente/Tibio, con movimiento en los
 * últimos 14 días y más de 24 h sin mensaje de una PERSONA (el bot no cuenta). Si nadie le ha
 * escrito nunca, se cuenta desde que empezó el chat. La consulta ya filtra lo mismo; se repite aquí
 * para que la regla quede en un solo lugar que se pueda probar.
 */
export function chatOlvidado(fila: FilaChatCandidato, ahora: Date): { temperatura: "CALIENTE" | "TIBIO"; horas: number } | null {
  if (fila.status === "CLOSED" || fila.status === "ARCHIVED") return null;
  if (fila.crmStage === "GANADO" || fila.crmStage === "PERDIDO") return null;
  // No mandar a escribirle a un cliente dormido, del exterior, bloqueado o de la línea administrativa.
  if (fila.dormidoHasta && new Date(fila.dormidoHasta).getTime() > ahora.getTime()) return null;
  if (fila.exterior || fila.bloqueadoEn || fila.lineaProposito === "ADMIN") return null;
  const temperatura = temperaturaDelChat(fila);
  if (!temperatura) return null;
  if (!fila.lastMessageAt || ahora.getTime() - new Date(fila.lastMessageAt).getTime() > DIAS_CON_MOVIMIENTO * DIA) return null;
  const desde = new Date(fila.ultimaRespuestaHumanaEn ?? fila.startedAt);
  const ms = ahora.getTime() - desde.getTime();
  if (!(ms > HORAS_SIN_MENSAJE * HORA)) return null;
  return { temperatura, horas: Math.floor(ms / HORA) };
}

function recortar(texto: string | null | undefined, largo = 200): string | null {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  return limpio.length > largo ? `${limpio.slice(0, largo - 1).trimEnd()}…` : limpio;
}

/** Cuando el contacto no tiene nombre guardado, muchas veces el "nombre" es el mismo número. */
function nombreDelCliente(nombre: string | null | undefined): string {
  const texto = (nombre ?? "").trim();
  if (!texto || (!/\p{L}/u.test(texto) && texto.replace(/\D/g, "").length >= 5)) return "Cliente sin nombre";
  return texto;
}

/** Qué intentó el Supervisor accionable con este chat, en palabras de la pantalla. */
export function queHizoElSupervisor(accion: Accion | undefined, ahora: Date) {
  if (!accion) return null;
  const vence = accion.venceEn ? Date.parse(accion.venceEn) : NaN;
  return {
    estado: ETIQUETA_DE_ESTADO[accion.estado] ?? accion.estado,
    avisada: accion.responsableNombre || null,
    avisada_es_la_supervisora: accion.responsableEsSupervisora,
    avisada_en: hora(accion.avisadaEn),
    plazo_minutos: accion.plazoMin,
    vence_en: hora(accion.venceEn),
    // Solo tiene sentido mientras la acción sigue abierta.
    plazo_vencido: ESTADOS_ACTIVOS.includes(accion.estado) && Number.isFinite(vence) ? vence <= ahora.getTime() : null,
    segundo_aviso_en: hora(accion.segundoAvisoEn),
    segundo_aviso_a: accion.segundoAvisoA,
    escalada_a_alexander_en: hora(accion.escaladaEn),
    gravedad_de_la_escalada: accion.gravedadEscalada ? ETIQUETA_DE_SEVERIDAD[accion.gravedadEscalada] : null,
    motivo_de_la_escalada: accion.motivoEscalada,
  };
}

/** Lo que Alexander ya marcó como atendido DESPUÉS de que empezó la alerta no vuelve a salir. */
export function yaAtendido(conversationId: string, inc: Pick<Incidente, "primeraVezEn">, atendidas: Atendidas, accion: Accion | undefined): boolean {
  const marca = atendidas[conversationId]?.en ?? (accion?.estado === "ATENDIDA_POR_ALEXANDER" ? accion.atendidaEn : null);
  if (!marca) return false;
  const en = Date.parse(marca);
  return Number.isFinite(en) && en >= new Date(inc.primeraVezEn).getTime();
}

type Miembro = { id: string; nombre: string };

const GRAVEDADES = [ETIQUETA_DE_SEVERIDAD.CRITICO, ETIQUETA_DE_SEVERIDAD.IMPORTANTE, ETIQUETA_DE_SEVERIDAD.OBSERVACION];
function ordenDeGravedad(etiqueta: string): number {
  const orden = GRAVEDADES.indexOf(etiqueta);
  return orden === -1 ? GRAVEDADES.length : orden;
}

export type EntradaArmado = {
  ahora: Date;
  filtros: Filtros;
  /** Solo las abiertas (con su `id` de SupervisorAlerta). */
  alertas: (Incidente & { id: string })[];
  datosPorChat: Map<string, DatosDelChat>;
  estado: EstadoAccionable | null;
  atendidas: Atendidas;
  candidatos: FilaChatCandidato[];
  miembros: Miembro[];
};

type AvisoDeAsesora = ReturnType<typeof avisoDelChat>;
type ChatOlvidado = ReturnType<typeof chatOlvidadoParaMostrar>;
type Grupo = { asesora: string; asesora_id: string | null; avisos: AvisoDeAsesora[]; chats: ChatOlvidado[] };

function avisoDelChat(input: {
  inc: Incidente & { id: string };
  hallazgo: Hallazgo | null;
  conversationId: string | null;
  datos: DatosDelChat | undefined;
  accion: Accion | undefined;
  ahora: Date;
}) {
  const { inc, hallazgo, conversationId, datos, accion, ahora } = input;
  const fila = conversationId ? filaDelChat({ conversationId, hallazgos: inc.hallazgos, datos, ahora }) : null;
  return {
    gravedad: ETIQUETA_DE_SEVERIDAD[hallazgo?.severidad ?? inc.severidad] ?? inc.severidad,
    motivo: hallazgo?.titulo || inc.titulo,
    detalle: hallazgo?.que || null,
    alerta_id: inc.id,
    detectado: hora(inc.primeraVezEn),
    cliente: conversationId ? (fila?.encontrado ? nombreDelCliente(datos?.nombre) : "Chat no encontrado") : null,
    // El Supervisor muestra el número tapado; aquí va completo, sacado del contacto.
    telefono: datos?.telefono ?? null,
    conversacion_id: conversationId,
    lo_ultimo_que_dijo_el_cliente: fila?.frase ?? accion?.frase ?? null,
    ultimo_mensaje_del_cliente_en: hora(datos?.ultimoClienteEn),
    esperando: fila?.esperando ?? null,
    que_hizo_el_supervisor: queHizoElSupervisor(accion, ahora),
    solucion_recomendada: {
      recomendacion: hallazgo?.recomendacion || null,
      que_hacer: hallazgo?.queCambiar || null,
      mensaje_sugerido_para_el_cliente: accion?.mensajeSugerido ?? null,
    },
  };
}

function chatOlvidadoParaMostrar(fila: FilaChatCandidato, resultado: { temperatura: "CALIENTE" | "TIBIO"; horas: number }) {
  return {
    temperatura: resultado.temperatura === "CALIENTE" ? "Caliente" : "Tibio",
    cliente: nombreDelCliente(fila.nombre),
    telefono: fila.telefono,
    conversacion_id: fila.conversationId,
    numero: fila.numero,
    ultimo_mensaje_del_cliente: recortar(fila.ultimoTextoCliente),
    ultimo_mensaje_del_cliente_en: hora(fila.ultimoClienteEn),
    ultimo_mensaje_de_la_asesora_en: hora(fila.ultimaRespuestaHumanaEn),
    horas_sin_mensaje_de_la_asesora: resultado.horas,
    // El cliente escribió después de la última respuesta de una persona: está esperando.
    cliente_esperando:
      Boolean(fila.ultimoClienteEn) &&
      (!fila.ultimaRespuestaHumanaEn || new Date(fila.ultimoClienteEn as Date).getTime() > new Date(fila.ultimaRespuestaHumanaEn).getTime()),
  };
}

/** Arma la respuesta: agrupa por asesora, aplica filtros y topes. Sin base: se prueba directo. */
export function armarRespuesta(entrada: EntradaArmado) {
  const { ahora, filtros, datosPorChat, atendidas, miembros } = entrada;
  const acciones = entrada.estado?.acciones ?? {};
  const porNombre = new Map(miembros.map((m) => [normalizar(m.nombre), m]));
  const porId = new Map(miembros.map((m) => [m.id, m]));
  const grupos = new Map<string, Grupo>();

  const grupoDe = (nombre: string | null | undefined, id: string | null | undefined): Grupo => {
    const miembro = (id ? porId.get(id) : undefined) ?? (nombre ? porNombre.get(normalizar(nombre)) : undefined);
    const visible = (nombre ?? "").trim() || miembro?.nombre || SIN_ASESORA;
    const clave = visible === SIN_ASESORA ? SIN_ASESORA : normalizar(visible);
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = { asesora: visible, asesora_id: visible === SIN_ASESORA ? null : (miembro?.id ?? id ?? null), avisos: [], chats: [] };
      grupos.set(clave, grupo);
    } else if (!grupo.asesora_id && visible !== SIN_ASESORA) {
      grupo.asesora_id = miembro?.id ?? id ?? null;
    }
    return grupo;
  };

  const paraAlexander: unknown[] = [];

  for (const inc of entrada.alertas) {
    if (inc.estado !== "ABIERTA") continue;
    if (!enRango(new Date(inc.primeraVezEn), filtros)) continue;

    if (inc.familia !== "ATENCION") {
      // Bot, embudo o cambio del libro: no son de ninguna asesora.
      if (atendidas[idDeIncidente(inc)]) continue;
      const recomendaciones = [...new Set(inc.hallazgos.map((h) => h.recomendacion).filter(Boolean))];
      paraAlexander.push({
        gravedad: ETIQUETA_DE_SEVERIDAD[inc.severidad] ?? inc.severidad,
        titulo: inc.titulo,
        familia: inc.familia,
        producto: inc.producto,
        alerta_id: inc.id,
        detectado: hora(inc.primeraVezEn),
        recomendacion: recomendaciones.join(" ") || null,
      });
      continue;
    }

    const ids = idsDeChatsDeLaAlerta(inc.hallazgos, Number.POSITIVE_INFINITY);
    if (ids.length === 0) {
      // Un aviso de atención sin chats (por ejemplo, un patrón de la asesora): va a su grupo.
      for (const h of inc.hallazgos.length ? inc.hallazgos : [null]) {
        const grupo = grupoDe(null, h?.asesoraId ?? null);
        grupo.avisos.push(avisoDelChat({ inc, hallazgo: h, conversationId: null, datos: undefined, accion: undefined, ahora }));
      }
      continue;
    }
    for (const conversationId of ids) {
      const guardada = acciones[conversationId];
      if (yaAtendido(conversationId, inc, atendidas, guardada)) continue;
      // Una acción cerrada de otra alerta (se guardan 24 h) no cuenta como lo que se intentó con esta.
      const accion = guardada && (ESTADOS_ACTIVOS.includes(guardada.estado) || guardada.claveAlerta === inc.clave) ? guardada : undefined;
      const hallazgo = inc.hallazgos.find((h) => h.evidencia?.chats?.includes(conversationId)) ?? inc.hallazgos[0] ?? null;
      const datos = datosPorChat.get(conversationId);
      // La asesora es la dueña de hoy del chat; si no hay datos del chat, la de la acción o del hallazgo
      // (nunca la supervisora: a ella le llegan los chats sin dueña).
      const accionDeAsesora = accion && accion.tipo !== "sin_duena" && !accion.responsableEsSupervisora ? accion : undefined;
      const grupo = datos
        ? grupoDe(datos.asesoraNombre, null)
        : grupoDe(accionDeAsesora?.responsableNombre ?? null, hallazgo?.asesoraId ?? accionDeAsesora?.responsableId ?? null);
      grupo.avisos.push(avisoDelChat({ inc, hallazgo, conversationId, datos, accion, ahora }));
    }
  }

  for (const fila of entrada.candidatos) {
    const resultado = chatOlvidado(fila, ahora);
    if (!resultado) continue;
    if (!enRango(fila.ultimoClienteEn ? new Date(fila.ultimoClienteEn) : null, filtros)) continue;
    grupoDe(fila.asesoraNombre, fila.asesoraId).chats.push(chatOlvidadoParaMostrar(fila, resultado));
  }

  const salida = (grupo: Grupo) => {
    const chats = [...grupo.chats].sort((a, b) => b.horas_sin_mensaje_de_la_asesora - a.horas_sin_mensaje_de_la_asesora);
    // Lo más grave primero, para que el tope nunca deje un CRÍTICO por fuera.
    const avisos = [...grupo.avisos].sort((a, b) => ordenDeGravedad(a.gravedad) - ordenDeGravedad(b.gravedad));
    return {
      asesora: grupo.asesora,
      asesora_id: grupo.asesora_id,
      avisos: avisos.slice(0, MAX_POR_ASESORA),
      ...(grupo.avisos.length > MAX_POR_ASESORA ? { avisos_por_fuera: grupo.avisos.length - MAX_POR_ASESORA } : {}),
      chats_sin_mensaje_de_la_asesora_24h: chats.slice(0, MAX_POR_ASESORA),
      ...(chats.length > MAX_POR_ASESORA ? { chats_por_fuera: chats.length - MAX_POR_ASESORA } : {}),
    };
  };

  const todos = [...grupos.values()].filter((g) => coincideAsesora(filtros.asesora, { nombre: g.asesora, id: g.asesora_id }));
  const conAsesora = todos.filter((g) => g.asesora !== SIN_ASESORA).sort((a, b) => a.asesora.localeCompare(b.asesora, "es"));
  const sinAsesora = todos.find((g) => g.asesora === SIN_ASESORA) ?? null;

  return {
    resumen: [...conAsesora, ...(sinAsesora ? [sinAsesora] : [])].map((g) => ({
      asesora: g.asesora,
      avisos: g.avisos.length,
      chats_sin_mensaje_de_la_asesora_24h: g.chats.length,
    })),
    por_asesora: conAsesora.map(salida),
    sin_asesora: sinAsesora ? salida(sinAsesora) : null,
    // Con filtro de asesora no van: no son de ella.
    para_alexander: filtros.asesora ? [] : paraAlexander,
  };
}

// ---------------------------------------------------------------------------------------------
// Lecturas de la base (todas filtradas por el negocio de la clave)
// ---------------------------------------------------------------------------------------------

/** El mismo permiso de la pantalla, con el rol de la persona DENTRO del negocio de la clave. */
export async function puedeVerElSupervisor(contexto: Contexto): Promise<boolean> {
  const miembro = await prisma.workspaceMember.findFirst({
    where: { workspaceId: contexto.workspaceId, userId: contexto.userId, isActive: true },
    select: { role: true, user: { select: { role: true } }, workspace: { select: { ownerId: true } } },
  });
  if (!miembro) return false;
  const rol = miembro.user?.role ?? "";
  const isOwner = rol === "CLIENTE" && (miembro.role === "OWNER" || miembro.workspace?.ownerId === contexto.userId);
  return puedeSupervisar({ workspaceId: contexto.workspaceId, userId: contexto.userId, isOwner, role: rol, membershipRole: miembro.role });
}

/** Chats Caliente/Tibio con más de 24 h sin mensaje de una persona. La regla final la aplica `chatOlvidado`. */
async function leerChatsCandidatos(workspaceId: string, ahora: Date): Promise<FilaChatCandidato[]> {
  const conMovimiento = new Date(ahora.getTime() - DIAS_CON_MOVIMIENTO * DIA);
  const limite = new Date(ahora.getTime() - HORAS_SIN_MENSAJE * HORA);
  return prisma.$queryRaw<FilaChatCandidato[]>(Prisma.sql`
    SELECT c."id" AS "conversationId", c."numero" AS "numero", c."status"::text AS "status", c."lastMessageAt" AS "lastMessageAt",
           c."startedAt" AS "startedAt", c."assignedToUserId" AS "asesoraId", u."name" AS "asesoraNombre",
           ct."name" AS "nombre", ct."phoneNumber" AS "telefono", ct."crmStage"::text AS "crmStage", el."temperatura" AS "temperatura",
           cli."createdAt" AS "ultimoClienteEn", cli."texto" AS "ultimoTextoCliente", hum."createdAt" AS "ultimaRespuestaHumanaEn",
           el."dormidoHasta" AS "dormidoHasta", el."exterior" AS "exterior", ct."bloqueadoEn" AS "bloqueadoEn", w."purpose" AS "lineaProposito"
      FROM "Conversation" c
      JOIN "Contact" ct ON ct."id" = c."contactId"
      LEFT JOIN "EmbudoLead" el ON el."conversationId" = c."id"
      LEFT JOIN "User" u ON u."id" = c."assignedToUserId"
      LEFT JOIN "WhatsAppChannel" w ON w."id" = c."channelId"
      LEFT JOIN LATERAL (
        SELECT m."createdAt", left(coalesce(nullif(m."transcripcion", ''), m."content", ''), 200) AS "texto" FROM "Message" m
         WHERE m."conversationId" = c."id" AND m."direction" = 'INBOUND' AND m."type"::text <> 'SYSTEM'
         ORDER BY m."createdAt" DESC LIMIT 1) cli ON true
      LEFT JOIN LATERAL (
        SELECT m."createdAt" FROM "Message" m
         WHERE m."conversationId" = c."id" AND m."direction" = 'OUTBOUND' AND m."type"::text <> 'SYSTEM'
           AND m."rawPayload"->>'source' IN ('manual', 'instance')
         ORDER BY m."createdAt" DESC LIMIT 1) hum ON true
     WHERE c."workspaceId" = ${workspaceId}
       AND c."status"::text NOT IN ('CLOSED', 'ARCHIVED')
       AND c."lastMessageAt" >= ${conMovimiento}
       AND ct."excludedFromCrm" = false
       AND ct."bloqueadoEn" IS NULL
       AND (el."dormidoHasta" IS NULL OR el."dormidoHasta" <= ${ahora})
       AND coalesce(el."exterior", false) = false
       AND (w."purpose" IS NULL OR w."purpose" <> 'ADMIN')
       AND ct."crmStage"::text NOT IN ('GANADO', 'PERDIDO')
       AND (upper(coalesce(el."temperatura", '')) IN ('CALIENTE', 'TIBIO') OR ct."crmStage"::text IN ('NEGOCIACION', 'PROPUESTA'))
       AND coalesce(hum."createdAt", c."startedAt") < ${limite}
     ORDER BY c."lastMessageAt" DESC
     LIMIT 1000`);
}

async function leerMiembros(workspaceId: string): Promise<Miembro[]> {
  const filas = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  return filas.map((f) => ({ id: f.userId, nombre: f.user?.name?.trim() || f.user?.email || f.userId }));
}

function leerFiltros(args: Argumentos): Filtros {
  const asesora = typeof args.asesora === "string" && args.asesora.trim() ? args.asesora.trim() : null;
  const fecha = (clave: "desde" | "hasta") => {
    const valor = typeof args[clave] === "string" ? (args[clave] as string).trim() : "";
    if (!valor) return null;
    const leida = diaBogota(valor, clave === "hasta");
    if (!leida) throw new Error(`La fecha "${clave}" tiene que ir como AAAA-MM-DD.`);
    return leida;
  };
  return { asesora, desde: fecha("desde"), hasta: fecha("hasta") };
}

async function verSupervisor(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver el Supervisor: es solo del dueño, los administradores y la supervisora.");
  }
  const filtros = leerFiltros(args);
  const ahora = new Date();
  const ws = contexto.workspaceId;
  const noSePudoLeer: string[] = [];
  const advertencias: string[] = [];
  const intentar = async <T>(nombre: string, leer: () => Promise<T>, vacio: T): Promise<T> => {
    try {
      return await leer();
    } catch (error) {
      noSePudoLeer.push(`${nombre}: ${error instanceof Error ? error.message : String(error)}`);
      return vacio;
    }
  };

  const [alertas, config, candidatos, miembros] = await Promise.all([
    intentar("avisos del Supervisor", () => leerAlertasRecientes(ws), [] as Awaited<ReturnType<typeof leerAlertasRecientes>>),
    intentar("Supervisor accionable", () => leerConfigAccionable(ws), null),
    intentar("chats Caliente/Tibio sin mensaje de la asesora", () => leerChatsCandidatos(ws, ahora), [] as FilaChatCandidato[]),
    intentar("equipo", () => leerMiembros(ws), [] as Miembro[]),
  ]);
  const abiertas = alertas.filter((a) => a.estado === "ABIERTA");
  const accionableActivo = Boolean(config?.activo);
  const [estado, atendidas, datosPorChat] = await Promise.all([
    accionableActivo ? intentar("estado del Supervisor accionable", () => leerEstadoAccionable(ws), null) : Promise.resolve(null),
    intentar("lo marcado como atendido", () => leerAtendidas(ws), {} as Atendidas),
    intentar(
      "datos de los chats de los avisos",
      () => leerDatosDeChats(ws, abiertas.flatMap((a) => idsDeChatsDeLaAlerta(a.hallazgos, Number.POSITIVE_INFINITY))),
      new Map<string, DatosDelChat>(),
    ),
  ]);
  if (!accionableActivo) {
    advertencias.push("El Supervisor accionable está apagado: no hay datos de avisos a la asesora, plazos ni escaladas (que_hizo_el_supervisor sale vacío).");
  }
  if (abiertas.length >= 100) {
    advertencias.push("Se leyeron las 100 alertas más recientes (el mismo tope de la pantalla): puede haber avisos más viejos por fuera.");
  }
  advertencias.push("Los avisos se recalculan cada 5 minutos: si la asesora acaba de responder, el aviso puede seguir saliendo hasta la siguiente revisión. Los chats de más de 24 h se leen en vivo.");

  return {
    generado_en: hora(ahora),
    filtros: { asesora: filtros.asesora, desde: typeof args.desde === "string" ? args.desde : null, hasta: typeof args.hasta === "string" ? args.hasta : null },
    accionable_activo: accionableActivo,
    ...armarRespuesta({ ahora, filtros, alertas: abiertas, datosPorChat, estado, atendidas, candidatos, miembros }),
    advertencias,
    ...(noSePudoLeer.length ? { no_se_pudo_leer: noSePudoLeer } : {}),
  };
}

export async function ejecutarHerramientaMcpSupervisor(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "ver_supervisor":
      return verSupervisor(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
