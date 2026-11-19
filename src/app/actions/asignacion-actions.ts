"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { asesorasDelReparto, pausadosNuevos, validarInterruptores } from "@/lib/asignacion-pantalla";
import { leerPausadosDeReparto } from "@/lib/channel-collaborators";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import {
  agregarAlHistorial,
  claveConfigDemora,
  claveHistorialDemora,
  estadoDelBotonDeTexto,
  leerHistorialDemoraDeTexto,
  textoDeConfigNueva,
  validarPedidoDeDemora,
} from "@/lib/demora-de-asesora-ajuste";
import { prisma } from "@/lib/prisma";
import {
  claveConfigDeAsignacion,
  guardarConfigDeAsignacion,
  leerConfigDeAsignacionDeTexto,
  type ConfigDeAsignacion,
} from "@/lib/reparto-cuando-lo-necesita";

/*
  MI EMPRESA > EQUIPO > ASIGNACIÓN (T-772, parte 3). Cuándo se le asigna un chat a una asesora (los
  interruptores de reparto-cuando-lo-necesita.ts), quién está en el reparto de cada línea de ventas
  (`pausedAssignmentIds`, la misma lista de Conexión) y los minutos de la regla de demora (la misma
  fila que lee la regla, con su historial). Solo el dueño o un administrador, con el mismo candado que
  Reparto por anuncio. Esta pantalla NO prende ni apaga la regla de demora: eso sigue en Equipo.
*/

export type AsesoraDeLaLinea = { id: string; nombre: string; enElReparto: boolean };

export type LineaDeVentas = {
  id: string;
  nombre: string;
  /** Sin colaboradoras: la ve todo el equipo y su reparto se arma en Conexión. */
  abierta: boolean;
  asesoras: AsesoraDeLaLinea[];
};

export type DatosDeAsignacion = {
  interruptores: ConfigDeAsignacion;
  lineas: LineaDeVentas[];
  minutosAviso: number;
  minutosReasignar: number;
  /** Solo para mostrarlo: esta pantalla no la prende ni la apaga. */
  demoraPrendida: boolean;
};

export type PedidoDeAsignacion = {
  interruptores: ConfigDeAsignacion;
  /** Por línea, las asesoras que quedan FUERA del reparto. */
  lineas: Array<{ id: string; fuera: string[] }>;
  minutosAviso: number | string;
  minutosReasignar: number | string;
};

const lineasDeVentas = (workspaceId: string) =>
  prisma.whatsAppChannel.findMany({
    where: { workspaceId, NOT: { purpose: "ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, metadata: true },
  });

const miembrosActivos = (workspaceId: string) =>
  prisma.workspaceMember.findMany({
    where: { workspaceId, isActive: true },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });

export async function leerAsignacion(): Promise<DatosDeAsignacion> {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });

  // La fila se lee directo (sin la memoria de un minuto) para que la pantalla muestre lo último guardado.
  const [filaConfig, filaDemora, canales, miembros] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: claveConfigDeAsignacion(access.workspaceId) }, select: { value: true } }),
    prisma.appSetting.findUnique({ where: { key: claveConfigDemora(access.workspaceId) }, select: { value: true } }),
    lineasDeVentas(access.workspaceId),
    miembrosActivos(access.workspaceId),
  ]);

  const nombres = new Map(
    miembros.map((miembro) => [miembro.userId, miembro.user.name?.trim() || miembro.user.email || "Sin nombre"]),
  );
  const activos = new Set(nombres.keys());
  const demora = estadoDelBotonDeTexto(filaDemora?.value);

  return {
    interruptores: leerConfigDeAsignacionDeTexto(filaConfig?.value),
    lineas: canales.map((canal) => {
      const pausados = new Set(leerPausadosDeReparto(canal.metadata));
      const asesoras = asesorasDelReparto(canal.metadata, activos);
      return {
        id: canal.id,
        nombre: canal.name,
        abierta: asesoras.length === 0,
        asesoras: asesoras.map((id) => ({ id, nombre: nombres.get(id) ?? "Sin nombre", enElReparto: !pausados.has(id) })),
      };
    }),
    minutosAviso: demora.minutosAviso,
    minutosReasignar: demora.minutosReasignar,
    demoraPrendida: demora.activo,
  };
}

export async function guardarAsignacion(datos: PedidoDeAsignacion): Promise<{ ok: true } | { error: string }> {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });

  // Primero se valida todo; recién después se escribe, para no dejar la mitad guardada.
  const interruptores = validarInterruptores(datos?.interruptores);
  if ("error" in interruptores) {
    return { error: interruptores.error };
  }

  const claveDemora = claveConfigDemora(access.workspaceId);
  const claveHistorial = claveHistorialDemora(access.workspaceId);
  const [filaDemora, filaHistorial, canales, miembros, quien] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: claveDemora }, select: { value: true } }),
    prisma.appSetting.findUnique({ where: { key: claveHistorial }, select: { value: true } }),
    lineasDeVentas(access.workspaceId),
    miembrosActivos(access.workspaceId),
    prisma.user.findUnique({ where: { id: access.userId }, select: { name: true, email: true } }),
  ]);

  // Prendida o apagada queda como está: aquí solo se cambian los minutos.
  const demoraAntes = estadoDelBotonDeTexto(filaDemora?.value);
  const demora = validarPedidoDeDemora({
    activo: demoraAntes.activo,
    minutosAviso: datos?.minutosAviso,
    minutosReasignar: datos?.minutosReasignar,
  });
  if ("error" in demora) {
    return { error: demora.error };
  }

  // Solo líneas de ventas de este negocio; lo demás que llegue se ignora.
  const activos = new Set(miembros.map((miembro) => miembro.userId));
  const pedidas = new Map(
    (Array.isArray(datos?.lineas) ? datos.lineas : [])
      .filter((linea) => linea && typeof linea.id === "string")
      .map((linea) => [linea.id, Array.isArray(linea.fuera) ? linea.fuera : []]),
  );
  const cambios: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  for (const canal of canales) {
    const fuera = pedidas.get(canal.id);
    if (!fuera) continue;
    const pausados = pausadosNuevos(canal.metadata, activos, fuera);
    if (!pausados) continue;
    const base =
      canal.metadata && typeof canal.metadata === "object" && !Array.isArray(canal.metadata)
        ? (canal.metadata as Record<string, unknown>)
        : {};
    // Solo cambia la pausa: las colaboradoras (quién trabaja la línea) y las monitoras quedan igual.
    cambios.push({ id: canal.id, metadata: { ...base, pausedAssignmentIds: pausados } });
  }

  await guardarConfigDeAsignacion(access.workspaceId, interruptores.config);

  for (const cambio of cambios) {
    await prisma.whatsAppChannel.update({
      where: { id: cambio.id },
      data: { metadata: cambio.metadata as Prisma.InputJsonValue },
    });
  }

  // Los minutos, solo si cambiaron, con su historial (primero el historial, como en Equipo).
  if (
    demora.estado.minutosAviso !== demoraAntes.minutosAviso ||
    demora.estado.minutosReasignar !== demoraAntes.minutosReasignar
  ) {
    const historial = agregarAlHistorial(leerHistorialDemoraDeTexto(filaHistorial?.value), {
      en: new Date().toISOString(),
      quienId: access.userId,
      quienNombre: quien?.name?.trim() || quien?.email || "Sin nombre",
      antes: demoraAntes,
      despues: demora.estado,
    });
    const configNueva = textoDeConfigNueva(filaDemora?.value, demora.estado);
    await prisma.appSetting.upsert({
      where: { key: claveHistorial },
      create: { key: claveHistorial, value: JSON.stringify(historial) },
      update: { value: JSON.stringify(historial) },
    });
    await prisma.appSetting.upsert({
      where: { key: claveDemora },
      create: { key: claveDemora, value: configNueva },
      update: { value: configNueva },
    });
  }

  revalidatePath("/cliente/equipo/asignacion");
  revalidatePath("/cliente/equipo");
  for (const cambio of cambios) {
    revalidatePath(`/cliente/conexion/whatsapp-business/${cambio.id}`);
  }
  return { ok: true };
}
