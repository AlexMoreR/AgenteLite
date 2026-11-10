import type { NombreDeRutaDeEnvio } from "./ruta-de-envio";

/*
  Lo que usa la pantalla para mandar por las rutas fijas de envio del chat (despliegue ii del plan
  "envios por rutas fijas"; contrato en src/lib/chats/ruta-de-envio.ts).

  Antes el envio final de archivos, audios, ubicacion, flujos, reenvios y reacciones era una Server
  Action: su id cambia en cada build, y una pestaña abierta antes de un despliegue fallaba ("Failed to
  find Server Action") hasta recargar. Una ruta fija no cambia entre versiones.

  Cada funcion recibe EXACTAMENTE la misma entrada que la accion y devuelve lo mismo que ella:
  - Si el servidor contesto (200, 400, 401, 403 o 413) con `ok` o `error`, se devuelve ese cuerpo tal
    cual, igual que antes devolvia la accion.
  - Si no hubo respuesta, vencio el tiempo, contesto 500 (la accion lanzo) o llego algo raro (el HTML
    de un proxy), LANZA. La accion tambien lanzaba en esos casos: los `catch` de la pantalla siguen
    iguales ("pudo haber salido", el unico reintento de la nota de voz).

  Sin imports de verdad (solo tipos): se prueba con Node en scripts/check-enviar-por-ruta.mjs.
*/

// El servidor corta al gateway a los 25 s; esto es solo para no esperar para siempre.
export const LIMITE_ESPERA_RUTA_MS = 60_000;

const STATUS_QUE_CONTESTA_LA_RUTA = new Set([200, 400, 401, 403, 413]);

export type ResultadoDeEnvio = { ok: true } | { error: string };

export type EntradaDeArchivo = {
  source: string;
  conversationId: string;
  agentId?: string;
  mediaUrl: string;
  mediaType: "IMAGE" | "VIDEO" | "DOCUMENT";
  fileName: string;
  mimeType: string;
  caption?: string;
  returnTo?: string;
};

export type EntradaDeAudio = {
  source: string;
  conversationId: string;
  agentId?: string;
  audioUrl: string;
  returnTo?: string;
};

export type EntradaDeUbicacion = {
  conversationId: string;
  agentId?: string;
  returnTo?: string;
};

export type EntradaDeFlujo = {
  source: "agent" | "official";
  conversationId: string;
  flowId: string;
  agentId?: string;
};

// El mismo SendFlowResult de flow-send-actions.ts (no se importa: este archivo no toca el servidor).
export type ResultadoDeFlujo =
  | { ok: true; enviados: number; fallidos: number; omitidos: number }
  | { ok: false; error: string };

export type ResultadoDeReaccion = { ok: boolean; error?: string };

export type ResultadoDeTexto = { ok?: boolean; error?: string };

/** La ruta no dio una respuesta de la accion: se lanza, como lanzaba la Server Action. */
export class EnvioSinRespuesta extends Error {
  status: number | null;
  constructor(ruta: string, status: number | null) {
    super(`[chats/${ruta}] sin respuesta del envio${status === null ? "" : ` (status ${status})`}`);
    this.name = "EnvioSinRespuesta";
    this.status = status;
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Lo que contesto la ruta, leido como antes se leia lo que devolvia la accion. Puro: se prueba solo. */
export function leerRespuestaDeRuta<T>(ruta: string, status: number, cuerpo: unknown): T {
  if (STATUS_QUE_CONTESTA_LA_RUTA.has(status) && esObjeto(cuerpo) && ("ok" in cuerpo || "error" in cuerpo)) {
    return cuerpo as T;
  }
  throw new EnvioSinRespuesta(ruta, status);
}

async function pedirALaRuta<T>(
  ruta: NombreDeRutaDeEnvio | "enviar",
  cuerpo: string | FormData,
  limiteMs: number | null,
): Promise<T> {
  const respuesta = await fetch(`/api/cliente/chats/${ruta}`, {
    method: "POST",
    body: cuerpo,
    ...(typeof cuerpo === "string" ? { headers: { "Content-Type": "application/json" } } : {}),
    credentials: "same-origin",
    cache: "no-store",
    ...(limiteMs === null ? {} : { signal: AbortSignal.timeout(limiteMs) }),
  });
  const datos = await respuesta.json().catch(() => null);
  return leerRespuestaDeRuta<T>(ruta, respuesta.status, datos);
}

// Los campos undefined no viajan en JSON; la accion los lee igual (opcionales en su zod).
export function enviarArchivoPorRuta(entrada: EntradaDeArchivo) {
  return pedirALaRuta<ResultadoDeEnvio>("enviar-archivo", JSON.stringify(entrada), LIMITE_ESPERA_RUTA_MS);
}

export function enviarAudioPorRuta(entrada: EntradaDeAudio) {
  return pedirALaRuta<ResultadoDeEnvio>("enviar-audio", JSON.stringify(entrada), LIMITE_ESPERA_RUTA_MS);
}

export function enviarUbicacionPorRuta(entrada: EntradaDeUbicacion) {
  return pedirALaRuta<ResultadoDeEnvio>("enviar-ubicacion", JSON.stringify(entrada), LIMITE_ESPERA_RUTA_MS);
}

// Sin limite de tiempo: el flujo hace pausas entre pasos, igual que con la accion.
export function enviarFlujoPorRuta(entrada: EntradaDeFlujo) {
  return pedirALaRuta<ResultadoDeFlujo>("enviar-flujo", JSON.stringify(entrada), null);
}

export function reaccionarPorRuta(entrada: { messageId: string; emoji: string }) {
  return pedirALaRuta<ResultadoDeReaccion>("reaccionar", JSON.stringify(entrada), LIMITE_ESPERA_RUTA_MS);
}

/** Texto suelto (reenviar) por la ruta que ya existe, /api/cliente/chats/enviar, con el mismo FormData. */
export function enviarTextoSimplePorRuta(datos: FormData) {
  return pedirALaRuta<ResultadoDeTexto>("enviar", datos, LIMITE_ESPERA_RUTA_MS);
}
