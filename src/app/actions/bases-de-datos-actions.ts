"use server";

/*
  Bases de datos del Espacio (28-nov-2026): lo que hace la tabla de la pantalla. El permiso es el del
  espacio (quien lo ve, la edita); el servidor vuelve a revisar todo en services/bases-de-datos.ts.
*/

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  agregarColumnaABase,
  agregarFilas,
  borrarFila,
  crearBaseDeDatos,
  editarFila,
  leerBaseDeDatos,
  quitarColumnaDeBase,
  renombrarColumnaDeBase,
  type BaseDeDatosVista,
  type FilaDeBaseVista,
} from "@/features/tableros-inteligentes/services/bases-de-datos";
import type { ColumnaDeBase } from "@/features/tableros-inteligentes/services/reglas-base-de-datos";
import { alcanceDe, editarTarjeta, type ContextoTablero } from "@/features/tableros-inteligentes/services/tableros";

type Fallo = { ok: false; error: string };
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

export async function agregarColumnaAction(tarjetaId: string, nombre: string): Promise<{ ok: true; columna: ColumnaDeBase } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    return { ok: true, columna: await agregarColumnaABase(contexto, tarjetaId, nombre) };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo agregar la columna");
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

export async function agregarFilaAction(tarjetaId: string): Promise<{ ok: true; fila: FilaDeBaseVista } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    const [fila] = await agregarFilas(contexto, tarjetaId, [{}]);
    return { ok: true, fila };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo agregar la fila");
  }
}

export async function editarCeldaDeBaseAction(
  tarjetaId: string,
  filaId: string,
  columnaId: string,
  texto: string,
): Promise<{ ok: true } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    await editarFila(contexto, tarjetaId, { id: filaId }, { [columnaId]: texto });
    return { ok: true };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo guardar la celda");
  }
}

export async function borrarFilaAction(tarjetaId: string, filaId: string): Promise<{ ok: true } | Fallo> {
  const contexto = await contextoDePantalla();
  try {
    await borrarFila(contexto, tarjetaId, { id: filaId });
    return { ok: true };
  } catch (fallo) {
    return mensaje(fallo, "No se pudo borrar la fila");
  }
}
