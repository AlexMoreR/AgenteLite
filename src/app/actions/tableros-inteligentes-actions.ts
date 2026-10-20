"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import { aprobarTarjeta, historialDeTarjeta } from "@/features/tableros-inteligentes/services/tableros";

/*
  Tablero IA (tableros inteligentes): lo que hace la PANTALLA.

  En la fase 1 la pantalla solo aprueba y lee el historial; las ideas las arma Claude por el MCP.
  Aprobar lo puede el dueño del negocio o el ADMIN de la plataforma (decisión del dueño, 19-oct-2026),
  y se comprueba ACÁ además de ocultar el botón: un botón oculto no es un permiso.
*/

export async function aprobarTarjetaAction(
  tarjetaId: string,
  vistaEn?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  if (!personaPuedeAprobar(access)) {
    return { ok: false, error: "Aprobar lo hace solo el dueño del negocio." };
  }
  try {
    await aprobarTarjeta({ workspaceId: access.workspaceId, userId: access.userId, origen: "PANTALLA" }, tarjetaId, vistaEn);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: fallo instanceof Error ? fallo.message : "No se pudo aprobar" };
  }
}

export type CambioDeTarjetaVista = {
  id: string;
  cuando: string;
  quien: string;
  origen: string;
  accion: string;
  antes: unknown;
  despues: unknown;
  deshecho: boolean;
};

export async function historialDeTarjetaAction(
  tarjetaId: string,
): Promise<{ ok: true; cambios: CambioDeTarjetaVista[] } | { ok: false; error: string }> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  try {
    const { cambios } = await historialDeTarjeta(access.workspaceId, tarjetaId);
    return {
      ok: true,
      cambios: cambios.map((cambio) => ({
        id: cambio.id,
        cuando: cambio.creadoEn.toISOString(),
        quien: cambio.quienNombre,
        origen: cambio.origen,
        accion: cambio.accion,
        antes: cambio.antes,
        despues: cambio.despues,
        deshecho: Boolean(cambio.deshechoEn),
      })),
    };
  } catch (fallo) {
    return { ok: false, error: fallo instanceof Error ? fallo.message : "No se pudo leer el historial" };
  }
}
