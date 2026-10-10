/**
 * LOS CHATS DE UNA ALERTA, COMO LOS LEE UNA PERSONA (código puro).
 *
 * Los detectores guardan en la evidencia el id interno de la conversación ("cvb085ce..."), que no
 * le sirve a la asesora ni al dueño para encontrar el chat. Aquí se arma, SOLO PARA MOSTRAR, una
 * fila por chat con el nombre del cliente, el teléfono tapado (últimos 4), lo que dijo, cuánto lleva
 * esperando, la asesora y el enlace que abre esa conversación en la bandeja. El id queda de dato
 * secundario (para soporte). No cambia nada de la detección ni de lo que se guarda.
 */

import { ultimos4 } from "../../coach/reglas";
import type { Hallazgo } from "./tipos";

const MIN = 60_000;
/** Cuántos chats se muestran por alerta como máximo. */
export const MAX_CHATS_POR_ALERTA = 15;
const LARGO_DE_LA_FRASE = 120;

/** Lo que se lee de la base por chat (una sola consulta para todos los chats de la pantalla). */
export type DatosDelChat = {
  conversationId: string;
  nombre: string | null;
  telefono: string | null;
  asesoraNombre: string | null;
  ultimoClienteEn: Date | null;
  ultimaRespuestaHumanaEn: Date | null;
  /** Último texto del cliente (recortado en la consulta). */
  ultimoTextoCliente: string | null;
};

export type FilaDeChatDeAlerta = {
  /** El id interno: solo para soporte (texto pequeño o tooltip). */
  conversationId: string;
  encontrado: boolean;
  /** Nombre del cliente, "Cliente sin nombre" o "Chat no encontrado". */
  nombre: string;
  /** "•••• 4567" o "" si no hay teléfono. */
  telefono: string;
  asesora: string | null;
  /** Lo que dijo el cliente (de la alerta o, si la alerta no lo trae, su último mensaje). */
  frase: string | null;
  /** "45 min laborales", "3 h"... o null si no está esperando. */
  esperando: string | null;
  /** Enlace a la conversación en la bandeja; null si el chat no existe. */
  href: string | null;
};

/**
 * El mismo enlace que usan Mi Día, Actividad del equipo y los avisos del agente: la bandeja abre la
 * conversación por su clave `agent:<id>` aunque no esté en el lote cargado (la busca por id dentro
 * del negocio), y `assigned=all` evita que quede escondida por el filtro "Mías".
 */
export function enlaceAlChat(conversationId: string): string {
  return `/cliente/chats?chatKey=${encodeURIComponent(`agent:${conversationId}`)}&assigned=all`;
}

/** Solo los últimos 4 dígitos: "•••• 4567". Reutiliza el enmascarado del Coach. */
export function telefonoOculto(telefono: string | null | undefined): string {
  const fin = ultimos4(telefono);
  return fin === "…" ? "" : `•••• ${fin.slice(1)}`;
}

/** Cuando el contacto no tiene nombre guardado, muchas veces el "nombre" es el mismo número. */
function nombreVisible(nombre: string | null | undefined): string | null {
  const texto = (nombre ?? "").trim();
  if (!texto) return null;
  if (!/\p{L}/u.test(texto) && texto.replace(/\D/g, "").length >= 5) return null;
  return texto;
}

function recortar(texto: string | null | undefined, largo = LARGO_DE_LA_FRASE): string | null {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  return limpio.length > largo ? `${limpio.slice(0, largo - 1).trimEnd()}…` : limpio;
}

function duracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 48 * 60) return `${Math.round(minutos / 60)} h`;
  return `${Math.round(minutos / (24 * 60))} días`;
}

/**
 * Lo que la alerta ya dice de un chat en sus hechos ("Chat <id>: 45 min laborales, dijo "...".").
 * Se lee del texto porque así lo guardan los detectores; no se cambia lo que guardan.
 */
export function loQueDiceLaAlerta(hallazgos: Hallazgo[], conversationId: string): { frase: string | null; esperando: string | null } {
  for (const h of hallazgos) {
    const linea = (h.hechos ?? []).find((x) => x.startsWith(`Chat ${conversationId}:`));
    if (!linea) continue;
    const resto = linea.slice(`Chat ${conversationId}:`.length);
    const comillas = [...resto.matchAll(/"([^"]*)"/g)].map((m) => m[1]).filter((x) => x.trim());
    const laborales = resto.match(/(\d+) min laborales/);
    const minutos = resto.match(/(\d+) min\b/);
    const horas = resto.match(/callado hace (\d+) h/);
    const esperando = laborales
      ? `${laborales[1]} min laborales`
      : horas
        ? `${horas[1]} h`
        : minutos
          ? duracion(Number(minutos[1]))
          : null;
    return { frase: recortar(comillas.at(-1)), esperando };
  }
  return { frase: null, esperando: null };
}

/** Los ids de chats de la alerta, sin repetir y en el orden en que los guardó el detector. */
export function idsDeChatsDeLaAlerta(hallazgos: Hallazgo[], max = MAX_CHATS_POR_ALERTA): string[] {
  const ids = new Set<string>();
  for (const h of hallazgos) for (const id of h.evidencia?.chats ?? []) if (id) ids.add(id);
  return [...ids].slice(0, max);
}

/** La fila que se muestra por chat. `datos` = undefined cuando el chat no existe (o es de otro negocio). */
export function filaDelChat(input: {
  conversationId: string;
  hallazgos: Hallazgo[];
  datos: DatosDelChat | undefined;
  ahora: Date;
}): FilaDeChatDeAlerta {
  const { conversationId, datos } = input;
  const alerta = loQueDiceLaAlerta(input.hallazgos, conversationId);
  if (!datos) {
    return {
      conversationId,
      encontrado: false,
      nombre: "Chat no encontrado",
      telefono: "",
      asesora: null,
      frase: alerta.frase,
      esperando: null,
      href: null,
    };
  }
  let esperando = alerta.esperando;
  if (!esperando && datos.ultimoClienteEn) {
    const sinRespuesta = !datos.ultimaRespuestaHumanaEn || datos.ultimoClienteEn.getTime() > datos.ultimaRespuestaHumanaEn.getTime();
    const minutos = Math.floor((input.ahora.getTime() - datos.ultimoClienteEn.getTime()) / MIN);
    if (sinRespuesta && minutos >= 0) esperando = duracion(minutos);
  }
  return {
    conversationId,
    encontrado: true,
    nombre: nombreVisible(datos.nombre) ?? "Cliente sin nombre",
    telefono: telefonoOculto(datos.telefono),
    asesora: datos.asesoraNombre?.trim() || null,
    frase: alerta.frase ?? recortar(datos.ultimoTextoCliente),
    esperando,
    href: enlaceAlChat(conversationId),
  };
}

export function filasDeLaAlerta(input: {
  hallazgos: Hallazgo[];
  datosPorChat: Map<string, DatosDelChat>;
  ahora: Date;
  max?: number;
}): FilaDeChatDeAlerta[] {
  return idsDeChatsDeLaAlerta(input.hallazgos, input.max).map((conversationId) =>
    filaDelChat({ conversationId, hallazgos: input.hallazgos, datos: input.datosPorChat.get(conversationId), ahora: input.ahora }),
  );
}

/** Cómo se nombra un chat dentro del texto largo de la alerta, en vez de su id. */
export function etiquetaDelChat(fila: FilaDeChatDeAlerta): string {
  if (!fila.encontrado) return "(chat no encontrado)";
  return fila.telefono ? `${fila.nombre} (${fila.telefono})` : fila.nombre;
}

/** El texto guardado de la alerta, con los ids de los chats cambiados por nombre y teléfono tapado. */
export function textoSinIds(texto: string, filas: FilaDeChatDeAlerta[]): string {
  let salida = texto;
  for (const fila of filas) {
    if (!fila.conversationId) continue;
    salida = salida.split(fila.conversationId).join(etiquetaDelChat(fila));
  }
  return salida;
}
