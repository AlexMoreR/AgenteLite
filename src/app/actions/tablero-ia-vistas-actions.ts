"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { alcanceDe, cambiarEstadoTarjeta, editarTarjeta, type ContextoTablero } from "@/features/tableros-inteligentes/services/tableros";
import {
  borrarVistaDeTabla,
  guardarUltimaVista,
  guardarVistaDeTabla,
} from "@/features/tableros-inteligentes/services/vistas-guardadas";
import type { VistaDeTabla } from "@/features/tableros-inteligentes/services/vistas-de-tabla";

/*
  Tablero IA, vistas estilo Notion (3-nov-2026): lo que hacen la Tabla, el Tablero (kanban) y el
  Calendario.

  - Las vistas (la última y las guardadas) son de la persona de la sesión: la clave lleva su userId y
    nunca se lee ni se escribe la de otra.
  - Cambiar el estado, el área, la fecha o la prioridad pasa por el MISMO servicio que el MCP y la ficha
    (cambiarEstadoTarjeta y editarTarjeta) con origen PANTALLA y el alcance de la sesión: las reglas
    (puedeCambiarEstado, el candado del Coordinador, tableros por cuenta) se revisan allá, no acá. Un
    menú que no ofrece una opción no es un permiso. El responsable sigue con cambiarResponsableAction.
*/

type Resultado = { ok: true } | { ok: false; error: string };

const mensaje = (fallo: unknown, porDefecto: string) => (fallo instanceof Error ? fallo.message : porDefecto);

async function contextoDePantalla(): Promise<ContextoTablero> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  return { ...alcanceDe(access), userId: access.userId, origen: "PANTALLA" };
}

/** Recordar la última vista de quien mira (Tabla, Tablero, Calendario o Mapa). */
export async function guardarUltimaVistaAction(vista: string): Promise<Resultado> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  try {
    await guardarUltimaVista(access.userId, vista);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo recordar la vista") };
  }
}

export async function guardarVistaDeTablaAction(
  nombre: string,
  config: unknown,
): Promise<{ ok: true; guardadas: VistaDeTabla[] } | { ok: false; error: string }> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  try {
    return { ok: true, guardadas: await guardarVistaDeTabla(access.userId, nombre, config) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo guardar la vista") };
  }
}

export async function borrarVistaDeTablaAction(id: string): Promise<{ ok: true; guardadas: VistaDeTabla[] } | { ok: false; error: string }> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  try {
    return { ok: true, guardadas: await borrarVistaDeTabla(access.userId, id) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo borrar la vista") };
  }
}

/**
 * Cambiar el estado desde la celda o arrastrando en el kanban. Lo decide `cambiarEstadoTarjeta` (la regla
 * de siempre); si queda POR_APROBAR con repo, puede aprobarse sola como hoy y se avisa con `aprobadaSola`.
 */
export async function cambiarEstadoDesdeVistaAction(
  tarjetaId: string,
  estado: string,
): Promise<{ ok: true; aprobadaSola: boolean } | { ok: false; error: string }> {
  const contexto = await contextoDePantalla();
  try {
    const resultado = await cambiarEstadoTarjeta(contexto, tarjetaId, estado);
    return { ok: true, aprobadaSola: Boolean(resultado.aprobacionAutomatica?.aprobada) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo cambiar el estado") };
  }
}

/**
 * Cambiar el área, la fecha o la prioridad desde la celda ("" o null borran el área y la fecha; la fecha va AAAA-MM-DD; la
 * prioridad es URGENTE, ALTA, MEDIA o BAJA y la valida editarTarjeta). Cambiar la prioridad cuenta como mover: no reinicia la aprobación.
 */
export async function editarCeldaAction(
  tarjetaId: string,
  cambio: { area: string | null } | { fecha: string | null } | { prioridad: string },
): Promise<{ ok: true; aviso?: string } | { ok: false; error: string }> {
  const contexto = await contextoDePantalla();
  // Solo estos tres campos: la celda no edita nada más.
  const permitido =
    typeof cambio !== "object" || cambio === null
      ? null
      : "area" in cambio
        ? { area: cambio.area ?? "" }
        : "fecha" in cambio
          ? { fecha: cambio.fecha ?? "" }
          : "prioridad" in cambio && typeof cambio.prioridad === "string" && cambio.prioridad.trim()
            ? { prioridad: cambio.prioridad }
            : null;
  if (!permitido) return { ok: false, error: "Esa columna no se edita desde la tabla." };
  try {
    const { avisoDePrioridad } = await editarTarjeta(contexto, tarjetaId, permitido);
    // Se bajó la prioridad pero el título la sigue dejando urgente: se le dice a quien la cambió.
    return avisoDePrioridad ? { ok: true, aviso: avisoDePrioridad } : { ok: true };
  } catch (fallo) {
    const texto = mensaje(fallo, "No se pudo guardar el cambio");
    return texto === "No hay nada distinto para cambiar." ? { ok: true } : { ok: false, error: texto };
  }
}
