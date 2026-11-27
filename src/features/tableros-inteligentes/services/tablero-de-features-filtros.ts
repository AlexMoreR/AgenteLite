/*
  Tablero IA, vista tipo tablero de Features (27-nov-2026, parte 2 de 3): lo puro de esa vista (el texto del repo, los filtros
  y el mensaje de «sin Área Features»), SIN prisma, para que la pantalla (un componente de cliente) lo use sin traer la base.
  tablero-de-features.ts lo vuelve a exportar: quien ya lo importaba de ahí sigue igual.
*/
import type { Prioridad } from "./reglas-trabajador";
import type { TarjetaDeFeatures } from "./tablero-de-features";

export const SIN_AREA_FEATURES = "No se encontró el Área Features";

/** Cómo se lee el repo en el tablero: 'Gestión', 'CRM' o 'Sin repo' (otro valor, tal cual). */
export function etiquetaDelRepo(repo: string | null | undefined): string {
  const clave = (repo ?? "").trim().toLowerCase();
  if (!clave) return "Sin repo";
  if (clave === "gestion") return "Gestión";
  if (clave === "aizencrm") return "CRM";
  return (repo ?? "").trim();
}

/* ------------------------------------------------------------------ filtros */

/**
 * Lo que se filtra; un filtro vacío (undefined o null) deja pasar todo. `area` = el nombre del área ("" = sin área);
 * `repo` = 'gestion', 'aizencrm' o "" (sin repo); `prioridad` = URGENTE, ALTA, MEDIA o BAJA.
 */
export type FiltrosDeFeatures = { area?: string | null; repo?: string | null; prioridad?: Prioridad | null };

/** Deja las tarjetas que cumplen TODOS los filtros pedidos (se combinan entre sí). */
export function filtrarTarjetas<T extends Pick<TarjetaDeFeatures, "area" | "repo" | "prioridad">>(
  tarjetas: readonly T[],
  filtros: FiltrosDeFeatures = {},
): T[] {
  const { area, repo, prioridad } = filtros;
  return tarjetas.filter(
    (tarjeta) =>
      (area === undefined || area === null || (tarjeta.area ?? "") === area) &&
      (repo === undefined || repo === null || (tarjeta.repo ?? "").trim().toLowerCase() === repo.trim().toLowerCase()) &&
      (prioridad === undefined || prioridad === null || tarjeta.prioridad === prioridad),
  );
}

