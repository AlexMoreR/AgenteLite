/*
  «Mover tarjeta» en los tres puntos de la ficha (23-nov-2026, pedido de Alex): la lista de Áreas a las que
  se puede mover una tarjeta. Puro: lo usa la ficha y lo prueba check-tableros-reglas.

  Solo las tarjetas de un tipo llamado «Área» que el tipo de la tarjeta acepta como madre (el servidor lo
  vuelve a revisar con revisarMadre). Nunca ella misma ni algo que cuelgue de ella: sería un ciclo.
*/

type TarjetaMinima = { id: string; titulo: string; tipoId: string; padreId: string | null };
type TipoMinimo = { id: string; nombre: string; padres: readonly string[] };

export type AreaParaMover = {
  id: string;
  titulo: string;
  /** Las Áreas de arriba, de la más alta a la más cercana («Empresa › Ventas»); vacío si está suelta. */
  ruta: string;
  /** La tarjeta ya cuelga de esta. */
  actual: boolean;
};

export function esTipoArea(nombre: string): boolean {
  return nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase() === "area";
}

export function areasParaMover(
  tarjeta: TarjetaMinima,
  tarjetas: readonly TarjetaMinima[],
  tipos: ReadonlyMap<string, TipoMinimo>,
): AreaParaMover[] {
  const tipoDeLaTarjeta = tipos.get(tarjeta.tipoId);
  if (!tipoDeLaTarjeta) return [];
  const madresPermitidas = new Set(tipoDeLaTarjeta.padres);
  const porId = new Map(tarjetas.map((otra) => [otra.id, otra]));

  // Ella y todo lo que cuelga de ella (a cualquier profundidad).
  const hijasDe = new Map<string, string[]>();
  for (const otra of tarjetas) {
    if (!otra.padreId) continue;
    hijasDe.set(otra.padreId, [...(hijasDe.get(otra.padreId) ?? []), otra.id]);
  }
  const prohibidas = new Set<string>([tarjeta.id]);
  const pendientes = [tarjeta.id];
  while (pendientes.length) {
    for (const hija of hijasDe.get(pendientes.pop() as string) ?? []) {
      if (!prohibidas.has(hija)) {
        prohibidas.add(hija);
        pendientes.push(hija);
      }
    }
  }

  const rutaDe = (area: TarjetaMinima) => {
    const arriba: string[] = [];
    const vistas = new Set<string>([area.id]);
    let madre = area.padreId ? porId.get(area.padreId) : undefined;
    while (madre && !vistas.has(madre.id) && arriba.length < 10) {
      vistas.add(madre.id);
      arriba.unshift(madre.titulo);
      madre = madre.padreId ? porId.get(madre.padreId) : undefined;
    }
    return arriba.join(" › ");
  };

  return tarjetas
    .filter((otra) => {
      const tipo = tipos.get(otra.tipoId);
      return tipo && esTipoArea(tipo.nombre) && madresPermitidas.has(tipo.id) && !prohibidas.has(otra.id);
    })
    .map((area) => ({ id: area.id, titulo: area.titulo, ruta: rutaDe(area), actual: area.id === tarjeta.padreId }))
    // Por la ruta completa: cada Área queda justo debajo de la que la contiene.
    .sort((a, b) => rutaCompleta(a).localeCompare(rutaCompleta(b), "es"));
}

function rutaCompleta(area: { ruta: string; titulo: string }) {
  return area.ruta ? `${area.ruta} › ${area.titulo}` : area.titulo;
}

/** El buscador de la lista: sin mayúsculas ni tildes, por el nombre o por la ruta. */
export function filtrarAreas(areas: readonly AreaParaMover[], busqueda: string): AreaParaMover[] {
  const limpiar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const buscado = limpiar(busqueda.trim());
  if (!buscado) return [...areas];
  return areas.filter((area) => limpiar(`${area.ruta} ${area.titulo}`).includes(buscado));
}
