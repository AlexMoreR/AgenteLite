/**
 * Los filtros nuevos de la bandeja: que son y como se leen.
 *
 * La lista de Chats se arma con CUATRO consultas que no se conocen entre si: la de la pantalla, la
 * del canal oficial, la del scroll infinito y la de los contadores. Un filtro aplicado en una sola
 * deja pasar las otras ENTERAS, sin error ni aviso —la lista simplemente trae de mas—, y ya nos
 * paso dos veces con el estado y con la asignacion. Por eso el criterio se escribe aca una vez y
 * las cuatro lo importan, en vez de repetirlo cuatro veces y que se separen con el tiempo.
 *
 * Este archivo no toca la base a proposito: el modal de filtros es del NAVEGADOR y necesita estos
 * mismos nombres y etapas. Si viviera junto a las consultas, Prisma entero terminaria viajando al
 * telefono de la asesora. Lo que consulta esta en ../services/filtros-de-bandeja.
 */

export const ETAPAS_CRM = [
  "NUEVO",
  "CALIFICADO",
  "PROPUESTA",
  "NEGOCIACION",
  "GANADO",
  "PERDIDO",
] as const;

export type EtapaCrm = (typeof ETAPAS_CRM)[number];

export type FiltrosDeBandeja = {
  /** Vacio = todas las etapas. */
  etapas: EtapaCrm[];
  sinResponder: boolean;
  /**
   * Ids de etiquetas: entra el chat cuyo contacto tenga CUALQUIERA de ellas (Alex, 04-10-2026: "no
   * puedo filtrar por etiqueta"). Vacio = sin filtro de etiqueta.
   */
  etiquetas: string[];
};

export const SIN_FILTROS: FiltrosDeBandeja = { etapas: [], sinResponder: false, etiquetas: [] };

export function hayFiltrosPuestos(filtros: FiltrosDeBandeja): boolean {
  return filtros.etapas.length > 0 || filtros.sinResponder || filtros.etiquetas.length > 0;
}

/**
 * Lee los filtros de la direccion.
 *
 * Sirve igual para la pantalla (searchParams de Next) que para las rutas de API (URLSearchParams),
 * porque recibe una funcion de lectura en vez de un objeto.
 */
export function leerFiltrosDeBandeja(
  leer: (clave: string) => string | null | undefined,
): FiltrosDeBandeja {
  const etapasCrudas = (leer("stage") ?? "")
    .split(",")
    .map((valor) => valor.trim().toUpperCase())
    .filter((valor): valor is EtapaCrm => (ETAPAS_CRM as readonly string[]).includes(valor));

  // Ids de etiqueta: solo letras, numeros y guiones, para que nada raro llegue a la consulta.
  const etiquetas = (leer("tag") ?? "")
    .split(",")
    .map((valor) => valor.trim())
    .filter((valor) => /^[A-Za-z0-9_-]{1,64}$/.test(valor));

  return {
    // Sin duplicados: "stage=NUEVO,NUEVO" no tiene por que multiplicar la condicion.
    etapas: Array.from(new Set(etapasCrudas)),
    sinResponder: (leer("pending") ?? "") === "1",
    etiquetas: Array.from(new Set(etiquetas)).slice(0, 20),
  };
}

/** Los filtros como pares para armar una direccion. Lo que esta vacio no viaja. */
export function paramsDeFiltros(filtros: FiltrosDeBandeja): Array<[string, string]> {
  const pares: Array<[string, string]> = [];
  if (filtros.etapas.length > 0) {
    pares.push(["stage", filtros.etapas.join(",")]);
  }
  if (filtros.sinResponder) {
    pares.push(["pending", "1"]);
  }
  if (filtros.etiquetas.length > 0) {
    pares.push(["tag", filtros.etiquetas.join(",")]);
  }
  return pares;
}

/** Hasta donde se mira hacia atras al buscar lo que quedo sin responder. */
export const DIAS_DE_SIN_RESPONDER = 60;
