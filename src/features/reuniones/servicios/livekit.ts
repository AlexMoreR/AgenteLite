import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/*
  LIVEKIT, el servidor de video de las reuniones (autoalojado, Apache 2.0).

  Todo lo que el CRM le pide a LiveKit pasa por acá, con las tres variables del servicio:
  - LIVEKIT_URL: la dirección wss que usa el navegador (wss://video.magilus.com);
  - LIVEKIT_API_KEY y LIVEKIT_API_SECRET: el par de claves. El secreto nunca sale del servidor.
  Si LiveKit se muda a otro VPS, solo cambian esas tres variables.

  No usa livekit-server-sdk: lo que hace falta son tres cosas chicas que se escriben con node:crypto
  y fetch (el pase de entrada es un JWT HS256, los avisos llegan firmados con otro JWT y la API es
  Twirp con JSON), y así no se suma una dependencia al servidor.
*/

export type ConfigLivekit = {
  /** wss://... para el navegador. */
  url: string;
  /** https://... para la API del servidor (la misma dirección). */
  urlApi: string;
  apiKey: string;
  apiSecret: string;
};

/** La sala espera 10 minutos vacía antes de cerrarse (también si alguien se cae y vuelve). */
export const SALA_VACIA_SEGUNDOS = 10 * 60;
/** El pase de entrada dura 10 minutos: solo sirve para entrar; adentro LiveKit lo renueva solo. */
export const PASE_SEGUNDOS = 10 * 60;
const TOPE_DE_PERSONAS = 12;

export function leerConfigLivekit(): ConfigLivekit | null {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) {
    return null;
  }
  return { url, urlApi: urlDeLaApi(url), apiKey, apiSecret };
}

/** wss://video.x.com -> https://video.x.com (ws:// -> http:// en local). */
export function urlDeLaApi(url: string): string {
  return url.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------------------------
// JWT HS256
// ---------------------------------------------------------------------------------------------

const base64url = (datos: Buffer | string) => Buffer.from(datos).toString("base64url");

export function firmarJwt(cuerpo: Record<string, unknown>, secreto: string): string {
  const cabecera = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const datos = base64url(JSON.stringify(cuerpo));
  const firma = createHmac("sha256", secreto).update(`${cabecera}.${datos}`).digest("base64url");
  return `${cabecera}.${datos}.${firma}`;
}

/** Devuelve el cuerpo del JWT si la firma y las fechas están bien; si no, null. */
export function verificarJwt(token: string, secreto: string, ahoraMs = Date.now()): Record<string, unknown> | null {
  const partes = token.split(".");
  if (partes.length !== 3) {
    return null;
  }
  const [cabecera, datos, firma] = partes;
  let encabezado: { alg?: unknown };
  let cuerpo: Record<string, unknown>;
  try {
    encabezado = JSON.parse(Buffer.from(cabecera, "base64url").toString("utf8"));
    cuerpo = JSON.parse(Buffer.from(datos, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (encabezado.alg !== "HS256" || !cuerpo || typeof cuerpo !== "object") {
    return null;
  }
  const esperada = Buffer.from(createHmac("sha256", secreto).update(`${cabecera}.${datos}`).digest("base64url"));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
    return null;
  }
  const ahora = Math.floor(ahoraMs / 1000);
  // Un minuto de margen por relojes que no están parejos.
  if (typeof cuerpo.exp === "number" && cuerpo.exp + 60 < ahora) {
    return null;
  }
  if (typeof cuerpo.nbf === "number" && cuerpo.nbf - 60 > ahora) {
    return null;
  }
  return cuerpo;
}

type Permisos = Record<string, unknown>;

function tokenDeLaApi(config: ConfigLivekit, permisos: Permisos): string {
  const ahora = Math.floor(Date.now() / 1000);
  return firmarJwt({ iss: config.apiKey, nbf: ahora - 5, exp: ahora + 60, jti: randomUUID(), video: permisos }, config.apiSecret);
}

// ---------------------------------------------------------------------------------------------
// Pase de entrada
// ---------------------------------------------------------------------------------------------

/**
 * El pase para entrar a la sala. Deja publicar el micrófono y la pantalla (con su audio), no la
 * cámara; el dueño y los invitados usan el mismo pase. Nadie recibe permiso de grabar (roomRecord) ni de administrar
 * (roomAdmin): la grabación la pide el servidor y "Terminar reunión" pasa por el CRM, que revisa
 * quién lo pide.
 */
export function crearPaseDeEntrada(
  config: Pick<ConfigLivekit, "apiKey" | "apiSecret">,
  datos: { sala: string; identidad: string; nombre: string; ahoraMs?: number },
): string {
  const ahora = Math.floor((datos.ahoraMs ?? Date.now()) / 1000);
  return firmarJwt(
    {
      iss: config.apiKey,
      sub: datos.identidad,
      name: datos.nombre,
      nbf: ahora - 5,
      exp: ahora + PASE_SEGUNDOS,
      jti: datos.identidad,
      video: {
        room: datos.sala,
        roomJoin: true,
        canPublish: true,
        // Micrófono y pantalla (con su audio): la cámara sigue sin permiso.
        canPublishSources: ["microphone", "screen_share", "screen_share_audio"],
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: false,
      },
    },
    config.apiSecret,
  );
}

// ---------------------------------------------------------------------------------------------
// Avisos (webhook) de LiveKit
// ---------------------------------------------------------------------------------------------

/**
 * Comprueba un aviso de LiveKit: llega con `Authorization: <JWT>` firmado con el secreto, emitido
 * por nuestra clave, y con el sha256 del cuerpo adentro (así no se puede cambiar el cuerpo).
 */
export function verificarAvisoDeLivekit(
  cuerpo: string,
  autorizacion: string | null,
  config: Pick<ConfigLivekit, "apiKey" | "apiSecret">,
  ahoraMs = Date.now(),
): boolean {
  const token = autorizacion?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return false;
  }
  const datos = verificarJwt(token, config.apiSecret, ahoraMs);
  // Sin vencimiento no se acepta: un aviso capturado no puede repetirse para siempre.
  if (!datos || datos.iss !== config.apiKey || typeof datos.sha256 !== "string" || typeof datos.exp !== "number") {
    return false;
  }
  const hash = createHash("sha256").update(cuerpo, "utf8").digest("base64");
  // LiveKit lo manda en base64 estándar; se acepta también sin relleno o en base64url.
  const normalizar = (valor: string) => valor.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  return normalizar(datos.sha256) === normalizar(hash);
}

// ---------------------------------------------------------------------------------------------
// API del servidor (Twirp con JSON)
// ---------------------------------------------------------------------------------------------

async function llamarApi<T>(config: ConfigLivekit, servicio: string, metodo: string, cuerpo: unknown, permisos: Permisos): Promise<T> {
  const respuesta = await fetch(`${config.urlApi}/twirp/livekit.${servicio}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenDeLaApi(config, permisos)}` },
    body: JSON.stringify(cuerpo),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) {
    throw new Error(`LiveKit ${metodo} respondió ${respuesta.status}: ${texto.slice(0, 200)}`);
  }
  return (texto ? JSON.parse(texto) : {}) as T;
}

/** Crea la sala (si ya existe, LiveKit devuelve la misma). Espera 10 minutos vacía. */
export async function crearSala(config: ConfigLivekit, sala: string) {
  await llamarApi(
    config,
    "RoomService",
    "CreateRoom",
    { name: sala, emptyTimeout: SALA_VACIA_SEGUNDOS, departureTimeout: SALA_VACIA_SEGUNDOS, maxParticipants: TOPE_DE_PERSONAS },
    { roomCreate: true },
  );
}

/** Cierra la sala para todos ("Terminar reunión"). */
export async function cerrarSala(config: ConfigLivekit, sala: string) {
  try {
    await llamarApi(config, "RoomService", "DeleteRoom", { room: sala }, { roomCreate: true });
  } catch (error) {
    // Si la sala ya no existe, ya está cerrada: no es un error.
    if (!/404|not.?found/i.test(error instanceof Error ? error.message : "")) {
      throw error;
    }
  }
}

/** Si la sala sigue abierta en LiveKit. */
export async function salaAbierta(config: ConfigLivekit, sala: string): Promise<boolean> {
  const respuesta = await llamarApi<{ rooms?: Array<{ name?: string }> }>(
    config,
    "RoomService",
    "ListRooms",
    { names: [sala] },
    { roomList: true },
  );
  return (respuesta.rooms ?? []).some((uno) => uno.name === sala);
}

/**
 * Pide a Egress que grabe UNA pista de audio tal cual llega (opus en .ogg), sin Chrome: es muy
 * liviano y deja una pista por persona, así se sabe quién habló sin IA extra.
 */
export async function grabarPista(config: ConfigLivekit, datos: { sala: string; trackSid: string; archivo: string }) {
  const respuesta = await llamarApi<{ egressId?: string; egress_id?: string }>(
    config,
    "Egress",
    "StartTrackEgress",
    { roomName: datos.sala, trackId: datos.trackSid, file: { filepath: datos.archivo } },
    { room: datos.sala, roomRecord: true },
  );
  const egressId = respuesta.egressId ?? respuesta.egress_id;
  if (!egressId) {
    throw new Error("LiveKit no devolvió el id de la grabación.");
  }
  return egressId;
}
