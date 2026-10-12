/**
 * ¿DE QUIÉN ES EL TURNO EN LA CONVERSACIÓN? (código puro, sin base). Pedido de Alexander, 12-10-2026.
 *
 * Una sola definición para el Supervisor (detectores de atención y pantalla), el Supervisor
 * accionable (avisos, segundo aviso, escaladas), el seguimiento inteligente (tareas de la asesora)
 * y las tareas sin asesora. El Supervisor interviene SOLO cuando Magilus debe responder; si el bot
 * o una persona ya respondió y esperamos al cliente, lo maneja la cadencia automática de
 * seguimientos (V3 / Follow, hasta 3 días) y después el descarte según la política.
 *
 * Caso real (12-oct, •••• 5474): 9:18 "Hola precio" → el bot da bienvenida + precio del combo y
 * pregunta "¿te comparto las fotos y en qué ciudad…?". A las 9:28 salía "señal sin dueña" (aviso a
 * Ingrid, segundo aviso, escalada a Alexander) y a las 9:48 una tarea "tibio sin asesora". El turno
 * era del CLIENTE.
 *
 * TURNO DE MAGILUS si (en este orden):
 *  (a) sin_respuesta: el último mensaje (no nota) es del cliente y nadie (bot ni persona) respondió
 *      después; también una llamada entrante PERDIDA después de nuestra última respuesta.
 *  (b) bot_pidio_asesora / bot_no_entendio: después del último mensaje del cliente solo respondió
 *      el bot, PERO pidió asesora (nota "El agente pide un asesor…", "…se avisó a un asesor en vez
 *      de repetirlo", "avisó a una asesora", reglas "pasar a la asesora" / "cierra una persona") o
 *      no entendió (regla "Red del paso…: no se entendió", "Pregunta algo que no está en el libro",
 *      "Respondió el redactor: ninguna regla del libro aplicaba").
 *  (c) senal_fuerte: solo respondió el bot y la última tanda del cliente trae una señal FUERTE que
 *      necesita persona: separar / anticipo / datos para pagar / "ya pagué" / comprobante / aceptó
 *      el precio / pidió cotización / dirección o fecha / decide hoy-mañana / eligió color / mandó
 *      sus datos (formulario) / pidió llamada o asesora.
 *  (d) caliente_sin_humano: solo respondió el bot, el chat está CALIENTE (etapa Caliente o
 *      temperatura CALIENTE) y NUNCA le escribió una persona (con o sin asesora): alguien debe entrar.
 *  (b') el bot "prometió" a una persona en su texto ("una de nuestras asesoras te contacta") o
 *      solo saludó porque ninguna regla encajó: cuenta como pedir asesora / no entendió.
 * TURNO DEL CLIENTE si: una persona respondió después del último mensaje del cliente
 * (respondio_persona), o respondió el bot sin pedir asesora y no aplica (c) ni (d)
 * (respondio_el_bot), o el cliente nunca escribió (cliente_no_ha_escrito).
 *
 * Los seguimientos automáticos (follow, agente-v3-seguimiento…) NO cuentan como respuesta: no
 * contestan lo que el cliente preguntó. Las notas del sistema no son mensajes; solo se leen para (b).
 */

import { detectarSenales } from "../features/embudo/dominio/senales";
import { colorElegido } from "../features/seguimiento-inteligente/dominio/temperatura";

export type Turno = "MAGILUS" | "CLIENTE";

export type MotivoDelTurno =
  | "sin_respuesta"
  | "llamada_perdida"
  | "bot_pidio_asesora"
  | "bot_no_entendio"
  | "senal_fuerte"
  | "caliente_sin_humano"
  | "respondio_persona"
  | "respondio_el_bot"
  | "cliente_no_ha_escrito";

export type TurnoDeLaConversacion = {
  de: Turno;
  motivo: MotivoDelTurno;
  /** La nota o la frase que decidió (para mostrar y auditar). */
  detalle: string | null;
  ultimoClienteEn: Date | null;
  /** Primera respuesta (bot o persona) después del último mensaje del cliente. */
  respondioEn: Date | null;
};

/** Un mensaje o nota del chat, tal como sale de la base. */
export type EventoDelChat = {
  direccion: "IN" | "OUT";
  /** Message.type (TEXT, IMAGE, SYSTEM…). */
  tipo: string;
  /** rawPayload.source: manual / instance = persona; null / api = bot; follow… = automático; activity / llamada = nota. */
  origen: string | null;
  texto: string | null;
  en: Date;
};

export type ContextoDelTurno = {
  /** Etapa Caliente (NEGOCIACION) o temperatura CALIENTE. */
  caliente: boolean;
  /** El chat tiene asesora. */
  asignada: boolean;
  /** Alguna vez escribió una persona en el chat (CRM o celular). Sin dato: se mira en los eventos. */
  tuvoContactoHumano?: boolean;
};

export const ORIGENES_HUMANOS = ["manual", "instance"];
export const ORIGENES_AUTOMATICOS_DEL_TURNO = ["agente-v3-seguimiento", "agente-v3-seguimiento-ia", "follow", "automation_reactivation"];

export type ClaseDeEvento = "cliente" | "bot" | "humano" | "automatico" | "nota" | "llamada_perdida" | "llamada_atendida";

export function claseDelEvento(e: EventoDelChat): ClaseDeEvento {
  if (e.tipo === "SYSTEM") {
    if (e.origen === "llamada") {
      const texto = (e.texto ?? "").toLowerCase();
      // Entrante perdida / rechazada / de 0 s: el cliente nos buscó y nadie le habló.
      if (e.direccion === "IN" && /perdida|no contest|rechazad|· 0\s?s\b/.test(texto)) return "llamada_perdida";
      // Saliente (contestada o no: la asesora hizo su parte) o entrante atendida.
      return "llamada_atendida";
    }
    return "nota";
  }
  if (e.direccion === "IN") return "cliente";
  if (e.origen && ORIGENES_HUMANOS.includes(e.origen)) return "humano";
  if (e.origen && ORIGENES_AUTOMATICOS_DEL_TURNO.includes(e.origen)) return "automatico";
  return "bot";
}

/** Notas del bot que piden a una persona. */
export const NOTA_PIDE_ASESORA =
  /^El agente pide un asesor|avis[oó] a (un|una) asesor|Gan[oó] "[^"]*(pasar a (un|una|la) asesor|cierra una persona|que cierre una persona|confirmar con la asesora|anunciar la llamada)/i;
/** Notas del bot que dicen que no entendió (red / fuera del libro / redactor sin regla / solo saludó). */
export const NOTA_NO_ENTENDIO =
  /Gan[oó] "Red del paso|no se entendi[oó]|Pregunta algo que no est[aá] en el libro|Respondi[oó] el redactor: ninguna regla|Sale el saludo del primer mensaje; ninguna otra regla/i;
/**
 * Texto del BOT que promete a una persona ("En un momento una de nuestras asesoras te contacta 🙌"):
 * el bot no resolvió; el turno sigue siendo nuestro (simulación 12-oct: 4 chats así desaparecían).
 */
export const BOT_PROMETE_ASESORA =
  /\ben un momento (una|un) (de nuestr\w+ )?asesor|\basesor(a|as|es)?\b[^.?!\n]{0,40}\b(te|le) (contacta|contactar[aá]|escribe|escribir[aá]|llama|llamar[aá]|atiende|atender[aá])\b/i;

/** Pide una persona o una llamada. */
const PIDE_PERSONA =
  /\b(llamame|llamenme|llameme|me (puede|pueden|podria|podrian|podes) llamar|me llaman|me llama\b|llamada|marcame|marquenme|asesora?|una persona|hablar con (alguien|una persona|un humano)|humano)\b/;
/** Campos de un formulario / datos de compra. */
const CAMPOS_DE_DATOS = [
  /\bnombre/,
  /\b(cedula|c\.?c\.?|nit|documento)\b/,
  /\bdireccion\b/,
  /\b(telefono|celular|cel)\b/,
  /\bciudad\b/,
  /\bbarrio\b/,
  /\b(correo|email|e-mail)\b/,
];

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** ¿El cliente mandó sus datos (formulario lleno / datos de compra)? */
export function mandoSusDatos(texto: string | null | undefined): boolean {
  const t = normalizar(texto ?? "");
  if (t.trim().length < 15) return false;
  const campos = CAMPOS_DE_DATOS.filter((r) => r.test(t)).length;
  if (campos >= 2) return true;
  const lineas = t.split(/\n+/).filter((l) => l.trim()).length;
  return lineas >= 3 && /\b\d{6,10}\b/.test(t) && /[a-z]{3,}/.test(t);
}

/** La señal FUERTE (que necesita persona) de un texto del cliente, o null. */
export function senalQueNecesitaPersona(texto: string | null | undefined): string | null {
  const original = texto ?? "";
  if (!original.trim()) return null;
  const fuerte = detectarSenales(original).find((s) => s.grupo === "fuerte");
  if (fuerte) return fuerte.fragmento;
  const color = colorElegido(original);
  if (color) return color;
  if (mandoSusDatos(original)) return "mandó sus datos";
  const t = normalizar(original);
  const persona = PIDE_PERSONA.exec(t);
  if (persona) return persona[0];
  return null;
}

/**
 * EL TURNO. `eventos` puede venir en cualquier orden y debe traer, como mínimo, todo lo ocurrido
 * desde nuestra última respuesta antes del último mensaje del cliente (mensajes y notas).
 */
export function turnoDeLaConversacion(eventos: EventoDelChat[], ctx: ContextoDelTurno): TurnoDeLaConversacion {
  const orden = [...eventos].sort((a, b) => a.en.getTime() - b.en.getTime());
  const clases = orden.map(claseDelEvento);
  let iCliente = -1;
  for (let i = orden.length - 1; i >= 0; i -= 1) {
    if (clases[i] === "cliente") {
      iCliente = i;
      break;
    }
  }
  const respuesta = (c: ClaseDeEvento) => c === "bot" || c === "humano" || c === "llamada_atendida";
  // Llamada entrante perdida después de nuestra última respuesta: el cliente nos busca.
  for (let i = orden.length - 1; i >= 0 && i > iCliente; i -= 1) {
    if (respuesta(clases[i])) break;
    if (clases[i] === "llamada_perdida") {
      return { de: "MAGILUS", motivo: "llamada_perdida", detalle: orden[i].texto, ultimoClienteEn: orden[i].en, respondioEn: null };
    }
  }
  if (iCliente < 0) return { de: "CLIENTE", motivo: "cliente_no_ha_escrito", detalle: null, ultimoClienteEn: null, respondioEn: null };
  const ultimoClienteEn = orden[iCliente].en;
  const despues = orden.slice(iCliente + 1).map((e, k) => ({ e, clase: clases[iCliente + 1 + k] }));
  const respuestas = despues.filter((x) => respuesta(x.clase));
  if (!respuestas.length) return { de: "MAGILUS", motivo: "sin_respuesta", detalle: null, ultimoClienteEn, respondioEn: null };
  const respondioEn = respuestas[0].e.en;
  if (respuestas.some((x) => x.clase === "humano" || x.clase === "llamada_atendida")) {
    return { de: "CLIENTE", motivo: "respondio_persona", detalle: null, ultimoClienteEn, respondioEn };
  }
  // Solo respondió el bot.
  const notas = despues.filter((x) => x.clase === "nota").map((x) => x.e.texto ?? "");
  const promesa = respuestas.find((x) => BOT_PROMETE_ASESORA.test(x.e.texto ?? ""));
  if (promesa) return { de: "MAGILUS", motivo: "bot_pidio_asesora", detalle: (promesa.e.texto ?? "").slice(0, 160), ultimoClienteEn, respondioEn };
  const pidio = notas.find((t) => NOTA_PIDE_ASESORA.test(t));
  if (pidio) return { de: "MAGILUS", motivo: "bot_pidio_asesora", detalle: pidio.slice(0, 160), ultimoClienteEn, respondioEn };
  const noEntendio = notas.find((t) => NOTA_NO_ENTENDIO.test(t));
  if (noEntendio) return { de: "MAGILUS", motivo: "bot_no_entendio", detalle: noEntendio.slice(0, 160), ultimoClienteEn, respondioEn };
  // La última tanda del cliente: sus mensajes desde nuestra última respuesta anterior.
  const tanda: string[] = [];
  for (let i = iCliente; i >= 0; i -= 1) {
    if (respuesta(clases[i])) break;
    if (clases[i] === "cliente") tanda.unshift(orden[i].texto ?? "");
  }
  for (const texto of [...tanda].reverse()) {
    const senal = senalQueNecesitaPersona(texto);
    if (senal) return { de: "MAGILUS", motivo: "senal_fuerte", detalle: senal, ultimoClienteEn, respondioEn };
  }
  const tuvoHumano = ctx.tuvoContactoHumano ?? clases.some((c) => c === "humano" || c === "llamada_atendida");
  // (d) Ampliada con los datos del 12-oct: también SIN asesora (un caliente que nunca habló con
  // una persona es nuestro, tenga o no dueña; sin esto 3 calientes sin dueña desaparecían).
  if (ctx.caliente && !tuvoHumano) {
    return { de: "MAGILUS", motivo: "caliente_sin_humano", detalle: null, ultimoClienteEn, respondioEn };
  }
  return { de: "CLIENTE", motivo: "respondio_el_bot", detalle: null, ultimoClienteEn, respondioEn };
}

/* ------------------------------------------------------------------------------------------------
   INTERRUPTOR: AppSetting `turno:config:<workspaceId>` (JSON). Sin fila o JSON roto = APAGADO =
   exactamente el comportamiento de antes.
     activo                 prende la regla en los 4 módulos.
     cadenciaSinTarea       (def. true) los toques de los días 3/4/7 a un TIBIO o FRÍO que ya atendió la
                            asesora no son tarea: siguen los seguimientos automáticos y el descarte.
     asignadoSinRespuesta   "turno" (def.): "lead asignado sin respuesta humana" solo si es turno de
                            Magilus (calientes sin humano incluidos, regla d). "siempre": como hoy
                            (sale aunque el bot haya contestado y espere al cliente).
------------------------------------------------------------------------------------------------ */

export type ConfigTurno = {
  activo: boolean;
  cadenciaSinTarea: boolean;
  asignadoSinRespuesta: "turno" | "siempre";
};

export const CONFIG_TURNO_APAGADO: ConfigTurno = { activo: false, cadenciaSinTarea: true, asignadoSinRespuesta: "turno" };

export const claveConfigTurno = (workspaceId: string) => `turno:config:${workspaceId}`;

export function leerConfigTurnoDeTexto(texto: string | null | undefined): ConfigTurno {
  let crudo: Record<string, unknown> = {};
  try {
    const v = texto ? JSON.parse(texto) : null;
    crudo = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    crudo = {};
  }
  return {
    activo: crudo.activo === true || crudo.activo === "true",
    cadenciaSinTarea: !(crudo.cadenciaSinTarea === false || crudo.cadenciaSinTarea === "false"),
    asignadoSinRespuesta: crudo.asignadoSinRespuesta === "siempre" ? "siempre" : "turno",
  };
}

/** Motivos del seguimiento inteligente que SIEMPRE crean tarea aunque sea turno del cliente. */
export const MOTIVOS_DE_TAREA_QUE_SIGUEN = [
  "formulario_sin_respuesta",
  "cotizacion_sin_respuesta",
  "fecha_futura_cerca",
  "caliente_esperando",
  "caliente_sin_asesora",
  // Recuperación 72 h: el último intento humano antes de descartar (12-10-2026).
  "recuperacion_72h",
];

/** ¿Esta tarea del seguimiento sigue aunque sea turno del cliente? (excepciones aprobadas) */
export function tareaSigueConTurnoDelCliente(motivo: string, prioridad?: string | null): boolean {
  if (MOTIVOS_DE_TAREA_QUE_SIGUEN.includes(motivo)) return true;
  // Toque de la cadencia de un Caliente o con cotización vigente: prioridad A.
  return motivo === "cadencia_sin_respuesta" && prioridad === "A";
}
