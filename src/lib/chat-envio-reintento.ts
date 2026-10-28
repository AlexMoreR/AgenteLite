/**
 * Envio de texto de Chats: reintento sin duplicar y mensajes que no salieron.
 *
 * Logica pura (sin red ni base): la usan el navegador (shared-inbox), la ruta del servidor
 * (/api/cliente/chats/enviar) y la prueba `test:envio-reintento`.
 *
 * Reglas:
 * - Cada mensaje lleva un NUMERO UNICO (`clientMessageId`). Reintentar el mismo mensaje manda el
 *   mismo numero, y el servidor no lo vuelve a enviar a WhatsApp si ya lo tiene.
 * - Solo se reintenta solo cuando es seguro que el mensaje NO salio. Si el gateway tardo de mas no se
 *   sabe si salio: queda "No se envió · Reintentar" y la asesora decide con un toque.
 */

export type MotivoDeFalloDeEnvio =
  | "version_vieja"
  | "sin_red"
  | "timeout_gateway"
  | "gateway_rechazo"
  | "conexion_cerrada"
  | "guardado_fallo"
  | "sesion"
  | "otro";

export type FalloDeEnvio = {
  motivo: MotivoDeFalloDeEnvio;
  /** true cuando es seguro que el mensaje no salio y se puede repetir solo. */
  reintentable: boolean;
};

/** Esperas entre intentos: 1,5 s y 4 s (como mucho 2 reintentos). */
export const ESPERAS_DE_REINTENTO_MS: readonly number[] = [1500, 4000];

export const MAX_ID_DE_ENVIO = 80;

/** Numero unico de un mensaje. Se crea una vez al enviar y se reusa en cada reintento. */
export function nuevoIdDeEnvio(): string {
  const cripto = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (cripto?.randomUUID) {
    return cripto.randomUUID();
  }
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Deja pasar solo un numero unico con forma valida (lo que llega del navegador no se confia). */
export function idDeEnvioValido(valor: unknown): string | null {
  if (typeof valor !== "string") {
    return null;
  }
  const limpio = valor.trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(limpio) ? limpio : null;
}

/**
 * Dice por que fallo un envio y si es seguro repetirlo.
 *
 * Entrada: el texto del error que dio el servidor (o el navegador) y, si hubo respuesta HTTP, su
 * codigo. `sinRed` es cuando el navegador ni consiguio hablar con el servidor.
 */
export function clasificarFalloDeEnvio(input: {
  error?: string | null;
  status?: number | null;
  sinRed?: boolean;
}): FalloDeEnvio {
  const texto = (input.error ?? "").toLowerCase();
  const status = input.status ?? null;

  if (input.sinRed) {
    return { motivo: "sin_red", reintentable: true };
  }
  if (/failed to find server action|older or newer deployment/.test(texto)) {
    return { motivo: "version_vieja", reintentable: true };
  }
  if (status === 401 || status === 403) {
    return { motivo: "sesion", reintentable: false };
  }
  // El servidor aun no atendia el pedido (reinicio, subida de version): nunca llego a WhatsApp.
  if (status === 404 || status === 502 || status === 503) {
    return { motivo: status === 404 ? "version_vieja" : "sin_red", reintentable: true };
  }
  // Tiempo agotado: no se sabe si salio. NO se repite solo.
  if (status === 408 || status === 504 || /no respondio a tiempo|timeout|timed out|tiempo agotado/.test(texto)) {
    return { motivo: "timeout_gateway", reintentable: false };
  }
  if (/guardado fallo/.test(texto)) {
    return { motivo: "guardado_fallo", reintentable: false };
  }
  if (/connection closed|conexion cerrada|websocket|not connected|desconectad|no esta conectad|socket hang up|econnreset|econnrefused/.test(texto)) {
    return { motivo: "conexion_cerrada", reintentable: true };
  }
  if (/access token|no autorizado|no esta activa|no se encontro|monitore/.test(texto)) {
    return { motivo: "otro", reintentable: false };
  }
  // El gateway contesto que no (el mensaje no salio): "No se pudo enviar el mensaje: <detalle>".
  if (/no se pudo enviar el mensaje:|api oficial/.test(texto)) {
    return { motivo: "gateway_rechazo", reintentable: true };
  }
  return { motivo: "otro", reintentable: false };
}

/** Lo que devuelve un intento de envio (la respuesta del servidor ya leida). */
export type RespuestaDeEnvio = {
  ok?: boolean;
  suppressOptimistic?: boolean;
  error?: string;
  motivo?: MotivoDeFalloDeEnvio;
  reintentable?: boolean;
  yaEnviado?: boolean;
};

export type SalidaDeEnvio<R extends RespuestaDeEnvio> = {
  resultado: R;
  /** Cuantas veces se llamo al servidor (1 = salio o fallo a la primera). */
  intentos: number;
};

/**
 * Manda el mensaje y, si falla de forma segura de repetir, lo vuelve a intentar hasta 2 veces con
 * el mismo numero unico. Devuelve el ultimo resultado.
 */
export async function enviarConReintento<R extends RespuestaDeEnvio>(input: {
  enviarUnaVez: (intento: number) => Promise<R>;
  esperar?: (ms: number) => Promise<void>;
  esperas?: readonly number[];
}): Promise<SalidaDeEnvio<R>> {
  const esperas = input.esperas ?? ESPERAS_DE_REINTENTO_MS;
  const esperar = input.esperar ?? ((ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms)));

  let resultado = await input.enviarUnaVez(1);
  let intentos = 1;
  while (resultado.ok === false && resultado.reintentable === true && intentos <= esperas.length) {
    await esperar(esperas[intentos - 1]);
    intentos += 1;
    resultado = await input.enviarUnaVez(intentos);
  }
  return { resultado, intentos };
}

/* ───────── Candado en memoria (servidor): el mismo envio no corre dos veces a la vez ───────── */

const enviosEnCurso = new Map<string, number>();
const VIDA_DEL_CANDADO_MS = 90_000;

/** Toma el candado de un envio. false = ese mismo envio ya esta en curso. */
export function tomarCandadoDeEnvio(clave: string, ahora = Date.now()): boolean {
  for (const [otra, desde] of enviosEnCurso) {
    if (ahora - desde > VIDA_DEL_CANDADO_MS) {
      enviosEnCurso.delete(otra);
    }
  }
  if (enviosEnCurso.has(clave)) {
    return false;
  }
  enviosEnCurso.set(clave, ahora);
  return true;
}

export function soltarCandadoDeEnvio(clave: string): void {
  enviosEnCurso.delete(clave);
}

/* ───────── Mensajes que no salieron, guardados en el navegador ───────── */

export const CLAVE_DE_FALLIDOS = "agentelite:chat-envios-fallidos:v1";
const MAX_FALLIDOS_EN_NAVEGADOR = 20;
const VIDA_DE_FALLIDO_MS = 7 * 24 * 60 * 60 * 1000;

export type FallidoGuardado = {
  /** Id de la burbuja. */
  id: string;
  conversationId: string;
  chatKey: string;
  /** Campos del formulario tal cual (incluye el numero unico). */
  campos: Array<[string, string]>;
  /** Texto sin firma. */
  texto: string;
  /** Texto como se ve en la burbuja (puede llevar firma). */
  contenido: string;
  creadoEn: number;
  error: string;
};

type AlmacenSimple = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function esFallidoValido(valor: unknown): valor is FallidoGuardado {
  if (!valor || typeof valor !== "object") {
    return false;
  }
  const f = valor as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    typeof f.conversationId === "string" &&
    typeof f.chatKey === "string" &&
    typeof f.texto === "string" &&
    f.texto.trim().length > 0 &&
    typeof f.contenido === "string" &&
    typeof f.creadoEn === "number" &&
    typeof f.error === "string" &&
    Array.isArray(f.campos) &&
    f.campos.every((par) => Array.isArray(par) && par.length === 2 && typeof par[0] === "string" && typeof par[1] === "string")
  );
}

/** Lee los fallidos guardados (nunca lanza: sin almacenamiento o con datos rotos devuelve vacio). */
export function leerFallidosGuardados(almacen: AlmacenSimple | null | undefined, ahora = Date.now()): FallidoGuardado[] {
  if (!almacen) {
    return [];
  }
  try {
    const crudo = almacen.getItem(CLAVE_DE_FALLIDOS);
    if (!crudo) {
      return [];
    }
    const lista = JSON.parse(crudo) as unknown;
    if (!Array.isArray(lista)) {
      return [];
    }
    return lista
      .filter(esFallidoValido)
      .filter((f) => ahora - f.creadoEn < VIDA_DE_FALLIDO_MS)
      .slice(-MAX_FALLIDOS_EN_NAVEGADOR);
  } catch {
    return [];
  }
}

/** Guarda la lista completa de fallidos (vacia = borra la clave). Nunca lanza. */
export function guardarFallidos(almacen: AlmacenSimple | null | undefined, lista: readonly FallidoGuardado[]): void {
  if (!almacen) {
    return;
  }
  try {
    if (lista.length === 0) {
      almacen.removeItem(CLAVE_DE_FALLIDOS);
      return;
    }
    almacen.setItem(CLAVE_DE_FALLIDOS, JSON.stringify(lista.slice(-MAX_FALLIDOS_EN_NAVEGADOR)));
  } catch {
    // Almacenamiento lleno o bloqueado: el fallido igual sigue en pantalla mientras no se recargue.
  }
}

/* ───────── Envio del navegador a /api/cliente/chats/enviar ───────── */

export const RUTA_DE_ENVIO_DE_TEXTO = "/api/cliente/chats/enviar";
export const RUTA_DE_FALLO_DE_ENVIO = "/api/cliente/chats/enviar/fallo";
/** Si el servidor no contesta en este tiempo (el gateway ya tiene 25 s), no se sabe si salio. */
export const TIEMPO_LIMITE_DEL_NAVEGADOR_MS = 45_000;

export type FalloSinServidor = {
  motivo: MotivoDeFalloDeEnvio;
  detalle: string;
  intento: number;
  conversationId: string;
  source: string;
  clientMessageId: string | null;
};

type FetchLike = (entrada: string, init?: RequestInit) => Promise<Response>;

function copiarFormulario(origen: FormData): FormData {
  const copia = new FormData();
  origen.forEach((valor, nombre) => {
    if (typeof valor === "string") {
      copia.set(nombre, valor);
    }
  });
  return copia;
}

/**
 * Manda UN intento a la ruta del servidor y devuelve la respuesta ya clasificada. Nunca lanza.
 * `alFallarSinServidor` se llama cuando el navegador no consiguio una respuesta del servidor (para
 * anotar el error cuando vuelva la conexion).
 */
async function enviarUnIntento(input: {
  formData: FormData;
  intento: number;
  fetchFn: FetchLike;
  alFallarSinServidor?: (info: FalloSinServidor) => void;
}): Promise<RespuestaDeEnvio> {
  const datos = copiarFormulario(input.formData);
  datos.set("intento", String(input.intento));
  const informar = (motivo: MotivoDeFalloDeEnvio, detalle: string) =>
    input.alFallarSinServidor?.({
      motivo,
      detalle,
      intento: input.intento,
      conversationId: String(datos.get("conversationId") ?? ""),
      source: String(datos.get("source") ?? "agent"),
      clientMessageId: idDeEnvioValido(datos.get("clientMessageId")),
    });

  let respuesta: Response;
  try {
    respuesta = await input.fetchFn(RUTA_DE_ENVIO_DE_TEXTO, {
      method: "POST",
      body: datos,
      credentials: "same-origin",
      cache: "no-store",
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(TIEMPO_LIMITE_DEL_NAVEGADOR_MS) : undefined,
    });
  } catch (error) {
    const nombre = error instanceof Error ? error.name : "";
    if (nombre === "TimeoutError" || nombre === "AbortError") {
      informar("timeout_gateway", "El servidor no contesto a tiempo");
      return {
        ok: false,
        error: "El mensaje tardo en salir y no se sabe si salio. Revisa el chat antes de reintentar.",
        motivo: "timeout_gateway",
        reintentable: false,
      };
    }
    informar("sin_red", error instanceof Error ? error.message : "Sin conexion");
    return { ok: false, error: "Sin conexion. No se pudo enviar el mensaje.", motivo: "sin_red", reintentable: true };
  }

  const cuerpo = (await respuesta.json().catch(() => null)) as RespuestaDeEnvio | null;
  if (cuerpo && typeof cuerpo.ok === "boolean") {
    if (cuerpo.ok === false) {
      // El servidor ya anoto este error; aca solo se completa lo que falte para decidir.
      const fallo =
        cuerpo.motivo && typeof cuerpo.reintentable === "boolean"
          ? { motivo: cuerpo.motivo, reintentable: cuerpo.reintentable }
          : clasificarFalloDeEnvio({ error: cuerpo.error, status: respuesta.status });
      return { ...cuerpo, motivo: fallo.motivo, reintentable: fallo.reintentable };
    }
    return cuerpo;
  }

  // Sin cuerpo valido (502 del proxy, pagina de error, version vieja): el servidor no atendio el pedido.
  const fallo = clasificarFalloDeEnvio({ status: respuesta.status });
  informar(fallo.motivo, `Respuesta ${respuesta.status} sin datos`);
  return {
    ok: false,
    error: "No se pudo enviar el mensaje",
    motivo: fallo.motivo,
    reintentable: fallo.reintentable,
  };
}

/**
 * Envia un texto por la ruta del servidor, con el reintento de `enviarConReintento`.
 * Pone el numero unico si el formulario no lo trae; el mismo numero viaja en cada reintento.
 */
export async function enviarTextoPorRuta(input: {
  formData: FormData;
  fetchFn?: FetchLike;
  esperar?: (ms: number) => Promise<void>;
  esperas?: readonly number[];
  alFallarSinServidor?: (info: FalloSinServidor) => void;
}): Promise<RespuestaDeEnvio & { intentos: number }> {
  if (!idDeEnvioValido(input.formData.get("clientMessageId"))) {
    input.formData.set("clientMessageId", nuevoIdDeEnvio());
  }
  const fetchFn: FetchLike = input.fetchFn ?? ((entrada, init) => fetch(entrada, init));
  const salida = await enviarConReintento({
    enviarUnaVez: (intento) =>
      enviarUnIntento({ formData: input.formData, intento, fetchFn, alFallarSinServidor: input.alFallarSinServidor }),
    esperar: input.esperar,
    esperas: input.esperas,
  });
  return { ...salida.resultado, intentos: salida.intentos };
}

/* Fallos que el servidor no vio: se anotan cuando hay conexion (en memoria; no sobreviven a una recarga). */
const fallosSinServidorPendientes: FalloSinServidor[] = [];

/** Guarda un fallo "sin servidor" y trata de anotarlo ya. Si no hay conexion queda para despues. */
export function registrarFalloSinServidor(info: FalloSinServidor, fetchFn?: FetchLike): void {
  fallosSinServidorPendientes.push(info);
  if (fallosSinServidorPendientes.length > 50) {
    fallosSinServidorPendientes.shift();
  }
  void vaciarFallosSinServidor(fetchFn);
}

/** Intenta anotar los fallos pendientes (se llama tambien cuando vuelve la conexion). */
export async function vaciarFallosSinServidor(fetchFn?: FetchLike): Promise<void> {
  const enviar: FetchLike = fetchFn ?? ((entrada, init) => fetch(entrada, init));
  while (fallosSinServidorPendientes.length > 0) {
    const siguiente = fallosSinServidorPendientes[0];
    try {
      const respuesta = await enviar(RUTA_DE_FALLO_DE_ENVIO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(siguiente),
        credentials: "same-origin",
        keepalive: true,
      });
      if (!respuesta.ok && respuesta.status !== 401) {
        return;
      }
      fallosSinServidorPendientes.shift();
    } catch {
      return;
    }
  }
}
