import { anotarLlamadaExterna } from "@/lib/medicion-de-pedido";
/**
 * Cliente de WAHA, el tercer gateway de WhatsApp.
 *
 * Vive APARTE de evolution.ts a proposito. Ese archivo tiene 2900 lineas y una logica de
 * reintentos entre dos dialectos (evogo y Evolution API) que hoy mueve toda la plata del negocio;
 * meterle un tercer dialecto adentro era la forma mas rapida de romper lo que ya funciona.
 *
 * Aca esta todo lo de WAHA, sin tocar nada de lo otro. evolution.ts solo delega en la puerta de
 * entrada de cada operacion: si el canal es WAHA, se viene para aca y no entra nunca a la logica
 * de los otros dos.
 *
 * Los contratos NO salen de la documentacion: salen de consultarle el OpenAPI al servidor real.
 * La documentacion ya nos mintio una vez (dice que /health no pide clave y si la pide).
 */

/** Como se identifica este gateway en `WhatsAppChannel.metadata.gateway.kind`. */
export const WAHA_GATEWAY_KIND = "WAHA" as const;

export type WahaConnection = {
  baseUrl: string;
  apiToken: string;
};

/**
 * Estados que devuelve WAHA para una sesion.
 *
 * WORKING es el unico que significa "puede enviar y recibir". SCAN_QR_CODE quiere decir que
 * espera que alguien escanee; STARTING que esta levantando; STOPPED y FAILED que no hay sesion.
 */
export type WahaSessionStatus =
  | "STOPPED"
  | "STARTING"
  | "SCAN_QR_CODE"
  | "WORKING"
  | "FAILED";

export type WahaSession = {
  name: string;
  status: WahaSessionStatus | string;
  config?: {
    webhooks?: Array<{ url?: string; events?: string[] }>;
  } | null;
  /** Datos del numero conectado. Null mientras no haya sesion. */
  me: {
    id?: string;
    pushName?: string;
    /** WAHA entrega el LID directo, sin tener que resolverlo aparte como en evogo. */
    lid?: string;
    jid?: string;
  } | null;
};

class WahaError extends Error {
  readonly status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = "WahaError";
    this.status = status;
  }
}

/** Cuanto se espera a WAHA antes de cortar. Sin limite, un gateway colgado cuelga la pantalla. */
const TIMEOUT_MS = 20_000;

/*
  Los envios de media tienen su propio plazo, mucho mas largo.

  20 segundos alcanzan para preguntar el estado de una sesion, pero no para mandar un archivo:
  WAHA lo descarga de nuestro servidor, lo CONVIERTE con ffmpeg (los videos van con convert: true,
  sin eso los rechaza) y recien ahi lo sube a WhatsApp. Un video de 85 MB no entra ni cerca en 20
  segundos.

  Caso real (3-sep-2026): 1001685636.mp4, 85 MB. La subida al servidor termino bien y el envio
  murio con "The operation was aborted due to timeout" -el plazo nuestro, no un rechazo de
  WhatsApp-.
*/
const TIMEOUT_MEDIA_MS = 300_000;

/**
 * Los eventos que le pedimos a WAHA.
 *
 * `message.ack` es el doble check: sin el sabemos que WhatsApp acepto el mensaje, pero no si le
 * llego al cliente ni si lo leyo. Es exactamente el dato que falto para diagnosticar la caida del
 * 28-ago, donde todo "figuraba enviado".
 */
/*
  `message.any` en vez de `message`: son el MISMO mensaje dos veces.

  `message` trae lo que entra y `message.any` trae lo que entra Y lo que sale, asi que pidiendo
  los dos cada mensaje del cliente llegaba dos veces: se procesaba dos veces y el equipo recibia
  DOS notificaciones identicas por cada mensaje (el "sonido doble"). Con `message.any` solo no se
  pierde nada: sigue trayendo lo que escriben las asesoras desde el celular.

  `presence.update` es el "escribiendo..." y el "grabando audio". Faltaba, asi que en las lineas
  nuevas no aparecia nunca -solo lo tenian dos sesiones viejas configuradas a mano-.
*/
const EVENTOS = [
  "message.any",
  "message.ack",
  "message.reaction",
  "session.status",
  "presence.update",
  // Sin estos dos, lo que el cliente editaba o borraba en su WhatsApp seguia igual en el CRM.
  "message.edited",
  "message.revoked",
] as const;

/** El nombre corto de una ruta de WAHA para medirla: "/api/sendText" -> "sendText", ".../messages/read" -> "read". */
function nombreDeLaRuta(path: string): string {
  const sinConsulta = path.split("?")[0] ?? "";
  const partes = sinConsulta.split("/").filter(Boolean);
  if (partes.includes("lids")) return "lids";
  return (partes[partes.length - 1] ?? "otro").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "otro";
}

/** Mas de esto en una llamada a WAHA queda en el log del servidor ("[waha lento]"). */
const WAHA_LENTO_MS = 1500;

async function wahaRequest<T>(
  connection: WahaConnection,
  path: string,
  init?: RequestInit & { esperaJson?: boolean; timeoutMs?: number },
): Promise<T> {
  const inicio = performance.now();
  try {
    return await wahaRequestSinMedir<T>(connection, path, init);
  } finally {
    /*
      Medir cada llamada (velocidad, 11-nov-2026): un texto tardaba 6 s y no se sabia en cual de las
      cuatro llamadas a WAHA. Va en el Server-Timing de la ruta y, si es lenta, en el log.
    */
    const ms = performance.now() - inicio;
    const nombre = nombreDeLaRuta(path);
    anotarLlamadaExterna(`waha_${nombre}`, ms);
    if (ms > WAHA_LENTO_MS) {
      console.warn(`[waha lento] ${JSON.stringify({ ruta: nombre, ms: Math.round(ms) })}`);
    }
  }
}

async function wahaRequestSinMedir<T>(
  connection: WahaConnection,
  path: string,
  init?: RequestInit & { esperaJson?: boolean; timeoutMs?: number },
): Promise<T> {
  const baseUrl = connection.baseUrl.replace(/\/+$/, "");
  if (!baseUrl || !connection.apiToken) {
    throw new Error("La conexion de WAHA no esta completa (falta URL o clave)");
  }

  const respuesta = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      // X-Api-Key, NO `apikey`: es el header de WAHA y lo pide en TODAS las rutas, /health
      // incluida (ahi se nos fue un healthcheck que reiniciaba el contenedor en bucle).
      "X-Api-Key": connection.apiToken,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(init?.timeoutMs ?? TIMEOUT_MS),
  });

  const texto = await respuesta.text().catch(() => "");
  if (!respuesta.ok) {
    throw new WahaError(respuesta.status, texto || `WAHA respondio ${respuesta.status}`);
  }
  if (!texto) {
    return undefined as T;
  }
  try {
    return JSON.parse(texto) as T;
  } catch {
    return texto as T;
  }
}

/**
 * A donde tiene que avisar WAHA cuando entra un mensaje.
 *
 * Se arma desde el origen publico de la app. Si no hay ninguno configurado se devuelve vacio y la
 * sesion se crea SIN webhook: preferimos una sesion que conecta y no avisa -visible y facil de
 * arreglar- a una que no arranca por una variable de entorno faltante.
 */
export function urlDeWebhookWaha(): string {
  const origen = [
    process.env.BACKEND_ENV,
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ]
    .map((valor) => valor?.trim().replace(/\/+$/, "") ?? "")
    .find((valor) => valor.startsWith("http"));

  if (!origen) {
    return "";
  }
  const url = new URL(`${origen}/api/webhooks/waha`);
  const secreto = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (secreto) {
    url.searchParams.set("token", secreto);
  }
  return url.toString();
}

/* ------------------------------------------------------------------ sesiones */

/** Trae la sesion. Devuelve null si no existe todavia (404), que no es un error. */
export async function leerSesionWaha(
  connection: WahaConnection,
  sesion: string,
): Promise<WahaSession | null> {
  try {
    return await wahaRequest<WahaSession>(connection, `/api/sessions/${encodeURIComponent(sesion)}`);
  } catch (error) {
    if (error instanceof WahaError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Deja la sesion creada y arrancada.
 *
 * Es idempotente a proposito: se llama al crear el canal y tambien cada vez que alguien abre la
 * pantalla de conexion. Si ya existe se la arranca, y si ya estaba andando no se toca -reiniciar
 * una sesion viva desconecta el WhatsApp de alguien que estaba trabajando.
 */
export async function asegurarSesionWaha(input: {
  connection: WahaConnection;
  sesion: string;
  webhookUrl?: string | null;
}): Promise<WahaSession | null> {
  const existente = await leerSesionWaha(input.connection, input.sesion);

  if (!existente) {
    await wahaRequest(input.connection, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        name: input.sesion,
        start: true,
        config: {
          /*
            El webhook se define POR SESION, no global.

            Es la mejora concreta sobre evogo, donde todo cae por un solo cano y hay que deducir
            de quien es cada mensaje. Aca cada linea avisa por su propia URL.
          */
          webhooks: input.webhookUrl
            ? [{ url: input.webhookUrl, events: [...EVENTOS] }]
            : [],
        },
      }),
    });
    return leerSesionWaha(input.connection, input.sesion);
  }

  await sincronizarWebhookUnaVez(input.connection, existente, input.webhookUrl ?? "");

  if (existente.status === "STOPPED" || existente.status === "FAILED") {
    const ahora = Date.now();
    const ultimo = ultimoIntentoDeLevantar.get(input.sesion) ?? 0;
    // Se le da tiempo a levantarse antes de volver a insistir.
    if (ahora - ultimo < ESPERA_ENTRE_INTENTOS_MS) {
      return existente;
    }
    ultimoIntentoDeLevantar.set(input.sesion, ahora);

    /*
      DETENER y despues arrancar. Arrancar solo NO alcanza.

      Con una sesion en FAILED, WAHA contesta "Session is already running": para el, el objeto
      sigue vivo aunque el cliente de WhatsApp se haya caido. El /start no hace nada y la sesion
      queda tildada para siempre, pidiendo un QR que no llega nunca. Solo el stop la desarma de
      verdad. Le paso a Admin, y desde afuera se veia como "WhatsApp no deja conectar".
    */
    await wahaRequest(input.connection, `/api/sessions/${encodeURIComponent(input.sesion)}/stop`, {
      method: "POST",
    }).catch(() => null);
    await new Promise((listo) => setTimeout(listo, 2000));

    await wahaRequest(input.connection, `/api/sessions/${encodeURIComponent(input.sesion)}/start`, {
      method: "POST",
    });
    return leerSesionWaha(input.connection, input.sesion);
  }

  return existente;
}

/**
 * Sesiones a las que ya intentamos corregirle la suscripcion en esta corrida.
 *
 * El candado es la parte importante. `asegurarSesionWaha` se llama en CADA consulta de la pantalla
 * de conexion, y actualizar la config de una sesion la reinicia; si nuestra comparacion no
 * coincidiera nunca con lo que WAHA guarda, estariamos reiniciando la linea cada pocos segundos.
 * Ese es exactamente el bucle que ya nos comimos con el healthcheck. Un intento por proceso: si
 * no alcanza, se reintenta en el proximo despliegue y mientras tanto nada se rompe.
 */
const webhookYaSincronizado = new Set<string>();

/**
 * Cuando se intento levantar cada sesion por ultima vez.
 *
 * La pantalla del QR pregunta cada ~3 segundos, y en cada pregunta se pasaba por aca. Con una
 * sesion caida eso disparaba un /start cada 3 segundos: un reinicio en medio del emparejamiento lo
 * corta, asi que la sesion NUNCA llegaba a estabilizarse y el QR no aparecia jamas. Le paso a
 * Admin: se veia como "no deja conectar", y en realidad la estabamos pisando nosotros.
 */
const ultimoIntentoDeLevantar = new Map<string, number>();
const ESPERA_ENTRE_INTENTOS_MS = 30_000;

async function sincronizarWebhookUnaVez(
  connection: WahaConnection,
  sesion: WahaSession,
  webhookUrl: string,
): Promise<void> {
  if (!webhookUrl || webhookYaSincronizado.has(sesion.name)) {
    return;
  }
  webhookYaSincronizado.add(sesion.name);

  const configurados = Array.isArray(sesion.config?.webhooks) ? sesion.config.webhooks : [];
  /*
    Se compara por SUBCONJUNTO, no por igualdad.

    WAHA puede reordenar los eventos o agregar los suyos; exigir una lista identica daria siempre
    "distinto" y volveria a escribir para siempre. Lo unico que nos importa es que exista un
    webhook con nuestra URL y que cubra los eventos que pedimos.
  */
  const alDia = configurados.some(
    (webhook) =>
      webhook?.url === webhookUrl &&
      EVENTOS.every((evento) => (webhook.events ?? []).includes(evento)),
  );
  if (alDia) {
    return;
  }

  const otros = configurados.filter((webhook) => webhook?.url !== webhookUrl);
  await wahaRequest(connection, `/api/sessions/${encodeURIComponent(sesion.name)}`, {
    method: "PUT",
    body: JSON.stringify({
      config: {
        ...(sesion.config ?? {}),
        webhooks: [...otros, { url: webhookUrl, events: [...EVENTOS] }],
      },
    }),
  }).catch((error) => {
    console.error("[waha] no pude actualizar la suscripcion de", sesion.name, error);
  });
}

/**
 * El estado de la sesion, traducido al vocabulario que ya usa el CRM.
 *
 * El resto de la app compara contra "open"/"close", que viene de Evolution. Traducir aca evita
 * tener que enseñarle a toda la app un tercer juego de nombres.
 */
/**
 * Borra una sesion de WAHA.
 *
 * Hace falta cuando un canal cambia de sesion o se elimina: la sesion vieja no se cae sola, sigue
 * vinculada al telefono y siguiendo recibiendo. Paso con Vacantes: quedaron `vacantes` y
 * `vacantes-2` sobre la MISMA linea, cada mensaje llegaba dos veces y la copia huerfana se
 * descartaba con `channel_not_found`, ensuciando todo el log.
 *
 * Es best-effort a proposito: que no se pueda borrar la vieja no puede impedir que la nueva quede
 * conectada, que es lo que el usuario esta esperando en pantalla.
 */
export async function borrarSesionWaha(connection: WahaConnection, sesion: string): Promise<void> {
  if (!sesion.trim()) {
    return;
  }
  try {
    await wahaRequest(connection, `/api/sessions/${encodeURIComponent(sesion)}`, {
      method: "DELETE",
      esperaJson: false,
    });
    console.log("[waha] sesion borrada", { sesion });
  } catch (error) {
    console.error("[waha] no pude borrar la sesion", sesion, error);
  }
}

export async function estadoDeSesionWaha(
  connection: WahaConnection,
  sesion: string,
): Promise<string | null> {
  const datos = await leerSesionWaha(connection, sesion);
  if (!datos) {
    return null;
  }
  switch (datos.status) {
    case "WORKING":
      return "open";
    case "SCAN_QR_CODE":
      return "qr";
    case "STARTING":
      return "connecting";
    default:
      return "close";
  }
}

/** El numero y la foto de la sesion, para mostrarlos en la tarjeta del canal. */
export async function perfilDeSesionWaha(
  connection: WahaConnection,
  sesion: string,
): Promise<{ owner: string | null; profilePictureUrl: string | null } | null> {
  const datos = await leerSesionWaha(connection, sesion);
  if (!datos?.me?.id) {
    return null;
  }
  return { owner: datos.me.id, profilePictureUrl: null };
}

/**
 * El QR para escanear.
 *
 * WAHA responde 422 -no 404- cuando la sesion YA esta conectada y no hay nada que escanear. Es
 * un caso normal, no una falla: se devuelve vacio y la pantalla muestra el canal conectado.
 */
export async function qrDeSesionWaha(
  connection: WahaConnection,
  sesion: string,
): Promise<{ qrCode: string | null; pairingCode: string | null }> {
  try {
    const datos = await wahaRequest<{ mimetype?: string; data?: string }>(
      connection,
      `/api/${encodeURIComponent(sesion)}/auth/qr`,
    );
    if (!datos?.data) {
      return { qrCode: null, pairingCode: null };
    }
    const tipo = datos.mimetype || "image/png";
    return { qrCode: `data:${tipo};base64,${datos.data}`, pairingCode: null };
  } catch (error) {
    if (error instanceof WahaError && (error.status === 422 || error.status === 404)) {
      return { qrCode: null, pairingCode: null };
    }
    throw error;
  }
}

/* -------------------------------------------------------------------- envio */

/** El destinatario como lo quiere WAHA: solo digitos y sufijo @c.us. */
export function chatIdDeTelefono(telefono: string): string {
  const limpio = telefono.trim();

  // Grupos, canales y los LID ya guardados con su dominio viajan tal cual.
  if (/@(g\.us|newsletter|lid|c\.us|s\.whatsapp\.net)$/i.test(limpio)) {
    return limpio;
  }

  const digitos = limpio.replace(/\D/g, "");

  /**
   * Un LID no es un telefono, y mandarlo como tal no llega a ningun lado.
   *
   * Los leads que entran por un anuncio ocultan su numero: WhatsApp los identifica con un LID, que
   * en la ficha del contacto queda pelado ("271498354913364"). Pegarle "@c.us" lo convierte en
   * "271498354913364@s.whatsapp.net", una direccion que no existe, y el gateway corta con
   * "no LID found for ... from server" en la cara de la asesora.
   *
   * Un telefono real no pasa de 13 digitos con indicativo; de 14 para arriba es un LID. Es el
   * mismo criterio que ya usaba el camino de Evolution (normalizeEvolutionSendNumber): quedo sin
   * portar al pasar las lineas a WAHA, y por eso volvio a aparecer.
   */
  if (digitos.length >= 14) {
    return `${digitos}@lid`;
  }

  return `${digitos}@c.us`;
}

/**
 * Un LID no es un telefono: hay que preguntarle a WhatsApp cual es.
 *
 * Los leads que entran por un anuncio ocultan su numero. WhatsApp los identifica con un LID, que
 * en la ficha del contacto queda pelado ("271498354913364"). Enviado como telefono se convierte en
 * "271498354913364@s.whatsapp.net" —una direccion que no existe— y el gateway corta con
 * "no LID found for ... from server" en la cara de la asesora, con el mensaje sin salir.
 *
 * WAHA tiene la tabla de equivalencias de la propia linea, asi que se le pregunta y se manda al
 * numero de verdad. Si no la tiene (el LID nunca escribio por esta linea), se manda al "@lid", que
 * es lo unico que puede llegar; peor es lo de antes, que no llegaba nunca.
 *
 * La respuesta se guarda: la equivalencia no cambia, y sin esto seria una consulta extra en cada
 * mensaje de una conversacion.
 */
const telefonoDeLid = new Map<string, string>();

/**
 * El telefono real detras de un LID, preguntandoselo a WAHA.
 *
 * Los leads que entran por un anuncio ocultan su numero: WhatsApp los identifica con un LID y el
 * contacto nacia llamandose "37898875334784". En evogo esto ya estaba resuelto por el fork; al
 * pasar a WAHA volvio, porque WAHA no traduce solo.
 *
 * Pero SI tiene la tabla: al 2-sep-2026, 1.860 equivalencias guardadas en la linea de Ventas 1.
 * Solo habia que preguntarle.
 *
 * Devuelve null si esa linea no conoce la equivalencia -pasa cuando el lead escribe por primera
 * vez y WhatsApp todavia no la mando-; en ese caso el contacto nace con el LID, como hasta ahora,
 * y se resuelve la proxima.
 *
 * La respuesta se guarda: una equivalencia no cambia.
 */
export async function telefonoDeUnLid(input: {
  connection: WahaConnection;
  sesion: string;
  lid: string;
}): Promise<string | null> {
  const lid = input.lid.replace(/[^0-9]/g, "");
  if (!lid) {
    return null;
  }
  const clave = `${input.sesion}:${lid}`;
  const guardado = telefonoDeLid.get(clave);
  if (guardado) {
    return guardado.split("@")[0] ?? null;
  }

  try {
    const respuesta = await wahaRequest<{ pn?: string | null }>(
      input.connection,
      `/api/${encodeURIComponent(input.sesion)}/lids/${encodeURIComponent(lid)}`,
    );
    const telefono = respuesta?.pn?.trim();
    if (!telefono) {
      return null;
    }
    telefonoDeLid.set(clave, chatIdDeTelefono(telefono));
    return telefono.split("@")[0]?.replace(/[^0-9]/g, "") || null;
  } catch {
    // Sin equivalencia se sigue con el LID: preguntar es una mejora, no un requisito para recibir.
    return null;
  }
}

async function chatIdParaEnviar(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
}): Promise<string> {
  const directo = chatIdDeTelefono(input.telefono);
  if (!directo.endsWith("@lid")) {
    return directo;
  }

  const lid = directo.slice(0, -"@lid".length);
  const enMemoria = telefonoDeLid.get(`${input.sesion}:${lid}`);
  if (enMemoria) {
    return enMemoria;
  }

  try {
    const respuesta = await wahaRequest<{ pn?: string | null }>(
      input.connection,
      `/api/${encodeURIComponent(input.sesion)}/lids/${encodeURIComponent(lid)}`,
    );
    const telefono = respuesta?.pn?.trim();
    if (telefono) {
      const resuelto = chatIdDeTelefono(telefono);
      telefonoDeLid.set(`${input.sesion}:${lid}`, resuelto);
      return resuelto;
    }
  } catch {
    // Sin equivalencia se sigue con el "@lid": preguntar es una mejora, no un requisito para enviar.
  }

  return directo;
}

/**
 * Manda algo a WAHA y, si WhatsApp responde que ese numero no existe, lo reintenta como LID.
 *
 * Deja de adivinar por la cantidad de digitos. La regla "de 14 para arriba es un LID" fallo con
 * 9307244503114, que tiene TRECE y es un LID igual: la asesora vio media pantalla de codigo rojo y
 * el mensaje no salio. Y no hay forma de saberlo de antemano —el endpoint /lids de WAHA contesta
 * lo mismo para un LID que para un telefono real, probado el 2-sep-2026—.
 *
 * Asi que decide WhatsApp: se intenta como telefono y, si contesta "no LID found", se manda al
 * "@lid". Un intento extra solo en el caso que hoy fallaba del todo.
 */
async function enviarConReintentoDeLid<T>(
  chatId: string,
  enviar: (chatId: string) => Promise<T>,
): Promise<T> {
  try {
    return await enviar(chatId);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    const digitos = chatId.split("@")[0]?.replace(/[^0-9]/g, "") ?? "";
    const puedeSerLid = /no lid found/i.test(detalle) && chatId.endsWith("@c.us") && digitos;
    if (!puedeSerLid) {
      throw error;
    }
    console.warn("[waha] no era un telefono, se reintenta como LID", { chatId });
    return enviar(`${digitos}@lid`);
  }
}

/**
 * Reacciona a un mensaje (👍 ❤️ …), o quita la reaccion si el emoji va vacio.
 *
 * Verificado contra el servidor: la ruta es `PUT /api/reaction` y pide la sesion, el id del
 * mensaje y el emoji. Es la misma reaccion que ve el cliente en su WhatsApp, no una marca
 * nuestra: por eso se manda y recien despues se guarda de este lado.
 */
export async function enviarReaccionWaha(input: {
  connection: WahaConnection;
  sesion: string;
  mensajeId: string;
  emoji: string;
}): Promise<void> {
  await wahaRequest(input.connection, "/api/reaction", {
    method: "PUT",
    body: JSON.stringify({
      session: input.sesion,
      messageId: input.mensajeId,
      // Vacio = quitar la reaccion, que es como lo entiende WhatsApp.
      reaction: input.emoji,
    }),
    esperaJson: false,
  });
}

/**
 * Manda una UBICACION: el pin con su mapita.
 *
 * Faltaba, y en WAHA -que son todas las lineas de venta- el boton de ubicacion moria con
 * "esta operacion todavia no esta implementada" (Alex, 26-09-2026). Es de las cosas que mas
 * piden los clientes: "mandame la ubicacion".
 */
export async function enviarUbicacionWaha(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
  latitud: number;
  longitud: number;
  titulo?: string | null;
}): Promise<{ externalId: string | null; raw: unknown }> {
  const destino = await chatIdParaEnviar(input);
  const acompanantes = empezarLeidoEnParalelo(input.connection, input.sesion, destino);
  const respuesta = await conAcompanantes(acompanantes, () => enviarConReintentoDeLid(destino, (chatId) =>
    wahaRequest<{ id?: string | { id?: string }; _data?: unknown }>(
      input.connection,
      "/api/sendLocation",
      {
        method: "POST",
        body: JSON.stringify({
          session: input.sesion,
          chatId,
          latitude: input.latitud,
          longitude: input.longitud,
          ...(input.titulo?.trim() ? { title: input.titulo.trim() } : {}),
        }),
      },
    ),
  ));

  return { externalId: leerIdDeMensaje(respuesta), raw: respuesta };
}

export async function enviarTextoWaha(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
  texto: string;
  citarId?: string | null;
  /** Sin tarjeta de vista previa del link. Ausente = el envío sale idéntico al de siempre. */
  sinVistaPrevia?: boolean;
}): Promise<{ externalId: string | null; raw: unknown }> {
  const destino = await chatIdParaEnviar(input);
  const acompanantes = empezarLeidoEnParalelo(input.connection, input.sesion, destino);
  const respuesta = await conAcompanantes(acompanantes, () => enviarConReintentoDeLid(destino, (chatId) =>
    wahaRequest<{ id?: string | { id?: string }; _data?: unknown }>(
      input.connection,
      "/api/sendText",
      {
        method: "POST",
        body: JSON.stringify({
          session: input.sesion,
          chatId,
          text: input.texto,
          ...(input.citarId ? { reply_to: input.citarId } : {}),
          ...(input.sinVistaPrevia ? { linkPreview: false } : {}),
        }),
      },
    ),
  ));

  return { externalId: leerIdDeMensaje(respuesta), raw: respuesta };
}

/**
 * El id del mensaje que acabamos de enviar.
 *
 * Sirve para reconocer el ECO: WAHA nos reenvia por webhook el mismo mensaje que mandamos, y sin
 * el id se guardaria dos veces en el chat.
 */
export function leerIdDeMensaje(respuesta: unknown): string | null {
  if (!respuesta || typeof respuesta !== "object") {
    return null;
  }
  const id = (respuesta as { id?: unknown }).id;
  if (typeof id === "string") {
    return id;
  }
  if (id && typeof id === "object") {
    const anidado = (id as { id?: unknown; _serialized?: unknown });
    if (typeof anidado._serialized === "string") {
      return anidado._serialized;
    }
    if (typeof anidado.id === "string") {
      return anidado.id;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ webhook */

/**
 * El sobre que manda WAHA en cada evento.
 *
 * Los campos de `payload` para un mensaje salen del esquema WAMessage del propio servidor, no de
 * la documentacion: id, timestamp, from, fromMe, to, body, hasMedia, participant, _data.
 */
type EventoWaha = {
  event?: unknown;
  session?: unknown;
  payload?: unknown;
};

/** `573001112233@c.us` es lo de WAHA; el resto del CRM habla `@s.whatsapp.net`. */
/**
 * Un campo del payload crudo, sin pelearse con las mayusculas.
 *
 * El mismo dato aparece como `itemCount`, `ItemCount` o `item_count` segun por donde venga: WAHA
 * serializa las estructuras de Go y no siempre respeta el nombre del protocolo. Buscar por nombre
 * exacto es lo que hace que un campo "no exista" cuando esta ahi a la vista.
 */
function campoCrudo(nodo: Record<string, unknown>, ...nombres: string[]): unknown {
  const normalizar = (valor: string) => valor.toLowerCase().replace(/[^a-z0-9]/g, "");
  const buscados = new Set(nombres.map(normalizar));
  for (const [clave, valor] of Object.entries(nodo)) {
    if (buscados.has(normalizar(clave))) {
      return valor;
    }
  }
  return undefined;
}

/** El bloque del pedido, venga como `orderMessage` o como `OrderMessage`. */
function nodoDePedido(bloque: unknown): Record<string, unknown> | null {
  if (!bloque || typeof bloque !== "object") {
    return null;
  }
  for (const [nombre, valor] of Object.entries(bloque as Record<string, unknown>)) {
    if (/order/i.test(nombre) && valor && typeof valor === "object" && !Array.isArray(valor)) {
      return valor as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Que dice la burbuja de un pedido hecho desde el catalogo de WhatsApp.
 *
 * Este mensaje no trae texto ni archivo -es una tarjeta que WhatsApp arma sola-, asi que se
 * descartaba entero: la clienta mandaba un pedido de 3 articulos y en el CRM no quedaba NADA. La
 * asesora contestaba "que buscas en particular?" a alguien que ya habia dicho exactamente que
 * queria. Peor que un mensaje feo es un mensaje invisible.
 *
 * Se arma un resumen con lo que trae la tarjeta. El detalle de los articulos no viaja en el
 * evento -hay que pedirselo aparte a WhatsApp con el token del pedido-, asi que por ahora se dice
 * cuantos son y cuanto suman, que es lo que decide si hay que abrir el telefono.
 */
function resumenDelPedido(pedido: Record<string, unknown>): string {
  const numero = (valor: unknown): number | null => {
    if (typeof valor === "number" && Number.isFinite(valor)) {
      return valor;
    }
    if (typeof valor === "string" && valor.trim() && Number.isFinite(Number(valor))) {
      return Number(valor);
    }
    return null;
  };
  const texto = (valor: unknown): string => (typeof valor === "string" ? valor.trim() : "");

  const articulos = numero(campoCrudo(pedido, "itemCount"));
  // El total viene multiplicado por 1000: es como lo manda WhatsApp para no usar decimales.
  const total = numero(campoCrudo(pedido, "totalAmount1000"));
  const moneda = texto(campoCrudo(pedido, "totalCurrencyCode"));
  const nota = texto(campoCrudo(pedido, "message"));
  const titulo = texto(campoCrudo(pedido, "orderTitle"));

  const partes = ["🛒 *Pedido desde el catálogo*"];
  if (articulos !== null) {
    partes.push(`${articulos} ${articulos === 1 ? "artículo" : "artículos"}`);
  }
  if (total !== null && total > 0) {
    const valor = Math.round(total / 1000).toLocaleString("es-CO");
    partes.push(`Total: ${valor}${moneda ? ` ${moneda}` : ""}`);
  }
  if (titulo) {
    partes.push(titulo);
  }
  if (nota) {
    partes.push(nota);
  }
  // Se dice donde esta el detalle: los articulos no vienen en el evento y la asesora los necesita.
  partes.push("_El detalle de los artículos se ve en WhatsApp._");

  return partes.join("\n");
}

/** Un estado ("historia"), una lista de difusion o un canal: ninguno es un chat con alguien. */
function esEstadoOCanal(jid: string): boolean {
  const valor = jid.trim().toLowerCase();
  return valor === "status@broadcast" || valor.endsWith("@broadcast") || valor.endsWith("@newsletter");
}

function jidDeWaha(valor: string): string {
  if (valor.endsWith("@c.us")) {
    return `${valor.slice(0, -"@c.us".length)}@s.whatsapp.net`;
  }
  return valor;
}

/**
 * Traduce un evento de WAHA al formato que ya entiende el webhook de Evolution.
 *
 * Es un traductor y no una tuberia nueva a proposito: el webhook de Evolution son 3900 lineas que
 * resuelven contacto, conversacion, etapa del embudo, agente y seguimientos. Reescribir todo eso
 * para el tercer gateway seria duplicar el corazon del CRM, y las dos copias se irian separando.
 *
 * Devuelve null para lo que todavia no soportamos; el que llama responde 200 igual, porque un
 * evento que no sabemos leer no es un error de WAHA y reintentarlo no lo va a mejorar.
 */
export type MediaPendiente = { url: string; mimetype: string };

/**
 * A que nodo del formato de Evolution corresponde cada tipo de archivo.
 *
 * El webhook viejo deduce el tipo del mensaje por el NOMBRE del nodo (`imageMessage`,
 * `audioMessage`...), no por un campo aparte. Poniendo el nodo correcto, toda la tuberia -tipo,
 * miniatura, descarga, burbuja- funciona sin tocar una linea de ella.
 */
function nodoSegunMime(mimetype: string): string {
  const tipo = mimetype.toLowerCase();
  // El webp es como WhatsApp manda los stickers; tratarlo como imagen los mostraria gigantes.
  if (tipo.startsWith("image/webp")) {
    return "stickerMessage";
  }
  if (tipo.startsWith("image/")) {
    return "imageMessage";
  }
  if (tipo.startsWith("video/")) {
    return "videoMessage";
  }
  if (tipo.startsWith("audio/")) {
    return "audioMessage";
  }
  return "documentMessage";
}

/** La miniatura de un video que se guarda: las de WhatsApp pesan unos 5 KB; una de mas no se guarda. */
const MINIATURA_DE_VIDEO_MAXIMA = 60_000;

/**
 * El ancho y el alto de una foto o un video, y la miniatura solo del video.
 *
 * El nodo del mensaje se arma a mano y se perdian: sin el tamaño la burbuja no sabe cuanto lugar
 * reservar y el chat salta al cargar la foto (Chats, parte 3). Se leen del MISMO nodo crudo de
 * WhatsApp y se copian tal cual; no cambia nada mas del mensaje. La miniatura de las fotos NO se
 * guarda: no hace falta para reservar el lugar y solo inflaria el payload.
 */
function medidasDelMedio(
  bloqueDelMensaje: Record<string, unknown> | null,
  nodo: string,
): Record<string, unknown> {
  if (!bloqueDelMensaje || (nodo !== "imageMessage" && nodo !== "videoMessage")) {
    return {};
  }
  const crudo = campoCrudo(bloqueDelMensaje, nodo);
  if (!crudo || typeof crudo !== "object") {
    return {};
  }
  const nodoCrudo = crudo as Record<string, unknown>;
  const lado = (valor: unknown) =>
    typeof valor === "number" && Number.isInteger(valor) && valor > 0 ? valor : null;
  const ancho = lado(campoCrudo(nodoCrudo, "width"));
  const alto = lado(campoCrudo(nodoCrudo, "height"));
  const miniatura = nodo === "videoMessage" ? campoCrudo(nodoCrudo, "jpegThumbnail") : undefined;
  return {
    ...(ancho && alto ? { width: ancho, height: alto } : {}),
    ...(typeof miniatura === "string" && miniatura.length > 0 && miniatura.length <= MINIATURA_DE_VIDEO_MAXIMA
      ? { jpegThumbnail: miniatura }
      : {}),
  };
}

export function traducirEventoWaha(
  cuerpo: unknown,
):
  | {
      evolution: Record<string, unknown>;
      media?: MediaPendiente;
      /** El mensaje trae archivo pero WAHA no lo pudo bajar: se puede pedir una vez mas. */
      mediaFaltante?: { chatId: string; mensajeId: string };
      motivo?: undefined;
    }
  | { evolution?: undefined; media?: undefined; mediaFaltante?: undefined; motivo: string } {
  if (!cuerpo || typeof cuerpo !== "object") {
    return { motivo: "el cuerpo no es un objeto" };
  }
  const evento = cuerpo as EventoWaha;
  const nombre = typeof evento.event === "string" ? evento.event : "";
  const sesion = typeof evento.session === "string" ? evento.session : "";
  if (!sesion) {
    return { motivo: "el evento no dice de que sesion es" };
  }

  if (nombre === "session.status") {
    const datos = (evento.payload ?? {}) as { status?: unknown };
    const estado = typeof datos.status === "string" ? datos.status : "";
    return {
      evolution: {
        event: "connection.update",
        instance: sesion,
        data: { state: estado === "WORKING" ? "open" : estado === "STARTING" ? "connecting" : "close" },
      },
    };
  }

  /*
    Las reacciones (👍 ❤️) vienen por su PROPIO evento, no dentro de los mensajes.

    Por eso no se veian: no estabamos suscritos a `message.reaction` y no llegaban nunca -ni
    siquiera al log de descartados-. Se traducen a la forma que el webhook de Evolution ya
    entiende (`reactionMessage`), que sabe pegarlas a la burbuja del mensaje reaccionado.
  */
  if (nombre === "message.reaction") {
    const datos = (evento.payload ?? {}) as {
      id?: unknown;
      from?: unknown;
      fromMe?: unknown;
      timestamp?: unknown;
      reaction?: unknown;
    };
    const de = typeof datos.from === "string" ? datos.from : "";
    const reaccion = (datos.reaction ?? {}) as { text?: unknown; messageId?: unknown };
    const objetivo = typeof reaccion.messageId === "string" ? reaccion.messageId : "";
    // El texto vacio es quitar la reaccion, y hay que pasarlo igual: si no, sacarla no se veria.
    const emoji = typeof reaccion.text === "string" ? reaccion.text : "";
    if (!de || !objetivo) {
      return { motivo: "reaccion sin mensaje al que pegarse" };
    }
    return {
      evolution: {
        event: "messages.upsert",
        instance: sesion,
        data: {
          key: {
            remoteJid: jidDeWaha(de),
            fromMe: datos.fromMe === true,
            id: typeof datos.id === "string" ? datos.id : null,
          },
          message: { reactionMessage: { key: { id: objetivo }, text: emoji } },
          messageTimestamp: typeof datos.timestamp === "number" ? datos.timestamp : undefined,
        },
      },
    };
  }

  /*
    Se procesa `message.any` y se descarta `message`: WAHA manda los dos por el MISMO mensaje.

    Las sesiones viejas quedaron suscritas a ambos, asi que no alcanza con pedir uno solo: hay que
    ignorar el repetido tambien aca, o el mensaje se sigue procesando dos veces (dos avisos push,
    dos veces el motor del agente) hasta que se reconfigure cada sesion.
  */
  if (nombre === "message") {
    return { motivo: "repetido: el mismo mensaje ya viene en message.any" };
  }
  if (nombre !== "message.any") {
    return { motivo: `evento no soportado: ${nombre || "(sin nombre)"}` };
  }

  const mensaje = (evento.payload ?? {}) as {
    id?: unknown;
    timestamp?: unknown;
    from?: unknown;
    fromMe?: unknown;
    /** "api" = lo mandamos nosotros por WAHA; "app" = salio del telefono (o lo mando el cliente). */
    source?: unknown;
    body?: unknown;
    hasMedia?: unknown;
    media?: unknown;
    participant?: unknown;
    /** Ubicacion ya leida por WAHA (latitude, longitude, name/description, address). */
    location?: unknown;
    /** Las tarjetas de contacto ya leidas por WAHA: una lista de textos vCard. */
    vCards?: unknown;
    vcards?: unknown;
    _data?: unknown;
  };

  const de = typeof mensaje.from === "string" ? mensaje.from : "";
  if (!de) {
    return { motivo: "el mensaje no dice de quien viene" };
  }

  /*
    Los ESTADOS de WhatsApp no entran al CRM.

    Un estado no es un mensaje para nosotros: es la historia que el contacto le publica a toda su
    agenda, y nos llega igual que un mensaje comun. Entrando al CRM se veia como un chat nuevo y
    -lo peor- sonaba como notificacion en el celular de todo el equipo. Esas eran las
    "notificaciones fantasma": se tocaban y no llevaban a ninguna conversacion real.

    Se mira el chat en los DOS lados: WAHA lo pone en `from`, pero el motor whatsmeow deja ahi al
    autor y el "status@broadcast" queda adentro, en `_data.Info.Chat`. Mirando uno solo, la mitad
    de los estados pasaba igual.

    Las listas de difusion y los canales entran por la misma puerta y tampoco son una conversacion.
  */
  const chatCrudo = (mensaje._data as { Info?: { Chat?: unknown } } | undefined)?.Info?.Chat;
  if (esEstadoOCanal(de) || esEstadoOCanal(typeof chatCrudo === "string" ? chatCrudo : "")) {
    return { motivo: "estado, difusion o canal de WhatsApp" };
  }

  const texto = typeof mensaje.body === "string" ? mensaje.body : "";

  /*
    Un pedido del catalogo no trae ni texto ni archivo, y asi se perdia entero.
  */
  const bloqueCrudo = (mensaje._data ?? {}) as { Message?: unknown };
  const pedido = nodoDePedido(bloqueCrudo.Message);

  /*
    La CITA de un mensaje ("responder") viaja en el contextInfo, y la estabamos tirando.

    Al traducir armabamos el nodo de texto a mano -texto y nada mas- asi que la respuesta llegaba
    al CRM como un mensaje suelto: se leia "si, esa" sin saber a que. El dato venia entero desde
    el principio.

    Se busca en todos los nodos porque cuelga del que corresponda al tipo de mensaje: en un texto
    de `extendedTextMessage`, en una foto de `imageMessage`. Y se reenvia tal cual, sin
    reinterpretarlo: la burbuja ya sabe leer esta forma, que es la misma de Evolution.
  */
  const citaCruda = ((): Record<string, unknown> | null => {
    const bloque = bloqueCrudo.Message;
    if (!bloque || typeof bloque !== "object") {
      return null;
    }
    for (const valor of Object.values(bloque as Record<string, unknown>)) {
      if (!valor || typeof valor !== "object") {
        continue;
      }
      const contexto = (valor as Record<string, unknown>).contextInfo;
      if (contexto && typeof contexto === "object" && (contexto as Record<string, unknown>).quotedMessage) {
        return contexto as Record<string, unknown>;
      }
    }
    return null;
  })();
  /*
    El saludo automatico de un anuncio (interactiveMessage) y el origen del anuncio (externalAdReply).

    Cuando alguien llega por un anuncio de Click-to-WhatsApp, WhatsApp Business manda solo una tarjeta
    "Anuncio / Somos Magilus" con los datos del anuncio. No trae `body` ni archivo, asi que se
    descartaba como "mensaje sin texto ni media" y en el chat no quedaba de que anuncio venia el
    cliente (Alex, 14-sep-2026). El texto esta en `interactiveMessage.body.text` y el anuncio en su
    contextInfo; la burbuja ya sabe dibujar la tarjeta si el contextInfo llega.

    Tambien se conserva el contextInfo con externalAdReply de CUALQUIER mensaje (el primero del
    cliente lo trae): antes solo se guardaba si era una cita.
  */
  const bloqueDelMensaje =
    bloqueCrudo.Message && typeof bloqueCrudo.Message === "object"
      ? (bloqueCrudo.Message as Record<string, unknown>)
      : null;
  const interactivo = bloqueDelMensaje?.interactiveMessage as
    | { body?: { text?: unknown } }
    | undefined;
  const textoInteractivo = typeof interactivo?.body?.text === "string" ? interactivo.body.text : "";
  const contextoDeAnuncio = ((): Record<string, unknown> | null => {
    for (const valor of Object.values(bloqueDelMensaje ?? {})) {
      const contexto = valor && typeof valor === "object" ? (valor as Record<string, unknown>).contextInfo : null;
      if (contexto && typeof contexto === "object" && (contexto as Record<string, unknown>).externalAdReply) {
        return contexto as Record<string, unknown>;
      }
    }
    return null;
  })();
  const contextoDelMensaje = citaCruda ?? contextoDeAnuncio;

  /*
    Las UBICACIONES que manda el cliente (o la asesora desde el telefono) no aparecian en el chat.

    No traen texto, y la miniatura del mapa hace que WAHA marque `hasMedia` sin archivo: o se
    descartaban como "mensaje sin texto ni media" o quedaban como "un archivo que no se pudo
    descargar". Por eso se leen ANTES que el texto y el archivo, y salen con el mismo nodo de
    Evolution (`locationMessage` o `liveLocationMessage`) que la burbuja ya sabe dibujar como mapa.
  */
  // El sobre de Evolution de un mensaje sin archivo (ubicacion o contacto): mismo origen, clave,
  // nombre y hora que los demas tipos.
  const sinArchivo = (contenido: Record<string, unknown>) => ({
    evolution: {
      event: "messages.upsert",
      instance: sesion,
      data: {
        ...(mensaje.source === "api" || mensaje.source === "app" ? { wahaSource: mensaje.source } : {}),
        key: {
          remoteJid: jidDeWaha(de),
          fromMe: mensaje.fromMe === true,
          id: typeof mensaje.id === "string" ? mensaje.id : null,
          ...(typeof mensaje.participant === "string"
            ? { participant: jidDeWaha(mensaje.participant) }
            : {}),
        },
        message: contenido,
        pushName: nombreDeQuienEscribe(mensaje._data),
        messageTimestamp: typeof mensaje.timestamp === "number" ? mensaje.timestamp : undefined,
      },
    },
  });

  const ubicacion = ubicacionDelMensaje(bloqueDelMensaje, mensaje.location);
  if (ubicacion) {
    return sinArchivo({
      [ubicacion.nodo]: {
        ...ubicacion.datos,
        ...(contextoDelMensaje ? { contextInfo: contextoDelMensaje } : {}),
      },
    });
  }

  /*
    Los CONTACTOS (tarjetas vCard) que manda el cliente o la asesora tampoco aparecian en el chat:
    no traen texto ni archivo y se descartaban como "mensaje sin texto ni media (contactMessage)".

    Se mandan como TEXTO ("👤 Contacto: nombre · telefono", una linea por contacto) porque el
    webhook y la burbuja todavia no saben leer contactos; asi no hay que tocarlos. El nombre y el
    telefono los escribe el otro: se limpian, se recortan y se usan solo como datos.
  */
  const contactos = contactosDelMensaje(bloqueDelMensaje, mensaje.vCards ?? mensaje.vcards);
  if (contactos) {
    return sinArchivo(
      contextoDelMensaje
        ? { extendedTextMessage: { text: contactos, contextInfo: contextoDelMensaje } }
        : { conversation: contactos },
    );
  }

  const textoVisible = texto.trim()
    ? texto
    : textoInteractivo.trim()
      ? textoInteractivo
      : pedido
        ? resumenDelPedido(pedido)
        : "";

  const archivo = (mensaje.media ?? {}) as {
    url?: unknown;
    mimetype?: unknown;
    filename?: unknown;
  };
  const urlDelArchivo = typeof archivo.url === "string" ? archivo.url : "";
  const mimetype = typeof archivo.mimetype === "string" ? archivo.mimetype : "";
  const nombreDelArchivo = typeof archivo.filename === "string" ? archivo.filename : "";
  const tieneMedia = mensaje.hasMedia === true && Boolean(urlDelArchivo);

  /*
    Un mensaje con media pero SIN archivo se guarda IGUAL.

    Antes se descartaba, dando por hecho que WAHA volveria a avisar al terminar de bajarlo. No
    vuelve: cuando la descarga falla, ese mensaje no llega nunca. Medido el 31-ago-2026 fueron 22
    en 24 horas —audios y fotos que el cliente mando y la asesora nunca vio—, y WhatsApp contesta
    403 al pedir el archivo de nuevo, asi que reintentar tampoco lo recupera.

    Lo caro no es perder el archivo: es que no quede NI RASTRO. El cliente manda un audio, en el
    chat no aparece ni una burbuja, y la asesora cree que no escribio. Una burbuja que dice "mando
    un audio y no se pudo descargar" es peor que el audio, pero muchisimo mejor que el silencio.
  */
  const mediaSinArchivo = mensaje.hasMedia === true && !urlDelArchivo;
  if (!tieneMedia && !mediaSinArchivo && !textoVisible.trim()) {
    /*
      Se dice QUE traia el mensaje que no supimos leer.

      Un "mensaje sin texto ni media" a secas no permite arreglar nada: asi estuvo perdiendose el
      pedido del catalogo sin que nadie pudiera saber que era. Con los nombres de los bloques,
      el proximo tipo que aparezca se reconoce leyendo el log.
    */
    const nodos = Object.keys((bloqueCrudo.Message ?? {}) as Record<string, unknown>);
    return { motivo: `mensaje sin texto ni media (${nodos.join(", ") || "sin bloques"})` };
  }

  /*
    La vista previa del enlace viene en el mensaje: no hay que salir a buscarla.

    Cuando alguien manda un link, WhatsApp ya adjunta el titulo de la pagina y una miniatura -es lo
    que hace la app del que lo mando, antes de enviarlo- y WAHA nos lo entrega entero. Lo estabamos
    tirando: el mensaje se guardaba como texto pelado y en el chat se veia una URL cruda.

    Aprovecharlo es infinitamente mejor que ir a leer la pagina desde nuestro servidor: no cuesta
    nada, no hay que cachear, no se demora, y sobre todo no abre la puerta a que un cliente nos
    mande un enlace apuntando a la red interna del servidor para ver que hay ahi.
  */
  const datosCrudos = (mensaje._data ?? {}) as {
    notifyName?: unknown;
    pushName?: unknown;
    Message?: { extendedTextMessage?: Record<string, unknown> };
  };
  const previoDelEnlace = datosCrudos.Message?.extendedTextMessage;
  const enlaceConVistaPrevia =
    previoDelEnlace && typeof previoDelEnlace.matchedText === "string"
      ? {
          matchedText: previoDelEnlace.matchedText,
          ...(typeof previoDelEnlace.title === "string" ? { title: previoDelEnlace.title } : {}),
          ...(typeof previoDelEnlace.description === "string"
            ? { description: previoDelEnlace.description }
            : {}),
          ...(typeof previoDelEnlace.canonicalUrl === "string"
            ? { canonicalUrl: previoDelEnlace.canonicalUrl }
            : {}),
          /*
            La miniatura viaja en base64 dentro del propio mensaje (unos 5 KB). Se guarda tal cual:
            es la misma que muestra WhatsApp y no depende de que la pagina siga existiendo.
          */
          ...(typeof previoDelEnlace.JPEGThumbnail === "string"
            ? { jpegThumbnail: previoDelEnlace.JPEGThumbnail }
            : {}),
        }
      : null;
  return {
    evolution: {
      event: "messages.upsert",
      instance: sesion,
      data: {
        /*
          De donde salio el mensaje, segun WAHA: "api" si lo mandamos nosotros (el agente, los
          seguimientos, los flujos, el CRM) y "app" si salio del telefono.

          Es la unica forma confiable de reconocer el eco de un envio NUESTRO. Sin esto, cuando el
          eco llegaba antes de que el agente terminara de guardar su mensaje, se tomaba por una
          asesora escribiendo desde el celular y la IA de ese chat se apagaba sola (Alex,
          30-09-2026: "¿por que aqui se paro el agente?"). Ver la pausa en el webhook.
        */
        ...(mensaje.source === "api" || mensaje.source === "app" ? { wahaSource: mensaje.source } : {}),
        key: {
          remoteJid: jidDeWaha(de),
          fromMe: mensaje.fromMe === true,
          id: typeof mensaje.id === "string" ? mensaje.id : null,
          ...(typeof mensaje.participant === "string"
            ? { participant: jidDeWaha(mensaje.participant) }
            : {}),
        },
        message: tieneMedia || mediaSinArchivo
          ? {
              [nodoSegunMime(mimetype)]: {
                ...(contextoDelMensaje ? { contextInfo: contextoDelMensaje } : {}),
                ...(urlDelArchivo ? { url: urlDelArchivo } : {}),
                mimetype,
                // En WhatsApp el texto que acompana una foto ES el caption, no un mensaje aparte.
                // Sin archivo se deja dicho QUE mando, para que la fila de la lista no quede muda.
                caption: textoVisible || (mediaSinArchivo ? avisoDeMediaPerdida(mimetype) : ""),
                ...(nombreDelArchivo ? { fileName: nombreDelArchivo } : {}),
                ...medidasDelMedio(bloqueDelMensaje, nodoSegunMime(mimetype)),
              },
            }
          : enlaceConVistaPrevia
            ? {
                extendedTextMessage: {
                  text: textoVisible,
                  ...enlaceConVistaPrevia,
                  ...(contextoDelMensaje ? { contextInfo: contextoDelMensaje } : {}),
                },
              }
            : contextoDelMensaje
            ? { extendedTextMessage: { text: textoVisible, contextInfo: contextoDelMensaje } }
            : { conversation: textoVisible },
        pushName: nombreDeQuienEscribe(mensaje._data),
        messageTimestamp: typeof mensaje.timestamp === "number" ? mensaje.timestamp : undefined,
      },
    },
    ...(tieneMedia ? { media: { url: urlDelArchivo, mimetype } } : {}),
    ...(mediaSinArchivo
      ? {
          mediaFaltante: {
            chatId: de,
            mensajeId: typeof mensaje.id === "string" ? mensaje.id : "",
          },
        }
      : {}),
  };
}

/** El nombre con el que se presenta quien escribe (WAHA lo pone en `notifyName` o `pushName`). */
function nombreDeQuienEscribe(datos: unknown): string | null {
  const crudos = (datos ?? {}) as { notifyName?: unknown; pushName?: unknown };
  return typeof crudos.notifyName === "string"
    ? crudos.notifyName
    : typeof crudos.pushName === "string"
      ? crudos.pushName
      : null;
}

// Largo maximo del nombre y la direccion de una ubicacion: son datos que escribe el otro, no se confian.
const LARGO_MAXIMO_NOMBRE_UBICACION = 200;
const LARGO_MAXIMO_DIRECCION_UBICACION = 300;

/**
 * La ubicacion de un mensaje de WAHA, en el formato de Evolution, o null si no es una ubicacion
 * valida.
 *
 * Primero se busca el nodo crudo de WhatsApp (`locationMessage` o `liveLocationMessage`): whatsmeow
 * usa mayuscula inicial (`DegreesLatitude`) y Baileys minuscula, igual que en
 * `extractEvolutionLocation`. Si no esta, se usa el campo `location` que WAHA pone arriba del
 * mensaje. La miniatura (`jpegThumbnail`) NO se guarda.
 */
function ubicacionDelMensaje(
  bloque: Record<string, unknown> | null,
  ubicacionDeWaha: unknown,
): {
  nodo: "locationMessage" | "liveLocationMessage";
  datos: { degreesLatitude: number; degreesLongitude: number; name?: string; address?: string };
} | null {
  const numero = (valor: unknown): number | null => {
    if (typeof valor === "number") {
      return Number.isFinite(valor) ? valor : null;
    }
    if (typeof valor === "string" && valor.trim()) {
      const leido = Number(valor);
      return Number.isFinite(leido) ? leido : null;
    }
    return null;
  };
  const textoRecortado = (largoMaximo: number, ...valores: unknown[]): string | undefined => {
    for (const valor of valores) {
      if (typeof valor === "string" && valor.trim()) {
        return valor.trim().slice(0, largoMaximo);
      }
    }
    return undefined;
  };
  const armar = (
    latitud: number | null,
    longitud: number | null,
    nombre: string | undefined,
    direccion: string | undefined,
  ) => {
    if (latitud === null || longitud === null) {
      return null;
    }
    if (latitud < -90 || latitud > 90 || longitud < -180 || longitud > 180) {
      return null;
    }
    return {
      degreesLatitude: latitud,
      degreesLongitude: longitud,
      ...(nombre ? { name: nombre } : {}),
      ...(direccion ? { address: direccion } : {}),
    };
  };

  for (const nodo of ["locationMessage", "liveLocationMessage"] as const) {
    const crudo = bloque?.[nodo];
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
      continue;
    }
    const valor = crudo as Record<string, unknown>;
    const datos = armar(
      numero(valor.degreesLatitude) ?? numero(valor.DegreesLatitude),
      numero(valor.degreesLongitude) ?? numero(valor.DegreesLongitude),
      textoRecortado(LARGO_MAXIMO_NOMBRE_UBICACION, valor.name, valor.Name),
      textoRecortado(LARGO_MAXIMO_DIRECCION_UBICACION, valor.address, valor.Address),
    );
    if (datos) {
      return { nodo, datos };
    }
  }

  if (ubicacionDeWaha && typeof ubicacionDeWaha === "object" && !Array.isArray(ubicacionDeWaha)) {
    const valor = ubicacionDeWaha as Record<string, unknown>;
    const datos = armar(
      numero(valor.latitude),
      numero(valor.longitude),
      textoRecortado(LARGO_MAXIMO_NOMBRE_UBICACION, valor.name, valor.description),
      textoRecortado(LARGO_MAXIMO_DIRECCION_UBICACION, valor.address),
    );
    if (datos) {
      return { nodo: "locationMessage", datos };
    }
  }

  return null;
}

// Largos maximos de un contacto: son datos que escribe el otro, no se confian.
const LARGO_MAXIMO_VCARD = 10_000;
const LARGO_MAXIMO_NOMBRE_CONTACTO = 100;
const LARGO_MAXIMO_TELEFONO_CONTACTO = 40;
const MAXIMO_DE_CONTACTOS = 20;

/** Lee un campo aceptando el nombre con minuscula o con mayuscula inicial. */
function campoSinMayusculas(valor: Record<string, unknown>, ...nombres: string[]): unknown {
  for (const nombre of nombres) {
    for (const variante of [nombre, nombre.charAt(0).toUpperCase() + nombre.slice(1)]) {
      if (valor[variante] !== undefined && valor[variante] !== null) {
        return valor[variante];
      }
    }
  }
  return undefined;
}

/** Quita caracteres de control, junta los espacios y recorta. */
function textoLimpioDeContacto(valor: string, largoMaximo: number): string {
  return valor
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, largoMaximo)
    .trim();
}

/**
 * El nombre y el telefono de una tarjeta vCard, o null si no trae ninguno de los dos.
 *
 * Nombre: FN, o si no `nombreDeRespaldo` (el displayName de WhatsApp). Telefono: el primer TEL, o
 * si no trae numero, su `waid`.
 */
function leerVCard(
  vcard: unknown,
  nombreDeRespaldo: unknown,
): { nombre: string; telefono: string } | null {
  const crudo = typeof vcard === "string" ? vcard.slice(0, LARGO_MAXIMO_VCARD) : "";
  // Las lineas largas de un vCard siguen en la de abajo empezando con un espacio o un tab.
  const lineas = crudo.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const desescapar = (valor: string) => valor.replace(/\\([,;:\\])/g, "$1").replace(/\\n/gi, " ");

  let nombre = "";
  let telefono = "";
  for (const linea of lineas) {
    const separador = linea.indexOf(":");
    if (separador <= 0) {
      continue;
    }
    // "item1.TEL;type=CELL;waid=573104445566" -> propiedad "TEL" y sus parametros.
    const cabeza = linea.slice(0, separador);
    const [propiedadConGrupo, ...parametros] = cabeza.split(";");
    const propiedad = propiedadConGrupo.split(".").pop()?.trim().toUpperCase() ?? "";
    const valor = desescapar(linea.slice(separador + 1));

    if (propiedad === "FN" && !nombre) {
      nombre = textoLimpioDeContacto(valor, LARGO_MAXIMO_NOMBRE_CONTACTO);
    } else if (propiedad === "TEL" && !telefono) {
      telefono = textoLimpioDeContacto(
        valor.replace(/[^0-9+()\-. ]/g, ""),
        LARGO_MAXIMO_TELEFONO_CONTACTO,
      );
      if (!/\d/.test(telefono)) {
        const waid = parametros
          .map((parametro) => /^waid=(\d{5,20})$/i.exec(parametro.trim())?.[1])
          .find(Boolean);
        telefono = waid ? `+${waid}` : "";
      }
    }
  }

  if (!nombre && typeof nombreDeRespaldo === "string") {
    nombre = textoLimpioDeContacto(nombreDeRespaldo, LARGO_MAXIMO_NOMBRE_CONTACTO);
  }
  return nombre || telefono ? { nombre, telefono } : null;
}

/**
 * Las tarjetas de contacto de un mensaje de WAHA como texto ("👤 Contacto: nombre · telefono",
 * una linea por contacto), o null si el mensaje no trae contactos.
 *
 * Se leen del nodo crudo de WhatsApp (`contactMessage` o `contactsArrayMessage.contacts[]`, con
 * nombres en minuscula como Baileys o mayuscula como whatsmeow). Si no estan, del campo `vCards`
 * que WAHA pone arriba del mensaje. Se usa una sola fuente para no repetir el mismo contacto.
 */
function contactosDelMensaje(
  bloque: Record<string, unknown> | null,
  vCardsDeWaha: unknown,
): string | null {
  const objeto = (valor: unknown): Record<string, unknown> | null =>
    valor && typeof valor === "object" && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : null;

  const leidos: { nombre: string; telefono: string }[] = [];
  const agregar = (crudo: Record<string, unknown> | null) => {
    if (!crudo) {
      return;
    }
    const contacto = leerVCard(
      campoSinMayusculas(crudo, "vcard", "vCard"),
      campoSinMayusculas(crudo, "displayName"),
    );
    if (contacto) {
      leidos.push(contacto);
    }
  };

  if (bloque) {
    agregar(objeto(campoSinMayusculas(bloque, "contactMessage")));
    const lista = objeto(campoSinMayusculas(bloque, "contactsArrayMessage"));
    const contactos = lista ? campoSinMayusculas(lista, "contacts") : undefined;
    if (Array.isArray(contactos)) {
      for (const contacto of contactos.slice(0, MAXIMO_DE_CONTACTOS)) {
        agregar(objeto(contacto));
      }
    }
  }

  if (leidos.length === 0 && Array.isArray(vCardsDeWaha)) {
    for (const vcard of vCardsDeWaha.slice(0, MAXIMO_DE_CONTACTOS)) {
      const contacto = leerVCard(vcard, undefined);
      if (contacto) {
        leidos.push(contacto);
      }
    }
  }

  if (leidos.length === 0) {
    return null;
  }
  return leidos
    .slice(0, MAXIMO_DE_CONTACTOS)
    .map(({ nombre, telefono }) =>
      `👤 Contacto: ${[nombre, telefono].filter(Boolean).join(" · ")}`,
    )
    .join("\n");
}

/** Que fue lo que mando, cuando el archivo no se pudo bajar. */
function avisoDeMediaPerdida(mimetype: string): string {
  const que = mimetype.startsWith("image/")
    ? "una foto"
    : mimetype.startsWith("video/")
      ? "un video"
      : mimetype.startsWith("audio/")
        ? "un audio"
        : "un archivo";
  return `⚠️ Te mando ${que}, pero no se pudo descargar. Pediselo de nuevo.`;
}

/**
 * Vuelve a pedirle a WAHA el archivo de un mensaje.
 *
 * A veces la primera descarga falla por algo pasajero y en el segundo intento entra. Cuando el
 * archivo ya expiro del lado de WhatsApp no hay caso -contesta 403- y por eso el reintento es UNO
 * solo: insistir no lo trae y demora el mensaje, que es lo unico que si podemos mostrar.
 */
export async function reintentarMediaWaha(input: {
  connection: WahaConnection;
  sesion: string;
  chatId: string;
  mensajeId: string;
}): Promise<{ url: string; mimetype: string; filename?: string } | null> {
  if (!input.chatId || !input.mensajeId) {
    return null;
  }
  try {
    const respuesta = await wahaRequest<{
      media?: { url?: unknown; mimetype?: unknown; filename?: unknown } | null;
    }>(
      input.connection,
      `/api/${encodeURIComponent(input.sesion)}/chats/${encodeURIComponent(input.chatId)}` +
        `/messages/${encodeURIComponent(input.mensajeId)}?downloadMedia=true`,
    );
    const media = respuesta?.media;
    const url = typeof media?.url === "string" ? media.url : "";
    if (!url) {
      return null;
    }
    return {
      url,
      mimetype: typeof media?.mimetype === "string" ? media.mimetype : "",
      ...(typeof media?.filename === "string" ? { filename: media.filename } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Baja un archivo de WAHA y lo devuelve en base64.
 *
 * Hay que bajarlo NOSOTROS: `/api/files/...` exige la clave (probado: 401 sin ella), asi que el
 * navegador de la asesora no puede abrir esa URL. Ademas el archivo vive en el volumen de WAHA;
 * guardandolo de nuestro lado sobrevive a que se recree el contenedor.
 *
 * El base64 se deja en el payload donde el resolver de siempre ya lo busca, asi la persistencia,
 * la miniatura y la burbuja funcionan sin cambiarles nada.
 */
export async function descargarMediaWaha(
  connection: WahaConnection,
  url: string,
): Promise<string | null> {
  try {
    const respuesta = await fetch(url, {
      headers: { "X-Api-Key": connection.apiToken },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!respuesta.ok) {
      console.error("[waha media] no pude bajar el archivo:", respuesta.status, url);
      return null;
    }
    const bytes = Buffer.from(await respuesta.arrayBuffer());
    return bytes.toString("base64");
  } catch (error) {
    console.error("[waha media] fallo la descarga", error);
    return null;
  }
}

/* -------------------------------------------------------------- doble check */

export type EstadoDeEntrega = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED";

/**
 * Cuanto avanzo un mensaje. Sirve para NO retroceder.
 *
 * Los acks llegan por su cuenta y pueden cruzarse: el "entregado" puede aparecer despues del
 * "leido". Sin este orden, un ack viejo que llega tarde le borraria el doble check azul a un
 * mensaje que el cliente ya leyo.
 */
const RANGO: Record<Exclude<EstadoDeEntrega, "FAILED">, number> = {
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
};

export function avanzaElEstado(actual: string | null | undefined, siguiente: EstadoDeEntrega): boolean {
  // Un error explicito de WhatsApp siempre vale: es informacion que nadie mas nos va a dar.
  if (siguiente === "FAILED") {
    return actual !== "FAILED";
  }
  const desde = RANGO[actual as Exclude<EstadoDeEntrega, "FAILED">] ?? -1;
  return RANGO[siguiente] > desde;
}

/**
 * Lee un evento `message.ack`.
 *
 * Los niveles son los de WhatsApp: -1 error, 0 pendiente, 1 llego al servidor, 2 llego al
 * telefono, 3 leido, 4 escuchado (audio). Para el estado 4 es leido tambien: el cliente lo abrio.
 * Ademas se avisa aparte que lo ESCUCHO, que es lo que pinta de azul el microfono del audio.
 */
export function leerAckWaha(
  cuerpo: unknown,
): { sesion: string; idMensaje: string; estado: EstadoDeEntrega; reproducido: boolean } | null {
  if (!cuerpo || typeof cuerpo !== "object") {
    return null;
  }
  const evento = cuerpo as EventoWaha;
  if (evento.event !== "message.ack" && evento.event !== "message.ack.group") {
    return null;
  }
  const sesion = typeof evento.session === "string" ? evento.session : "";
  const datos = (evento.payload ?? {}) as { id?: unknown; ack?: unknown };
  const idMensaje = typeof datos.id === "string" ? datos.id : "";
  if (!sesion || !idMensaje) {
    return null;
  }

  const estado =
    datos.ack === -1
      ? "FAILED"
      : datos.ack === 0
        ? "QUEUED"
        : datos.ack === 1
          ? "SENT"
          : datos.ack === 2
            ? "DELIVERED"
            : datos.ack === 3 || datos.ack === 4
              ? "READ"
              : null;

  if (!estado) {
    return null;
  }
  return { sesion, idMensaje, estado, reproducido: datos.ack === 4 };
}

/**
 * El id CRUDO del mensaje, sin el destinatario pegado adelante.
 *
 * WAHA compone el identificador como `<fromMe>_<jid>_<ID>`, y el jid del medio NO es estable: al
 * enviar nos devuelve el numero (`true_573001112233@c.us_3EB0...`) y en el acuse nos manda el LID
 * (`true_37898875334784@lid_3EB0...`). Comparando la cadena entera, el acuse de un mensaje nuestro
 * jamas encuentra a su mensaje, y el doble check nunca aparece.
 *
 * Lo unico que se mantiene igual en los dos es el pedazo final, que es el id de verdad.
 */
export function idCrudoDeMensaje(id: string): string {
  const partes = id.split("_");
  return partes[partes.length - 1] ?? "";
}

/* --------------------------------------------------------- envio de archivos */

/** A que ruta de WAHA va cada tipo de archivo. */
const RUTA_POR_TIPO: Record<"image" | "video" | "audio" | "document", string> = {
  image: "/api/sendImage",
  video: "/api/sendVideo",
  audio: "/api/sendVoice",
  document: "/api/sendFile",
};

export async function enviarMediaWaha(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
  tipo: "image" | "video" | "audio" | "document";
  /** Una URL publica, o el contenido en base64 si no hay URL (notas de voz grabadas en la app). */
  url?: string | null;
  base64?: string | null;
  mimetype?: string | null;
  nombreDeArchivo?: string | null;
  epigrafe?: string | null;
}): Promise<{ externalId: string | null; raw: unknown }> {
  /*
    Se manda la URL, no el archivo.

    WAHA la descarga por su cuenta (RemoteFile), asi que el pedido viaja liviano. Mandar el binario
    en base64 dentro del JSON es lo que hace fallar los envios grandes.
  */
  const url = input.url?.trim() || "";
  const base64 = input.base64?.trim() || "";
  if (!url && !base64) {
    throw new Error("No hay archivo para enviar (ni URL ni contenido)");
  }

  const cuerpo: Record<string, unknown> = {
    session: input.sesion,
    chatId: await chatIdParaEnviar(input),
    file: {
      // La nota de voz grabada en el CRM no tiene URL publica todavia: viaja como contenido.
      ...(url ? { url } : { data: base64 }),
      ...(input.mimetype?.trim() ? { mimetype: input.mimetype.trim() } : {}),
      ...(input.nombreDeArchivo?.trim() ? { filename: input.nombreDeArchivo.trim() } : {}),
    },
  };

  /*
    La nota de voz y el video llevan `convert` obligatorio: sin el, WAHA rechaza el pedido.

    Nota de voz: si el archivo YA es OGG con opus (lo unico que WhatsApp acepta como nota de voz),
    se manda con `convert: false` y WAHA se salta su segunda conversion con ffmpeg (medido el
    10-nov-2026: ~10 s de los 15 s de una nota de 95 KB se iban en el paso de WAHA). Se decide por
    los BYTES, no por la extension: un .ogg puede traer otro formato y la nota llegaria rota.
    Ojo: las notas grabadas en el CRM se guardan en .m4a (AAC), asi que esas siguen con `convert: true`.

    Video: sigue SIEMPRE con `convert: true`. No se cambio en la tarjeta 8l3ukw4k: WAHA lo pide
    para el mp4 y no hay medicion que diga que se pueda saltar.
  */
  let convertDeVoz = true;
  let msDeteccion: number | null = null;
  if (input.tipo === "audio") {
    const inicioDeteccion = Date.now();
    const primeros = await primerosBytesDelArchivo({ url, base64 });
    msDeteccion = Date.now() - inicioDeteccion;
    convertDeVoz = !(primeros && esOggOpus(primeros));
    if (!convertDeVoz) {
      (cuerpo.file as Record<string, unknown>).mimetype = MIMETYPE_OGG_OPUS;
    }
  }
  if (input.tipo === "audio" || input.tipo === "video") {
    cuerpo.convert = input.tipo === "audio" ? convertDeVoz : true;
  }
  // El audio de WhatsApp no tiene epigrafe; mandarlo hace que WAHA rechace el pedido.
  if (input.tipo !== "audio" && input.epigrafe?.trim()) {
    cuerpo.caption = input.epigrafe.trim();
  }

  const acompanantes = empezarLeidoEnParalelo(input.connection, input.sesion, String(cuerpo.chatId));
  const enviar = (extra: Record<string, unknown>) =>
    enviarConReintentoDeLid(String(cuerpo.chatId), (chatId) =>
      wahaRequest<unknown>(input.connection, RUTA_POR_TIPO[input.tipo], {
        method: "POST",
        body: JSON.stringify({ ...cuerpo, ...extra, chatId }),
        timeoutMs: TIMEOUT_MEDIA_MS,
      }),
    );

  const inicio = Date.now();
  let reintento = false;
  let convertUsado = cuerpo.convert;
  let respuesta: unknown;
  try {
    try {
      respuesta = await conAcompanantes(acompanantes, () => enviar({}));
    } catch (error) {
      /*
        Si WAHA RECHAZA (4xx) la nota con `convert: false`, se vuelve UNA vez al camino de siempre.
        Solo con un rechazo: si se agoto el plazo, la nota pudo haber salido y reintentar la duplicaria.
      */
      const rechazo = error instanceof WahaError && error.status >= 400 && error.status < 500;
      if (input.tipo !== "audio" || convertUsado !== false || !rechazo) {
        throw error;
      }
      reintento = true;
      convertUsado = true;
      const archivo = { ...(cuerpo.file as Record<string, unknown>) };
      if (input.mimetype?.trim()) {
        archivo.mimetype = input.mimetype.trim();
      } else {
        delete archivo.mimetype;
      }
      respuesta = await enviar({ convert: true, file: archivo });
    }
    registrarPasoGatewayWaha({
      tipo: input.tipo,
      convert: convertUsado ?? null,
      reintento,
      ms: Date.now() - inicio,
      msDeteccion,
    });
  } catch (error) {
    registrarPasoGatewayWaha(
      {
        tipo: input.tipo,
        convert: convertUsado ?? null,
        reintento,
        ms: Date.now() - inicio,
        msDeteccion,
        status: error instanceof WahaError ? error.status : null,
      },
      true,
    );
    throw error;
  }
  return { externalId: leerIdDeMensaje(respuesta), raw: respuesta };
}

/** El tipo con el que va la nota de voz cuando ya esta en OGG con opus y WAHA no la convierte. */
const MIMETYPE_OGG_OPUS = "audio/ogg; codecs=opus";

/** Cuanto se espera para leer el comienzo del archivo. Si no alcanza, se sigue como hoy (convert: true). */
const PLAZO_PRIMEROS_BYTES_MS = 3_000;
const CUANTOS_BYTES_SE_LEEN = 64;

/**
 * Si los bytes son de un OGG con opus adentro: empieza con "OggS" y la primera pagina trae "OpusHead".
 * Es la unica forma confiable: un .ogg puede traer vorbis (o un .m4a renombrado), y WhatsApp mostraria
 * la nota rota.
 */
export function esOggOpus(bytes: Uint8Array): boolean {
  if (bytes.length < 36) {
    return false;
  }
  const texto = Buffer.from(bytes).toString("latin1");
  return texto.startsWith("OggS") && texto.includes("OpusHead");
}

/**
 * Los primeros bytes del archivo que se va a mandar, o null si no se pudieron leer.
 *
 * Del contenido en base64 se decodifica solo el comienzo. De la URL se piden los primeros bytes con
 * un plazo corto y se corta la descarga apenas llegan: nunca baja el archivo entero.
 */
export async function primerosBytesDelArchivo(input: {
  url?: string | null;
  base64?: string | null;
}): Promise<Uint8Array | null> {
  try {
    const base64 = input.base64?.trim() || "";
    if (base64) {
      // Por si viene como data URL ("data:audio/ogg;base64,....").
      const limpio = base64.replace(/^data:[^,]*,/, "");
      // 88 caracteres de base64 son 66 bytes: alcanza para la primera pagina del OGG.
      return new Uint8Array(Buffer.from(limpio.slice(0, 88), "base64"));
    }

    const url = input.url?.trim() || "";
    if (!/^https?:\/\//i.test(url)) {
      return null;
    }
    const respuesta = await fetch(url, {
      headers: { Range: `bytes=0-${CUANTOS_BYTES_SE_LEEN - 1}` },
      cache: "no-store",
      signal: AbortSignal.timeout(PLAZO_PRIMEROS_BYTES_MS),
    });
    if (!respuesta.ok || !respuesta.body) {
      await respuesta.body?.cancel().catch(() => {});
      return null;
    }
    // Si el servidor ignora el Range manda el archivo entero: se lee solo el comienzo y se corta.
    const lector = respuesta.body.getReader();
    const partes: Uint8Array[] = [];
    let total = 0;
    while (total < CUANTOS_BYTES_SE_LEEN) {
      const { done, value } = await lector.read();
      if (done || !value) {
        break;
      }
      partes.push(value);
      total += value.length;
    }
    await lector.cancel().catch(() => {});
    return new Uint8Array(Buffer.concat(partes)).slice(0, CUANTOS_BYTES_SE_LEEN);
  } catch {
    // Sin poder leerlo se sigue como hoy: WAHA lo convierte.
    return null;
  }
}

/** Una linea [envio-medio] por envio de archivo a WAHA: cuanto tardo el gateway. Sin telefonos ni contenido. */
function registrarPasoGatewayWaha(datos: Record<string, unknown>, fallo = false) {
  const linea = `[envio-medio] ${JSON.stringify({ paso: "gateway-waha", ...datos })}`;
  if (fallo) {
    console.error(linea);
  } else {
    console.info(linea);
  }
}

/* -------------------------------------------------------- fotos de perfil */

/**
 * La foto de perfil de un contacto.
 *
 * Es lo que con evogo estaba APAGADO: alli cada consulta colgaba ~75s cuando WhatsApp
 * rate-limitea, y el goteo automatico saturaba el gateway hasta bloquear los ENVIOS. Medido en
 * WAHA: 272 ms la primera vez y 21 ms despues. Por eso aca si se puede tener fotos.
 *
 * La URL que devuelve es del CDN de WhatsApp (pps.whatsapp.net): se abre sin clave, pero CADUCA.
 * Por eso arriba se guarda con vencimiento y se vuelve a pedir, no se toma como definitiva.
 */
export async function fotoDeContactoWaha(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
}): Promise<string | null> {
  try {
    const chatId = chatIdDeTelefono(input.telefono);
    const datos = await wahaRequest<{ profilePictureURL?: unknown }>(
      input.connection,
      `/api/contacts/profile-picture?session=${encodeURIComponent(input.sesion)}&contactId=${encodeURIComponent(chatId)}`,
    );
    const url = datos?.profilePictureURL;
    return typeof url === "string" && url.trim() ? url : null;
  } catch (error) {
    /*
      Que la sesion no este lista NO es un error.

      WAHA responde 422 mientras la linea espera el QR. Anotarlo como error llenaba el registro de
      ruido y escondia los problemas de verdad.
    */
    if (error instanceof WahaError && error.status === 422) {
      return null;
    }
    console.error("[waha] no pude traer la foto de", input.telefono, error);
    return null;
  }
}

/** La foto y el nombre del NUMERO conectado, para la tarjeta del canal. */
export async function perfilDeLaLineaWaha(
  connection: WahaConnection,
  sesion: string,
): Promise<{ nombre: string | null; foto: string | null } | null> {
  try {
    const datos = await wahaRequest<{ name?: unknown; picture?: unknown }>(
      connection,
      `/api/${encodeURIComponent(sesion)}/profile`,
    );
    return {
      nombre: typeof datos?.name === "string" ? datos.name : null,
      foto: typeof datos?.picture === "string" && datos.picture.trim() ? datos.picture : null,
    };
  } catch {
    // La foto es cosmetica: si falla, la tarjeta muestra el avatar generico y nada mas.
    return null;
  }
}

/* ------------------------------------------------------------------ historial */

/**
 * Los chats de una linea, del mas reciente al mas viejo.
 *
 * Esto es lo que evogo NO puede hacer: no tiene forma de listar chats ni mensajes, y por eso el
 * boton "Sincronizar chats" nunca funciono ahi. En WAHA se piden y llegan.
 */
export async function listarChatsWaha(input: {
  connection: WahaConnection;
  sesion: string;
  limite?: number;
}): Promise<Array<{ id: string; nombre: string | null; foto: string | null }>> {
  const limite = Math.min(Math.max(input.limite ?? 100, 1), 500);
  const datos = await wahaRequest<Array<Record<string, unknown>>>(
    input.connection,
    `/api/${encodeURIComponent(input.sesion)}/chats/overview?limit=${limite}`,
  );

  if (!Array.isArray(datos)) {
    return [];
  }

  return datos
    .map((chat) => ({
      id: typeof chat.id === "string" ? chat.id : "",
      nombre: typeof chat.name === "string" ? chat.name : null,
      foto: typeof chat.picture === "string" ? chat.picture : null,
    }))
    /*
      Los grupos se descartan.

      El CRM trabaja por CONTACTO: un grupo no tiene un telefono al que atribuirle la
      conversacion, y traerlos llenaria el embudo de "leads" que no son personas.
    */
    .filter((chat) => chat.id && chat.id.endsWith("@c.us"));
}

/** Los mensajes de un chat, tal como los guarda WAHA (formato WAMessage). */
export async function mensajesDeChatWaha(input: {
  connection: WahaConnection;
  sesion: string;
  chatId: string;
  limite?: number;
  desplazamiento?: number;
}): Promise<Array<Record<string, unknown>>> {
  const limite = Math.min(Math.max(input.limite ?? 100, 1), 500);
  const desde = Math.max(input.desplazamiento ?? 0, 0);
  /*
    downloadMedia=false a proposito.

    Traer el historial con los archivos adentro multiplica el tiempo y el peso por cada foto de
    cada chat. Lo que importa al importar es la conversacion; la media entrante se resuelve
    despues, cuando alguien abre ese chat.
  */
  const datos = await wahaRequest<Array<Record<string, unknown>>>(
    input.connection,
    `/api/${encodeURIComponent(input.sesion)}/chats/${encodeURIComponent(input.chatId)}/messages` +
      `?limit=${limite}&offset=${desde}&downloadMedia=false`,
  );

  return Array.isArray(datos) ? datos : [];
}

/**
 * Convierte un mensaje historico de WAHA al formato que entiende el resto del CRM.
 *
 * Reusa el MISMO traductor del webhook: asi un mensaje importado y uno que llega en vivo se
 * guardan igual, con el mismo tipo y el mismo id. Si se escribiera aparte, las dos formas se
 * irian separando y un dia el historial mostraria las cosas distinto que el chat.
 */
export function comoMensajeDeEvolution(
  sesion: string,
  mensaje: Record<string, unknown>,
): Record<string, unknown> | null {
  const traduccion = traducirEventoWaha({ event: "message.any", session: sesion, payload: mensaje });
  if (!traduccion.evolution) {
    return null;
  }
  const datos = traduccion.evolution.data;
  return datos && typeof datos === "object" ? (datos as Record<string, unknown>) : null;
}

/* ----------------------------------------------------------------- presencia */

export type PresenciaWaha = {
  /** Como identifica WhatsApp al contacto: puede ser su numero O su LID. */
  identidad: string;
  /** true mientras escribe o graba; false cuando paro. */
  activo: boolean;
  /** "typing" | "recording" — para decir "escribiendo..." o "grabando audio...". */
  que: "escribiendo" | "grabando" | null;
  /** Tiene WhatsApp abierto en este momento. Escribir implica estar en linea. */
  enLinea: boolean;
  /*
    El estado TAL CUAL lo mando WhatsApp.

    Solo para el log. Todo lo que no sea typing/recording/online cae en el mismo saco de "paro",
    asi que si el aviso de grabar llegara con otro nombre lo estariamos tirando sin enterarnos.
    Guardando el crudo, el log lo delata en vez de callarlo.
  */
  crudo: string;
};

/**
 * Lee un evento `presence.update`.
 *
 * Verificado contra el servidor (GOWS 2026.8.1). El payload real:
 *   { id: "37898875334784@lid",
 *     presences: [{ participant: "...", lastKnownPresence: "typing", lastSeen: null }] }
 *
 * Dos cosas que solo se ven mirando el evento de verdad:
 *
 * 1. El contacto viene identificado por su LID, NO por su telefono. Es el tercer lugar donde
 *    aparece lo mismo; comparando por telefono la burbuja no se mostraria nunca.
 * 2. La lectura `GET /presence/{chat}` devuelve vacio en GOWS: hay que construir sobre el EVENTO,
 *    no sobre la consulta.
 *
 * Ademas la suscripcion CADUCA a los pocos minutos: hay que renovarla al abrir cada chat, o la
 * funcion andaria al principio y dejaria de andar sin motivo aparente.
 */
export function leerPresenciaWaha(
  cuerpo: unknown,
): { sesion: string; presencia: PresenciaWaha } | null {
  if (!cuerpo || typeof cuerpo !== "object") {
    return null;
  }
  const evento = cuerpo as EventoWaha;
  if (evento.event !== "presence.update") {
    return null;
  }
  const sesion = typeof evento.session === "string" ? evento.session : "";
  const datos = (evento.payload ?? {}) as { id?: unknown; presences?: unknown };
  const identidad = typeof datos.id === "string" ? datos.id : "";
  if (!sesion || !identidad) {
    return null;
  }

  const lista = Array.isArray(datos.presences) ? datos.presences : [];
  const primera = (lista[0] ?? {}) as { lastKnownPresence?: unknown };
  const estado =
    typeof primera.lastKnownPresence === "string" ? primera.lastKnownPresence.toLowerCase() : "";

  const que = estado === "typing" ? "escribiendo" : estado === "recording" ? "grabando" : null;

  /*
    "En linea" tambien sale de aca, y es el MISMO evento que el "escribiendo".

    WhatsApp avisa `online` cuando la persona abre la app y `offline` cuando la cierra; estabamos
    tirando esos dos y quedandonos solo con typing/recording. Y quien escribe esta en linea por
    definicion, aunque en ese aviso no lo diga.
  */
  const enLinea = estado === "online" || estado === "available" || Boolean(que);

  return { sesion, presencia: { identidad, activo: Boolean(que), que, enLinea, crudo: estado } };
}

/**
 * Borra un mensaje para todos.
 *
 * Verificado contra el servidor: `DELETE /api/{sesion}/chats/{chat}/messages/{id}` y devuelve el
 * acuse del borrado. El id es el mismo que guardamos (`true_<chat>_<hash>`), y el chat va en
 * forma `@c.us`.
 *
 * A diferencia del envio, aca NO se traga el error: el que borra esta mirando la pantalla y tiene
 * que enterarse si el mensaje sigue en el telefono del cliente.
 */
export async function borrarMensajeWaha(input: {
  connection: WahaConnection;
  sesion: string;
  chatId: string;
  mensajeId: string;
}): Promise<void> {
  await wahaRequest(
    input.connection,
    `/api/${encodeURIComponent(input.sesion)}/chats/${encodeURIComponent(input.chatId)}` +
      `/messages/${encodeURIComponent(input.mensajeId)}`,
    { method: "DELETE", esperaJson: false },
  );
}

/**
 * Edita el texto de un mensaje propio ya enviado.
 *
 * Ruta de WAHA: `PUT /api/{sesion}/chats/{chat}/messages/{id}` con `{ text }`; es la hermana de la
 * que borra. WhatsApp solo deja editar dentro de los 15 minutos y solo texto.
 *
 * NO se traga el error: quien edita esta mirando la pantalla y tiene que saber si el cliente
 * sigue viendo el texto viejo (hay motores de WAHA que no editan).
 */
export async function editarMensajeWaha(input: {
  connection: WahaConnection;
  sesion: string;
  chatId: string;
  mensajeId: string;
  texto: string;
}): Promise<void> {
  await wahaRequest(
    input.connection,
    `/api/${encodeURIComponent(input.sesion)}/chats/${encodeURIComponent(input.chatId)}` +
      `/messages/${encodeURIComponent(input.mensajeId)}`,
    { method: "PUT", body: JSON.stringify({ text: input.texto }), esperaJson: false },
  );
}

/**
 * Bloquea (o desbloquea) un contacto en WhatsApp, desde la linea de esta sesion.
 *
 * Contrato sacado del OpenAPI del servidor (02-10-2026): `POST /api/contacts/block` y
 * `/api/contacts/unblock` con `{ contactId, session }`. El contacto se arma igual que para enviar:
 * un lead de anuncio sin telefono va como "@lid", y si WhatsApp no lo reconoce como telefono se
 * reintenta asi.
 *
 * NO se traga el error: quien bloquea tiene que saber si en WhatsApp quedo bloqueado o no.
 */
export async function bloquearContactoWaha(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
  bloquear: boolean;
}): Promise<void> {
  const chatId = await chatIdParaEnviar(input);
  await enviarConReintentoDeLid(chatId, (contactId) =>
    wahaRequest(input.connection, `/api/contacts/${input.bloquear ? "block" : "unblock"}`, {
      method: "POST",
      body: JSON.stringify({ contactId, session: input.sesion }),
      esperaJson: false,
    }),
  );
}

/**
 * Avisa a WhatsApp que queremos saber cuando este contacto escribe.
 *
 * Sin esto no llega ningun evento. Y caduca: se vuelve a llamar cada vez que alguien abre el chat.
 */
export async function suscribirPresenciaWaha(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
}): Promise<void> {
  try {
    await wahaRequest(
      input.connection,
      `/api/${encodeURIComponent(input.sesion)}/presence/${encodeURIComponent(chatIdDeTelefono(input.telefono))}/subscribe`,
      { method: "POST", body: "{}" },
    );
  } catch {
    // Es cosmetico: si falla, el chat funciona igual y solo no se ve "escribiendo...".
  }
}

/**
 * A que chat pertenece un mensaje, sacado de su propio id.
 *
 * WAHA arma el id como `<fromMe>_<chat>_<hash>`, asi que el chat viaja adentro del id que ya
 * tenemos guardado en el mensaje. Sirve para volver a pedirle el archivo a un mensaje viejo sin
 * adivinar el jid a partir del telefono del contacto -los que entran por un anuncio no tienen
 * telefono, son un @lid- y sin salir a leer el payload crudo.
 */
export function chatIdDeUnMensajeWaha(externalId?: string | null): string | null {
  const id = (externalId ?? "").trim();
  const primerGuion = id.indexOf("_");
  const ultimoGuion = id.lastIndexOf("_");
  if (primerGuion < 1 || ultimoGuion <= primerGuion) {
    return null;
  }
  const chat = id.slice(primerGuion + 1, ultimoGuion);
  // Sin arroba no es un chat de WhatsApp; mejor decir que no se pudo que pedir cualquier cosa.
  return chat.includes("@") ? chat : null;
}

/* ------------------------------------------------- ediciones y borrados */

export type CambioDeMensajeWaha =
  | { tipo: "edicion"; sesion: string; idMensaje: string; texto: string | null }
  | { tipo: "borrado"; sesion: string; idMensaje: string };

/**
 * Lee `message.edited` y `message.revoked`: el cliente edito o borro un mensaje en su WhatsApp.
 *
 * El id que traen (`editedMessageId`, `revokedMessageId`) es el del mensaje ORIGINAL y viene crudo,
 * sin el `<fromMe>_<chat>_` adelante; el `id` de afuera es el de la accion misma y no sirve para
 * encontrar la burbuja. Si falta, se deja rastro de lo que vino: la doc no muestra el payload de GOWS.
 */
export function leerEdicionOBorradoWaha(cuerpo: unknown): CambioDeMensajeWaha | null {
  if (!cuerpo || typeof cuerpo !== "object") {
    return null;
  }
  const evento = cuerpo as EventoWaha;
  if (evento.event !== "message.edited" && evento.event !== "message.revoked") {
    return null;
  }
  const sesion = typeof evento.session === "string" ? evento.session : "";
  const datos = (evento.payload ?? {}) as Record<string, unknown>;
  const clave = evento.event === "message.edited" ? "editedMessageId" : "revokedMessageId";
  const idMensaje = typeof datos[clave] === "string" ? (datos[clave] as string) : "";
  if (!sesion || !idMensaje) {
    console.log(`[waha ${evento.event}] sin ${clave}; claves:`, Object.keys(datos).join(","));
    return null;
  }
  return evento.event === "message.edited"
    ? { tipo: "edicion", sesion, idMensaje, texto: typeof datos.body === "string" ? datos.body : null }
    : { tipo: "borrado", sesion, idMensaje };
}

/* --------------------------------------------- escribiendo y visto azul */

const PLAZO_DE_PRESENCIA_MS = 3000;

/**
 * Devuelve la linea a "desconectada".
 *
 * Probado contra el servidor (13-sep-2026): `startTyping` pone la sesion ONLINE y `stopTyping` NO la
 * devuelve. Mientras una sesion esta online WhatsApp deja de mandar notificaciones al celular de esa
 * linea -la asesora que atiende desde el telefono dejaria de enterarse de los mensajes-. Por eso
 * todo lo que toca la presencia termina aca, pase lo que pase.
 */
export async function volverADesconectadaWaha(connection: WahaConnection, sesion: string): Promise<void> {
  try {
    await wahaRequest(connection, `/api/${encodeURIComponent(sesion)}/presence`, {
      method: "POST",
      body: JSON.stringify({ presence: "offline" }),
      timeoutMs: PLAZO_DE_PRESENCIA_MS,
    });
  } catch (error) {
    console.warn("[waha presencia] no se pudo volver a desconectada", {
      sesion,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Visto azul en el WhatsApp del cliente, pero SOLO al responder.
 *
 * Decision de Alex (13-sep-2026): abrir un chat en el CRM no marca nada -la asesora puede leer sin que
 * el cliente se entere-; responder si, lo haga una asesora o el agente de IA, como pasa en el
 * telefono. Por eso vive en el envio y no en la apertura del chat.
 *
 * Usa la ruta que lee todo lo pendiente del chat sin pedir ids (con GOWS `sendSeen` necesita la
 * lista). Nunca frena el envio: si falla, el mensaje sale igual.
 */
/**
 * ENVÍOS EN PARALELO (velocidad, 11-nov-2026). Antes cada envío esperaba, en fila: marcar el chat
 * leído (hasta 3 s), volver a "desconectada", enviar y volver a "desconectada" otra vez. Medido: un
 * texto tardaba 6 s. Ahora marcar leído sale A LA VEZ que el envío y no se espera, y "desconectada"
 * va UNA vez, por debajo, cuando terminan los dos (enviar también deja la línea en línea). La asesora
 * solo espera el envío de verdad.
 */
type Acompanantes = { leido: Promise<void>; connection: WahaConnection; sesion: string };

function empezarLeidoEnParalelo(connection: WahaConnection, sesion: string, chatId: string): Acompanantes {
  const leido = chatId
    ? wahaRequest(
        connection,
        `/api/${encodeURIComponent(sesion)}/chats/${encodeURIComponent(chatId)}/messages/read`,
        { method: "POST", body: "{}", timeoutMs: PLAZO_DE_PRESENCIA_MS },
      ).then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
  return { leido, connection, sesion };
}

/** Corre el envío; al terminar (salga bien o mal), "desconectada" va por debajo sin que nadie espere. */
async function conAcompanantes<T>(acompanantes: Acompanantes, enviar: () => Promise<T>): Promise<T> {
  const envio = enviar();
  void Promise.allSettled([acompanantes.leido, envio]).then(() =>
    volverADesconectadaWaha(acompanantes.connection, acompanantes.sesion),
  );
  return envio;
}

async function marcarChatLeidoAntesDeResponder(
  connection: WahaConnection,
  sesion: string,
  chatId: string,
): Promise<void> {
  if (!chatId) {
    return;
  }
  try {
    await wahaRequest(
      connection,
      `/api/${encodeURIComponent(sesion)}/chats/${encodeURIComponent(chatId)}/messages/read`,
      { method: "POST", body: "{}", timeoutMs: PLAZO_DE_PRESENCIA_MS },
    );
  } catch {
    // Es cosmetico: el mensaje sale igual.
  } finally {
    await volverADesconectadaWaha(connection, sesion);
  }
}

/**
 * "Escribiendo..." en el WhatsApp del cliente, justo antes de que salga la respuesta.
 *
 * Primero el visto (la doc de WAHA recomienda leer antes de responder, contra bloqueos). La espera va
 * con techo de 2,5 s porque el agente YA espero su demora antes de armar la respuesta: aca solo se
 * muestra, no se demora de nuevo.
 */
export async function escribiendoWaha(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
  esperaMs: number;
}): Promise<void> {
  const chatId = chatIdDeTelefono(input.telefono);
  const cuerpo = JSON.stringify({ session: input.sesion, chatId });
  try {
    await marcarChatLeidoAntesDeResponder(input.connection, input.sesion, chatId);
    await wahaRequest(input.connection, "/api/startTyping", {
      method: "POST",
      body: cuerpo,
      timeoutMs: PLAZO_DE_PRESENCIA_MS,
    });
    await new Promise((listo) => setTimeout(listo, Math.max(0, Math.min(input.esperaMs, 2500))));
    await wahaRequest(input.connection, "/api/stopTyping", {
      method: "POST",
      body: cuerpo,
      timeoutMs: PLAZO_DE_PRESENCIA_MS,
    }).catch(() => null);
  } finally {
    await volverADesconectadaWaha(input.connection, input.sesion);
  }
}
