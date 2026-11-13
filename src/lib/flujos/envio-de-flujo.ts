/*
  ENVIO DE UN FLUJO, PASO POR PASO: las reglas del avance (parte 1 de «Flujos: que se envíen completos
  aunque la asesora cambie de chat, y al instante»).

  Funciones puras: no importan Prisma ni gateways, no mandan nada. Reciben la lista de pasos y
  devuelven una lista NUEVA (nunca cambian la que reciben). En esta parte todavía no las usa el envío:
  solo la línea de medición `[flujo] medicion` sale de aquí, para tomar el «antes» en producción.

  La regla más importante es la de `retomar`: si el servidor se cayó mientras un paso estaba
  «enviando», no se sabe si a la clienta le llegó. Ese paso NUNCA se reenvía solo (mandarle dos veces
  el mismo catálogo es peor que no mandarlo): queda «fallido» y la asesora decide con Reintentar.
*/
import type { FlowStep } from "@/lib/agent-product-flow";

export type EstadoDePaso = "pendiente" | "enviando" | "enviado" | "fallido" | "omitido";

export type TipoDePaso = FlowStep["kind"];

export type PasoDeEnvio = {
  /** Posición del paso en el flujo (empieza en 0): el orden en que sale. */
  indice: number;
  tipo: TipoDePaso;
  estado: EstadoDePaso;
  /** Por qué falló o por qué se omitió; null si no aplica. */
  error: string | null;
  /** Id del mensaje que quedó en el chat al mandarlo; null si todavía no salió. */
  mensajeId: string | null;
  /** El paso del flujo tal como estaba al tocar «Enviar flujo» (si después cambian el flujo, sale igual). */
  contenido: FlowStep;
};

export type EstadoDeEnvio = "EN_CURSO" | "TERMINADO" | "CON_FALLAS";

/** Pausas entre pasos, en una sola constante: es lo único que se toca para mandarlo más rápido o más lento. */
export const PAUSAS = {
  PAUSA_TRAS_TEXTO_MS: 400,
  PAUSA_TRAS_ARCHIVO_MS: 800,
} as const;

export const ERROR_AUDIO_OMITIDO = "El audio no se manda desde el chat";
export const ERROR_NO_SE_SABE_SI_SALIO = "no se sabe si salió";

/** Arma la lista de pasos a partir de los del flujo, en el mismo orden. El audio queda omitido. */
export function armarPasos(steps: readonly FlowStep[]): PasoDeEnvio[] {
  return steps.map((contenido, indice) => ({
    indice,
    tipo: contenido.kind,
    estado: contenido.kind === "audio" ? "omitido" : "pendiente",
    error: contenido.kind === "audio" ? ERROR_AUDIO_OMITIDO : null,
    mensajeId: null,
    contenido,
  }));
}

/** El próximo paso que hay que mandar (el primero pendiente, en orden), o null si no queda ninguno. */
export function siguientePaso(pasos: readonly PasoDeEnvio[]): PasoDeEnvio | null {
  return pasos.find((paso) => paso.estado === "pendiente") ?? null;
}

function cambiarPaso(
  pasos: readonly PasoDeEnvio[],
  indice: number,
  cambio: (paso: PasoDeEnvio) => PasoDeEnvio,
): PasoDeEnvio[] {
  if (!pasos.some((paso) => paso.indice === indice)) {
    throw new Error(`No existe el paso ${indice}`);
  }
  return pasos.map((paso) => (paso.indice === indice ? cambio(paso) : paso));
}

/** Se va a mandar: solo un paso pendiente puede pasar a «enviando». */
export function marcarEnviando(pasos: readonly PasoDeEnvio[], indice: number): PasoDeEnvio[] {
  return cambiarPaso(pasos, indice, (paso) => {
    if (paso.estado !== "pendiente") {
      throw new Error(`El paso ${indice} no está pendiente (está ${paso.estado})`);
    }
    return { ...paso, estado: "enviando", error: null };
  });
}

export function marcarEnviado(
  pasos: readonly PasoDeEnvio[],
  indice: number,
  mensajeId: string | null = null,
): PasoDeEnvio[] {
  return cambiarPaso(pasos, indice, (paso) => ({ ...paso, estado: "enviado", error: null, mensajeId }));
}

export function marcarFallido(pasos: readonly PasoDeEnvio[], indice: number, error: string): PasoDeEnvio[] {
  return cambiarPaso(pasos, indice, (paso) => ({
    ...paso,
    estado: "fallido",
    error: error.trim() || "No se pudo enviar",
  }));
}

export type Avance = { enviados: number; total: number; texto: string };

/** Cuántos salieron de cuántos se pueden mandar («N de M»). Los omitidos (el audio) no cuentan en el total. */
export function calcularAvance(pasos: readonly PasoDeEnvio[]): Avance {
  const total = pasos.filter((paso) => paso.estado !== "omitido").length;
  const enviados = pasos.filter((paso) => paso.estado === "enviado").length;
  return { enviados, total, texto: `${enviados} de ${total}` };
}

/** EN_CURSO mientras quede algo por mandar o mandándose; si no, CON_FALLAS si alguno falló, o TERMINADO. */
export function estadoFinal(pasos: readonly PasoDeEnvio[]): EstadoDeEnvio {
  if (pasos.some((paso) => paso.estado === "pendiente" || paso.estado === "enviando")) return "EN_CURSO";
  if (pasos.some((paso) => paso.estado === "fallido")) return "CON_FALLAS";
  return "TERMINADO";
}

/**
 * Al volver después de una caída: todo paso que quedó «enviando» pasa a «fallido» con «no se sabe si
 * salió». NUNCA vuelve a «pendiente», así que `siguientePaso` no lo toma: solo sale con Reintentar.
 */
export function retomar(pasos: readonly PasoDeEnvio[]): PasoDeEnvio[] {
  return pasos.map((paso) =>
    paso.estado === "enviando" ? { ...paso, estado: "fallido", error: ERROR_NO_SE_SABE_SI_SALIO } : paso,
  );
}

/** Solo un paso fallido se puede reintentar (ni el enviado, ni el omitido, ni el que se está mandando). */
export function puedeReintentar(paso: PasoDeEnvio): boolean {
  return paso.estado === "fallido";
}

/** Reintentar UN solo paso: ese vuelve a «pendiente» y los demás quedan como estaban. */
export function reintentarPaso(pasos: readonly PasoDeEnvio[], indice: number): PasoDeEnvio[] {
  return cambiarPaso(pasos, indice, (paso) => {
    if (!puedeReintentar(paso)) {
      throw new Error(`El paso ${indice} no se puede reintentar (está ${paso.estado})`);
    }
    return { ...paso, estado: "pendiente", error: null };
  });
}

/** Cuánto esperar después de un paso antes del siguiente. */
export function pausaTras(tipo: TipoDePaso): number {
  return tipo === "text" ? PAUSAS.PAUSA_TRAS_TEXTO_MS : PAUSAS.PAUSA_TRAS_ARCHIVO_MS;
}

export type MedicionDePaso = {
  tipo: TipoDePaso;
  resultado: "enviado" | "fallido" | "omitido";
  /** Lo que tardó en mandarse ese paso, sin contar la pausa de antes. */
  ms: number;
};

export type LineaDeMedicion = {
  conversationId: string;
  flowId: string;
  pasos: number;
  enviados: number;
  fallidos: number;
  omitidos: number;
  /** Milisegundos de cada paso, en orden: «1:text=120ms». */
  porPaso: string[];
  /** Suma de lo que tardaron los pasos (sin pausas). */
  msEnPasos: number;
  /** Todo el envío, pausas incluidas: lo que esperó la asesora. */
  msTotal: number;
};

/**
 * Arma lo que se escribe con `console.info('[flujo] medicion', …)`. Solo tiempos y conteos: nada del
 * contenido de los mensajes ni datos de la clienta.
 */
export function lineaDeMedicion(entrada: {
  conversationId: string;
  flowId: string;
  pasos: readonly MedicionDePaso[];
  msTotal: number;
}): LineaDeMedicion {
  const redondear = (ms: number) => Math.max(0, Math.round(ms));
  const contar = (resultado: MedicionDePaso["resultado"]) =>
    entrada.pasos.filter((paso) => paso.resultado === resultado).length;
  return {
    conversationId: entrada.conversationId,
    flowId: entrada.flowId,
    pasos: entrada.pasos.length,
    enviados: contar("enviado"),
    fallidos: contar("fallido"),
    omitidos: contar("omitido"),
    porPaso: entrada.pasos.map((paso, i) => `${i + 1}:${paso.tipo}=${redondear(paso.ms)}ms${paso.resultado === "enviado" ? "" : ` (${paso.resultado})`}`),
    msEnPasos: entrada.pasos.reduce((suma, paso) => suma + redondear(paso.ms), 0),
    msTotal: redondear(entrada.msTotal),
  };
}
