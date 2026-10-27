/*
  Que hacer cuando un texto del chat no sale (queja de las asesoras, reunion del 27-oct-2026:
  "a cada rato al enviar sale error y toca recargar").

  Aca vive solo la decision -sin React ni red ni base de datos- para poder probarla con
  `npm run test:envio-reintento`:

  1. Numero unico por mensaje (clientMessageId): el servidor no manda dos veces el mismo.
  2. Por que fallo (motivo) y si es SEGURO reintentar solo: unicamente cuando es seguro que el
     mensaje NO salio. Si el gateway tardo demasiado no se sabe si salio: no se reintenta solo.
  3. Esperas del reintento automatico (1 o 2 veces) y el bucle que lo aplica.
  4. Mensajes fallidos guardados en el navegador para que sobrevivan a una recarga.
*/

export const ESPERAS_DE_REINTENTO_MS = [1_500, 4_000] as const;
/** Tiempo limite de una llamada al gateway (Evolution GO, Evolution API, API oficial). */
export const TIEMPO_LIMITE_GATEWAY_MS = 25_000;
/** Cuanto espera el navegador la respuesta de la ruta antes de darla por perdida. */
export const TIEMPO_LIMITE_NAVEGADOR_MS = 40_000;

export type MotivoDeFalla =
  | "version_vieja"
  | "sin_red"
  | "timeout_gateway"
  | "gateway_rechazo"
  | "conexion_cerrada"
  | "guardado_fallo"
  | "sin_sesion"
  | "otro";

export const MOTIVOS_DE_FALLA: readonly MotivoDeFalla[] = [
  "version_vieja",
  "sin_red",
  "timeout_gateway",
  "gateway_rechazo",
  "conexion_cerrada",
  "guardado_fallo",
  "sin_sesion",
  "otro",
];

/** Numero unico de un mensaje. Lo pone el navegador al enviar y se repite en cada reintento. */
export function nuevoIdDeMensaje(): string {
  const cripto = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (cripto?.randomUUID) {
    return cripto.randomUUID();
  }
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Un id valido: corto y sin caracteres raros (se guarda dentro de los datos del mensaje). */
export function idDeMensajeValido(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(limpio) ? limpio : null;
}

/** Deduce el motivo a partir del texto del error que dejo el servidor o el gateway. */
export function clasificarMotivo(texto: string | null | undefined): MotivoDeFalla {
  const t = (texto ?? "").toLowerCase();
  if (!t) {
    return "otro";
  }
  if (/failed to find server action|older or newer deployment/.test(t)) {
    return "version_vieja";
  }
  if (/no respondio a tiempo|no respondió a tiempo|timeout|timed out|aborterror|se agoto el tiempo|se agotó el tiempo/.test(t)) {
    return "timeout_gateway";
  }
  if (/connection closed|not connected|no esta conectad|no está conectad|disconnected|websocket/.test(t)) {
    return "conexion_cerrada";
  }
  if (/no autorizado|unauthorized|sesion|sesión/.test(t)) {
    return "sin_sesion";
  }
  if (/fetch failed|failed to fetch|network|econnrefused|econnreset|enotfound|load failed/.test(t)) {
    return "sin_red";
  }
  if (/guardar|guardado/.test(t)) {
    return "guardado_fallo";
  }
  if (/no se pudo enviar|rechaz|respondio con|respondió con|invalid|invalido|inválido|\b4\d\d\b|\b5\d\d\b/.test(t)) {
    return "gateway_rechazo";
  }
  return "otro";
}

/**
 * Si se puede reintentar SOLO sin riesgo de mandar el mensaje dos veces.
 *
 * - version_vieja, sin_red y conexion_cerrada: el mensaje no llego al gateway o este lo cerro
 *   antes de mandarlo.
 * - gateway_rechazo: el gateway contesto que no lo mando.
 * - timeout_gateway: NO se sabe si salio; la asesora decide con "Reintentar" (y el numero unico
 *   evita el doble envio si ya estaba guardado).
 */
export function esReintentable(motivo: MotivoDeFalla): boolean {
  return (
    motivo === "version_vieja" ||
    motivo === "sin_red" ||
    motivo === "conexion_cerrada" ||
    motivo === "gateway_rechazo"
  );
}

export type ResultadoDeEnvio = {
  ok: boolean;
  error?: string;
  suppressOptimistic?: boolean;
  /** El servidor ya tenia este mensaje: no se volvio a mandar. */
  yaEnviado?: boolean;
  motivo?: MotivoDeFalla;
};

export type OpcionesDeReintento = {
  /** Una llamada de envio. Lanza si no hubo respuesta (sin red, corte). */
  enviar: (intento: number) => Promise<ResultadoDeEnvio>;
  esperar?: (ms: number) => Promise<void>;
  /** Para anotar cada intento fallido (el navegador avisa al servidor si ni llego). */
  alFallar?: (info: { intento: number; motivo: MotivoDeFalla; error: string; llegoAlServidor: boolean }) => void;
};

const esperaReal = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/**
 * Envia con hasta 2 reintentos (3 intentos en total), SIEMPRE con el mismo numero unico (lo pone
 * quien llama dentro de `enviar`). Solo reintenta si es seguro que el mensaje no salio.
 */
export async function enviarConReintento(opciones: OpcionesDeReintento): Promise<ResultadoDeEnvio> {
  const esperar = opciones.esperar ?? esperaReal;
  let ultimo: ResultadoDeEnvio = { ok: false, error: "No se pudo enviar el mensaje" };

  for (let intento = 1; intento <= ESPERAS_DE_REINTENTO_MS.length + 1; intento += 1) {
    let motivo: MotivoDeFalla;
    let llegoAlServidor = true;
    try {
      const resultado = await opciones.enviar(intento);
      if (resultado.ok) {
        return resultado;
      }
      motivo = resultado.motivo ?? clasificarMotivo(resultado.error);
      ultimo = { ...resultado, motivo };
    } catch (error) {
      llegoAlServidor = false;
      const texto = error instanceof Error ? error.message : String(error);
      motivo = clasificarMotivo(texto);
      if (motivo === "otro" || motivo === "gateway_rechazo") {
        motivo = "sin_red";
      }
      ultimo = {
        ok: false,
        error: "No se pudo enviar el mensaje (sin conexión)",
        motivo,
      };
    }

    opciones.alFallar?.({
      intento,
      motivo,
      error: ultimo.error ?? "",
      llegoAlServidor,
    });

    const hayOtroIntento = intento <= ESPERAS_DE_REINTENTO_MS.length;
    if (!hayOtroIntento || !esReintentable(motivo)) {
      break;
    }
    await esperar(ESPERAS_DE_REINTENTO_MS[intento - 1]);
  }

  return ultimo;
}

/* ---------- Mensajes fallidos guardados en el navegador ---------- */

export const CLAVE_FALLIDOS_NAVEGADOR = "chats:mensajes-fallidos:v1";
/** Un fallido guardado mas viejo que esto ya no se muestra (el chat cambio, el cliente escribio). */
export const VIGENCIA_FALLIDOS_MS = 12 * 60 * 60 * 1000;

/** Cada asesora guarda lo suyo: en un equipo compartido no se ven los fallidos de otra. */
export function claveDeFallidos(dueno: string | null | undefined): string {
  return `${CLAVE_FALLIDOS_NAVEGADOR}:${(dueno ?? "").trim() || "sin-dueno"}`;
}
const MAXIMO_FALLIDOS_GUARDADOS = 30;

export type FallidoGuardado = {
  id: string;
  conversationId: string;
  content: string;
  matchContent?: string;
  createdAt: string;
  errorDetail?: string | null;
  envio?: { chatKey: string; campos: Array<[string, string]> };
};

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function serializarFallidos(lista: readonly FallidoGuardado[]): string {
  return JSON.stringify(lista.slice(-MAXIMO_FALLIDOS_GUARDADOS));
}

/** Lee la lista guardada; ante cualquier dato raro devuelve una lista vacia. */
export function leerFallidos(texto: string | null | undefined): FallidoGuardado[] {
  if (!texto) {
    return [];
  }
  try {
    const datos: unknown = JSON.parse(texto);
    if (!Array.isArray(datos)) {
      return [];
    }
    return datos.filter(
      (item): item is FallidoGuardado =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as FallidoGuardado).id === "string" &&
        typeof (item as FallidoGuardado).conversationId === "string" &&
        typeof (item as FallidoGuardado).content === "string",
    );
  } catch {
    return [];
  }
}

export function guardarFallidosEnNavegador(
  almacen: Almacen | null | undefined,
  dueno: string | null | undefined,
  lista: readonly FallidoGuardado[],
) {
  try {
    if (!almacen) {
      return;
    }
    if (lista.length === 0) {
      almacen.removeItem(claveDeFallidos(dueno));
      return;
    }
    almacen.setItem(claveDeFallidos(dueno), serializarFallidos(lista));
  } catch {
    // Sin almacenamiento (modo privado, lleno): la burbuja sigue en pantalla igual.
  }
}

export function cargarFallidosDelNavegador(
  almacen: Almacen | null | undefined,
  dueno: string | null | undefined,
  ahora: number = Date.now(),
): FallidoGuardado[] {
  try {
    return leerFallidos(almacen?.getItem(claveDeFallidos(dueno))).filter((item) => {
      const hora = Date.parse(item.createdAt);
      return Number.isFinite(hora) && ahora - hora < VIGENCIA_FALLIDOS_MS;
    });
  } catch {
    return [];
  }
}

/* ---------- Candado en memoria: el mismo numero unico en curso no se manda otra vez ---------- */

/**
 * Dos llamadas con el mismo numero unico a la vez comparten UN solo envio: la segunda espera el
 * resultado de la primera. Igual al candado de las notas de voz; vive en memoria del servidor.
 */
export function crearCandadoDeEnvios<T>(recordarMs = 120_000) {
  const enCurso = new Map<string, Promise<T>>();
  return {
    async ejecutar(id: string, trabajo: () => Promise<T>, recordar: (valor: T) => boolean): Promise<T> {
      const existente = enCurso.get(id);
      if (existente) {
        return existente;
      }
      const promesa = trabajo();
      enCurso.set(id, promesa);
      let guardar = false;
      try {
        const valor = await promesa;
        guardar = recordar(valor);
        return valor;
      } finally {
        if (guardar) {
          setTimeout(() => enCurso.delete(id), recordarMs).unref?.();
        } else {
          enCurso.delete(id);
        }
      }
    },
    tamano: () => enCurso.size,
  };
}
