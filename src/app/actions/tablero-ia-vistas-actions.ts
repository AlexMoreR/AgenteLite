"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  alcanceDe,
  cambiarEstadoTarjeta,
  editarTarjeta,
  type ContextoTablero,
} from "@/features/tableros-inteligentes/services/tableros";
import { esEstado, sePuedeMarcarHechoAMano } from "@/features/tableros-inteligentes/services/reglas";
import {
  borrarVistaGuardada,
  guardarUltimaVista,
  guardarVistaConNombre,
} from "@/features/tableros-inteligentes/services/vistas-guardadas";
import type { VistaGuardada } from "@/features/tableros-inteligentes/services/vistas-de-tabla";

/*
  Tablero IA estilo Notion (2-nov-2026): lo que hacen las vistas Tabla, Tablero y Calendario.

  - Las vistas de cada persona (la última y las guardadas) van en AppSetting con su userId, que sale
    SIEMPRE de la sesión: nadie guarda ni lee las vistas de otra persona.
  - Cambiar el estado desde la celda o arrastrando en el kanban usa cambiarEstadoTarjeta con origen
    PANTALLA: las MISMAS reglas de siempre (puedeCambiarEstado) y el mismo alcance (un tablero ajeno
    responde "no existe"). Aprobar NO pasa por acá: sigue siendo el botón de la tarjeta.
  - Área y fecha se editan con editarTarjeta, origen PANTALLA (queda en el historial).
  - El responsable se sigue cambiando con cambiarResponsableAction (tableros-inteligentes-actions.ts).
*/

type Resultado = { ok: true } | { ok: false; error: string };

const mensaje = (fallo: unknown, porDefecto: string) => (fallo instanceof Error ? fallo.message : porDefecto);

/** Lo que dice editarTarjeta cuando no cambió nada: para la celda no es un error. */
const SIN_CAMBIOS = "No hay nada distinto para cambiar.";

async function sesion() {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  const contexto: ContextoTablero = { ...alcanceDe(access), userId: access.userId, origen: "PANTALLA" };
  return { userId: access.userId, contexto };
}

/** Recordar la última vista (Tabla, Tablero, Calendario o Mapa) de quien mira. */
export async function guardarUltimaVistaAction(vista: string): Promise<Resultado> {
  const { userId } = await sesion();
  try {
    await guardarUltimaVista(userId, vista);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo recordar la vista") };
  }
}

/** Guardar la tabla como está (búsqueda, filtros, orden y grupos) con un nombre. */
export async function guardarVistaAction(
  nombre: string,
  config: unknown,
): Promise<{ ok: true; guardadas: VistaGuardada[] } | { ok: false; error: string }> {
  const { userId } = await sesion();
  try {
    return { ok: true, guardadas: await guardarVistaConNombre(userId, nombre, config) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo guardar la vista") };
  }
}

export async function borrarVistaAction(
  vistaId: string,
): Promise<{ ok: true; guardadas: VistaGuardada[] } | { ok: false; error: string }> {
  const { userId } = await sesion();
  try {
    return { ok: true, guardadas: await borrarVistaGuardada(userId, vistaId) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo borrar la vista") };
  }
}

/**
 * Cambiar el estado desde la tabla o el kanban. Las reglas son las del servidor (puedeCambiarEstado);
 * si no lo deja, vuelve el motivo para mostrarlo. El HECHO a mano de una tarjeta con repo NO va por
 * acá: tiene su botón con nota en la tarjeta (marcarHechoAManoAction).
 */
export async function cambiarEstadoDesdeVistaAction(
  tarjetaId: string,
  estado: string,
  estadoVisto: string,
): Promise<{ ok: true; ahora: string; aprobadaSola: boolean } | { ok: false; error: string }> {
  const { contexto } = await sesion();
  if (!esEstado(estado)) return { ok: false, error: "Ese estado no existe." };
  if (estado === "HECHO" && esEstado(estadoVisto) && sePuedeMarcarHechoAMano(estadoVisto)) {
    return { ok: false, error: 'Para marcarla hecha usa el botón "Marcar hecho a mano" de la tarjeta (pide una nota).' };
  }
  try {
    const resultado = await cambiarEstadoTarjeta(contexto, tarjetaId, estado);
    return { ok: true, ahora: resultado.ahora, aprobadaSola: resultado.ahora !== estado };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo cambiar el estado") };
  }
}

/** Editar el área o la fecha ("AAAA-MM-DD", o "" para quitarla) desde la celda. */
export async function editarCeldaAction(
  tarjetaId: string,
  cambios: { area?: string | null; fecha?: string | null },
): Promise<Resultado> {
  const { contexto } = await sesion();
  const permitidos: { area?: string | null; fecha?: string | null } = {};
  if (cambios && "area" in cambios) permitidos.area = typeof cambios.area === "string" ? cambios.area : "";
  if (cambios && "fecha" in cambios) permitidos.fecha = typeof cambios.fecha === "string" ? cambios.fecha : "";
  if (!("area" in permitidos) && !("fecha" in permitidos)) return { ok: false, error: "No hay nada para cambiar." };
  try {
    await editarTarjeta(contexto, tarjetaId, permitidos);
    return { ok: true };
  } catch (fallo) {
    const texto = mensaje(fallo, "No se pudo guardar el cambio");
    return texto === SIN_CAMBIOS ? { ok: true } : { ok: false, error: texto };
  }
}
