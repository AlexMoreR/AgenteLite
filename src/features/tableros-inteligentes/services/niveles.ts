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

/*
  CONTADORES del mapa (como el tablero "Tareas Magilus"): cada tarjeta cuenta ELLA MISMA y TODA su
  descendencia no borrada, pero solo las tarjetas de tipos con estados (las carpetas, como Área, no
  suman). Los grupos:
  - teToca: lo que espera al dueño = POR_APROBAR (solo de tipos con aprobación) + PLAN_LISTO +
    POR_REVISAR + ERROR + FALLIDO.
  - enCurso: lo que está andando = PLANEANDO + PLAN_APROBADO + EN_CURSO + SUBIENDO.
  - siguen: abiertas que no dependen del dueño = IDEA + APROBADO (y POR_APROBAR de tipos sin aprobación).
  - hecho: HECHO.
*/
export type Contadores = { teToca: number; enCurso: number; siguen: number; hecho: number };
export type GrupoDeContador = keyof Contadores;
export const GRUPOS_DE_CONTADOR: readonly GrupoDeContador[] = ["teToca", "enCurso", "siguen", "hecho"];

export const contadoresEnCero = (): Contadores => ({ teToca: 0, enCurso: 0, siguen: 0, hecho: 0 });

export type TarjetaConEstado = TarjetaDeNivel & { estado: string; tipoId: string };
export type TipoDeContador = { id: string; usaEstados: boolean; requiereAprobacion: boolean };

/** El grupo de UNA tarjeta por su propio estado (null = carpeta o tipo sin estados). */
export function grupoDeLaTarjeta(
  tarjeta: Pick<TarjetaConEstado, "estado" | "tipoId">,
  tipos: ReadonlyMap<string, TipoDeContador>,
): GrupoDeContador | null {
  const tipo = tipos.get(tarjeta.tipoId);
  if (tipo && !tipo.usaEstados) return null;
  switch (tarjeta.estado) {
    case "FALLIDO":
    case "ERROR":
    case "PLAN_LISTO":
    case "POR_REVISAR":
      return "teToca";
    case "POR_APROBAR":
      // Sin tipo conocido se trata como que pide aprobación (lo más seguro: que el dueño lo vea).
      return !tipo || tipo.requiereAprobacion ? "teToca" : "siguen";
    case "EN_CURSO":
    case "PLANEANDO":
    case "PLAN_APROBADO":
    case "SUBIENDO":
      return "enCurso";
    case "IDEA":
    case "APROBADO":
      return "siguen";
    case "HECHO":
      return "hecho";
    default:
      return null;
  }
}

export const sumarContadores = (a: Contadores, b: Contadores): Contadores => ({
  teToca: a.teToca + b.teToca,
  enCurso: a.enCurso + b.enCurso,
  siguen: a.siguen + b.siguen,
  hecho: a.hecho + b.hecho,
});

/** Los contadores RECURSIVOS de cada tarjeta no borrada (ella + toda su descendencia). */
export function contadoresRecursivos(
  tarjetas: TarjetaConEstado[],
  tipos: readonly TipoDeContador[],
): Map<string, Contadores> {
  const vivas = tarjetas.filter((tarjeta) => !tarjeta.borradoEn);
  const madre = madresVisibles(vivas);
  const porTipo = new Map(tipos.map((tipo) => [tipo.id, tipo]));
  const hijas = new Map<string, string[]>();
  for (const [id, suMadre] of madre) if (suMadre) hijas.set(suMadre, [...(hijas.get(suMadre) ?? []), id]);
  const porId = new Map(vivas.map((tarjeta) => [tarjeta.id, tarjeta]));
  const resultado = new Map<string, Contadores>();

  const calcular = (id: string, camino: Set<string>): Contadores => {
    const listo = resultado.get(id);
    if (listo) return listo;
    const propio = contadoresEnCero();
    const grupo = grupoDeLaTarjeta(porId.get(id)!, porTipo);
    if (grupo) propio[grupo] += 1;
    // Un ciclo (no debería existir) no se recorre dos veces.
    camino.add(id);
    let total = propio;
    for (const hija of hijas.get(id) ?? []) if (!camino.has(hija)) total = sumarContadores(total, calcular(hija, camino));
    camino.delete(id);
    resultado.set(id, total);
    return total;
  };
  for (const tarjeta of vivas) calcular(tarjeta.id, new Set());
  return resultado;
}

/** Los contadores de lo que se ve en un nivel: el del nivel, o la suma de todas las raíces. */
export function contadoresDelNivel(
  tarjetas: TarjetaConEstado[],
  tipos: readonly TipoDeContador[],
  nivelId: string | null,
  recursivos: ReadonlyMap<string, Contadores> = contadoresRecursivos(tarjetas, tipos),
): Contadores {
  const { nivel, grupos } = gruposDelNivel(
    tarjetas.filter((tarjeta) => !tarjeta.borradoEn),
    nivelId,
  );
  if (nivel) return recursivos.get(nivel) ?? contadoresEnCero();
  return grupos.reduce((suma, grupo) => sumarContadores(suma, recursivos.get(grupo.centro) ?? contadoresEnCero()), contadoresEnCero());
}

/**
 * ¿El filtro de grupos atenúa esta tarjeta? Se ve si tiene algo en algún grupo activo. Una sin nada
 * ("sin tareas") nunca se atenúa: no hay nada que esconder.
 */
export function atenuadaPorGrupos(contadores: Contadores, activos: ReadonlySet<GrupoDeContador>): boolean {
  const total = GRUPOS_DE_CONTADOR.reduce((suma, grupo) => suma + contadores[grupo], 0);
  if (total === 0) return false;
  return !GRUPOS_DE_CONTADOR.some((grupo) => activos.has(grupo) && contadores[grupo] > 0);
}

/**
 * Filtro "Mis tarjetas": los ids de las tarjetas que son de esta persona o que tienen, más abajo, alguna
 * suya (así una carpeta con tareas mías no se apaga). Las demás se ven apagadas, no desaparecen.
 */
export function tarjetasConMias(
  tarjetas: readonly { id: string; padreId: string | null; responsableId: string | null; borradoEn?: unknown }[],
  userId: string,
): Set<string> {
  const porId = new Map(tarjetas.map((tarjeta) => [tarjeta.id, tarjeta]));
  const conMias = new Set<string>();
  for (const tarjeta of tarjetas) {
    if (tarjeta.borradoEn || tarjeta.responsableId !== userId) continue;
    // Sube por las madres hasta la raíz (con tope y sin repetir, por si los datos tuvieran un ciclo).
    let actual: typeof tarjeta | undefined = tarjeta;
    while (actual && !conMias.has(actual.id)) {
      conMias.add(actual.id);
      actual = actual.padreId ? porId.get(actual.padreId) : undefined;
    }
  }
  return conMias;
}

/**
 * Los contadores de un tablero entero a partir de un conteo agrupado (estado y tipo, cuántas): los
 * de la página de inicio, que no lee las tarjetas. Suman lo mismo que los chips en la raíz.
 */
export function contadoresDelConteo(
  filas: readonly { estado: string; tipoId: string; cantidad: number }[],
  tipos: readonly TipoDeContador[],
): Contadores {
  const porTipo = new Map(tipos.map((tipo) => [tipo.id, tipo]));
  const total = contadoresEnCero();
  for (const fila of filas) {
    const grupo = grupoDeLaTarjeta(fila, porTipo);
    if (grupo) total[grupo] += fila.cantidad;
  }
  return total;
}
