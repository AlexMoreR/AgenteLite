/*
  CAMBIAR DE PASTILLA AL INSTANTE (velocidad del chat, 10-nov-2026).

  Medido en produccion: tocar "Mías" tardaba 0,95 s y "No leído" 1,4 s, siempre esperando /list. Pero
  esas vistas son un pedazo de una lista que el navegador YA tiene (la de Todas, o la de Mías): "No
  leído" son las filas con mensajes sin abrir, "Sin responder" las que tienen `sinResponderDesde`,
  "Mías" las asignadas a quien mira. Se pintan al instante filtrando esa lista y /list, que sale igual,
  las completa por debajo (trae las mas viejas que no estaban cargadas).

  Solo cuando la cuenta es SEGURA: misma linea, estado Abiertas, sin buscador, sin "Esperando" y sin
  otras condiciones (etapa, etiquetas, fechas...): esas no se pueden saber con lo que trae la fila, y
  ahi se espera a /list como antes. Funciones puras: ver lista-provisional.test.ts.
*/
import type { CondicionDeBandeja } from "@/features/chats/domain/filtros-de-bandeja";

export type FilaParaFiltrar = {
  assignedToUserId?: string | null;
  incomingCount?: number | null;
  sinResponderDesde?: Date | string | null;
};

export type VistaDestino = {
  asignada: string;
  estado: string;
  condiciones: readonly CondicionDeBandeja[];
  espera: boolean;
  busqueda: string;
};

/** De que lista guardada se puede sacar la vista, y como filtrarla. */
export type Derivacion<F extends FilaParaFiltrar> = {
  /** Asignacion de la lista base, en orden de preferencia ("mine" antes que "all"). */
  bases: Array<{ asignada: "all" | "mine"; filtrar: (fila: F) => boolean }>;
};

export function derivacionDeLaVista<F extends FilaParaFiltrar>(
  destino: VistaDestino,
  usuarioId: string | null | undefined,
): Derivacion<F> | null {
  if (destino.busqueda.trim() || destino.espera || destino.estado !== "open") {
    return null;
  }

  const condiciones: Array<(fila: F) => boolean> = [];
  for (const condicion of destino.condiciones) {
    if (condicion.campo === "no_leido" && condicion.operador === "si") {
      condiciones.push((fila) => (fila.incomingCount ?? 0) > 0);
    } else if (condicion.campo === "sin_responder" && condicion.operador === "si") {
      condiciones.push((fila) => Boolean(fila.sinResponderDesde));
    } else {
      return null;
    }
  }
  const cumpleCondiciones = (fila: F) => condiciones.every((cumple) => cumple(fila));

  const asignada = destino.asignada;
  if (asignada === "all") {
    // Todas sin condiciones ES la lista base: no hay nada que derivar.
    return condiciones.length > 0 ? { bases: [{ asignada: "all", filtrar: cumpleCondiciones }] } : null;
  }
  if (asignada === "mine") {
    const id = usuarioId?.trim();
    const bases: Derivacion<F>["bases"] = [];
    if (condiciones.length > 0) bases.push({ asignada: "mine", filtrar: cumpleCondiciones });
    if (id) bases.push({ asignada: "all", filtrar: (fila) => fila.assignedToUserId === id && cumpleCondiciones(fila) });
    return bases.length > 0 ? { bases } : null;
  }
  if (asignada === "unassigned") {
    return { bases: [{ asignada: "all", filtrar: (fila) => !fila.assignedToUserId && cumpleCondiciones(fila) }] };
  }
  if (asignada.startsWith("user:")) {
    const id = asignada.slice("user:".length).trim();
    return id ? { bases: [{ asignada: "all", filtrar: (fila) => fila.assignedToUserId === id && cumpleCondiciones(fila) }] } : null;
  }
  return null;
}

/**
 * La lista provisional: la primera base que haya, filtrada. `leerBase` devuelve la lista guardada de
 * esa asignacion (Abiertas, sin condiciones) o undefined. Vacia tambien vale: dice "no hay" al instante
 * y /list corrige si habia mas abajo.
 */
export function listaProvisional<F extends FilaParaFiltrar>(
  destino: VistaDestino,
  usuarioId: string | null | undefined,
  leerBase: (asignada: "all" | "mine") => readonly F[] | undefined,
): F[] | null {
  const derivacion = derivacionDeLaVista<F>(destino, usuarioId);
  if (!derivacion) return null;
  for (const base of derivacion.bases) {
    const filas = leerBase(base.asignada);
    if (filas) return filas.filter(base.filtrar);
  }
  return null;
}
