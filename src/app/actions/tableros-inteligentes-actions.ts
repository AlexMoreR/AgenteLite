"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import {
  aprobarTarjeta,
  cambiarZonasEnPantalla,
  borrarTipo,
  crearTipo,
  editarTipo,
  historialDeTarjeta,
} from "@/features/tableros-inteligentes/services/tableros";
import {
  agregarAprobador,
  crearClaveTrabajador,
  listarAprobadores,
  listarClavesTrabajador,
  quitarAprobador,
  revocarClaveTrabajador,
} from "@/features/tableros-inteligentes/services/trabajador";
import type { MomentoDeAprobacion } from "@/features/tableros-inteligentes/services/reglas-trabajador";

/*
  Tablero IA (tableros inteligentes): lo que hace la PANTALLA.

  La pantalla aprueba, lee el historial y administra los TIPOS de tarjeta (panel Tipos); las
  tarjetas las arma Claude por el MCP. Aprobar y tocar los tipos lo puede el dueño del negocio o el
  ADMIN de la plataforma (decisión del dueño, 19-oct-2026), y se comprueba ACÁ además de ocultar
  los botones: un botón oculto no es un permiso.

  Fase 2 (20-oct-2026): aprobar tiene tres momentos (la tarea, el plan y el sí final "subir a
  producción"); quién puede cada uno lo decide el servicio con reglas-trabajador.ts (el dueño todo, un
  aprobador según su alcance, el sí final SOLO el dueño). El panel Trabajador (claves y aprobadores) y
  quitar una zona protegida son solo del dueño.
*/

type Resultado = { ok: true } | { ok: false; error: string };

const mensaje = (fallo: unknown, porDefecto: string) => (fallo instanceof Error ? fallo.message : porDefecto);

/**
 * Aprobar desde la pantalla: la tarea, el plan o el sí final (y Reintentar desde ERROR = aprobar la
 * tarea o el plan otra vez). Queda en el historial con el nombre de quien aprobó y "pantalla".
 */
export async function aprobarTarjetaAction(
  tarjetaId: string,
  momento: MomentoDeAprobacion = "tarea",
  vistaEn?: string,
): Promise<Resultado> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  try {
    await aprobarTarjeta(
      { workspaceId: access.workspaceId, userId: access.userId, origen: "PANTALLA" },
      tarjetaId,
      { momento, via: "pantalla", vistaEn },
    );
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo aprobar") };
  }
}

/** Cambiar las zonas protegidas de una tarjeta (quitarlas: solo el dueño; lo comprueba el servicio). */
export async function cambiarZonasAction(tarjetaId: string, zonas: string[]): Promise<Resultado> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  try {
    await cambiarZonasEnPantalla({ workspaceId: access.workspaceId, userId: access.userId, origen: "PANTALLA" }, tarjetaId, zonas);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo cambiar la zona protegida") };
  }
}

/* ── Panel Trabajador (solo el dueño) ──────────────────────────────────────────────────────── */

export type PanelTrabajadorVista = {
  claves: { id: string; nombre: string; creadoEn: string; ultimoUsoEn: string | null; revocadaEn: string | null }[];
  aprobadores: { id: string; userId: string; nombre: string; alcance: string; puedeSubir: boolean }[];
  candidatos: { userId: string; nombre: string }[];
};

const SOLO_EL_DUENO_TRABAJADOR = "El trabajador y los aprobadores los maneja solo el dueño del negocio.";

async function accesoDelDueno() {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  return access.isOwner ? access : null;
}

export async function panelTrabajadorAction(): Promise<{ ok: true; panel: PanelTrabajadorVista } | { ok: false; error: string }> {
  const access = await accesoDelDueno();
  if (!access) return { ok: false, error: SOLO_EL_DUENO_TRABAJADOR };
  try {
    const [claves, { aprobadores, candidatos }] = await Promise.all([
      listarClavesTrabajador(access.workspaceId),
      listarAprobadores(access.workspaceId),
    ]);
    return {
      ok: true,
      panel: {
        claves: claves.map((clave) => ({
          id: clave.id,
          nombre: clave.nombre,
          creadoEn: clave.creadoEn.toISOString(),
          ultimoUsoEn: clave.ultimoUsoEn ? clave.ultimoUsoEn.toISOString() : null,
          revocadaEn: clave.revocadaEn ? clave.revocadaEn.toISOString() : null,
        })),
        aprobadores,
        candidatos,
      },
    };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo leer el panel del trabajador") };
  }
}

/** Crea la clave del trabajador y la devuelve UNA vez (después solo queda su huella). */
export async function crearClaveTrabajadorAction(nombre: string): Promise<{ ok: true; clave: string } | { ok: false; error: string }> {
  const access = await accesoDelDueno();
  if (!access) return { ok: false, error: SOLO_EL_DUENO_TRABAJADOR };
  try {
    const { clave } = await crearClaveTrabajador(access.workspaceId, nombre);
    return { ok: true, clave };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo crear la clave") };
  }
}

export async function revocarClaveTrabajadorAction(id: string): Promise<Resultado> {
  const access = await accesoDelDueno();
  if (!access) return { ok: false, error: SOLO_EL_DUENO_TRABAJADOR };
  try {
    await revocarClaveTrabajador(access.workspaceId, id);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo revocar la clave") };
  }
}

export async function agregarAprobadorAction(userId: string, alcance: "DESARROLLO" | "TODO" = "DESARROLLO"): Promise<Resultado> {
  const access = await accesoDelDueno();
  if (!access) return { ok: false, error: SOLO_EL_DUENO_TRABAJADOR };
  try {
    await agregarAprobador(access.workspaceId, userId, alcance);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo agregar") };
  }
}

export async function quitarAprobadorAction(id: string): Promise<Resultado> {
  const access = await accesoDelDueno();
  if (!access) return { ok: false, error: SOLO_EL_DUENO_TRABAJADOR };
  try {
    await quitarAprobador(access.workspaceId, id);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo quitar") };
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
