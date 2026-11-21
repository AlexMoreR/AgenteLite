/**
 * El aviso de llamada ENTRANTE dentro del navegador (parte 3 de "Llamadas entrantes en la PWA").
 *
 * El servidor lo manda en vivo como `type: "llamada-entrante"` (avisar-llamada-entrante.ts). El
 * altavoz de la app (chats-official-realtime.tsx) lo recibe y, si quien mira no esta en
 * `noSeEnteran`, lo reparte con este evento del navegador. Quien lo escucha es la pantalla de
 * llamada entrante (LlamadaEntrante.tsx), montada una sola vez en LlamadaEnCursoProvider.
 */

export const EVENTO_LLAMADA_ENTRANTE = "aizen:llamada-entrante";

export type EstadoDeLlamadaEntrante = "sonando" | "contestada" | "terminada";

export type AvisoDeLlamadaEntrante = {
  estado: EstadoDeLlamadaEntrante;
  llamadaId: string;
  /** El nombre de la ficha; null si el número no tiene ficha. */
  nombre: string | null;
  /** Solo dígitos. */
  numero: string;
  foto: string | null;
  conversacionId: string | null;
  href: string | null;
};

const ESTADOS = new Set<EstadoDeLlamadaEntrante>(["sonando", "contestada", "terminada"]);

function texto(valor: unknown, largoMaximo = 512): string | null {
  return typeof valor === "string" && valor.trim() && valor.length <= largoMaximo ? valor.trim() : null;
}

/**
 * Lee el aviso que llega por el altavoz. Lo que no tiene estado o id de llamada se ignora (null):
 * mejor no timbrar que timbrar con datos rotos.
 */
export function leerAvisoDeLlamadaEntrante(datos: unknown): AvisoDeLlamadaEntrante | null {
  if (!datos || typeof datos !== "object") {
    return null;
  }
  const fila = datos as Record<string, unknown>;
  const estado = fila.estado as EstadoDeLlamadaEntrante;
  const llamadaId = texto(fila.llamadaId, 128);
  if (!ESTADOS.has(estado) || !llamadaId) {
    return null;
  }
  const href = texto(fila.href, 1024);
  return {
    estado,
    llamadaId,
    nombre: texto(fila.nombre),
    numero: (texto(fila.numero, 32) ?? "").replace(/\D/g, ""),
    foto: texto(fila.foto, 2048),
    conversacionId: texto(fila.conversacionId, 128),
    // Solo enlaces del propio CRM: nunca se navega a otro sitio con un dato que viene de afuera.
    href: href && href.startsWith("/cliente/") ? href : null,
  };
}

/** Lo que se muestra del cliente: el nombre de su ficha o, si no tiene, el número. */
export function clienteDeLaLlamada(aviso: Pick<AvisoDeLlamadaEntrante, "nombre" | "numero">): string {
  return aviso.nombre || (aviso.numero ? `+${aviso.numero}` : "Número desconocido");
}
