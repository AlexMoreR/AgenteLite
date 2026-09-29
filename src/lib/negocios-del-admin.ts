import { prisma } from "@/lib/prisma";

/**
 * LOS NEGOCIOS, para el admin de la plataforma.
 *
 * Desde el 29-09-2026 el catalogo es de cada negocio: productos, categorias y cotizaciones tienen
 * dueño. El admin de la plataforma sigue viendo los nueve juntos -decision de Alex- pero ahora
 * necesita tres cosas que antes no: una columna que diga de quien es cada fila, un filtro arriba
 * para mirar uno solo, y un selector al crear, porque lo que se crea tiene que nacer con dueño.
 *
 * Las tres salen de aca para que digan lo mismo.
 */

export type NegocioDelAdmin = { id: string; name: string };

export async function listarNegocios(): Promise<NegocioDelAdmin[]> {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return workspaces.map((w) => ({ id: w.id, name: w.name?.trim() || "Sin nombre" }));
}

/**
 * El filtro que llega por la direccion, ya validado.
 *
 * Devuelve null cuando no hay filtro o cuando el id no es de ningun negocio: en los dos casos se
 * muestran todos, que es el comportamiento de siempre. Un id inventado no puede vaciar la
 * pantalla ni, peor, hacerla mostrar otra cosa.
 */
export function leerFiltroDeNegocio(
  valor: string | string[] | undefined,
  negocios: NegocioDelAdmin[],
): string | null {
  const pedido = typeof valor === "string" ? valor.trim() : "";
  if (!pedido) {
    return null;
  }
  return negocios.some((negocio) => negocio.id === pedido) ? pedido : null;
}
