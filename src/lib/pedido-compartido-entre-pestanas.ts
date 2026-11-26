/**
 * Un mismo pedido automatico, compartido entre las pestañas abiertas del CRM.
 *
 * Aca se dejan varias pestañas abiertas todo el dia, y cada una pedia por su cuenta lo mismo -por
 * ejemplo la lista de 40 chats de la campanita, la consulta mas cara de la app-. Con esto, la pestaña
 * que pide publica la respuesta por un `BroadcastChannel` y las demas la usan mientras sea reciente,
 * sin volver a pedirla.
 *
 * - Si hay un dato de esa clave con menos de `frescoMs`, se devuelve sin pedir (`origen: "compartido"`).
 * - Si otra pestaña avisó que ya está pidiendo esa clave, se espera su respuesta un rato corto.
 * - Si no, se llama `pedir()`, se publica la respuesta y se devuelve (`origen: "red"`).
 * - Un pedido en curso con la misma clave en la misma pestaña se reutiliza.
 * - Sin `BroadcastChannel`, o si algo de esto falla, se llama `pedir()` como siempre.
 *
 * Solo sirve para lecturas: el dato viaja entre pestañas del mismo sitio (misma sesión del navegador).
 */

export type OrigenDelPedido = "red" | "compartido";
export type ResultadoCompartido<T> = { dato: T; origen: OrigenDelPedido };

type CanalParecido = {
  postMessage(mensaje: unknown): void;
  close(): void;
  onmessage: ((evento: { data: unknown }) => void) | null;
};
export type ConstructorDeCanal = new (nombre: string) => CanalParecido;

type MensajeDato = { tipo: "dato"; clave: string; dato: unknown; en: number };
type MensajePidiendo = { tipo: "pidiendo"; clave: string; en: number };

const NOMBRE_DEL_CANAL = "aizencrm-pedidos";
/** Cuanto se espera, como mucho, la respuesta de otra pestaña que ya avisó que está pidiendo. */
const ESPERA_MAXIMA_MS = 5000;

export type OpcionesPedidoCompartido = {
  /** El constructor del canal. Sin pasarlo se usa el `BroadcastChannel` del navegador; con `null`, ninguno. */
  Canal?: ConstructorDeCanal | null;
  nombre?: string;
  esperaMaximaMs?: number;
};

export type PedidoCompartido = {
  pedirCompartido<T>(clave: string, frescoMs: number, pedir: () => Promise<T>): Promise<ResultadoCompartido<T>>;
  cerrar(): void;
};

function canalDelNavegador(): ConstructorDeCanal | null {
  try {
    const Canal = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    return typeof Canal === "function" ? (Canal as ConstructorDeCanal) : null;
  } catch {
    return null;
  }
}

/** Crea un ayudante con su propio canal. Las pruebas lo usan con un canal falso. */
export function crearPedidoCompartido(opciones: OpcionesPedidoCompartido = {}): PedidoCompartido {
  const nombre = opciones.nombre ?? NOMBRE_DEL_CANAL;
  const esperaMaximaMs = opciones.esperaMaximaMs ?? ESPERA_MAXIMA_MS;
  const Canal = opciones.Canal === undefined ? canalDelNavegador() : opciones.Canal;

  // El ultimo dato conocido de cada clave (de otra pestaña o de esta), con cuando se pidio.
  const ultimos = new Map<string, { dato: unknown; en: number }>();
  // Cuando avisó otra pestaña que empezó a pedir cada clave.
  const pidiendoAfuera = new Map<string, number>();
  // Quienes esperan el dato de otra pestaña, por clave.
  const esperando = new Map<string, Set<(dato: unknown) => void>>();
  const enCurso = new Map<string, Promise<ResultadoCompartido<unknown>>>();

  const guardar = (clave: string, dato: unknown, en: number) => {
    const antes = ultimos.get(clave);
    if (!antes || antes.en <= en) {
      ultimos.set(clave, { dato, en });
    }
  };

  const recibir = (evento: { data: unknown }) => {
    try {
      const mensaje = evento?.data as { tipo?: unknown; clave?: unknown; dato?: unknown; en?: unknown } | null;
      if (!mensaje || typeof mensaje.clave !== "string" || typeof mensaje.en !== "number") {
        return;
      }
      if (mensaje.tipo === "pidiendo") {
        pidiendoAfuera.set(mensaje.clave, mensaje.en);
        return;
      }
      if (mensaje.tipo !== "dato") {
        return;
      }
      pidiendoAfuera.delete(mensaje.clave);
      guardar(mensaje.clave, mensaje.dato, mensaje.en);
      const quienes = esperando.get(mensaje.clave);
      if (quienes) {
        esperando.delete(mensaje.clave);
        for (const avisar of quienes) avisar(mensaje.dato);
      }
    } catch {
      // Un mensaje raro no rompe nada: se ignora.
    }
  };

  let canal: CanalParecido | null = null;
  try {
    if (Canal) {
      canal = new Canal(nombre);
      canal.onmessage = recibir;
    }
  } catch {
    canal = null;
  }

  const publicar = (mensaje: MensajeDato | MensajePidiendo) => {
    try {
      canal?.postMessage(mensaje);
    } catch {
      // Si el dato no se puede mandar, las otras pestañas piden el suyo: como antes.
    }
  };

  /** Espera el dato de otra pestaña hasta `ms`. Devuelve `null` si no llegó. */
  const esperarDato = (clave: string, ms: number) =>
    new Promise<{ dato: unknown } | null>((resolver) => {
      let quienes = esperando.get(clave);
      if (!quienes) {
        quienes = new Set();
        esperando.set(clave, quienes);
      }
      const alLlegar = (dato: unknown) => {
        clearTimeout(reloj);
        resolver({ dato });
      };
      const reloj = setTimeout(() => {
        esperando.get(clave)?.delete(alLlegar);
        resolver(null);
      }, Math.max(0, ms));
      quienes.add(alLlegar);
    });

  async function resolverPedido<T>(clave: string, frescoMs: number, pedir: () => Promise<T>) {
    try {
      const ahora = Date.now();
      const guardado = ultimos.get(clave);
      if (guardado && ahora - guardado.en < frescoMs) {
        return { dato: guardado.dato as T, origen: "compartido" as const };
      }
      // Otra pestaña ya está pidiendo esto mismo, y empezó hace poco: se espera su respuesta.
      const anuncio = pidiendoAfuera.get(clave);
      const ventana = Math.min(frescoMs, esperaMaximaMs);
      if (anuncio !== undefined && ahora - anuncio < ventana) {
        const llegado = await esperarDato(clave, ventana - (ahora - anuncio));
        if (llegado) {
          return { dato: llegado.dato as T, origen: "compartido" as const };
        }
      }
    } catch {
      // Si el ayudante falla, se pide como siempre.
    }

    const en = Date.now();
    publicar({ tipo: "pidiendo", clave, en });
    const dato = await pedir();
    // `en` es cuando EMPEZO el pedido: el dato refleja ese momento, no el de la respuesta.
    try {
      guardar(clave, dato, en);
    } catch {
      // Sin guardar, la proxima vez se pide de nuevo.
    }
    publicar({ tipo: "dato", clave, dato, en });
    return { dato, origen: "red" as const };
  }

  function pedirCompartido<T>(clave: string, frescoMs: number, pedir: () => Promise<T>): Promise<ResultadoCompartido<T>> {
    if (!canal) {
      return pedir().then((dato) => ({ dato, origen: "red" as const }));
    }
    const actual = enCurso.get(clave);
    if (actual) {
      return actual as Promise<ResultadoCompartido<T>>;
    }
    const promesa = resolverPedido(clave, frescoMs, pedir);
    enCurso.set(clave, promesa);
    promesa
      .finally(() => {
        if (enCurso.get(clave) === promesa) enCurso.delete(clave);
      })
      .catch(() => undefined);
    return promesa;
  }

  return {
    pedirCompartido,
    cerrar() {
      try {
        canal?.close();
      } catch {
        // Nada que hacer.
      }
      canal = null;
    },
  };
}

let ayudante: PedidoCompartido | null = null;

/**
 * Pide `clave` con `pedir()`, o usa la respuesta que otra pestaña publicó hace menos de `frescoMs`.
 * Ver la explicacion arriba.
 */
export function pedirCompartido<T>(
  clave: string,
  frescoMs: number,
  pedir: () => Promise<T>,
): Promise<ResultadoCompartido<T>> {
  try {
    if (!ayudante) {
      ayudante = crearPedidoCompartido();
    }
    return ayudante.pedirCompartido(clave, frescoMs, pedir);
  } catch {
    return pedir().then((dato) => ({ dato, origen: "red" as const }));
  }
}

/**
 * Lee una respuesta JSON y la deja en algo que se puede pasar a otra pestaña: el codigo y el cuerpo.
 * Las pantallas que comparten una misma clave tienen que usar esta misma forma.
 */
export async function leerRespuestaJson(url: string): Promise<{ estado: number; datos: unknown }> {
  const respuesta = await fetch(url, { cache: "no-store" });
  const datos = await respuesta.json().catch(() => null);
  return { estado: respuesta.status, datos };
}
