/**
 * LISTO PARA PAGAR (parte 1): reconocer cuándo el V3 pidió asesora por una SEÑAL DE COMPRA y armar
 * el aviso distinto para la asesora, con el mensaje de cierre listo para copiar y mandar.
 *
 * Sin base de datos: todo aquí es texto. El bot no le manda nada de esto al cliente; lo manda la
 * asesora si quiere.
 */

/** Frases (sin tildes, en minúsculas) que el V3 pone en el motivo cuando hay señal de compra. */
const FRASES_DE_SENAL = ["senal de compra", "separar o comprar", "datos de compra", "cuenta para consignar"];

/** Quita tildes y pasa a minúsculas, para comparar sin importar cómo vino escrito. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** ¿El motivo del aviso es una señal de compra? */
export function esListoParaPagar(motivo: string | null | undefined): boolean {
  if (!motivo) {
    return false;
  }
  const limpio = normalizar(motivo);
  return FRASES_DE_SENAL.some((frase) => limpio.includes(frase));
}

/** La mitad del precio, redondeada y con puntos de miles (989000 → "494.500"). Sin precio válido, null. */
export function mitadDelPrecio(precio: number | null | undefined): string | null {
  if (typeof precio !== "number" || !Number.isFinite(precio) || precio <= 0) {
    return null;
  }
  const mitad = Math.round(precio / 2);
  return String(mitad).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** El mensaje que la asesora le puede mandar al cliente para cerrar. */
export function mensajeDeCierre(precio: number | null | undefined): string {
  const mitad = mitadDelPrecio(precio);
  const cincuenta = mitad ? `el 50 % (${mitad})` : "el 50 %";
  return `¡Listo! Te lo aparto con ${cincuenta} y el resto antes del despacho. Te paso la cuenta: ¿en qué color lo quieres?`;
}

/** Las líneas de arriba del aviso por WhatsApp a la asesora. */
export function armarEncabezadoDelAviso(input: { cliente: string; telefono: string; motivo: string }): string[] {
  return [
    esListoParaPagar(input.motivo) ? "🔥 *LISTO PARA PAGAR*" : "🔔 *Necesita atención*",
    "",
    `👤 ${input.cliente}`,
    `📱 ${input.telefono}`,
    `📌 ${input.motivo}`,
  ];
}

/*
  LISTO PARA PAGAR (parte 3): si nadie del equipo escribe en el chat a los 5 minutos del aviso, en
  horario de trabajo, el aviso le llega al líder de ventas. Aquí está la decisión, sin base de datos.
*/

/** Cuánto se espera a que alguien del equipo escriba antes de pasarle el aviso al líder. */
export const ESPERA_PARA_ESCALAR_MS = 5 * 60_000;
/** Después de esto la marca se cierra sola: ya no tiene sentido avisarle a nadie. */
export const VIDA_DE_LA_MARCA_MS = 24 * 60 * 60_000;

export type EstadoDeLaMarca = "pendiente" | "escalado" | "atendido" | "cerrado" | "sin_destino";
export type DecisionDeLaMarca = "nada" | "atendido" | "cerrar" | "escalar";

/**
 * Qué hacer con una marca "Listo para pagar". El orden importa: una respuesta del equipo gana
 * siempre, y fuera de horario la marca sigue pendiente (al abrir el horario se escala).
 */
export function decidirMarca(input: {
  estado: string;
  avisadoEn: Date;
  ahora: Date;
  huboRespuestaHumana: boolean;
  enHorario: boolean;
}): DecisionDeLaMarca {
  if (input.estado !== "pendiente") {
    return "nada";
  }
  if (input.huboRespuestaHumana) {
    return "atendido";
  }
  const espera = input.ahora.getTime() - input.avisadoEn.getTime();
  if (!Number.isFinite(espera) || espera > VIDA_DE_LA_MARCA_MS) {
    return "cerrar";
  }
  if (!input.enHorario) {
    return "nada";
  }
  if (espera < ESPERA_PARA_ESCALAR_MS) {
    return "nada";
  }
  return "escalar";
}

/** El título del aviso al líder (push y primera línea del WhatsApp). */
export const TITULO_PARA_EL_LIDER = "🔥 LISTO PARA PAGAR — sin respuesta en 5 min";

/** El WhatsApp al líder: cliente, asesora, enlace al chat y el mensaje de cierre. */
export function armarTextoParaElLider(input: {
  cliente: string;
  asesora: string | null;
  enlace: string;
  cierre: string;
}): string {
  return [
    `*${TITULO_PARA_EL_LIDER}*`,
    "",
    `👤 ${input.cliente}`,
    `*Asignado a:* ${input.asesora ?? "nadie todavía"}`,
    "",
    input.enlace,
    "",
    `Mensaje de cierre: ${input.cierre}`,
  ].join("\n");
}
