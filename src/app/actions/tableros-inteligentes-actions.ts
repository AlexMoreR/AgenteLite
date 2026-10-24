"use server";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { personaPuedeAprobar } from "@/features/tableros-inteligentes/services/reglas";
import {
  alcanceDe,
  aprobarTarjeta,
  cambiarZonasEnPantalla,
  borrarTipo,
  crearTablero,
  crearTipo,
  editarTarjeta,
  editarTipo,
  historialDeTarjeta,
  marcarHechoAMano,
  personaQueAprueba,
  renombrarTablero,
  type ContextoTablero,
} from "@/features/tableros-inteligentes/services/tableros";
import {
  agregarAprobador,
  crearClaveTrabajador,
  listarAprobadores,
  listarClavesTrabajador,
  quitarAprobador,
  revocarClaveTrabajador,
} from "@/features/tableros-inteligentes/services/trabajador";
import {
  aprobacionAutomaticaPrendida,
  ponerAprobacionAutomatica,
} from "@/features/tableros-inteligentes/services/aprobacion-automatica";
import { resumenDeHoyParaLaPantalla } from "@/features/tableros-inteligentes/services/resumen-diario";
import type { MomentoDeAprobacion } from "@/features/tableros-inteligentes/services/reglas-trabajador";

/*
  Tablero IA (tableros inteligentes): lo que hace la PANTALLA.

  La pantalla aprueba, lee el historial y administra los TIPOS de tarjeta (panel Tipos); las
  tarjetas las arma Claude por el MCP. Aprobar y tocar los tipos lo puede el dueño del negocio o el
  ADMIN de la plataforma (decisión del dueño, 19-oct-2026), y se comprueba ACÁ además de ocultar
  los botones: un botón oculto no es un permiso.

  Fase 2 (20-oct-2026): aprobar tiene tres momentos (la tarea, el plan y el sí final "subir a
  producción"); quién puede cada uno lo decide el servicio con reglas-trabajador.ts (el dueño todo, un
  aprobador según su alcance, el sí final SOLO el dueño). Quitar una zona protegida es solo del dueño.
  El panel Coordinador (claves y aprobadores): el dueño o el ADMIN de la plataforma (20-oct-2026), como
  los tipos; una asesora o una administradora del negocio, no.

  Tableros POR CUENTA (20-oct-2026): cada persona ve, crea y renombra SUS tableros; el dueño o el
  ADMIN ven todos y eligen de quién es cada uno. Todo lo de acá pasa por el alcance de la sesión
  (alcanceDe), así que un id de un tablero ajeno responde "no existe".
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
  const contexto = await contextoDePantalla();
  try {
    await aprobarTarjeta(contexto, tarjetaId, { momento, via: "pantalla", vistaEn });
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo aprobar") };
  }
}

/**
 * Marcar hecho a mano desde la pantalla (solo el dueño; lo comprueba el servicio): una tarjeta con repo
 * en ERROR, FALLIDO o POR_REVISAR cuyo cambio se terminó por fuera. Pide la nota y, si se quiere, el commit.
 */
export async function marcarHechoAManoAction(
  tarjetaId: string,
  nota: string,
  commit?: string,
  vistaEn?: string,
): Promise<Resultado> {
  const contexto = await contextoDePantalla();
  try {
    await marcarHechoAMano(contexto, tarjetaId, { via: "pantalla", nota, commit, vistaEn });
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo marcar la tarjeta como hecha") };
  }
}

/** Cambiar las zonas protegidas de una tarjeta (quitarlas: solo el dueño; lo comprueba el servicio). */
export async function cambiarZonasAction(tarjetaId: string, zonas: string[]): Promise<Resultado> {
  const contexto = await contextoDePantalla();
  try {
    await cambiarZonasEnPantalla(contexto, tarjetaId, zonas);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo cambiar la zona protegida") };
  }
}

/**
 * La persona de la sesión con su alcance: el dueño o el ADMIN ven todos los tableros; los demás, solo
 * los suyos (tableros por cuenta, 20-oct-2026). Un tablero ajeno responde "no existe".
 */
async function contextoDePantalla(): Promise<ContextoTablero> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  return { ...alcanceDe(access), userId: access.userId, origen: "PANTALLA" };
}

/* ── Tableros: cada uno crea y renombra los suyos; el dueño o el ADMIN, todos, y eligen el dueño ── */

export async function crearTableroAction(
  nombre: string,
  duenoUserId?: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const contexto = await contextoDePantalla();
  try {
    const tablero = await crearTablero(contexto, nombre, duenoUserId);
    return { ok: true, id: tablero.id };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo crear el tablero") };
  }
}

export async function renombrarTableroAction(tableroId: string, nombre: string, duenoUserId?: string): Promise<Resultado> {
  const contexto = await contextoDePantalla();
  try {
    await renombrarTablero(contexto, tableroId, nombre, duenoUserId);
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo cambiar el nombre") };
  }
}

/* ── Panel Coordinador (dueño o ADMIN de la plataforma) ─────────────────────────────────────── */

export type PanelTrabajadorVista = {
  claves: { id: string; nombre: string; creadoEn: string; ultimoUsoEn: string | null; revocadaEn: string | null }[];
  aprobadores: { id: string; userId: string; nombre: string; alcance: string; puedeSubir: boolean }[];
  candidatos: { userId: string; nombre: string }[];
  /** El interruptor "Aprobar solas las tareas de bajo riesgo" (prendido por defecto). */
  aprobacionAutomatica: boolean;
  /** Quien mira es el dueño del negocio: solo él mueve el interruptor. */
  esDueno: boolean;
};

const SOLO_EL_DUENO_TRABAJADOR = "El Coordinador y los aprobadores los maneja solo el dueño del negocio.";

/** El dueño o el ADMIN de la plataforma (personaPuedeAprobar). Una asesora, no. */
async function accesoDelDueno() {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  return personaPuedeAprobar(access) ? access : null;
}

export async function panelTrabajadorAction(): Promise<{ ok: true; panel: PanelTrabajadorVista } | { ok: false; error: string }> {
  const access = await accesoDelDueno();
  if (!access) return { ok: false, error: SOLO_EL_DUENO_TRABAJADOR };
  try {
    const [claves, { aprobadores, candidatos }, aprobacionAutomatica, persona] = await Promise.all([
      listarClavesTrabajador(access.workspaceId),
      listarAprobadores(access.workspaceId),
      aprobacionAutomaticaPrendida(access.workspaceId),
      personaQueAprueba(access.workspaceId, access.userId),
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
        aprobacionAutomatica,
        esDueno: persona.esDueno,
      },
    };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo leer el panel del Coordinador") };
  }
}

/** Crea la clave del Coordinador y la devuelve UNA vez (después solo queda su huella). */
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

/** Prende o apaga la aprobación automática de las tareas de bajo riesgo. Solo el dueño (no basta ser ADMIN de la plataforma). */
export async function cambiarAprobacionAutomaticaAction(prendida: boolean): Promise<Resultado> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  try {
    const persona = await personaQueAprueba(access.workspaceId, access.userId);
    if (!persona.esDueno) return { ok: false, error: "Prender o apagar la aprobación automática es solo del dueño del negocio." };
    await ponerAprobacionAutomatica(access.workspaceId, Boolean(prendida));
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo cambiar la aprobación automática") };
  }
}

export type ResumenDeHoyVista = Awaited<ReturnType<typeof resumenDeHoyParaLaPantalla>>;

/** La caja "Resumen de hoy": el dueño o el ADMIN de la plataforma, como el panel del Coordinador. */
export async function resumenDeHoyAction(): Promise<{ ok: true; resumen: ResumenDeHoyVista } | { ok: false; error: string }> {
  const access = await accesoDelDueno();
  if (!access) return { ok: false, error: "El resumen de hoy lo ve solo el dueño del negocio." };
  try {
    return { ok: true, resumen: await resumenDeHoyParaLaPantalla(access.workspaceId) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo leer el resumen de hoy") };
  }
}

/** Cambiar el riesgo de una tarjeta con repo. Solo el dueño; el servidor rechaza BAJO si las reglas ven riesgo alto. */
export async function cambiarRiesgoAction(tarjetaId: string, riesgo: "BAJO" | "ALTO", motivo?: string): Promise<Resultado> {
  const contexto = await contextoDePantalla();
  try {
    const persona = await personaQueAprueba(contexto.workspaceId, contexto.userId);
    if (!persona.esDueno) return { ok: false, error: "El riesgo de una tarjeta lo cambia solo el dueño del negocio." };
    await editarTarjeta(contexto, tarjetaId, { riesgo, motivoRiesgo: motivo?.trim() || undefined });
    return { ok: true };
  } catch (fallo) {
    const texto = mensaje(fallo, "No se pudo cambiar el riesgo");
    // Dejarlo como estaba no es un error para la pantalla.
    return texto === "No hay nada distinto para cambiar." ? { ok: true } : { ok: false, error: texto };
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
    const { cambios } = await historialDeTarjeta(alcanceDe(access), tarjetaId);
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

async function accesoParaTipos(): Promise<ContextoTablero | null> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  if (!personaPuedeAprobar(access)) return null;
  return { ...alcanceDe(access), userId: access.userId, origen: "PANTALLA" };
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
