/**
 * LA FICHA DE CADA LEAD para el Supervisor (código puro).
 *
 * A partir de los mensajes del chat (los mismos que usa el relleno del embudo, ver
 * embudo/dominio/relleno.ts → MensajeDelRelleno) saca los indicadores que el Supervisor compara
 * contra su línea base: qué regla ganó el primer mensaje, cuántos mensajes soltó el bot al
 * principio, si hubo precio o fotos antes de identificar al cliente, si el cliente respondió, si
 * conversó, si mostró señal de compra, si pasó a una asesora, cuánto tardó la primera respuesta
 * humana, cuántos seguimientos recibió y si el bot repitió preguntas.
 *
 * CADA INDICADOR TIENE SU VENTANA y solo mira mensajes dentro de ella, contada desde la entrada
 * del lead. Así un indicador está "maduro" cuando su ventana ya pasó, y la misma ficha sirve en
 * vivo y en la simulación histórica sin mirar el futuro: en la hora T solo cuentan los leads cuya
 * ventana terminó antes de T (ver `disponible`).
 */

import type { MensajeDelRelleno } from "../../embudo/dominio/relleno";
import { productoDeEntrada, type ConfigEmbudo, CONFIG_EMBUDO_POR_DEFECTO } from "../../embudo/dominio/combo";
import { detectarSenales } from "../../embudo/dominio/senales";
import { mensajeConContenido } from "../../../lib/turno-con-contenido";

export type MensajeDelSupervisor = Pick<
  MensajeDelRelleno,
  "id" | "direction" | "type" | "content" | "transcripcion" | "createdAt" | "source" | "kind" | "assigneeUserId" | "enviadoPorUserId"
>;

const MIN = 60_000;
const HORA = 60 * MIN;

/** Ventanas de maduración (ms desde la entrada del lead). */
export const VENTANAS = {
  primerTurno: 10 * MIN,
  rafagaInicial: 5 * MIN,
  respuesta: 2 * HORA,
  conversacion: 24 * HORA,
  senal: 24 * HORA,
  asesora: 24 * HORA,
  seguimientos: 72 * HORA,
} as const;

export type Indicador =
  | "regla_primer_mensaje"
  | "rafaga_inicial"
  | "precio_o_fotos_antes_de_identificar"
  | "respondio_2h"
  | "conversa_3_24h"
  | "senal_24h"
  | "a_asesora_24h"
  | "asesora_sin_senal_24h"
  | "senal_sin_asesora_1h"
  | "pregunta_repetida_24h"
  | "ciudad_repetida_24h"
  | "insistencia_72h";

/** Qué ventana necesita cada indicador para estar maduro. */
export const MADURA_EN: Record<Indicador, number> = {
  regla_primer_mensaje: VENTANAS.primerTurno,
  rafaga_inicial: VENTANAS.rafagaInicial,
  precio_o_fotos_antes_de_identificar: VENTANAS.primerTurno,
  respondio_2h: VENTANAS.respuesta,
  conversa_3_24h: VENTANAS.conversacion,
  senal_24h: VENTANAS.senal,
  a_asesora_24h: VENTANAS.asesora,
  asesora_sin_senal_24h: VENTANAS.asesora,
  senal_sin_asesora_1h: VENTANAS.asesora + HORA,
  pregunta_repetida_24h: VENTANAS.conversacion,
  ciudad_repetida_24h: VENTANAS.conversacion,
  insistencia_72h: VENTANAS.seguimientos,
};

export const NOMBRE_DEL_INDICADOR: Record<Indicador, string> = {
  regla_primer_mensaje: "Regla que gana el primer mensaje",
  rafaga_inicial: "Leads con más de 3 mensajes del bot en los primeros 5 min",
  precio_o_fotos_antes_de_identificar: "Precio o fotos antes de identificar al cliente",
  respondio_2h: "Clientes que responden en 2 h",
  conversa_3_24h: "Clientes que conversan (3+ mensajes) en 24 h",
  senal_24h: "Leads con señal de compra en 24 h",
  a_asesora_24h: "Leads que pasan a asesora en 24 h",
  asesora_sin_senal_24h: "Pasan a asesora sin señal de compra",
  senal_sin_asesora_1h: "Señal de compra sin respuesta humana en 1 h",
  pregunta_repetida_24h: "El bot repite la misma pregunta",
  ciudad_repetida_24h: "El bot pregunta la ciudad cuando ya la dijo",
  insistencia_72h: "3+ seguimientos automáticos a quien nunca respondió (72 h)",
};

/** Indicadores que son MALOS cuando suben (el resto, malos cuando bajan). */
export const MALO_SI_SUBE = new Set<Indicador>([
  "rafaga_inicial",
  "precio_o_fotos_antes_de_identificar",
  "asesora_sin_senal_24h",
  "senal_sin_asesora_1h",
  "pregunta_repetida_24h",
  "ciudad_repetida_24h",
  "insistencia_72h",
]);

export type FichaDelLead = {
  conversationId: string;
  /** Hora del primer mensaje del cliente. */
  entradaEn: Date;
  producto: string | null;
  /** El primer mensaje es el texto exacto (normalizado) de un anuncio. */
  textoDelAnuncio: boolean;
  /** Versión del libro V3 vigente al entrar (si se conoce). */
  libroVersion: number | null;
  asesoraId: string | null;
  /** Regla que ganó el primer turno (de la nota "Agente V3: Ganó …"), o null si no hubo nota. */
  reglaPrimerMensaje: string | null;
  /** Mensajes del bot en los primeros 5 min. */
  botPrimeros5Min: number;
  /** El turno con más mensajes seguidos del bot en las primeras 24 h. */
  maxRafaga: number;
  /** Precio o fotos/video en el primer turno, antes de que el cliente vuelva a escribir. */
  precioOFotosAntesDeIdentificar: boolean;
  /** Minutos hasta la primera respuesta del cliente con contenido (null = no respondió). */
  minutosHastaRespuesta: number | null;
  /** Mensajes del cliente después del primero, en 24 h. */
  respuestas24h: number;
  /** Minutos hasta la primera señal de compra (null = ninguna en 24 h). */
  minutosHastaSenal: number | null;
  senalFuerte: boolean;
  /** Minutos hasta pasar a asesora (asignación o primer mensaje humano), null = no pasó en 24 h. */
  minutosHastaAsesora: number | null;
  /** Minutos desde la primera señal hasta el primer mensaje humano posterior (null = nunca en 24 h). */
  minutosSenalARespuestaHumana: number | null;
  seguimientos72h: number;
  /** El cliente escribió algo con contenido en 72 h (para medir la insistencia a quien nunca respondió). */
  respondio72h: boolean;
  /** Paso más avanzado del embudo (de EmbudoLead o del relleno), si se conoce. */
  pasoMaximo?: string | null;
  /** Etapa del CRM (para contar GANADO). */
  etapa?: string | null;
  preguntaRepetida: boolean;
  ciudadRepetida: boolean;
  /** Ids de mensajes del bot que sirven de evidencia (primer turno). */
  evidencia: { primerTurno: string[] };
};

const FUENTES_DE_PERSONA = new Set(["manual", "instance"]);
const FUENTES_DE_SEGUIMIENTO = new Set(["agente-v3-seguimiento", "agente-v3-seguimiento-ia", "follow"]);
const RE_GANO = /Gan[oó] [«"“]([^»"”]+)[»"”] porque/;
const RE_PRECIO = /\$\s?\d|\d{3}[.,]\d{3}|\bprecio\b|\bvalor\b|\bpesos\b/i;


/**
 * Ciudades y municipios frecuentes (sin tildes). No pretende ser completo: sirve para saber que el
 * cliente YA dijo dónde está antes de que el bot vuelva a preguntarlo.
 */
const RE_CIUDAD_DICHA =
  /\b(bogota|medellin|cali|barranquilla|cartagena|bucaramanga|pereira|manizales|ibague|villavicencio|neiva|pasto|monteria|cucuta|santa marta|armenia|popayan|tunja|valledupar|sincelejo|soacha|palmira|tulua|bello|envigado|itagui|yopal|florencia|quibdo|riohacha|girardot|duitama|sogamoso|cartago|buga|jamundi|zipaquira|facatativa|fusagasuga|mosquera|funza|rionegro|apartado|barrancabermeja|ocana|pamplona|leticia|san andres|mocoa|arauca|chia|cajica|dosquebradas|la dorada|honda|espinal|melgar|caucasia|turbo|magangue|lorica|cienaga|maicao|aguachica|ipiales|tumaco|buenaventura|yumbo|candelaria|sabaneta|la estrella|caldas)\b/;

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function esDelBot(m: MensajeDelSupervisor): boolean {
  return m.direction === "OUTBOUND" && m.type !== "SYSTEM" && !m.source;
}

function esDeSeguimiento(m: MensajeDelSupervisor): boolean {
  return m.direction === "OUTBOUND" && m.type !== "SYSTEM" && FUENTES_DE_SEGUIMIENTO.has(m.source ?? "");
}

function esDelCliente(m: MensajeDelSupervisor): boolean {
  return m.direction === "INBOUND" && m.type !== "SYSTEM";
}

/** La última oración con "?" de un texto del bot, normalizada, o null. */
export function preguntaDelBot(texto: string | null | undefined): string | null {
  const limpio = sinTildes(texto ?? "").replace(/[*_~]/g, "");
  const partes = limpio.split(/(?<=[?.!\n])/);
  const conPregunta = partes.filter((parte) => parte.includes("?"));
  const ultima = conPregunta.at(-1);
  if (!ultima) return null;
  const normal = ultima.replace(/[¿?¡!.,;:()"'🙌😊👋✨💜🌸]/gu, " ").replace(/\s+/g, " ").trim();
  return normal.length >= 8 ? normal : null;
}

export type OpcionesDeFicha = {
  config?: ConfigEmbudo;
  /** Textos de anuncio conocidos (se comparan normalizados). */
  textosDeAnuncio?: string[];
  /** Versión del libro vigente en un momento. */
  versionEn?: (cuando: Date) => number | null;
  /** Origen del anuncio guardado en el contacto. */
  anuncio?: { titulo?: string | null; id?: string | null } | null;
  asesoraId?: string | null;
};

export const TEXTO_DEL_ANUNCIO_COMBO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";

function normalizarTextoDeAnuncio(texto: string): string {
  return sinTildes(texto).replace(/[*_~`"'¡!¿?.,;:()[\]]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * La ficha de UN lead. `mensajes` del más viejo al más nuevo; los que estén después de `hasta`
 * (si se pasa) se ignoran, para no mirar el futuro en la simulación.
 */
export function fichaDelLead(
  conversationId: string,
  mensajesCrudos: MensajeDelSupervisor[],
  opciones: OpcionesDeFicha = {},
  hasta?: Date,
): FichaDelLead | null {
  const mensajes = hasta ? mensajesCrudos.filter((m) => m.createdAt.getTime() <= hasta.getTime()) : mensajesCrudos;
  const primero = mensajes.find(esDelCliente);
  if (!primero) return null;
  const t0 = primero.createdAt.getTime();
  const dentro = (m: MensajeDelSupervisor, ventana: number) => m.createdAt.getTime() >= t0 && m.createdAt.getTime() <= t0 + ventana;
  const minutos = (m: MensajeDelSupervisor) => (m.createdAt.getTime() - t0) / MIN;

  const textoPrimero = primero.content ?? "";
  const anuncios = (opciones.textosDeAnuncio ?? [TEXTO_DEL_ANUNCIO_COMBO]).map(normalizarTextoDeAnuncio);
  const textoDelAnuncio = anuncios.includes(normalizarTextoDeAnuncio(textoPrimero));

  // Regla del primer turno: la primera nota "Ganó" dentro de la ventana del primer turno, antes del
  // segundo mensaje del cliente (si escribió dos veces seguidas, igual es su primer turno).
  const segundoDelCliente = mensajes.find((m) => esDelCliente(m) && m.createdAt.getTime() > t0 && mensajeConContenido({ type: m.type, content: m.content }));
  const corteDelTurno = Math.min(t0 + VENTANAS.primerTurno, segundoDelCliente ? segundoDelCliente.createdAt.getTime() : Infinity);
  const notaDelPrimerTurno = mensajes.find(
    (m) => m.type === "SYSTEM" && m.createdAt.getTime() >= t0 && m.createdAt.getTime() <= t0 + VENTANAS.primerTurno && RE_GANO.test(m.content ?? ""),
  );
  const reglaPrimerMensaje = notaDelPrimerTurno ? (notaDelPrimerTurno.content ?? "").match(RE_GANO)?.[1]?.trim() ?? null : null;

  const delBot = mensajes.filter(esDelBot);
  const primerTurno = delBot.filter((m) => m.createdAt.getTime() >= t0 && m.createdAt.getTime() <= corteDelTurno);
  /*
    La ráfaga INICIAL es lo que el bot suelta en el primer turno (antes de que el cliente vuelva a
    escribir) dentro de los primeros 5 min. Contar "todo lo de los primeros 5 min" mezclaba las
    fotos que se mandan cuando el cliente ya contestó "sí" y daba al revés la correlación con la
    respuesta (la primera simulación lo mostró: 100 % de "respuesta" en los que recibían ráfaga).
  */
  const botPrimeros5Min = primerTurno.filter((m) => dentro(m, VENTANAS.rafagaInicial)).length;
  const precioOFotosAntesDeIdentificar = primerTurno.some(
    (m) => m.type === "IMAGE" || m.type === "VIDEO" || (m.type === "TEXT" && RE_PRECIO.test(m.content ?? "")),
  );

  // Ráfagas: mensajes del bot seguidos (sin cliente en medio), dentro de 24 h.
  let maxRafaga = 0;
  let racha = 0;
  for (const m of mensajes) {
    if (!dentro(m, VENTANAS.conversacion)) continue;
    if (esDelCliente(m)) racha = 0;
    else if (esDelBot(m)) {
      racha += 1;
      maxRafaga = Math.max(maxRafaga, racha);
    }
  }

  const delCliente = mensajes.filter(esDelCliente).filter((m) => m.createdAt.getTime() > t0);
  const primeraRespuesta = delCliente.find(
    (m) => dentro(m, VENTANAS.respuesta) && mensajeConContenido({ type: m.type, content: m.transcripcion || m.content }),
  );
  const respuestas24h = delCliente.filter((m) => dentro(m, VENTANAS.conversacion)).length;

  // Señales de compra (sin las negativas). El texto del anuncio no cuenta como señal.
  const conSenal = mensajes.filter(esDelCliente).filter((m) => {
    if (!dentro(m, VENTANAS.senal)) return false;
    if (m === primero && textoDelAnuncio) return false;
    return detectarSenales(m.transcripcion || m.content || "").some((s) => s.grupo !== "negativa");
  });
  const primeraSenal = conSenal[0] ?? null;
  const senalFuerte = conSenal.some((m) => detectarSenales(m.transcripcion || m.content || "").some((s) => s.grupo === "fuerte"));

  // A asesora: nota de asignación o primer mensaje humano (el automático del celular en el primer
  // minuto no cuenta: es el saludo de la línea).
  const humano = (m: MensajeDelSupervisor) =>
    m.direction === "OUTBOUND" &&
    m.type !== "SYSTEM" &&
    FUENTES_DE_PERSONA.has(m.source ?? "") &&
    !(m.source === "instance" && m.createdAt.getTime() - t0 < MIN);
  const pasoAAsesora = mensajes.find((m) => dentro(m, VENTANAS.asesora) && ((m.type === "SYSTEM" && m.kind === "assigned") || humano(m)));
  const respuestaHumanaTrasSenal = primeraSenal
    ? mensajes.find((m) => humano(m) && m.createdAt.getTime() >= primeraSenal.createdAt.getTime() && dentro(m, VENTANAS.asesora + HORA))
    : undefined;

  const seguimientos72h = mensajes.filter((m) => esDeSeguimiento(m) && dentro(m, VENTANAS.seguimientos)).length;

  // Preguntas repetidas del bot (misma pregunta normalizada dos veces en 24 h).
  const preguntas = new Map<string, number>();
  let preguntaRepetida = false;
  for (const m of mensajes) {
    if (!(esDelBot(m) || esDeSeguimiento(m)) || !dentro(m, VENTANAS.conversacion)) continue;
    const pregunta = preguntaDelBot(m.content);
    if (!pregunta) continue;
    const n = (preguntas.get(pregunta) ?? 0) + 1;
    preguntas.set(pregunta, n);
    if (n >= 2) preguntaRepetida = true;
  }

  // Ciudad repetida: el cliente ya nombró una ciudad y DESPUÉS el bot le pregunta "¿en qué ciudad…?".
  let ciudadDichaEn: number | null = null;
  let ciudadRepetida = false;
  for (const m of mensajes) {
    if (!dentro(m, VENTANAS.conversacion)) continue;
    if (esDelCliente(m) && ciudadDichaEn === null && RE_CIUDAD_DICHA.test(sinTildes(m.transcripcion || m.content || ""))) {
      ciudadDichaEn = m.createdAt.getTime();
    } else if (ciudadDichaEn !== null && (esDelBot(m) || esDeSeguimiento(m)) && preguntaLaCiudad(m.content)) {
      ciudadRepetida = true;
    }
  }

  return {
    conversationId,
    entradaEn: primero.createdAt,
    producto: productoDeEntrada({ anuncio: opciones.anuncio ?? null, primerMensaje: textoPrimero }, opciones.config ?? CONFIG_EMBUDO_POR_DEFECTO),
    textoDelAnuncio,
    libroVersion: opciones.versionEn ? opciones.versionEn(primero.createdAt) : null,
    asesoraId: opciones.asesoraId ?? null,
    reglaPrimerMensaje,
    botPrimeros5Min,
    maxRafaga,
    precioOFotosAntesDeIdentificar,
    minutosHastaRespuesta: primeraRespuesta ? minutos(primeraRespuesta) : null,
    respuestas24h,
    minutosHastaSenal: primeraSenal ? minutos(primeraSenal) : null,
    senalFuerte,
    minutosHastaAsesora: pasoAAsesora ? minutos(pasoAAsesora) : null,
    minutosSenalARespuestaHumana:
      primeraSenal && respuestaHumanaTrasSenal ? (respuestaHumanaTrasSenal.createdAt.getTime() - primeraSenal.createdAt.getTime()) / MIN : null,
    seguimientos72h,
    respondio72h: delCliente.some(
      (m) => dentro(m, VENTANAS.seguimientos) && mensajeConContenido({ type: m.type, content: m.transcripcion || m.content }),
    ),
    preguntaRepetida,
    ciudadRepetida,
    evidencia: { primerTurno: primerTurno.slice(0, 10).map((m) => m.id) },
  };
}

/** ¿El bot PREGUNTA la ciudad? (una oración con "?" que la pide; "te confirmo el envío a tu ciudad" no cuenta). */
export function preguntaLaCiudad(texto: string | null | undefined): boolean {
  const pregunta = preguntaDelBot(texto);
  return Boolean(pregunta && /\bciudad\b|desde donde|de donde (eres|nos escribes)/.test(pregunta));
}

/** ¿El indicador de este lead ya maduró a la hora `ahora`? */
export function disponible(ficha: FichaDelLead, indicador: Indicador, ahora: Date): boolean {
  return ahora.getTime() - ficha.entradaEn.getTime() >= MADURA_EN[indicador];
}

/**
 * El valor (éxito / fracaso) de un indicador de proporción para un lead, o null si no aplica
 * (por ejemplo "asesora sin señal" solo aplica a los que pasaron a asesora).
 */
export function valorDelIndicador(ficha: FichaDelLead, indicador: Exclude<Indicador, "regla_primer_mensaje">): boolean | null {
  switch (indicador) {
    case "rafaga_inicial":
      return ficha.botPrimeros5Min > 3;
    case "precio_o_fotos_antes_de_identificar":
      return ficha.precioOFotosAntesDeIdentificar;
    case "respondio_2h":
      return ficha.minutosHastaRespuesta !== null;
    case "conversa_3_24h":
      return ficha.respuestas24h >= 3;
    case "senal_24h":
      return ficha.minutosHastaSenal !== null;
    case "a_asesora_24h":
      return ficha.minutosHastaAsesora !== null;
    case "asesora_sin_senal_24h":
      if (ficha.minutosHastaAsesora === null) return null;
      return ficha.minutosHastaSenal === null || ficha.minutosHastaSenal > ficha.minutosHastaAsesora;
    case "senal_sin_asesora_1h":
      if (ficha.minutosHastaSenal === null) return null;
      return ficha.minutosSenalARespuestaHumana === null || ficha.minutosSenalARespuestaHumana > 60;
    case "pregunta_repetida_24h":
      return ficha.preguntaRepetida;
    case "ciudad_repetida_24h":
      return ficha.ciudadRepetida;
    case "insistencia_72h":
      if (ficha.respondio72h) return null;
      return ficha.seguimientos72h >= 3;
    default:
      return null;
  }
}
