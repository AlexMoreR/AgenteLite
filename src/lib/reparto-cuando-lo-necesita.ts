import { departamentoDeCiudad, limpiarTexto } from "@/features/pauta/dominio/departamentos";
import { prisma } from "@/lib/prisma";
import { respondioLaBienvenida, type MensajeDelTurno } from "@/lib/turno-con-contenido";

/**
 * ASIGNAR A LA ASESORA SOLO CUANDO EL CHAT LO NECESITA (Alex, 11-11-2026, parte 1).
 *
 * Desde el 30-10-2026 el chat pasaba a una asesora apenas la clienta respondía la bienvenida, hasta
 * con un "ok" o con "Para el combo de estética", cuando el bot todavía estaba calificando. Las
 * asesoras cargaban con chats que el bot resolvía solo.
 *
 * Ahora el chat recibe asesora cuando:
 *  (a) el agente pide un asesor (nota "El agente pide un asesor: …") o la IA está pausada;
 *  (b) la clienta pregunta por plata o por la entrega: precio, forma de pago, envío,
 *      contraentrega o su ciudad (`hablaDePlataOEntrega`).
 *  (c) `asesoraEscribe`: el interruptor queda guardado desde ya; lo usan las partes que siguen.
 * Con `comoAntes` prendido se vuelve a la regla del 30-10-2026 (`respondioLaBienvenida`).
 *
 * La configuración vive en `AppSetting` con la clave `reparto:cuando:<workspaceId>` (JSON). Sin
 * fila, con el texto roto o con la base caída: los valores por defecto (a, b y c prendidos,
 * comoAntes apagado).
 *
 * Lo usan el reparto por turno (reparto-por-turno.ts) y el rescate de chats huérfanos
 * (rescate-de-chats-huerfanos.ts). No manda mensajes ni cambia al agente: solo decide.
 */

export type ConfigDeAsignacion = {
  /** (a) Asignar cuando el agente pide un asesor o la IA está pausada. */
  agentePide: boolean;
  /** (b) Asignar cuando la clienta pregunta por precio, pago, envío, contraentrega o dice su ciudad. */
  clientaPreguntaPlataOEntrega: boolean;
  /** (c) Asignar cuando una asesora le escribe a la clienta (lo usan las partes siguientes). */
  asesoraEscribe: boolean;
  /** Como antes: asignar apenas la clienta responde la bienvenida (pisa a, b y c). */
  comoAntes: boolean;
};

export const CONFIG_DE_ASIGNACION_POR_DEFECTO: ConfigDeAsignacion = {
  agentePide: true,
  clientaPreguntaPlataOEntrega: true,
  asesoraEscribe: true,
  comoAntes: false,
};

const INTERRUPTORES = ["agentePide", "clientaPreguntaPlataOEntrega", "asesoraEscribe", "comoAntes"] as const;

export const claveConfigDeAsignacion = (workspaceId: string) => `reparto:cuando:${workspaceId}`;

/** Un interruptor: true/false (o su texto). Lo demás, el valor por defecto. */
function leerInterruptor(crudo: unknown, porDefecto: boolean): boolean {
  if (crudo === true || crudo === "true") return true;
  if (crudo === false || crudo === "false") return false;
  return porDefecto;
}

/** Valida y completa con los valores por defecto lo que falte o venga mal. */
export function completarConfigDeAsignacion(valor: unknown): ConfigDeAsignacion {
  const objeto = valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
  const config = { ...CONFIG_DE_ASIGNACION_POR_DEFECTO };
  for (const clave of INTERRUPTORES) {
    config[clave] = leerInterruptor(objeto[clave], CONFIG_DE_ASIGNACION_POR_DEFECTO[clave]);
  }
  return config;
}

/** El texto guardado en `AppSetting.value`: roto o vacío = valores por defecto. */
export function leerConfigDeAsignacionDeTexto(texto: string | null | undefined): ConfigDeAsignacion {
  try {
    return completarConfigDeAsignacion(texto ? JSON.parse(texto) : null);
  } catch {
    return { ...CONFIG_DE_ASIGNACION_POR_DEFECTO };
  }
}

/** Un minuto de memoria por proceso, igual que reparto-config.ts. */
const MEMORIA_MS = 60_000;
const configs = new Map<string, { valor: ConfigDeAsignacion; vence: number }>();

export async function leerConfigDeAsignacion(workspaceId: string): Promise<ConfigDeAsignacion> {
  const guardado = configs.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.valor;
  let valor: ConfigDeAsignacion;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigDeAsignacion(workspaceId) } });
    valor = leerConfigDeAsignacionDeTexto(fila?.value);
  } catch {
    valor = { ...CONFIG_DE_ASIGNACION_POR_DEFECTO };
  }
  configs.set(workspaceId, { valor, vence: Date.now() + MEMORIA_MS });
  return valor;
}

export async function guardarConfigDeAsignacion(workspaceId: string, config: Partial<ConfigDeAsignacion>): Promise<ConfigDeAsignacion> {
  const valor = completarConfigDeAsignacion(config);
  const texto = JSON.stringify(valor);
  const key = claveConfigDeAsignacion(workspaceId);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: texto }, update: { value: texto } });
  configs.delete(workspaceId);
  return valor;
}

/* ------------------------------------------------------------------------------------------------
   (b) ¿LA CLIENTA HABLA DE PLATA O DE LA ENTREGA?

   Se compara sin tildes y en minúsculas (`limpiarTexto` de departamentos.ts: deja letras y números
   separados por un espacio). La ciudad sale de la lista de departamentos y ciudades de la pauta:
   el mensaje es solo la ciudad ("Medellín", "Cali, Valle") o viene tras "soy de", "vivo en"…
------------------------------------------------------------------------------------------------ */

const PRECIO = /\b(cuanto (vale|valen|cuesta|cuestan|sale|salen|seria|serian|queda|quedan)|precios?|valor|valores|costos?)\b/;
const PAGO = /\b(como (pago|pagaria|se paga|puedo pagar|le pago|te pago|es el pago|seria el pago)|formas? de pago|medios? de pago|nequi|daviplata|transferencias?|consignacion|consignar|pagar|cuotas)\b/;
const ENVIO = /\b(envios?|envian|enviarian|enviar a|despachan|despacho|domicilio|flete|transportadora|tiempo de entrega|entregas?|entregan)\b/;
const CONTRAENTREGA = /\b(contra ?entrega|contraentregas|pago al recibir|pagar al recibir)\b/;
const FRASE_DE_CIUDAD = /\b(soy de|somos de|vivo en|vivimos en|estoy en|estamos en|resido en|me encuentro en|desde|mi ciudad es|ciudad de)\s+(.+)$/;

/** Hasta cuántas palabras tiene un mensaje que es "solo la ciudad". */
const PALABRAS_DE_SOLO_CIUDAD = 4;

function nombraUnaCiudad(original: string, limpio: string): boolean {
  const palabras = limpio.split(" ").filter(Boolean);
  // El texto original, con sus comas: así "Cali, Valle" se prueba también por partes.
  if (palabras.length > 0 && palabras.length <= PALABRAS_DE_SOLO_CIUDAD && departamentoDeCiudad(original)) {
    return true;
  }
  const frase = FRASE_DE_CIUDAD.exec(limpio);
  if (!frase) return false;
  // "soy de santa marta y quiero…": se prueban las primeras 1 a 4 palabras después de la frase.
  const despues = frase[2].split(" ").filter(Boolean);
  for (let largo = 1; largo <= Math.min(PALABRAS_DE_SOLO_CIUDAD, despues.length); largo += 1) {
    if (departamentoDeCiudad(despues.slice(0, largo).join(" "))) return true;
  }
  return false;
}

/** ¿Este texto de la clienta pregunta precio, forma de pago, envío, contraentrega o dice su ciudad? */
export function hablaDePlataOEntrega(texto: string | null | undefined): boolean {
  const limpio = limpiarTexto(texto);
  if (!limpio) return false;
  return PRECIO.test(limpio) || PAGO.test(limpio) || ENVIO.test(limpio) || CONTRAENTREGA.test(limpio) || nombraUnaCiudad(String(texto), limpio);
}

/* ------------------------------------------------------------------------------------------------
   LA REGLA (pura, sin base).
------------------------------------------------------------------------------------------------ */

/** ¿Este mensaje es de la clienta, vigente y con texto? */
function textoDeLaClienta(mensaje: MensajeDelTurno): string | null {
  if (mensaje.direction !== "INBOUND" || mensaje.borrado) return null;
  if ((mensaje.type ?? "TEXT").toUpperCase() === "SYSTEM") return null;
  return mensaje.content ?? null;
}

export function elChatNecesitaAsesora(input: {
  mensajes: ReadonlyArray<MensajeDelTurno>;
  config: ConfigDeAsignacion;
  agentePidioAsesor: boolean;
  iaPausada: boolean;
}): boolean {
  const { mensajes, config } = input;
  if (config.comoAntes) {
    return respondioLaBienvenida(mensajes);
  }
  if (config.agentePide && (input.agentePidioAsesor || input.iaPausada)) {
    return true;
  }
  if (config.clientaPreguntaPlataOEntrega) {
    return mensajes.some((mensaje) => hablaDePlataOEntrega(textoDeLaClienta(mensaje)));
  }
  return false;
}

/**
 * La nota que deja el agente cuando le pasa el chat a una persona (webhook de Evolution y
 * agente-v3/servicios/retomar.ts): "El agente pide un asesor: <motivo>".
 */
export const NOTA_EL_AGENTE_PIDE_UN_ASESOR = "El agente pide un asesor";

/** ¿Alguna de estas notas del sistema es un pedido de asesor del agente? */
export function agentePidioAsesorEnNotas(notas: ReadonlyArray<string | null | undefined>): boolean {
  const prefijo = NOTA_EL_AGENTE_PIDE_UN_ASESOR.toLowerCase();
  return notas.some((nota) => (nota ?? "").trim().toLowerCase().startsWith(prefijo));
}

/** El filtro de Prisma de esas notas (tipo SYSTEM, vigentes). */
const filtroDeLaNota = {
  type: "SYSTEM" as const,
  deletedAt: null,
  content: { startsWith: NOTA_EL_AGENTE_PIDE_UN_ASESOR, mode: "insensitive" as const },
};

/** Lee de la base si el agente pidió asesor en este chat. */
export async function leerSiElAgentePidioAsesor(conversationId: string): Promise<boolean> {
  const nota = await prisma.message.findFirst({
    where: { conversationId, ...filtroDeLaNota },
    select: { content: true },
  });
  return Boolean(nota && agentePidioAsesorEnNotas([nota.content]));
}

/** Lo mismo para muchos chats en una consulta: los ids de los chats donde el agente pidió asesor. */
export async function chatsDondeElAgentePidioAsesor(conversationIds: string[]): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set();
  const filas = await prisma.message.groupBy({
    by: ["conversationId"],
    where: { conversationId: { in: conversationIds }, ...filtroDeLaNota },
  });
  return new Set(filas.map((fila) => fila.conversationId));
}
