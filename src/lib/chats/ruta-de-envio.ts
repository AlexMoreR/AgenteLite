/*
  Rutas fijas de los envios del chat (despliegue i del plan "envios por rutas fijas").

  El texto ya va por POST /api/cliente/chats/enviar. Los demas envios (archivo, audio, ubicacion, flujo
  y reaccion) eran solo Server Actions, cuyo identificador cambia en cada build: una pestaña vieja
  fallaba con "Failed to find Server Action". Cada ruta de aca es delgada: recibe la entrada EXACTA de
  hoy en JSON y llama a la MISMA accion, que sigue validando con su zod y aplicando sus reglas
  (monitoreo, firma, anti-bloqueo, repetidos de la nota de voz). Aca no se valida ni se convierte nada.

  Este archivo es puro (sin Next ni Prisma) para probarlo con Node: scripts/check-rutas-de-envio.mjs y
  scripts/check-contrato-envios.mjs (con src/lib/chats/contrato-envios.congelados.json).

  CONTRATO (las pestañas abiertas mandan el formato con el que se cargaron, de cualquier version):
  - Solo se AGREGAN campos OPCIONALES.
  - Nunca se renombra ni se quita un campo, una ruta o un campo de la respuesta.
  - Un campo nuevo no puede volverse obligatorio para que el envio funcione.
  - Si cambia la accion de abajo, su zod tiene que seguir aceptando los payloads congelados.
  Una ruta, una vez subida, no se borra.
*/

export const RUTAS_DE_ENVIO = {
  // clientMessageId: agregado despues, opcional (un reintento con el mismo numero no sale dos veces).
  "enviar-archivo": ["source", "conversationId", "agentId", "mediaUrl", "mediaType", "fileName", "mimeType", "caption", "returnTo", "clientMessageId"],
  "enviar-audio": ["source", "conversationId", "agentId", "audioUrl", "returnTo"],
  "enviar-ubicacion": ["conversationId", "agentId", "returnTo"],
  "enviar-flujo": ["source", "conversationId", "flowId", "agentId"],
  reaccionar: ["messageId", "emoji"],
  // Fijar es solo del CRM (no sale a WhatsApp). messageId null = desfijar.
  fijar: ["conversationId", "messageId"],
} as const satisfies Record<string, readonly string[]>;

export type NombreDeRutaDeEnvio = keyof typeof RUTAS_DE_ENVIO;

// Solo viajan URLs y textos cortos: el archivo ya subio aparte (/upload-media, /upload-audio).
export const LIMITE_BYTES_DEL_CUERPO = 32 * 1024;

export const ERROR_SESION_CERRADA = "Tu sesión se cerró. Vuelve a entrar para enviar.";
export const ERROR_NO_AUTORIZADO = "No autorizado";
// El mismo texto que ya contestan las acciones cuando su zod rechaza la entrada.
export const ERROR_DATOS_INVALIDOS = "Datos invalidos";
export const ERROR_LANZO = "No se pudo enviar";

export type RespuestaDeRuta = { status: number; cuerpo: unknown };

/** redirect() de Next por dentro de la accion (sin permiso): se contesta como no autorizado. */
export function esRedireccion(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

/** Copia solo los campos conocidos, sin convertirlos. Los desconocidos se ignoran (cliente mas nuevo). */
export function elegirCampos(cuerpo: Record<string, unknown>, campos: readonly string[]) {
  const elegidos: Record<string, unknown> = {};
  for (const campo of campos) {
    if (Object.prototype.hasOwnProperty.call(cuerpo, campo)) {
      elegidos[campo] = cuerpo[campo];
    }
  }
  return elegidos;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** La logica de la ruta sin I/O: la sesion, el acceso y la lectura del cuerpo llegan de afuera. */
export async function procesarPedido(pedido: {
  nombre: NombreDeRutaDeEnvio;
  sesionValida: boolean;
  accesoAChats: boolean;
  largoDeclarado?: string | null;
  leerCuerpo: () => Promise<string>;
  accion: (entrada: Record<string, unknown>) => Promise<unknown>;
  limiteBytes?: number;
  alLanzar?: (mensaje: string, detalle: Record<string, unknown>) => void;
}): Promise<RespuestaDeRuta> {
  const limite = pedido.limiteBytes ?? LIMITE_BYTES_DEL_CUERPO;
  if (!pedido.sesionValida) {
    return { status: 401, cuerpo: { error: ERROR_SESION_CERRADA } };
  }
  if (!pedido.accesoAChats) {
    return { status: 403, cuerpo: { error: ERROR_NO_AUTORIZADO } };
  }

  const largo = pedido.largoDeclarado ? Number.parseInt(pedido.largoDeclarado, 10) : NaN;
  if (Number.isFinite(largo) && largo > limite) {
    return { status: 413, cuerpo: { error: ERROR_DATOS_INVALIDOS } };
  }

  let texto: string;
  try {
    texto = await pedido.leerCuerpo();
  } catch {
    return { status: 400, cuerpo: { error: ERROR_DATOS_INVALIDOS } };
  }
  if (new TextEncoder().encode(texto).byteLength > limite) {
    return { status: 413, cuerpo: { error: ERROR_DATOS_INVALIDOS } };
  }

  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return { status: 400, cuerpo: { error: ERROR_DATOS_INVALIDOS } };
  }
  if (!esObjeto(cuerpo)) {
    return { status: 400, cuerpo: { error: ERROR_DATOS_INVALIDOS } };
  }

  const entrada = elegirCampos(cuerpo, RUTAS_DE_ENVIO[pedido.nombre]);
  try {
    // Lo que contesta la accion se devuelve sin tocarlo: la pantalla lo lee igual que antes.
    return { status: 200, cuerpo: await pedido.accion(entrada) };
  } catch (error) {
    if (esRedireccion(error)) {
      return { status: 403, cuerpo: { error: ERROR_NO_AUTORIZADO } };
    }
    // Lanzo en medio del envio: no se sabe si salio. La pantalla lo trata como cuando lanzaba la accion.
    const registrar = pedido.alLanzar ?? ((mensaje: string, detalle: Record<string, unknown>) => console.error(mensaje, detalle));
    registrar(`[chats/${pedido.nombre}] el envio lanzo un error`, {
      conversationId: typeof entrada.conversationId === "string" ? entrada.conversationId.slice(0, 200) : null,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 500, cuerpo: { error: ERROR_LANZO, lanzo: true } };
  }
}
