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
};

export const SIN_FILTROS: FiltrosDeBandeja = { etapas: [], sinResponder: false };

export function hayFiltrosPuestos(filtros: FiltrosDeBandeja): boolean {
  return filtros.etapas.length > 0 || filtros.sinResponder;
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

  return {
    // Sin duplicados: "stage=NUEVO,NUEVO" no tiene por que multiplicar la condicion.
    etapas: Array.from(new Set(etapasCrudas)),
    sinResponder: (leer("pending") ?? "") === "1",
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
  return pares;
}

/** Hasta donde se mira hacia atras al buscar lo que quedo sin responder. */
export const DIAS_DE_SIN_RESPONDER = 60;
