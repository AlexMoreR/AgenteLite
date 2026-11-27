"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import { tableroDeFeatures, type TableroDeFeatures } from "@/features/tableros-inteligentes/services/tablero-de-features";

/*
  Tablero IA, vista tipo tablero de Features (27-nov-2026, parte 1): SOLO LEE. Trae las tarjetas que cuelgan del Área Features
  del negocio de la sesión, repartidas en columnas por estado. No cambia ninguna tarjeta: para eso están las acciones de siempre.
  El permiso es el de trabajosTerminadosAction: la sesión, el negocio de la sesión y personaPuedeAprobar (el dueño o el ADMIN).
*/

export async function tableroDeFeaturesAction(): Promise<{ ok: true; tablero: TableroDeFeatures } | { ok: false; error: string }> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  if (!personaPuedeAprobar(access)) return { ok: false, error: "El tablero de Features lo ve solo el dueño del negocio." };
  try {
    return { ok: true, tablero: await tableroDeFeatures(access.workspaceId) };
  } catch {
    return { ok: false, error: "No se pudo leer el tablero de Features" };
  }
}
