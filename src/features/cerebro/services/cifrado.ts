import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
  CEREBRO: cifrado del permiso de Google y firma del "state" del inicio de sesión.

  La clave sale de CEREBRO_CLAVE_CIFRADO (se pone en el servidor; nunca en el código). Con ella se cifra el
  permiso de Google (AES-256-GCM) antes de guardarlo y se firma el state de OAuth para que nadie pueda
  inventar un regreso de Google.
*/

export function claveDeCifrado(secreto = process.env.CEREBRO_CLAVE_CIFRADO): Buffer {
  const texto = secreto?.trim();
  if (!texto || texto.length < 16) {
    throw new Error("Falta CEREBRO_CLAVE_CIFRADO en el servidor (mínimo 16 caracteres).");
  }
  return createHash("sha256").update(texto).digest();
}

/** Texto cifrado como `v1.<iv>.<etiqueta>.<datos>` en base64url. */
export function cifrar(texto: string, clave = claveDeCifrado()): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", clave, iv);
  const datos = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const etiqueta = cifrador.getAuthTag();
  return ["v1", iv.toString("base64url"), etiqueta.toString("base64url"), datos.toString("base64url")].join(".");
}

export function descifrar(cifrado: string, clave = claveDeCifrado()): string {
  const [version, iv, etiqueta, datos] = cifrado.split(".");
  if (version !== "v1" || !iv || !etiqueta || !datos) throw new Error("El permiso guardado no se puede leer.");
  const descifrador = createDecipheriv("aes-256-gcm", clave, Buffer.from(iv, "base64url"));
  descifrador.setAuthTag(Buffer.from(etiqueta, "base64url"));
  return Buffer.concat([descifrador.update(Buffer.from(datos, "base64url")), descifrador.final()]).toString("utf8");
}

export type EstadoDeOAuth = { workspaceId: string; userId: string; vence: number };

/** El state del inicio de sesión: firmado y con vencimiento (15 minutos). */
export function firmarEstado(datos: Omit<EstadoDeOAuth, "vence">, ahora = Date.now(), clave = claveDeCifrado()): string {
  const cuerpo = Buffer.from(JSON.stringify({ ...datos, vence: ahora + 15 * 60_000 })).toString("base64url");
  const firma = createHmac("sha256", clave).update(cuerpo).digest("base64url");
  return `${cuerpo}.${firma}`;
}

export function verificarEstado(estado: string | null | undefined, ahora = Date.now(), clave = claveDeCifrado()): EstadoDeOAuth | null {
  if (!estado) return null;
  const [cuerpo, firma] = estado.split(".");
  if (!cuerpo || !firma) return null;
  const esperada = createHmac("sha256", clave).update(cuerpo).digest("base64url");
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as EstadoDeOAuth;
    if (typeof datos.workspaceId !== "string" || typeof datos.userId !== "string" || typeof datos.vence !== "number") return null;
    return datos.vence >= ahora ? datos : null;
  } catch {
    return null;
  }
}
