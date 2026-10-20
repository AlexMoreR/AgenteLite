"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import {
  aprobarTarjeta,
  borrarTipo,
  crearTipo,
  editarTipo,
  historialDeTarjeta,
} from "@/features/tableros-inteligentes/services/tableros";

/*
  Tablero IA (tableros inteligentes): lo que hace la PANTALLA.

  La pantalla aprueba, lee el historial y administra los TIPOS de tarjeta (panel Tipos); las
  tarjetas las arma Claude por el MCP. Aprobar y tocar los tipos lo puede el dueño del negocio o el
  ADMIN de la plataforma (decisión del dueño, 19-oct-2026), y se comprueba ACÁ además de ocultar
  los botones: un botón oculto no es un permiso.
*/

type Resultado = { ok: true } | { ok: false; error: string };

const mensaje = (fallo: unknown, porDefecto: string) => (fallo instanceof Error ? fallo.message : porDefecto);

export async function aprobarTarjetaAction(tarjetaId: string, vistaEn?: string): Promise<Resultado> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  if (!personaPuedeAprobar(access)) {
    return { ok: false, error: "Aprobar lo hace solo el dueño del negocio." };
  }
  try {
    await aprobarTarjeta({ workspaceId: access.workspaceId, userId: access.userId, origen: "PANTALLA" }, tarjetaId, vistaEn);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo aprobar") };
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
    return { ok: false, error: mensaje(fallo, "No se pudo leer el historial") };
  }
}

/** Lo que manda el panel Tipos al guardar un tipo. */
export type DatosTipoPantalla = {
  nombre: string;
  color: string;
  icono: string | null;
  requiereAprobacion: boolean;
  /** false = carpeta (como Área): sus tarjetas no tienen estado. */
  usaEstados: boolean;
  orden: number;
  /** Ids de los tipos madre permitidos (puede incluir el propio: Área dentro de Área). */
  padres: string[];
};

async function accesoParaTipos() {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  if (!personaPuedeAprobar(access)) return null;
  return { workspaceId: access.workspaceId, userId: access.userId, origen: "PANTALLA" as const };
}

const SOLO_EL_DUENO = "Los tipos los cambia solo el dueño del negocio.";

export async function crearTipoAction(tableroId: string, datos: DatosTipoPantalla): Promise<Resultado> {
  const contexto = await accesoParaTipos();
  if (!contexto) return { ok: false, error: SOLO_EL_DUENO };
  try {
    await crearTipo(contexto, tableroId, { ...datos, icono: datos.icono ?? "" });
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo crear el tipo") };
  }
}

export async function editarTipoAction(tipoId: string, datos: DatosTipoPantalla): Promise<Resultado> {
  const contexto = await accesoParaTipos();
  if (!contexto) return { ok: false, error: SOLO_EL_DUENO };
  try {
    await editarTipo(contexto, tipoId, { ...datos, icono: datos.icono ?? "" });
    return { ok: true };
  } catch (fallo) {
    const texto = mensaje(fallo, "No se pudo guardar el tipo");
    // Guardar sin cambios no es un error para la pantalla.
    return texto === "No hay nada distinto para cambiar." ? { ok: true } : { ok: false, error: texto };
  }
}

export async function borrarTipoAction(tipoId: string): Promise<Resultado> {
  const contexto = await accesoParaTipos();
  if (!contexto) return { ok: false, error: SOLO_EL_DUENO };
  try {
    await borrarTipo(contexto, tipoId);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo borrar el tipo") };
  }
}
