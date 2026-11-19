"use server";

import { revalidatePath } from "next/cache";

import {
  calcularCambioDeAsignacion,
  escribirCambioDeAsignacion,
  leerAsignacionDelNegocio,
  type DatosDeAsignacion,
} from "@/lib/asignacion-del-negocio";
import { validarInterruptores } from "@/lib/asignacion-pantalla";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import type { ConfigDeAsignacion } from "@/lib/reparto-cuando-lo-necesita";

/*
  MI EMPRESA > EQUIPO > ASIGNACIÓN (T-772, parte 3). Cuándo se le asigna un chat a una asesora (los
  interruptores de reparto-cuando-lo-necesita.ts), quién está en el reparto de cada línea de ventas
  (`pausedAssignmentIds`, la misma lista de Conexión) y los minutos de la regla de demora (la misma
  fila que lee la regla, con su historial). Solo el dueño o un administrador, con el mismo candado que
  Reparto por anuncio. Esta pantalla NO prende ni apaga la regla de demora: eso sigue en Equipo.

  Leer y guardar viven en src/lib/asignacion-del-negocio.ts, que también usa el MCP (parte 4).
*/

export type { AsesoraDeLaLinea, DatosDeAsignacion, LineaDeVentas } from "@/lib/asignacion-del-negocio";

export type PedidoDeAsignacion = {
  interruptores: ConfigDeAsignacion;
  /** Por línea, las asesoras que quedan FUERA del reparto. */
  lineas: Array<{ id: string; fuera: string[] }>;
  minutosAviso: number | string;
  minutosReasignar: number | string;
};

export async function leerAsignacion(): Promise<DatosDeAsignacion> {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });
  return leerAsignacionDelNegocio(access.workspaceId);
}

export async function guardarAsignacion(datos: PedidoDeAsignacion): Promise<{ ok: true } | { error: string }> {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });

  // Primero se valida todo; recién después se escribe, para no dejar la mitad guardada.
  const interruptores = validarInterruptores(datos?.interruptores);
  if ("error" in interruptores) {
    return { error: interruptores.error };
  }

  // Solo líneas de ventas de este negocio; lo demás que llegue se ignora.
  const calculado = await calcularCambioDeAsignacion(access.workspaceId, {
    interruptores: interruptores.config,
    lineas: Array.isArray(datos?.lineas) ? datos.lineas : [],
    minutosAviso: datos?.minutosAviso,
    minutosReasignar: datos?.minutosReasignar,
  });
  if ("error" in calculado) {
    return { error: calculado.error };
  }

  const quien = await prisma.user.findUnique({ where: { id: access.userId }, select: { name: true, email: true } });
  await escribirCambioDeAsignacion(access.workspaceId, calculado.cambio, {
    id: access.userId,
    nombre: quien?.name?.trim() || quien?.email || "Sin nombre",
  });

  revalidatePath("/cliente/equipo/asignacion");
  revalidatePath("/cliente/equipo");
  for (const canal of calculado.cambio.canales) {
    revalidatePath(`/cliente/conexion/whatsapp-business/${canal.id}`);
  }
  return { ok: true };
}
