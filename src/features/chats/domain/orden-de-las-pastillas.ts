/**
 * LA FILA DE PASTILLAS de la bandeja: cuales hay, en que orden van y cuales estan ocultas.
 *
 * Una sola fila con las pastillas FIJAS (Todas, Mias, No leido, Sin responder, Sin asignar) y las
 * LISTAS guardadas de la persona. Cada persona la acomoda a su gusto (mover a la izquierda o a la
 * derecha, ocultar las fijas) y eso se guarda en AppSetting con su userId en la clave: lo que
 * acomoda el dueño no cambia la bandeja de las asesoras.
 *
 * Funciones puras, sin Prisma: las usan la barra (navegador) y la ruta que guarda
 * (/api/cliente/chats/pastillas). Pruebas: npm run test:pastillas-ordenables
 *
 * Reglas:
 * - Quien ve cual: la asesora no ve Todas ni Sin asignar (lo decide `isManager`, igual que antes).
 * - Sin nada guardado (o con datos rotos), el orden por defecto: las fijas en el orden de
 *   PASTILLAS_FIJAS y despues las listas en el orden en que se guardaron.
 * - Lo guardado se limpia SIEMPRE al leerlo: claves desconocidas, repetidas o de listas que ya no
 *   existen se descartan. Lo que falta (una lista nueva) va al final.
 * - Solo las fijas se ocultan; las listas se borran desde su menu.
 * - Mover salta las ocultas: se mueve respecto de la vecina que se VE.
 */

/** Las fijas, en el orden por defecto. */
export const PASTILLAS_FIJAS = ["todas", "mias", "no_leido", "sin_responder", "sin_asignar"] as const;

export type PastillaFija = (typeof PASTILLAS_FIJAS)[number];

/** Una lista guardada va como `lista:<id>`. */
export type ClaveDePastilla = PastillaFija | `lista:${string}`;

export type PreferenciaDePastillas = {
  /** El orden completo (fijas y listas, tambien las ocultas). Vacio = el de por defecto. */
  orden: ClaveDePastilla[];
  /** Las fijas que la persona oculto. */
  ocultas: PastillaFija[];
};

export const SIN_PREFERENCIA: PreferenciaDePastillas = { orden: [], ocultas: [] };

export const ETIQUETAS_DE_PASTILLAS: Record<PastillaFija, string> = {
  todas: "Todas",
  mias: "Mías",
  no_leido: "No leído",
  sin_responder: "Sin responder",
  sin_asignar: "Sin asignar",
};

/** Las fijas que solo ven los jefes (dueño, administrador, supervisora o monitora). */
const SOLO_JEFES: ReadonlySet<PastillaFija> = new Set<PastillaFija>(["todas", "sin_asignar"]);

/** Tope de lo que se acepta guardar: 5 fijas + 12 listas, con aire. */
const MAXIMO_DE_CLAVES = 40;

/** Los ids de las listas guardadas (`f` + base 36): sin nada raro. */
const ID_DE_LISTA = /^[A-Za-z0-9_-]{1,64}$/;

export function claveDePreferenciaDePastillas(userId: string): string {
  return `chats:pastillas:${userId}`;
}

export function claveDeLista(id: string): ClaveDePastilla {
  return `lista:${id}`;
}

/** El id de la lista de una clave `lista:<id>`, o null si es una fija. */
export function idDeLista(clave: string): string | null {
  return clave.startsWith("lista:") ? clave.slice("lista:".length) : null;
}

export function esPastillaFija(valor: unknown): valor is PastillaFija {
  return typeof valor === "string" && (PASTILLAS_FIJAS as readonly string[]).includes(valor);
}

/** Las fijas que ve esta persona, en el orden por defecto. */
export function fijasQueVe(isManager: boolean): PastillaFija[] {
  return PASTILLAS_FIJAS.filter((clave) => isManager || !SOLO_JEFES.has(clave));
}

/**
 * Lo guardado (o lo que llega para guardar), limpio: solo fijas conocidas y listas de ESTA
 * persona, sin repetidas. Cualquier cosa rota (JSON ilegible, otro tipo) da SIN_PREFERENCIA: la
 * bandeja abre igual, con el orden por defecto.
 */
export function limpiarPreferencia(crudo: unknown, idsDeListas: readonly string[]): PreferenciaDePastillas {
  let datos: unknown = crudo;
  if (typeof datos === "string") {
    try {
      datos = JSON.parse(datos);
    } catch {
      return SIN_PREFERENCIA;
    }
  }
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return SIN_PREFERENCIA;
  const { orden, ocultas } = datos as { orden?: unknown; ocultas?: unknown };
  const listas = new Set(idsDeListas);

  const ordenLimpio: ClaveDePastilla[] = [];
  const vistas = new Set<string>();
  for (const valor of Array.isArray(orden) ? orden.slice(0, MAXIMO_DE_CLAVES) : []) {
    if (typeof valor !== "string" || vistas.has(valor)) continue;
    const id = idDeLista(valor);
    const sirve = id !== null ? ID_DE_LISTA.test(id) && listas.has(id) : esPastillaFija(valor);
    if (!sirve) continue;
    vistas.add(valor);
    ordenLimpio.push(valor as ClaveDePastilla);
  }

  const ocultasLimpias = Array.from(
    new Set((Array.isArray(ocultas) ? ocultas.slice(0, MAXIMO_DE_CLAVES) : []).filter(esPastillaFija)),
  );

  return { orden: ordenLimpio, ocultas: ocultasLimpias };
}

type Contexto = { isManager: boolean; idsDeListas: readonly string[] };

/**
 * El orden COMPLETO para esta persona: lo guardado que todavia existe y ella puede ver, y despues
 * lo que falta en el orden por defecto (las fijas y, al final, las listas nuevas).
 */
export function ordenCompleto(preferencia: PreferenciaDePastillas, contexto: Contexto): ClaveDePastilla[] {
  const porDefecto: ClaveDePastilla[] = [...fijasQueVe(contexto.isManager), ...contexto.idsDeListas.map(claveDeLista)];
  const permitidas = new Set<string>(porDefecto);
  const guardado = preferencia.orden.filter((clave, i, todas) => permitidas.has(clave) && todas.indexOf(clave) === i);
  const yaEstan = new Set<string>(guardado);
  return [...guardado, ...porDefecto.filter((clave) => !yaEstan.has(clave))];
}

/** Lo que se dibuja: las que se ven, en orden, y las fijas ocultas (para "Mostrar pastillas ocultas"). */
export function pastillasDeLaFila(
  preferencia: PreferenciaDePastillas,
  contexto: Contexto,
): { visibles: ClaveDePastilla[]; ocultas: PastillaFija[] } {
  const orden = ordenCompleto(preferencia, contexto);
  const ocultas = new Set<string>(preferencia.ocultas);
  return {
    visibles: orden.filter((clave) => !ocultas.has(clave)),
    ocultas: orden.filter((clave): clave is PastillaFija => esPastillaFija(clave) && ocultas.has(clave)),
  };
}

/** Hacia donde se puede mover una pastilla que se ve (en los extremos falta una de las dos). */
export function movimientosPosibles(visibles: readonly ClaveDePastilla[], clave: ClaveDePastilla): { izquierda: boolean; derecha: boolean } {
  const i = visibles.indexOf(clave);
  return { izquierda: i > 0, derecha: i >= 0 && i < visibles.length - 1 };
}

/**
 * Mover una pastilla un lugar a la izquierda (-1) o a la derecha (1), saltando las ocultas.
 * Devuelve la preferencia nueva, o null si no se puede (extremo o pastilla que no se ve).
 */
export function moverPastilla(
  preferencia: PreferenciaDePastillas,
  contexto: Contexto,
  clave: ClaveDePastilla,
  hacia: -1 | 1,
): PreferenciaDePastillas | null {
  const orden = ordenCompleto(preferencia, contexto);
  const { visibles } = pastillasDeLaFila(preferencia, contexto);
  const i = visibles.indexOf(clave);
  const vecina = visibles[i + hacia];
  if (i < 0 || !vecina) return null;
  const a = orden.indexOf(clave);
  const b = orden.indexOf(vecina);
  const nuevo = [...orden];
  [nuevo[a], nuevo[b]] = [nuevo[b], nuevo[a]];
  return { orden: nuevo, ocultas: [...preferencia.ocultas] };
}

/** Ocultar una fija (las listas no se ocultan). Conserva el lugar: al mostrarla vuelve ahi. */
export function ocultarPastilla(
  preferencia: PreferenciaDePastillas,
  contexto: Contexto,
  clave: PastillaFija,
): PreferenciaDePastillas {
  return {
    orden: ordenCompleto(preferencia, contexto),
    ocultas: Array.from(new Set([...preferencia.ocultas, clave])),
  };
}

/** Volver a mostrar una fija oculta, o todas si no se dice cual. */
export function mostrarPastilla(
  preferencia: PreferenciaDePastillas,
  contexto: Contexto,
  clave?: PastillaFija,
): PreferenciaDePastillas {
  return {
    orden: ordenCompleto(preferencia, contexto),
    ocultas: clave ? preferencia.ocultas.filter((otra) => otra !== clave) : [],
  };
}
