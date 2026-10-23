import { createHmac, timingSafeEqual } from "node:crypto";

/*
  LINKS FIRMADOS para escuchar los audios de las reuniones.

  Los audios nunca quedan en una carpeta pública: se escuchan por /api/reuniones/audio/<pista> con
  una firma que vence en 1 hora. La firma es un HMAC del id de la pista y la hora de vencimiento:
  cambiar cualquiera de los dos la invalida.
*/

export const LINK_DURA_MS = 60 * 60 * 1000;

/** El secreto de las firmas: el de la sesión del CRM, que ya existe y nunca sale del servidor. */
export function secretoDeLosLinks(): string | null {
  return process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || null;
}

function firmar(pistaId: string, venceMs: number, secreto: string) {
  return createHmac("sha256", secreto).update(`reunion-audio:${pistaId}:${venceMs}`).digest("base64url");
}

/** El vencimiento va redondeado a 10 minutos: la pantalla se refresca sola y así el link no cambia (ni corta el audio que suena). */
const REDONDEO_MS = 10 * 60 * 1000;

export function linkFirmado(pistaId: string, secreto: string, ahoraMs = Date.now()): string {
  const vence = Math.floor((ahoraMs + LINK_DURA_MS) / REDONDEO_MS) * REDONDEO_MS;
  return `/api/reuniones/audio/${encodeURIComponent(pistaId)}?vence=${vence}&firma=${firmar(pistaId, vence, secreto)}`;
}

export function linkFirmadoValido(
  pistaId: string,
  vence: string | null,
  firma: string | null,
  secreto: string,
  ahoraMs = Date.now(),
): boolean {
  const venceMs = Number(vence);
  if (!firma || !Number.isFinite(venceMs) || venceMs < ahoraMs) {
    return false;
  }
  // Un link no puede durar más de 1 hora desde ahora, aunque alguien invente una fecha lejana.
  if (venceMs > ahoraMs + LINK_DURA_MS + 60_000) {
    return false;
  }
  const esperada = Buffer.from(firmar(pistaId, venceMs, secreto));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/*
  La identidad de un invitado (i_<azar>) vuelve firmada: así, si se cae y vuelve, entra como la misma
  persona, pero nadie puede entrar con la identidad de otro (que se ve en la sala) y sacarlo.
*/
function firmarIdentidad(identidad: string, secreto: string) {
  return createHmac("sha256", secreto).update(`reunion-identidad:${identidad}`).digest("base64url").slice(0, 22);
}

export function identidadFirmada(identidad: string, secreto: string): string {
  return `${identidad}.${firmarIdentidad(identidad, secreto)}`;
}

/** La identidad si la firma es buena; si no, null. */
export function leerIdentidadFirmada(valor: string, secreto: string): string | null {
  const punto = valor.lastIndexOf(".");
  if (punto <= 0) {
    return null;
  }
  const identidad = valor.slice(0, punto);
  const esperada = Buffer.from(firmarIdentidad(identidad, secreto));
  const recibida = Buffer.from(valor.slice(punto + 1));
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida) ? identidad : null;
}
