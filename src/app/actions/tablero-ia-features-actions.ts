"use server";

// Tablero de Features (27-nov-2026, parte 1 de 3): la entrada del servidor que LEE las tarjetas de Features en columnas. Solo
// lee: no cambia ninguna tarjeta. Solo el dueño o el ADMIN (personaPuedeAprobar), igual que trabajosTerminadosAction.
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import { tableroDeFeatures, type TableroDeFeatures } from "@/features/tableros-inteligentes/services/tablero-de-features";

// En un archivo "use server" solo se exportan funciones async: el texto queda adentro.
const SIN_PERMISO_TABLERO_DE_FEATURES = "El tablero de Features lo ve solo el dueño del negocio.";

export async function tableroDeFeaturesAction(): Promise<{ ok: true; tablero: TableroDeFeatures } | { ok: false; error: string }> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  if (!personaPuedeAprobar(access)) return { ok: false, error: SIN_PERMISO_TABLERO_DE_FEATURES };
  try {
    return { ok: true, tablero: await tableroDeFeatures(access.workspaceId) };
  } catch (fallo) {
    // El detalle (puede traer SQL) queda solo en el log del servidor; a la pantalla va un texto fijo.
    console.error("[tablero-de-features]", fallo instanceof Error ? fallo.message : fallo);
    return { ok: false, error: "No se pudo leer el tablero de Features." };
  }
}
