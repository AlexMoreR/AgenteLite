"use server";

import { revalidatePath } from "next/cache";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { desconectar, driveDelNegocio, elegirCarpeta } from "@/features/cerebro/services/conexion";
import { buscarEnElCerebro, leerDocumentoDelCerebro, type DocumentoLeido } from "@/features/cerebro/services/consultas";
import { guardarAutorizadosDelCerebro, permisosDelCerebro } from "@/features/cerebro/services/permisos";
import {
  pasarAlCerebro,
  prepararPasoAlCerebro,
  type PedidoDelPaso,
  type PreparacionDelPaso,
} from "@/features/cerebro/services/pasar";
import { sincronizarElCerebro } from "@/features/cerebro/services/sincronizar-negocio";
import type { ResultadoDeSincronizacion } from "@/features/cerebro/services/sincronizar";
import type { PedazoDelCerebro } from "@/features/cerebro/services/reglas";

/*
  CEREBRO: lo que hace la PANTALLA. Cada acción comprueba el permiso en el servidor (un botón oculto no es
  un permiso): ver y buscar, el dueño o quien él autorizó; conectar, elegir carpeta, desconectar y autorizar,
  solo el dueño.
*/

type Fallo = { ok: false; error: string };
const mensaje = (fallo: unknown, porDefecto: string) => (fallo instanceof Error ? fallo.message : porDefecto);

async function conPermiso(nivel: "ver" | "administrar") {
  const access = await requireClientWorkspaceAccess();
  const permisos = await permisosDelCerebro(access);
  if (nivel === "administrar" ? !permisos.administrar : !permisos.ver) {
    throw new Error(nivel === "administrar" ? "Solo el dueño puede hacer esto." : "No tienes acceso al cerebro.");
  }
  return access;
}

export async function listarCarpetasDeGoogleAction(
  texto?: string,
): Promise<{ ok: true; carpetas: Array<{ id: string; nombre: string }> } | Fallo> {
  try {
    const access = await conPermiso("administrar");
    const { drive } = await driveDelNegocio(access.workspaceId);
    const carpetas = await drive.listarCarpetas(texto);
    return { ok: true, carpetas: carpetas.map((carpeta) => ({ id: carpeta.driveId, nombre: carpeta.nombre })).slice(0, 100) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudieron leer las carpetas de Drive") };
  }
}

export async function elegirCarpetaAction(carpetaId: string, nombre: string): Promise<{ ok: true; resultado: ResultadoDeSincronizacion } | Fallo> {
  try {
    const access = await conPermiso("administrar");
    const { drive } = await driveDelNegocio(access.workspaceId);
    // Se comprueba que la carpeta existe de verdad antes de guardarla.
    const carpeta = await drive.metadatos(carpetaId);
    await elegirCarpeta(access.workspaceId, carpeta.driveId, carpeta.nombre || nombre);
    const resultado = await sincronizarElCerebro(access.workspaceId);
    revalidatePath("/cliente/negocio/cerebro");
    return { ok: true, resultado };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo elegir la carpeta") };
  }
}

export async function sincronizarAhoraAction(): Promise<{ ok: true; resultado: ResultadoDeSincronizacion } | Fallo> {
  try {
    const access = await conPermiso("ver");
    const resultado = await sincronizarElCerebro(access.workspaceId);
    revalidatePath("/cliente/negocio/cerebro");
    return resultado.ok ? { ok: true, resultado } : { ok: false, error: resultado.error ?? "No se pudo sincronizar" };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo sincronizar") };
  }
}

export async function desconectarCerebroAction(): Promise<{ ok: true } | Fallo> {
  try {
    const access = await conPermiso("administrar");
    await desconectar(access.workspaceId);
    revalidatePath("/cliente/negocio/cerebro");
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo desconectar") };
  }
}

export async function guardarAutorizadosAction(userIds: string[]): Promise<{ ok: true } | Fallo> {
  try {
    const access = await conPermiso("administrar");
    await guardarAutorizadosDelCerebro(access.workspaceId, userIds);
    revalidatePath("/cliente/negocio/cerebro");
    return { ok: true };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo guardar") };
  }
}

export async function leerDocumentoAction(driveId: string): Promise<{ ok: true; documento: DocumentoLeido } | Fallo> {
  try {
    const access = await conPermiso("ver");
    return { ok: true, documento: await leerDocumentoDelCerebro(access.workspaceId, driveId, true) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo abrir el documento") };
  }
}

export async function buscarEnElCerebroAction(texto: string): Promise<{ ok: true; resultados: PedazoDelCerebro[] } | Fallo> {
  try {
    const access = await conPermiso("ver");
    return { ok: true, resultados: await buscarEnElCerebro(access.workspaceId, texto, 20) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo buscar") };
  }
}

/* ── Pasar al cerebro (desde la ficha de una tarjeta) ── */

export async function prepararPasoAlCerebroAction(tarjetaId: string): Promise<{ ok: true; datos: PreparacionDelPaso } | Fallo> {
  try {
    const access = await requireClientWorkspaceAccess("tableros_inteligentes");
    return { ok: true, datos: await prepararPasoAlCerebro(access, tarjetaId) };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo preparar el paso al cerebro") };
  }
}

export async function pasarAlCerebroAction(pedido: PedidoDelPaso): Promise<{ ok: true; documento: string } | Fallo> {
  try {
    const access = await requireClientWorkspaceAccess("tableros_inteligentes");
    const resultado = await pasarAlCerebro(access, pedido);
    return { ok: true, documento: resultado.ruta };
  } catch (fallo) {
    return { ok: false, error: mensaje(fallo, "No se pudo pasar al cerebro") };
  }
}

/** La gente del negocio para elegir a quién autorizar (solo el dueño). */
export async function miembrosParaAutorizar() {
  const access = await conPermiso("administrar");
  const miembros = await prisma.workspaceMember.findMany({
    where: { workspaceId: access.workspaceId, isActive: true, userId: { not: access.userId } },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });
  return miembros.map((miembro) => ({ userId: miembro.userId, nombre: miembro.user?.name?.trim() || miembro.user?.email || "Sin nombre" }));
}
