"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import { tableroDeFeatures, type TableroDeFeatures } from "@/features/tableros-inteligentes/services/tablero-de-features";

/*
  Tablero IA, vista tipo tablero de Features (27-nov-2026, parte 1 de 3): solo LEE las tarjetas que cuelgan del Área
  Features, repartidas en columnas por estado. No cambia ninguna tarjeta. El permiso es el mismo de trabajosTerminadosAction:
  la sesión, el negocio de la sesión y solo el dueño o el ADMIN (personaPuedeAprobar).
*/

// En un archivo "use server" solo se exportan funciones async: el texto queda sin exportar.
const SIN_PERMISO_TABLERO_DE_FEATURES = "El tablero de Features lo ve solo el dueño del negocio.";

export async function tableroDeFeaturesAction(): Promise<{ ok: true; tablero: TableroDeFeatures } | { ok: false; error: string }> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  if (!personaPuedeAprobar(access)) return { ok: false, error: SIN_PERMISO_TABLERO_DE_FEATURES };
  try {
    return { ok: true, tablero: await tableroDeFeatures(access.workspaceId) };
  } catch {
    return { ok: false, error: "No se pudo leer el tablero de Features" };
  }
}
