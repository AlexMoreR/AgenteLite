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

/* ------------------------------------------------------------------------------------------------
   LISTO PARA PAGAR (parte 3): si nadie del equipo le escribe al cliente en 5 minutos, en horario de
   trabajo, el aviso le llega al líder de ventas. Aquí solo la decisión y el texto; la base y los
   envíos están en `servicios/listo-para-pagar.ts`.
------------------------------------------------------------------------------------------------ */

/** Cómo va la marca de un aviso "Listo para pagar". */
export type EstadoDeLaMarca = "pendiente" | "escalado" | "atendido" | "cerrado" | "sin_destino";

/** Lo que hay que hacer con una marca en esta vuelta del reloj. */
export type DecisionDeLaMarca = "nada" | "atendido" | "cerrar" | "escalar";

/** Minutos sin respuesta humana antes de avisarle al líder. */
export const MINUTOS_PARA_ESCALAR = 5;
/** Pasado esto la marca ya no sirve: se cierra sin avisar. */
export const HORAS_DE_VIDA_DE_LA_MARCA = 24;

export const TITULO_PARA_EL_LIDER = "🔥 LISTO PARA PAGAR — sin respuesta en 5 min";

/**
 * Qué hacer con una marca. El orden importa: una marca que no está pendiente no se toca; si alguien
 * del equipo ya escribió, queda atendida; vieja (más de 24 h), se cierra; fuera de horario sigue
 * pendiente (sale al abrir); con menos de 5 minutos todavía se espera; si no, se escala.
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
  const transcurrido = input.ahora.getTime() - input.avisadoEn.getTime();
  if (transcurrido > HORAS_DE_VIDA_DE_LA_MARCA * 60 * 60_000) {
    return "cerrar";
  }
  if (!input.enHorario) {
    return "nada";
  }
  if (transcurrido < MINUTOS_PARA_ESCALAR * 60_000) {
    return "nada";
  }
  return "escalar";
}

/** El WhatsApp (o el cuerpo del push) para el líder de ventas. */
export function armarAvisoParaElLider(input: {
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
    "Mensaje de cierre:",
    input.cierre,
  ].join("\n");
}
