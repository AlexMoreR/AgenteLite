import type { FlowStep } from "@/lib/agent-product-flow";

/**
 * Reglas del envío de un flujo desde el chat, paso por paso (parte 1 de «Flujos: que se envíen completos
 * aunque la asesora cambie de chat, y al instante»).
 *
 * Funciones PURAS: no tocan la base ni los gateways. Reciben la lista de pasos y devuelven una lista nueva,
 * sin cambiar la que reciben. La tabla `EnvioDeFlujo` guarda esa lista en `pasos`.
 *
 * Regla de oro: un paso que quedó en "enviando" (se cayó el servidor a mitad del envío) NUNCA se vuelve a
 * mandar solo, porque no se sabe si a la clienta ya le llegó. Al retomar pasa a "fallido" con el error
 * «no se sabe si salió», y la asesora decide con Reintentar.
 */

export type EstadoDelPaso = "pendiente" | "enviando" | "enviado" | "fallido" | "omitido";

export type EstadoDelEnvio = "EN_CURSO" | "TERMINADO" | "CON_FALLAS";

export type TipoDePaso = FlowStep["kind"];

export type PasoDeEnvio = {
  /** Posición en el flujo, desde 0. Los pasos salen en este orden. */
  indice: number;
  tipo: TipoDePaso;
  estado: EstadoDelPaso;
  /** Por qué falló o por qué se omitió; null si no aplica. */
  error: string | null;
  /** Id del mensaje que quedó en el chat al enviarse; null mientras no salga. */
  mensajeId: string | null;
  /** El paso tal cual viene del flujo (texto, o archivo con su dirección). */
  contenido: FlowStep;
};

export const ERROR_NO_SE_SABE_SI_SALIO = "no se sabe si salió";
export const ERROR_AUDIO_OMITIDO = "el audio no se manda desde el chat";

/**
 * Pausas entre pasos, en una sola constante. WhatsApp entrega mal varias cosas pegadas; con esto caen de a
 * poco sin hacer esperar a la asesora. Son los MÁXIMOS: nadie espera más que esto entre dos pasos.
 */
export const PAUSAS_DEL_FLUJO = {
  PAUSA_TRAS_TEXTO_MS: 400,
  PAUSA_TRAS_ARCHIVO_MS: 800,
} as const;

/** Cuánto esperar después de mandar un paso de este tipo, antes del siguiente. */
export function pausaTras(tipo: TipoDePaso): number {
  return tipo === "text" ? PAUSAS_DEL_FLUJO.PAUSA_TRAS_TEXTO_MS : PAUSAS_DEL_FLUJO.PAUSA_TRAS_ARCHIVO_MS;
}

/** Arma la lista de pasos a partir de los pasos del flujo. El audio queda `omitido` desde el comienzo. */
export function armarPasos(pasosDelFlujo: readonly FlowStep[]): PasoDeEnvio[] {
  return pasosDelFlujo.map((contenido, indice) => {
    const esAudio = contenido.kind === "audio";
    return {
      indice,
      tipo: contenido.kind,
      estado: esAudio ? "omitido" : "pendiente",
      error: esAudio ? ERROR_AUDIO_OMITIDO : null,
      mensajeId: null,
      contenido,
    };
  });
}

/** El próximo paso a mandar (el primero `pendiente`, en orden), o null si no queda ninguno. */
export function siguientePaso(pasos: readonly PasoDeEnvio[]): PasoDeEnvio | null {
  return [...pasos].sort((a, b) => a.indice - b.indice).find((paso) => paso.estado === "pendiente") ?? null;
}

function cambiarPaso(
  pasos: readonly PasoDeEnvio[],
  indice: number,
  cambio: (paso: PasoDeEnvio) => PasoDeEnvio,
): PasoDeEnvio[] {
  return pasos.map((paso) => (paso.indice === indice ? cambio(paso) : paso));
}

/** Justo antes de mandarlo: si el servidor se cae ahora, el paso queda en "enviando". */
export function marcarEnviando(pasos: readonly PasoDeEnvio[], indice: number): PasoDeEnvio[] {
  return cambiarPaso(pasos, indice, (paso) => ({ ...paso, estado: "enviando", error: null }));
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
    error: error.trim() || "no se pudo enviar",
  }));
}

export type AvanceDelEnvio = {
  enviados: number;
  /** Pasos que se mandan de verdad: no cuenta los omitidos (el audio). */
  total: number;
  fallidos: number;
  omitidos: number;
  /** «N de M», para mostrarle a la asesora. */
  texto: string;
};

export function calcularAvance(pasos: readonly PasoDeEnvio[]): AvanceDelEnvio {
  const enviados = pasos.filter((paso) => paso.estado === "enviado").length;
  const fallidos = pasos.filter((paso) => paso.estado === "fallido").length;
  const omitidos = pasos.filter((paso) => paso.estado === "omitido").length;
  const total = pasos.length - omitidos;
  return { enviados, total, fallidos, omitidos, texto: `${enviados} de ${total}` };
}

/**
 * Estado del envío completo: EN_CURSO mientras quede algo por mandar o mandándose; al final, CON_FALLAS si
 * algún paso falló, y TERMINADO si no (el audio omitido no cuenta como falla: se avisa aparte).
 */
export function estadoDelEnvio(pasos: readonly PasoDeEnvio[]): EstadoDelEnvio {
  if (pasos.some((paso) => paso.estado === "pendiente" || paso.estado === "enviando")) return "EN_CURSO";
  if (pasos.some((paso) => paso.estado === "fallido")) return "CON_FALLAS";
  return "TERMINADO";
}

/**
 * Al retomar un envío (tras una caída o un reinicio): todo paso que quedó en "enviando" pasa a "fallido"
 * con «no se sabe si salió». NUNCA se reenvía solo. Los pendientes siguen pendientes.
 */
export function retomar(pasos: readonly PasoDeEnvio[]): PasoDeEnvio[] {
  return pasos.map((paso) =>
    paso.estado === "enviando" ? { ...paso, estado: "fallido", error: ERROR_NO_SE_SABE_SI_SALIO } : paso,
  );
}

/** Solo un paso `fallido` tiene botón Reintentar. */
export function puedeReintentar(paso: PasoDeEnvio): boolean {
  return paso.estado === "fallido";
}

/** Reintentar UN solo paso: vuelve a `pendiente` ese y nada más. Si no se puede reintentar, no cambia nada. */
export function reintentarPaso(pasos: readonly PasoDeEnvio[], indice: number): PasoDeEnvio[] {
  return cambiarPaso(pasos, indice, (paso) =>
    puedeReintentar(paso) ? { ...paso, estado: "pendiente", error: null, mensajeId: null } : paso,
  );
}

export type TiempoDePaso = {
  tipo: TipoDePaso;
  /** Lo que tardó mandar el paso (sin la pausa). */
  ms: number;
  resultado: "enviado" | "fallido" | "omitido";
};

/**
 * Arma lo que va en el log `[flujo] medicion`: milisegundos por paso, lo que se esperó en pausas y el total.
 * No lleva el contenido de los mensajes ni el teléfono de la clienta.
 */
export function lineaDeMedicion(datos: {
  flowId: string;
  conversationId: string;
  pasos: readonly TiempoDePaso[];
  pausasMs: number;
  totalMs: number;
}) {
  const redondear = (ms: number) => Math.max(0, Math.round(ms));
  return {
    flowId: datos.flowId,
    conversationId: datos.conversationId,
    pasos: datos.pasos.length,
    enviados: datos.pasos.filter((paso) => paso.resultado === "enviado").length,
    fallidos: datos.pasos.filter((paso) => paso.resultado === "fallido").length,
    omitidos: datos.pasos.filter((paso) => paso.resultado === "omitido").length,
    msPorPaso: datos.pasos.map((paso) => `${paso.tipo}:${redondear(paso.ms)}`).join(" "),
    pausasMs: redondear(datos.pausasMs),
    totalMs: redondear(datos.totalMs),
  };
}
