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

/**
 * Los eventos que le pedimos a WAHA.
 *
 * `message.ack` es el doble check: sin el sabemos que WhatsApp acepto el mensaje, pero no si le
 * llego al cliente ni si lo leyo. Es exactamente el dato que falto para diagnosticar la caida del
 * 28-ago, donde todo "figuraba enviado".
 */
const EVENTOS = ["message", "message.any", "message.ack", "session.status"] as const;

async function wahaRequest<T>(
  connection: WahaConnection,
  path: string,
  init?: RequestInit & { esperaJson?: boolean },
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
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

export async function enviarTextoWaha(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
  texto: string;
  citarId?: string | null;
}): Promise<{ externalId: string | null; raw: unknown }> {
  const respuesta = await enviarConReintentoDeLid(await chatIdParaEnviar(input), (chatId) =>
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
        }),
      },
    ),
  );

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

  if (nombre !== "message" && nombre !== "message.any") {
    return { motivo: `evento no soportado: ${nombre || "(sin nombre)"}` };
  }

  const mensaje = (evento.payload ?? {}) as {
    id?: unknown;
    timestamp?: unknown;
    from?: unknown;
    fromMe?: unknown;
    body?: unknown;
    hasMedia?: unknown;
    media?: unknown;
    participant?: unknown;
    _data?: unknown;
  };

  const de = typeof mensaje.from === "string" ? mensaje.from : "";
  if (!de) {
    return { motivo: "el mensaje no dice de quien viene" };
  }

  const texto = typeof mensaje.body === "string" ? mensaje.body : "";

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
  if (!tieneMedia && !mediaSinArchivo && !texto.trim()) {
    return { motivo: "mensaje sin texto ni media" };
  }

  const datosCrudos = (mensaje._data ?? {}) as { notifyName?: unknown; pushName?: unknown };
  const nombreDeQuienEscribe =
    typeof datosCrudos.notifyName === "string"
      ? datosCrudos.notifyName
      : typeof datosCrudos.pushName === "string"
        ? datosCrudos.pushName
        : null;

  return {
    evolution: {
      event: "messages.upsert",
      instance: sesion,
      data: {
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
                ...(urlDelArchivo ? { url: urlDelArchivo } : {}),
                mimetype,
                // En WhatsApp el texto que acompana una foto ES el caption, no un mensaje aparte.
                // Sin archivo se deja dicho QUE mando, para que la fila de la lista no quede muda.
                caption: texto || (mediaSinArchivo ? avisoDeMediaPerdida(mimetype) : ""),
                ...(nombreDelArchivo ? { fileName: nombreDelArchivo } : {}),
              },
            }
          : { conversation: texto },
        pushName: nombreDeQuienEscribe,
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
 * telefono, 3 leido, 4 escuchado (audio). Para nosotros 4 es leido tambien: el cliente lo abrio.
 */
export function leerAckWaha(
  cuerpo: unknown,
): { sesion: string; idMensaje: string; estado: EstadoDeEntrega } | null {
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
  return { sesion, idMensaje, estado };
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

  // La nota de voz y el video llevan `convert` obligatorio: sin el, WAHA rechaza el pedido.
  if (input.tipo === "audio" || input.tipo === "video") {
    cuerpo.convert = true;
  }
  // El audio de WhatsApp no tiene epigrafe; mandarlo hace que WAHA rechace el pedido.
  if (input.tipo !== "audio" && input.epigrafe?.trim()) {
    cuerpo.caption = input.epigrafe.trim();
  }

  const respuesta = await enviarConReintentoDeLid(String(cuerpo.chatId), (chatId) =>
    wahaRequest<unknown>(input.connection, RUTA_POR_TIPO[input.tipo], {
      method: "POST",
      body: JSON.stringify({ ...cuerpo, chatId }),
    }),
  );

  return { externalId: leerIdDeMensaje(respuesta), raw: respuesta };
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
  const traduccion = traducirEventoWaha({ event: "message", session: sesion, payload: mensaje });
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

  return { sesion, presencia: { identidad, activo: Boolean(que), que } };
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
