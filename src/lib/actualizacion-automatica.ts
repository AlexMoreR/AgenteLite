/*
  Actualizacion automatica de la app (tarjeta maqn9g47, 27-oct-2026).

  Las asesoras dejan la app abierta todo el dia y subimos varios cambios al dia. Antes salia un boton
  "Actualizar" y, mientras nadie lo tocaba, los envios le pegaban a la version vieja del servidor y
  fallaban. Ahora la app se recarga SOLA en un momento seguro, sin perder el borrador ni el chat
  (la direccion ya trae ?chatKey=), y un texto que se cayo por version vieja se reenvia UNA vez.

  Aca viven las reglas puras (sin React) para probarlas con `npm run test:actualizacion-automatica`,
  y los avisos de "ocupada" que comparten el chat y el guardia de version.
*/

/** Cuanto tiene que llevar quieta (sin teclear) para que se pueda recargar. */
export const QUIETA_MS = 5_000;
/** Como mucho una recarga automatica por minuto (misma idea que cliente/error.tsx). */
export const MIN_ENTRE_RECARGAS_MS = 60_000;
/** Con tantas recargas seguidas y la app todavia vieja, se muestra la pastilla de respaldo. */
export const MAX_RECARGAS_SEGUIDAS = 2;
/** Un envio pendiente mas viejo que esto ya no se reenvia. */
export const VIDA_MAX_PENDIENTE_MS = 120_000;
/** Espera tras la ultima tecla antes de guardar el borrador. */
export const ESPERA_GUARDAR_BORRADOR_MS = 400;

export const EVENTO_REVISAR_VERSION = "aizen:revisar-version";
export const EVENTO_GUARDAR_BORRADOR = "aizen:guardar-borrador";

const CLAVE_RECARGAS = "aizen:auto-recarga";
const PREFIJO_BORRADOR = "aizen:borrador:";
const CLAVE_PENDIENTE = "aizen:envio-pendiente";

/** Lo minimo que se usa de sessionStorage (asi las pruebas pasan uno falso). */
export type AlmacenSimple = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function almacenDelNavegador(): AlmacenSimple | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/* ------------------------------ Avisos de "ocupada" ------------------------------ */

let ultimaEscrituraMs = 0;
const ocupaciones = new Set<string>();

/** La asesora acaba de teclear. */
export function marcarEscritura(ahora = Date.now()) {
  ultimaEscrituraMs = ahora;
}

/** Prende o apaga un motivo de "ocupada": envio, grabando, subiendo, adjuntar. */
export function marcarOcupada(motivo: string, activa: boolean) {
  if (activa) {
    ocupaciones.add(motivo);
  } else {
    ocupaciones.delete(motivo);
  }
}

export function estaOcupada(ahora = Date.now(), ignorar: string[] = []): boolean {
  if (ahora - ultimaEscrituraMs < QUIETA_MS) {
    return true;
  }
  for (const motivo of ocupaciones) {
    if (!ignorar.includes(motivo)) {
      return true;
    }
  }
  return false;
}

/** Pide al guardia que mire ya si hay version nueva (tocar la caja, abrir "adjuntar"). */
export function pedirRevisionDeVersion(ignorar: string[] = []) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(EVENTO_REVISAR_VERSION, { detail: { ignorar } }));
}

/** Pide al chat que guarde ya el borrador (justo antes de recargar). */
export function pedirGuardadoDeBorrador() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(EVENTO_GUARDAR_BORRADOR));
}

/* ------------------------------ Tope de recargas ------------------------------ */

export type RegistroRecargas = { ultima: number; intentos: number };

export function leerRecargas(almacen: AlmacenSimple | null = almacenDelNavegador()): RegistroRecargas {
  try {
    const crudo = almacen?.getItem(CLAVE_RECARGAS);
    if (crudo) {
      const dato = JSON.parse(crudo) as Partial<RegistroRecargas>;
      return { ultima: Number(dato.ultima) || 0, intentos: Number(dato.intentos) || 0 };
    }
  } catch {
    // Sin almacenamiento o dato roto: se parte de cero.
  }
  return { ultima: 0, intentos: 0 };
}

export function registrarRecarga(ahora = Date.now(), almacen: AlmacenSimple | null = almacenDelNavegador()) {
  const actual = leerRecargas(almacen);
  try {
    almacen?.setItem(CLAVE_RECARGAS, JSON.stringify({ ultima: ahora, intentos: actual.intentos + 1 }));
  } catch {
    // Sin almacenamiento: decidirRecarga no podra limitar, pero el boton de respaldo sigue.
  }
}

/** La app ya esta al dia: se olvidan los intentos. */
export function olvidarRecargas(almacen: AlmacenSimple | null = almacenDelNavegador()) {
  try {
    almacen?.removeItem(CLAVE_RECARGAS);
  } catch {
    // nada
  }
}

export type DecisionDeRecarga = "recargar" | "esperar" | "pastilla";

/**
 * Que hacer cuando se sabe que hay version nueva.
 * - pastilla: ya se recargo 2 veces seguidas y la app sigue vieja (el servidor tarda en quedar al dia).
 * - esperar: la asesora esta haciendo algo, o ya se recargo hace menos de un minuto.
 * - recargar: momento seguro.
 */
export function decidirRecarga(input: {
  ahora: number;
  ocupada: boolean;
  recargas: RegistroRecargas;
}): DecisionDeRecarga {
  const { ahora, ocupada, recargas } = input;
  if (recargas.intentos >= MAX_RECARGAS_SEGUIDAS) {
    return "pastilla";
  }
  if (ocupada) {
    return "esperar";
  }
  if (recargas.intentos > 0 && ahora - recargas.ultima < MIN_ENTRE_RECARGAS_MS) {
    return "esperar";
  }
  return "recargar";
}

/* ------------------------------ Borrador por chat ------------------------------ */

export function guardarBorrador(
  chatKey: string,
  texto: string,
  almacen: AlmacenSimple | null = almacenDelNavegador(),
) {
  if (!chatKey) {
    return;
  }
  try {
    if (texto.trim()) {
      almacen?.setItem(PREFIJO_BORRADOR + chatKey, texto);
    } else {
      almacen?.removeItem(PREFIJO_BORRADOR + chatKey);
    }
  } catch {
    // Sin almacenamiento (modo privado): el borrador no se guarda y ya.
  }
}

export function leerBorrador(chatKey: string, almacen: AlmacenSimple | null = almacenDelNavegador()): string {
  if (!chatKey) {
    return "";
  }
  try {
    return almacen?.getItem(PREFIJO_BORRADOR + chatKey) ?? "";
  } catch {
    return "";
  }
}

export function borrarBorrador(chatKey: string, almacen: AlmacenSimple | null = almacenDelNavegador()) {
  try {
    almacen?.removeItem(PREFIJO_BORRADOR + chatKey);
  } catch {
    // nada
  }
}

/* --------------------------- Envio pendiente (reenvio unico) --------------------------- */

export type EnvioPendiente = {
  chatKey: string;
  conversationId: string;
  campos: Array<[string, string]>;
  /** El texto SIN firma (con el que se compara contra lo guardado en el chat). */
  texto: string;
  /** El texto como se ve en la burbuja (con firma). */
  contenido: string;
  creadoEn: number;
};

export function guardarEnvioPendiente(
  envio: EnvioPendiente,
  almacen: AlmacenSimple | null = almacenDelNavegador(),
) {
  try {
    almacen?.setItem(CLAVE_PENDIENTE, JSON.stringify(envio));
  } catch {
    // Sin almacenamiento: queda como "No se envió" con Reintentar, como antes.
  }
}

/**
 * Lee el pendiente y BORRA la marca en el mismo paso, antes de cualquier reenvio: asi nunca se
 * reenvia dos veces, ni aunque la pagina se recargue en mitad del reenvio.
 */
export function tomarEnvioPendiente(almacen: AlmacenSimple | null = almacenDelNavegador()): EnvioPendiente | null {
  let crudo: string | null | undefined = null;
  try {
    crudo = almacen?.getItem(CLAVE_PENDIENTE);
    almacen?.removeItem(CLAVE_PENDIENTE);
  } catch {
    return null;
  }
  if (!crudo) {
    return null;
  }
  try {
    const dato = JSON.parse(crudo) as Partial<EnvioPendiente>;
    if (
      typeof dato.chatKey !== "string" ||
      typeof dato.conversationId !== "string" ||
      typeof dato.texto !== "string" ||
      typeof dato.contenido !== "string" ||
      typeof dato.creadoEn !== "number" ||
      !Array.isArray(dato.campos)
    ) {
      return null;
    }
    return dato as EnvioPendiente;
  } catch {
    return null;
  }
}

/**
 * ¿Se puede reenviar? Solo si es del chat abierto, tiene menos de 2 minutos y el texto NO esta ya
 * guardado en el chat (`yaGuardado`, calculado con textoCoincideConGuardado). Ante la duda, no.
 */
export function puedeReenviarPendiente(input: {
  pendiente: EnvioPendiente;
  chatAbiertoId: string;
  ahora: number;
  yaGuardado: boolean;
}): boolean {
  const { pendiente, chatAbiertoId, ahora, yaGuardado } = input;
  if (!pendiente.texto.trim() || pendiente.conversationId !== chatAbiertoId) {
    return false;
  }
  const edad = ahora - pendiente.creadoEn;
  if (edad < 0 || edad > VIDA_MAX_PENDIENTE_MS) {
    return false;
  }
  return !yaGuardado;
}
