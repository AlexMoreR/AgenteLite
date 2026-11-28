"use server";

/*
  Bases de datos del Espacio (28-nov-2026): lo que hace la tabla de la pantalla. El permiso es el del
  espacio (quien lo ve, la edita); el servidor vuelve a revisar todo en services/bases-de-datos.ts.
  Las acciones de columnas devuelven todas las columnas como quedaron, para que la tabla no se desfase.
*/

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  agregarColumnaABase,
  agregarFilas,
  borrarFilas,
  cambiarTipoDeColumnaDeBase,
  crearBaseDeDatos,
  duplicarColumnaDeBase,
  duplicarFilas,
  editarFila,
  leerBaseDeDatos,
  moverFila,
  quitarColumnaDeBase,
  renombrarColumnaDeBase,
  type BaseDeDatosVista,
} from "@/features/tableros-inteligentes/services/bases-de-datos";
import { nombreLibre, type ColumnaDeBase } from "@/features/tableros-inteligentes/services/reglas-base-de-datos";
import { alcanceDe, editarTarjeta, type ContextoTablero } from "@/features/tableros-inteligentes/services/tableros";

type Fallo = { ok: false; error: string };
type ConColumnas = { ok: true; columnas: ColumnaDeBase[] } | Fallo;
const mensaje = (fallo: unknown, porDefecto: string): Fallo => ({
  ok: false,
  error: fallo instanceof Error ? fallo.message : porDefecto,
});

async function contextoDePantalla(): Promise<ContextoTablero> {
  const access = await requireClientWorkspaceAccess("tableros_inteligentes");
  return { ...alcanceDe(access), userId: access.userId, origen: "PANTALLA" };
}

export async function crearBaseDeDatosAction(datos: {
  tableroId: string;
  titulo: string;
  padreId: string | null;
}): Promise<{ ok: true; id: string } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    const { tarjetaId } = await crearBaseDeDatos(contexto, datos);
    return { ok: true, id: tarjetaId };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo crear la base de datos");
  }
}

export async function leerBaseDeDatosAction(tarjetaId: string): Promise<{ ok: true; base: BaseDeDatosVista } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    return { ok: true, base: await leerBaseDeDatos(contexto, tarjetaId) };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo abrir la base de datos");
  }
}

/** El nombre de la base de datos es el título de su tarjeta (queda en el historial como cualquier cambio). */
export async function renombrarBaseDeDatosAction(tarjetaId: string, titulo: string): Promise<{ ok: true } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    await editarTarjeta(contexto, tarjetaId, { titulo });
    return { ok: true };
  } catch (fallo) {
    const error = mensaje(fallo, "No se pudo cambiar el nombre");
    return error.error === "No hay nada distinto para cambiar." ? { ok: true } : error;
  }
}

/** Una columna nueva de texto con un nombre libre («Columna 3»), en `posicion` (sin ella, al final). */
export async function agregarColumnaAction(tarjetaId: string, posicion?: number): Promise<ConColumnas> {
  const contexto = await contextoDePantalla();
  try {
    const actual = await leerBaseDeDatos(contexto, tarjetaId, { limite: 1 });
    const { columnas } = await agregarColumnaABase(contexto, tarjetaId, nombreLibre(actual.columnas), { posicion });
    return { ok: true, columnas };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo agregar la columna");
  }
}

export async function duplicarColumnaAction(tarjetaId: string, columnaId: string): Promise<ConColumnas> {
  const contexto = await contextoDePantalla();
  try {
    return { ok: true, columnas: (await duplicarColumnaDeBase(contexto, tarjetaId, columnaId)).columnas };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo duplicar la columna");
  }
}

export async function cambiarTipoDeColumnaAction(tarjetaId: string, columnaId: string, tipo: string): Promise<ConColumnas> {
  const contexto = await contextoDePantalla();
  try {
    return { ok: true, columnas: await cambiarTipoDeColumnaDeBase(contexto, tarjetaId, columnaId, tipo) };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo cambiar el tipo de la columna");
  }
}

export async function renombrarColumnaAction(tarjetaId: string, columnaId: string, nombre: string): Promise<{ ok: true } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    await renombrarColumnaDeBase(contexto, tarjetaId, columnaId, nombre);
    return { ok: true };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo cambiar el nombre de la columna");
  }
}

export async function quitarColumnaAction(tarjetaId: string, columnaId: string): Promise<{ ok: true } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    await quitarColumnaDeBase(contexto, tarjetaId, columnaId);
    return { ok: true };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo quitar la columna");
  }
}

type ConBase = { ok: true; base: BaseDeDatosVista } | Fallo;

/** Después de un cambio de orden se devuelve la tabla entera: los # de todas las filas pudieron cambiar. */
async function conLaBase(contexto: ContextoTablero, tarjetaId: string, cambio: () => Promise<unknown>, porDefecto: string): Promise<ConBase> {
  try {
    await cambio();
    return { ok: true, base: await leerBaseDeDatos(contexto, tarjetaId) };
  } catch (fallo) {
    return mensaje(fallo, porDefecto);
  }
}

/** Una fila vacía al final, o justo debajo de `despuesDe` (el + de cada fila). */
export async function agregarFilaAction(tarjetaId: string, despuesDe?: string | null): Promise<ConBase> {
  const contexto = await contextoDePantalla();
  return conLaBase(contexto, tarjetaId, () => agregarFilas(contexto, tarjetaId, [{}], { despuesDe }), "No se pudo agregar la fila");
}

export async function borrarFilasAction(tarjetaId: string, filaIds: string[]): Promise<ConBase> {
  const contexto = await contextoDePantalla();
  return conLaBase(contexto, tarjetaId, () => borrarFilas(contexto, tarjetaId, filaIds), "No se pudieron borrar las filas");
}

export async function duplicarFilasAction(tarjetaId: string, filaIds: string[]): Promise<ConBase> {
  const contexto = await contextoDePantalla();
  return conLaBase(contexto, tarjetaId, () => duplicarFilas(contexto, tarjetaId, filaIds), "No se pudieron duplicar las filas");
}

export async function moverFilaAction(tarjetaId: string, filaId: string, destinoId: string, lado: "antes" | "despues"): Promise<ConBase> {
  const contexto = await contextoDePantalla();
  return conLaBase(contexto, tarjetaId, () => moverFila(contexto, tarjetaId, filaId, destinoId, lado), "No se pudo mover la fila");
}

/** Guarda una celda. Devuelve el texto como quedó (un número o una fecha se normalizan) y, si una lista sumó una opción, las columnas. */
export async function editarCeldaDeBaseAction(
  tarjetaId: string,
  filaId: string,
  columnaId: string,
  texto: string,
): Promise<{ ok: true; texto: string; columnas?: ColumnaDeBase[] } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    const fila = await editarFila(contexto, tarjetaId, { id: filaId }, { [columnaId]: texto });
    return { ok: true, texto: fila.valores[columnaId] ?? "", ...(fila.columnas ? { columnas: fila.columnas } : {}) };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo guardar la celda");
  }
}
