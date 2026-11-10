/**
 * "Esperando respuesta": los chats donde el cliente escribio y ninguna PERSONA le contesto.
 *
 * Esta parte no importa Prisma a proposito: los tipos y la ventana los va a usar tambien la
 * bandeja, que corre en el navegador. Las consultas viven en ../services/espera-de-chats.ts.
 *
 * Ojo: no es lo mismo que el filtro "Sin responder". Desde el 10-11-2026 tambien tiene que ser
 * turno de Magilus (lib/turno-de-la-conversacion.ts): si el agente contesto sin pedir asesora, el
 * chat no espera; si pidio o prometio una asesora, no entendio o el cliente dio una señal fuerte,
 * si. El reloj cuenta desde la ultima tanda del cliente.
 */

/** Solo se mira lo de las ultimas 72 horas: lo mas viejo no es trabajo de hoy. */
export const HORAS_DE_ESPERA = 72;
export const VENTANA_DE_ESPERA_MS = HORAS_DE_ESPERA * 60 * 60 * 1000;

/** Un chat esperando, tal como sale en GET /api/cliente/chats/counts. */
export type ChatEsperando = {
  /** `agent:<id>` u `official:<id>`: la misma clave que usa la lista. */
  key: string;
  /** Desde cuando espera (ISO): el primer mensaje del cliente que nadie le contesto. */
  desde: string;
  /** Es de quien pregunta (asesora principal o segunda). */
  mia: boolean;
};

/** El campo `espera` de /counts. `null` si no se pudo calcular (el resto de la respuesta sale igual). */
export type EsperaDeChats = {
  /** Cuantos de los que esperan son de quien pregunta. */
  mine: number;
  /** Cuantos esperan de todo lo que esa persona ve. */
  all: number;
  /** Los que esperan, el que mas lleva esperando primero. */
  chats: ChatEsperando[];
};

/* ------------------------------------------------------------------------------------------------
   LA LISTA "Esperando" en GET /api/cliente/chats/list?espera=1
------------------------------------------------------------------------------------------------ */

/**
 * El orden de la lista: el que mas lleva esperando primero y, si empatan, por `key`. El desempate
 * hace falta para paginar: con dos chats del mismo minuto, sin el, la pagina 2 podia repetir uno y
 * saltarse el otro.
 */
export function ordenarEsperando<T extends { key: string; desde: string }>(chats: readonly T[]): T[] {
  return [...chats].sort((a, b) => {
    const diferencia = Date.parse(a.desde) - Date.parse(b.desde);
    if (diferencia !== 0) return diferencia;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/**
 * Una pagina de la lista ya ordenada. `nextOffset` y `hasMore` se cuentan sobre la lista de
 * esperas, NO sobre las filas que despues se pudieron traer: si un chat se resolvio en el minuto
 * que dura la memoria, su fila no vuelve, pero el scroll sigue desde el mismo lugar sin repetir ni
 * saltar ninguno.
 */
export function paginaDeEspera<T>(lista: readonly T[], offset: number, limit: number) {
  const desde = Math.max(0, offset);
  const pagina = lista.slice(desde, desde + Math.max(0, limit));
  const nextOffset = desde + pagina.length;
  return { pagina, nextOffset, hasMore: nextOffset < lista.length };
}

/**
 * Deja las filas en el orden de la lista de esperas (y solo las que estan en ella). Hace falta al
 * final porque las filas se arman ordenadas por el ultimo mensaje.
 */
export function ordenarSegunEspera<T extends { key: string }>(filas: readonly T[], claves: readonly string[]): T[] {
  const porClave = new Map(filas.map((fila) => [fila.key, fila]));
  return claves.flatMap((clave) => {
    const fila = porClave.get(clave);
    return fila ? [fila] : [];
  });
}

/* ------------------------------------------------------------------------------------------------
   LA VISTA CON LA QUE ABRE LA BANDEJA (la usa la pantalla en la parte 4)
------------------------------------------------------------------------------------------------ */

/**
 * Lo que en la direccion ya dice que mirar. Si viene cualquiera de estos, la bandeja respeta la
 * direccion: un enlace a un chat, una busqueda o un filtro puesto no se cambian por la vista
 * inicial.
 */
export const PARAMETROS_QUE_ELIGEN_LA_VISTA: readonly string[] = [
  "chatKey",
  "conversacion",
  "assigned",
  "q",
  "status",
  "c",
  "stage",
  "tag",
  "pending",
  "espera",
];

export type VistaInicialDeLaBandeja =
  /** La direccion ya dice que mirar: no se toca. */
  | { origen: "direccion" }
  /** Sin nada en la direccion: con esta pestaña abre, y con o sin "Esperando". */
  | { origen: "defecto"; assigned: "all" | "mine"; espera: boolean };

/**
 * Con que vista abre la bandeja, sin Prisma (sirve en la pantalla).
 *
 * - Dueño, administrador, supervisora o monitora: Todas.
 * - Asesora con chats suyos esperando: Mias con "Esperando".
 * - Asesora sin chats esperando (o si no se pudo saber): Mias.
 */
export function vistaInicialDeLaBandeja(input: {
  leer: (clave: string) => string | null | undefined;
  /** Dueño, administrador, supervisora o monitora: los que ven "Todas". */
  veTodas: boolean;
  /** Cuantos chats de esa persona esperan (`espera.mine` de /counts). null = no se pudo saber. */
  esperandoMios: number | null;
}): VistaInicialDeLaBandeja {
  const hayAlgoEnLaDireccion = PARAMETROS_QUE_ELIGEN_LA_VISTA.some((clave) =>
    Boolean(input.leer(clave)?.trim()),
  );
  if (hayAlgoEnLaDireccion) return { origen: "direccion" };
  if (input.veTodas) return { origen: "defecto", assigned: "all", espera: false };
  return { origen: "defecto", assigned: "mine", espera: (input.esperandoMios ?? 0) > 0 };
}

/* ------------------------------------------------------------------------------------------------
   LA MARCA «espera N min» DE CADA FILA (parte 3)
------------------------------------------------------------------------------------------------ */

/** Por debajo de esto la marca va en gris; desde aca, en ambar. */
export const MINUTOS_DE_ESPERA_AMBAR = 10;
/** Desde esto la marca va en rojo. */
export const MINUTOS_DE_ESPERA_ROJO = 15;

export type ColorDeEspera = "gris" | "ambar" | "rojo";

export type MarcaDeEspera = {
  minutos: number;
  texto: string;
  color: ColorDeEspera;
};

const MINUTO_DE_ESPERA_MS = 60_000;
const MINUTOS_POR_HORA_DE_ESPERA = 60;
const MINUTOS_POR_DIA_DE_ESPERA = 24 * MINUTOS_POR_HORA_DE_ESPERA;

/** Minutos enteros que lleva esperando (nunca negativo). `null` si no hay desde o la fecha no sirve. */
export function minutosDeEspera(
  desde: Date | string | number | null | undefined,
  ahora: Date | string | number,
): number | null {
  if (desde === null || desde === undefined) return null;
  const inicio = desde instanceof Date ? desde.getTime() : typeof desde === "number" ? desde : Date.parse(desde);
  const fin = ahora instanceof Date ? ahora.getTime() : typeof ahora === "number" ? ahora : Date.parse(ahora);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return null;
  return Math.max(0, Math.floor((fin - inicio) / MINUTO_DE_ESPERA_MS));
}

/** «espera 12 min»; desde 60 min «espera 2 h 5 min» (o «espera 2 h» en la hora justa); desde 24 h «espera 3 d». */
export function textoDeEspera(minutos: number): string {
  if (minutos >= MINUTOS_POR_DIA_DE_ESPERA) return `espera ${Math.floor(minutos / MINUTOS_POR_DIA_DE_ESPERA)} d`;
  if (minutos >= MINUTOS_POR_HORA_DE_ESPERA) {
    const horas = Math.floor(minutos / MINUTOS_POR_HORA_DE_ESPERA);
    const resto = minutos % MINUTOS_POR_HORA_DE_ESPERA;
    return resto ? `espera ${horas} h ${resto} min` : `espera ${horas} h`;
  }
  return `espera ${minutos} min`;
}

/** Gris por debajo de 10 min, ambar de 10 a 14 y rojo desde 15. */
export function colorDeEspera(minutos: number): ColorDeEspera {
  if (minutos >= MINUTOS_DE_ESPERA_ROJO) return "rojo";
  if (minutos >= MINUTOS_DE_ESPERA_AMBAR) return "ambar";
  return "gris";
}

/** La marca de una fila, o `null` si el chat no esta esperando. */
export function marcaDeEspera(
  desde: Date | string | number | null | undefined,
  ahora: Date | string | number,
): MarcaDeEspera | null {
  const minutos = minutosDeEspera(desde, ahora);
  if (minutos === null) return null;
  return { minutos, texto: textoDeEspera(minutos), color: colorDeEspera(minutos) };
}

/**
 * `key` -> desde cuando espera, sacado del `espera` del ultimo /counts. Con `null` (no se pudo
 * calcular) o sin chats queda vacio: ninguna fila lleva marca. Un chat que ya no viene en el
 * siguiente /counts pierde la marca porque el mapa se arma de nuevo cada vez.
 */
export function esperaPorClave(espera: Pick<EsperaDeChats, "chats"> | null | undefined): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const chat of espera?.chats ?? []) {
    if (chat?.key && chat.desde) mapa.set(chat.key, chat.desde);
  }
  return mapa;
}
