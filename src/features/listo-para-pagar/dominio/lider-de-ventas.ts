/*
  A quien le toca ser el lider de ventas del negocio (el que recibe el aviso "Listo para pagar"
  cuando nadie escribe a tiempo). Sin base de datos, para poder probarlo.

  1. El elegido por el dueño en Equipo, si sigue siendo miembro activo.
  2. Si no, la primera supervisora (en el orden guardado) que siga activa.
  3. Si no hay ninguna, nadie (null).
*/
export function elegirLiderDeVentas(
  elegido: string | null,
  supervisoras: readonly string[],
  activos: ReadonlySet<string>,
): string | null {
  if (elegido && activos.has(elegido)) {
    return elegido;
  }
  return supervisoras.find((id) => activos.has(id)) ?? null;
}
