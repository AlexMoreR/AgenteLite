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
  const digitos = telefono.replace(/\D/g, "");
  return `${digitos}@c.us`;
}

export async function enviarTextoWaha(input: {
  connection: WahaConnection;
  sesion: string;
  telefono: string;
  texto: string;
  citarId?: string | null;
}): Promise<{ externalId: string | null; raw: unknown }> {
  const respuesta = await wahaRequest<{ id?: string | { id?: string }; _data?: unknown }>(
    input.connection,
    "/api/sendText",
    {
      method: "POST",
      body: JSON.stringify({
        session: input.sesion,
        chatId: chatIdDeTelefono(input.telefono),
        text: input.texto,
        ...(input.citarId ? { reply_to: input.citarId } : {}),
      }),
    },
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
export function traducirEventoWaha(
  cuerpo: unknown,
): { evolution: Record<string, unknown>; motivo?: undefined } | { evolution?: undefined; motivo: string } {
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
    participant?: unknown;
    _data?: unknown;
  };

  const de = typeof mensaje.from === "string" ? mensaje.from : "";
  if (!de) {
    return { motivo: "el mensaje no dice de quien viene" };
  }

  /*
    Por ahora solo texto.

    Un mensaje con foto se ignora en vez de guardarse vacio: una burbuja en blanco en el chat es
    peor que ninguna, porque la asesora cree que el cliente no mando nada. Media es el siguiente
    paso, y hasta que este, esto tiene que ser evidente.
  */
  const texto = typeof mensaje.body === "string" ? mensaje.body : "";
  if (mensaje.hasMedia === true) {
    return { motivo: "mensaje con media: todavia no soportado en WAHA" };
  }
  if (!texto.trim()) {
    return { motivo: "mensaje sin texto" };
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
        message: { conversation: texto },
        pushName: nombreDeQuienEscribe,
        messageTimestamp: typeof mensaje.timestamp === "number" ? mensaje.timestamp : undefined,
      },
    },
  };
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
