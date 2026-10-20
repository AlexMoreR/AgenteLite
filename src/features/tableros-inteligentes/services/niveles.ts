/*
  NAVEGACIÓN POR NIVELES del mapa del Tablero IA (usa TarjetaTablero.padreId).

  - Nivel raíz (al abrir el tablero): las tarjetas sin madre (por ejemplo "Magilus") y sus hijas
    directas (las áreas). Nada más.
  - Entrar a una tarjeta con hijas: esa tarjeta arriba y SOLO sus hijas directas.
  - Una tarjeta cuya madre está borrada (o no está) cuenta como suelta: va en la raíz.

  Funciones puras: reciben solo las tarjetas NO borradas (las borradas no se cuentan ni se ven).
  Pruebas: npm run test:tableros.
*/

export type TarjetaDeNivel = { id: string; padreId: string | null; titulo?: string; borradoEn?: string | null };

/** La madre de cada tarjeta, solo si esa madre está entre las tarjetas (no borrada). */
export function madresVisibles(tarjetas: TarjetaDeNivel[]): Map<string, string | null> {
  const vivas = new Set(tarjetas.filter((tarjeta) => !tarjeta.borradoEn).map((tarjeta) => tarjeta.id));
  const madre = new Map<string, string | null>();
  for (const tarjeta of tarjetas) {
    if (tarjeta.borradoEn) continue;
    madre.set(tarjeta.id, tarjeta.padreId && vivas.has(tarjeta.padreId) ? tarjeta.padreId : null);
  }
  return madre;
}

/** Cuántas hijas (no borradas) tiene cada tarjeta. Las que no tienen hijas no aparecen. */
export function contarHijas(tarjetas: TarjetaDeNivel[]): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const madre of madresVisibles(tarjetas).values()) {
    if (madre) cuenta.set(madre, (cuenta.get(madre) ?? 0) + 1);
  }
  return cuenta;
}

/**
 * Las tarjetas que se ven en un nivel, en el orden en que llegaron. `nivelId` null (o una tarjeta
 * que no existe) = la raíz. Devuelve también el nivel que de verdad se muestra.
 */
export function tarjetasDelNivel(
  tarjetas: TarjetaDeNivel[],
  nivelId: string | null,
): { nivel: string | null; visibles: string[] } {
  const madre = madresVisibles(tarjetas);
  const nivel = nivelId && madre.has(nivelId) ? nivelId : null;
  const visibles: string[] = [];
  if (nivel) {
    for (const [id, suMadre] of madre) if (id === nivel || suMadre === nivel) visibles.push(id);
    return { nivel, visibles };
  }
  const raices = new Set([...madre].filter(([, suMadre]) => suMadre === null).map(([id]) => id));
  for (const [id, suMadre] of madre) if (raices.has(id) || (suMadre !== null && raices.has(suMadre))) visibles.push(id);
  return { nivel: null, visibles };
}

/** La ruta de la raíz hasta el nivel (sin incluir la raíz misma): "Magilus > Ventas > ...". */
export function migasDelNivel(tarjetas: TarjetaDeNivel[], nivelId: string | null): { id: string; titulo: string }[] {
  const madre = madresVisibles(tarjetas);
  const titulo = new Map(tarjetas.map((tarjeta) => [tarjeta.id, tarjeta.titulo ?? ""]));
  const ruta: { id: string; titulo: string }[] = [];
  const vistas = new Set<string>();
  let actual = nivelId && madre.has(nivelId) ? nivelId : null;
  while (actual && !vistas.has(actual)) {
    vistas.add(actual);
    ruta.unshift({ id: actual, titulo: titulo.get(actual) ?? "" });
    actual = madre.get(actual) ?? null;
  }
  return ruta;
}

/**
 * El nivel donde se ve una tarjeta con su ficha (el de los links del MCP): el de su madre, o la raíz
 * si no tiene. En la raíz se ven también las hijas de las raíces, pero entrar a la madre es igual de
 * correcto y deja la ruta a la vista.
 */
export function nivelDeLaTarjeta(tarjetas: TarjetaDeNivel[], tarjetaId: string): string | null {
  return madresVisibles(tarjetas).get(tarjetaId) ?? null;
}

/** Los grupos radiales de un nivel: la tarjeta del nivel con sus hijas, o cada raíz con las suyas. */
export function gruposDelNivel(
  tarjetas: TarjetaDeNivel[],
  nivelId: string | null,
): { nivel: string | null; grupos: { centro: string; hijas: string[] }[] } {
  const madre = madresVisibles(tarjetas);
  const nivel = nivelId && madre.has(nivelId) ? nivelId : null;
  const hijasDe = (id: string) => [...madre].filter(([, suMadre]) => suMadre === id).map(([hija]) => hija);
  if (nivel) return { nivel, grupos: [{ centro: nivel, hijas: hijasDe(nivel) }] };
  const raices = [...madre].filter(([, suMadre]) => suMadre === null).map(([id]) => id);
  // Primero las raíces con hijas (las carpetas grandes), después las sueltas.
  const grupos = raices.map((id) => ({ centro: id, hijas: hijasDe(id) }));
  return { nivel: null, grupos: [...grupos.filter((g) => g.hijas.length), ...grupos.filter((g) => !g.hijas.length)] };
}

/**
 * La Lista agrupada por ÁREA (las tarjetas de un tipo sin estados): cada área con sus descendientes
 * (hasta la próxima área, que tiene su propio grupo), con su profundidad para la sangría; y al final
 * las sueltas (sin área arriba). `dentroDe` limita a lo que cuelga de esa tarjeta (el nivel actual).
 */
export function agruparPorArea<T extends TarjetaDeNivel>(
  tarjetas: T[],
  esArea: (tarjeta: T) => boolean,
  dentroDe: string | null = null,
): {
  areas: { area: T; ruta: string[]; tarjetas: { tarjeta: T; profundidad: number }[] }[];
  sueltas: { tarjeta: T; profundidad: number }[];
} {
  const vivas = tarjetas.filter((tarjeta) => !tarjeta.borradoEn);
  const madre = madresVisibles(vivas);
  const porId = new Map(vivas.map((tarjeta) => [tarjeta.id, tarjeta]));
  const hijas = new Map<string | null, T[]>();
  for (const tarjeta of vivas) {
    const suMadre = madre.get(tarjeta.id) ?? null;
    hijas.set(suMadre, [...(hijas.get(suMadre) ?? []), tarjeta]);
  }

  const areas: { area: T; ruta: string[]; tarjetas: { tarjeta: T; profundidad: number }[] }[] = [];
  const sueltas: { tarjeta: T; profundidad: number }[] = [];
  const vistas = new Set<string>();

  // Recorrido en profundidad: cada tarjeta va al grupo del área más cercana hacia arriba.
  const recorrer = (tarjeta: T, area: (typeof areas)[number] | null, profundidad: number, ruta: string[]) => {
    if (vistas.has(tarjeta.id)) return;
    vistas.add(tarjeta.id);
    if (esArea(tarjeta)) {
      const rutaNueva = [...ruta, tarjeta.titulo ?? ""];
      const grupo = { area: tarjeta, ruta: rutaNueva, tarjetas: [] };
      areas.push(grupo);
      for (const hija of hijas.get(tarjeta.id) ?? []) recorrer(hija, grupo, 0, rutaNueva);
      return;
    }
    (area ? area.tarjetas : sueltas).push({ tarjeta, profundidad });
    for (const hija of hijas.get(tarjeta.id) ?? []) recorrer(hija, area, profundidad + 1, ruta);
  };

  if (dentroDe && porId.has(dentroDe)) {
    // El área de arriba del nivel (si la hay) da el encabezado y la ruta.
    const arriba: T[] = [];
    const subidas = new Set<string>();
    let actual = madre.get(dentroDe) ?? null;
    while (actual && !subidas.has(actual)) {
      subidas.add(actual);
      arriba.unshift(porId.get(actual)!);
      actual = madre.get(actual) ?? null;
    }
    const areasArriba = arriba.filter(esArea);
    const ruta = areasArriba.map((t) => t.titulo ?? "");
    const cercana = areasArriba.at(-1);
    const nivel = porId.get(dentroDe)!;
    let grupo: (typeof areas)[number] | null = null;
    if (cercana && !esArea(nivel)) {
      grupo = { area: cercana, ruta, tarjetas: [] };
      areas.push(grupo);
    }
    recorrer(nivel, grupo, 0, ruta);
  } else {
    for (const raiz of hijas.get(null) ?? []) recorrer(raiz, null, 0, []);
  }
  return { areas, sueltas };
}
