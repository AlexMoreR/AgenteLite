/*
  Reglas del guardado en el celular (P5, T3). Solo funciones puras, sin localStorage ni window: se
  prueban con node:test (reglas.test.ts) y las usan dueno.ts, chat-history-cache.ts,
  lista-guardada.ts y la bandeja.
*/
import type { SharedInboxConversationItem } from "../chat-inbox-types";

/** La version del guardado. Cambiarla descarta todo lo guardado antes (otra forma de los datos). */
export const VERSION_DEL_GUARDADO = "v3";

/** Nada guardado en el celular se muestra si tiene mas de esto, ni siquiera "mientras carga". */
export const MAX_HORAS_DEL_GUARDADO = 24;

/** Cuantas filas de la lista se guardan (la primera pagina pesa unos 16 kB). */
export const MAX_FILAS_GUARDADAS = 40;

/** El ultimo mensaje de la fila se guarda cortado: la fila solo pinta una linea. */
export const MAX_LARGO_DEL_ULTIMO_MENSAJE = 140;

/**
 * La llave del dueño del guardado: negocio + usuario + version. Si falta el negocio o el usuario
 * (pantalla de login, sesion vencida, sin modulo de chats) no hay dueño y no se guarda ni se lee nada.
 */
export function llaveDelDueno(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  version: string = VERSION_DEL_GUARDADO,
): string | null {
  const negocio = typeof workspaceId === "string" ? workspaceId.trim() : "";
  const usuario = typeof userId === "string" ? userId.trim() : "";
  const conVersion = typeof version === "string" ? version.trim() : "";
  if (!negocio || !usuario || !conVersion) {
    return null;
  }
  return `${negocio}:${usuario}:${conVersion}`;
}

/**
 * Si una copia guardada todavia se puede mostrar: de esta version y con menos de `maxHoras`. Una copia
 * sin fecha, con fecha en el futuro lejano o de otra version se descarta.
 */
export function esGuardadoVigente(
  guardado: { guardadoEn?: unknown; version?: unknown } | null | undefined,
  ahora: number,
  opciones: { maxHoras?: number; version?: string } = {},
): boolean {
  if (!guardado || typeof guardado !== "object") {
    return false;
  }
  const version = opciones.version ?? VERSION_DEL_GUARDADO;
  if (guardado.version !== version) {
    return false;
  }
  const en = guardado.guardadoEn;
  if (typeof en !== "number" || !Number.isFinite(en)) {
    return false;
  }
  const maxMs = (opciones.maxHoras ?? MAX_HORAS_DEL_GUARDADO) * 3_600_000;
  // Un reloj que se movio hacia atras no puede volver "eterna" una copia: mas de 5 min en el futuro no vale.
  if (en - ahora > 5 * 60_000) {
    return false;
  }
  return ahora - en <= maxMs;
}

/** Solo lo que pinta la fila de la lista. Nada de contactId, segundoAsesorId, esperaDesde ni ids internos. */
export type FilaGuardada = {
  id: string;
  source: "agent" | "official";
  label: string;
  secondaryLabel: string;
  avatarUrl: string | null;
  tags: Array<{ label: string; color: string }>;
  incomingCount: number | null;
  assignedToName: string | null;
  crmStage: string | null;
  status: SharedInboxConversationItem["status"];
  lastMessage: string | null;
  lastMessageType: SharedInboxConversationItem["lastMessageType"];
  lastMessageDirection: SharedInboxConversationItem["lastMessageDirection"];
  lastMessageStatus: string | null;
  /** ISO. */
  lastMessageAt: string | null;
  href: string;
  /**
   * Solo si es true: el chat abierto que no cumple el filtro (pastillas que coinciden, parte 3).
   * Se guarda para que, al leer la lista, esa fila siga escondida.
   */
  fueraDeLaVista?: true;
};

function texto(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

function fechaIso(valor: unknown): string | null {
  if (valor instanceof Date) {
    return Number.isFinite(valor.getTime()) ? valor.toISOString() : null;
  }
  if (typeof valor === "string" && valor) {
    const ms = new Date(valor).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
}

/** Copia SOLO los campos que pinta la fila (una lista cerrada: un campo nuevo no se cuela solo). */
export function filaParaGuardar(item: SharedInboxConversationItem): FilaGuardada | null {
  if (!item || typeof item.id !== "string" || !item.id) {
    return null;
  }
  const ultimo = texto(item.lastMessage);
  return {
    id: item.id,
    source: item.source === "official" ? "official" : "agent",
    label: texto(item.label) ?? "",
    secondaryLabel: texto(item.secondaryLabel) ?? "",
    avatarUrl: texto(item.avatarUrl),
    tags: Array.isArray(item.tags)
      ? item.tags
          .filter((tag) => tag && typeof tag.label === "string")
          .map((tag) => ({ label: tag.label, color: typeof tag.color === "string" ? tag.color : "" }))
      : [],
    incomingCount: typeof item.incomingCount === "number" ? item.incomingCount : null,
    assignedToName: texto(item.assignedToName),
    crmStage: texto(item.crmStage),
    status: item.status ?? null,
    lastMessage: ultimo === null ? null : ultimo.slice(0, MAX_LARGO_DEL_ULTIMO_MENSAJE),
    lastMessageType: item.lastMessageType ?? null,
    lastMessageDirection: item.lastMessageDirection ?? null,
    lastMessageStatus: texto(item.lastMessageStatus),
    lastMessageAt: fechaIso(item.lastMessageAt),
    href: texto(item.href) ?? "",
    ...(item.fueraDeLaVista === true ? { fueraDeLaVista: true as const } : {}),
  };
}

/** Las primeras `maximo` filas (la lista ya viene en el orden en que se pinta). */
export function recortarLista<T>(filas: readonly T[], maximo: number = MAX_FILAS_GUARDADAS): T[] {
  if (!Array.isArray(filas) || maximo <= 0) {
    return [];
  }
  return filas.slice(0, maximo);
}

type ConFecha = { id: string; lastMessageAt?: Date | string | null };

function ms(valor: Date | string | null | undefined): number | null {
  if (valor instanceof Date) {
    const t = valor.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof valor === "string" && valor) {
    const t = new Date(valor).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Al ponerse al dia con la primera pagina de /list: quita de la lista los chats que dejaron la vista
 * (reasignados, resueltos, sin acceso).
 *
 * Una fila que NO vino en la pagina y es MAS NUEVA que la fila mas vieja de la pagina ya no esta en
 * la vista: si estuviera, el servidor la habria mandado. Las mas viejas que eso se conservan, porque
 * se cargaron al bajar y la pagina no llega hasta ellas. Si la pagina es la lista entera
 * (`hayMas = false`) sale todo lo que no vino.
 *
 * `conservar`: ids que nunca se quitan aca (el chat abierto, los fijados, las filas de la API oficial
 * que este /list no trae). Una fila sin fecha se conserva (no se puede comparar).
 *
 * Devuelve la MISMA lista si no hay nada que quitar.
 */
export function reconciliarPrimeraPagina<T extends ConFecha>(
  actual: readonly T[],
  pagina: readonly ConFecha[],
  hayMas: boolean,
  conservar?: (fila: T) => boolean,
): T[] {
  const enLaPagina = new Set(pagina.map((fila) => fila.id));
  let masVieja = Number.POSITIVE_INFINITY;
  for (const fila of pagina) {
    const t = ms(fila.lastMessageAt);
    if (t !== null && t < masVieja) {
      masVieja = t;
    }
  }
  // Una pagina vacia con mas por venir no dice nada: no se quita nada.
  if (hayMas && !Number.isFinite(masVieja)) {
    return actual as T[];
  }

  let quito = false;
  const siguen = actual.filter((fila) => {
    if (enLaPagina.has(fila.id) || conservar?.(fila)) {
      return true;
    }
    if (!hayMas) {
      quito = true;
      return false;
    }
    const t = ms(fila.lastMessageAt);
    if (t === null || t <= masVieja) {
      return true;
    }
    quito = true;
    return false;
  });
  return quito ? siguen : (actual as T[]);
}

export type CambioDeFila<F> = {
  conversationId: string;
  /** Cuando paso el cambio (ms). */
  at: number;
  /** La fila nueva, o null si la fila salio de la vista. */
  fila: F | null;
};

/**
 * Aplica cambios de filas en orden y sin retroceder.
 *
 * - Ordena por (at, id), asi dos cambios que llegan en desorden terminan igual.
 * - Ignora lo repetido (mismo conversationId + at).
 * - Nunca deja que una fila con `lastMessageAt` mas viejo pise una mas nueva (dos /summary que
 *   llegan en desorden), ni que un cambio mas viejo que el ultimo aplicado de esa fila la toque.
 *
 * `estado.filas` es un mapa id -> fila; `estado.vistos` guarda el ultimo `at` aplicado por chat. No
 * cambia el estado de entrada.
 */
export function aplicarCambiosEnOrden<F extends ConFecha>(
  estado: { filas: ReadonlyMap<string, F>; vistos: ReadonlyMap<string, number> },
  cambios: readonly CambioDeFila<F>[],
): { filas: Map<string, F>; vistos: Map<string, number> } {
  const filas = new Map(estado.filas);
  const vistos = new Map(estado.vistos);
  const ordenados = [...cambios]
    .filter((cambio) => cambio && typeof cambio.conversationId === "string" && Number.isFinite(cambio.at))
    .sort((a, b) => (a.at !== b.at ? a.at - b.at : a.conversationId.localeCompare(b.conversationId)));
  const yaAplicados = new Set<string>();

  for (const cambio of ordenados) {
    const llave = `${cambio.conversationId}@${cambio.at}`;
    if (yaAplicados.has(llave)) {
      continue;
    }
    yaAplicados.add(llave);
    const ultimo = vistos.get(cambio.conversationId);
    if (ultimo !== undefined && cambio.at <= ultimo) {
      continue;
    }
    if (cambio.fila === null) {
      filas.delete(cambio.conversationId);
      vistos.set(cambio.conversationId, cambio.at);
      continue;
    }
    const antes = filas.get(cambio.conversationId);
    const tAntes = antes ? ms(antes.lastMessageAt) : null;
    const tNueva = ms(cambio.fila.lastMessageAt);
    if (tAntes !== null && (tNueva === null || tNueva < tAntes)) {
      // La fila que llega es mas vieja que la que hay: no retrocede.
      vistos.set(cambio.conversationId, cambio.at);
      continue;
    }
    filas.set(cambio.conversationId, cambio.fila);
    vistos.set(cambio.conversationId, cambio.at);
  }
  return { filas, vistos };
}
