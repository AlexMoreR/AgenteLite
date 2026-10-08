"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { leerColaboradores, leerMonitores, leerPausadosDeReparto } from "@/lib/channel-collaborators";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { sanitizeClientModuleAccess } from "@/lib/client-workspace-modules";
import { guardarAsesoraDeRespaldo } from "@/lib/en-linea";
import { guardarHorarioDeReparto, normalizarHorario } from "@/lib/horario-de-reparto";
import { guardarSupervisoras, leerSupervisoras } from "@/lib/permisos-del-equipo";
import { prisma } from "@/lib/prisma";
import {
  guardarConfigDeAvisos,
  leerConfigDeAvisos,
  normalizarNumeroDeAviso,
} from "@/features/agente-v3/servicios/avisos";

export type EstadoEnLaLinea = "no" | "recibe" | "pausa" | "monitorea";

/**
 * La asesora de respaldo: a quién le llega el cliente nuevo cuando nadie está "Recibiendo
 * clientes" (Alex, 08-10-2026: "A Ingrid, con aviso"). Vacío = nadie: el cliente queda sin dueña,
 * como antes. Solo el dueño o un administrador.
 */
export async function guardarAsesoraDeRespaldoAction(formData: FormData): Promise<void> {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });
  const pedido = String(formData.get("respaldo") ?? "").trim();
  if (pedido) {
    const miembro = await prisma.workspaceMember.findFirst({
      where: { workspaceId: access.workspaceId, userId: pedido, isActive: true },
      select: { userId: true },
    });
    if (!miembro) {
      return;
    }
  }
  await guardarAsesoraDeRespaldo(access.workspaceId, pedido || null);
  revalidatePath("/cliente/equipo/actividad");
}

/**
 * Guarda TODO lo de una persona del equipo en un solo paso: su rol, que pantallas ve y que hace en
 * cada linea de WhatsApp (Alex, 15-sep-2026: "en editar deberiamos tener lo mismo que esta en
 * conexion, el rol, que vistas va a haber").
 *
 * Solo el dueño (o un administrador de la plataforma), igual que el resto de Equipo.
 */
export async function guardarPersonaDelEquipoAction(input: {
  memberId: string;
  rol: "asesora" | "supervisora";
  modulos: string[];
  lineas: Array<{ channelId: string; estado: EstadoEnLaLinea }>;
  /** Días y horas en que le caen leads automáticos. Sin esto, no se toca lo guardado. */
  horario?: unknown;
  /**
   * WhatsApp donde le llegan los avisos ("necesita atención"). Vacío = no recibe avisos. Sin el
   * campo, no se toca lo guardado.
   */
  whatsappDeAvisos?: string;
}): Promise<{ ok: true } | { error: string }> {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });

  const miembro = await prisma.workspaceMember.findFirst({
    where: { id: typeof input.memberId === "string" ? input.memberId : "", workspaceId: access.workspaceId },
    select: { id: true, userId: true, role: true, user: { select: { role: true, name: true, email: true } } },
  });
  if (!miembro) {
    return { error: "Esa persona no es del equipo" };
  }

  // El numero se valida antes de escribir nada, como el resto.
  const textoDelNumero = typeof input.whatsappDeAvisos === "string" ? input.whatsappDeAvisos.trim() : null;
  const numeroDeAvisos = textoDelNumero ? normalizarNumeroDeAviso(textoDelNumero) : null;
  if (textoDelNumero && !numeroDeAvisos) {
    return { error: "El WhatsApp para avisos no parece un número. Escríbelo con el código del país, por ejemplo +57 300 123 4567." };
  }
  // A un administrador no se le recortan pantallas ni se le pone rol: ya tiene todo. Solo sus lineas.
  const esEmpleada = miembro.role === "AGENT" && miembro.user.role === "EMPLEADO";

  const canales = await prisma.whatsAppChannel.findMany({
    where: { workspaceId: access.workspaceId },
    select: { id: true, name: true, metadata: true },
  });

  // Primero se valida todo; recien despues se escribe, para no dejar la mitad guardada.
  const cambios: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  for (const linea of Array.isArray(input.lineas) ? input.lineas : []) {
    const canal = canales.find((fila) => fila.id === linea.channelId);
    if (!canal || !["no", "recibe", "pausa", "monitorea"].includes(linea.estado)) {
      continue;
    }
    const colaboradores = leerColaboradores(canal.metadata);
    /*
      Una linea sin colaboradores la ve TODO el equipo. Agregar a una sola persona la cerraria para
      las demas sin que nadie lo note, asi que esas lineas se reparten desde Conexion, a proposito.
    */
    if (colaboradores.length === 0) {
      continue;
    }
    const pausados = new Set(leerPausadosDeReparto(canal.metadata));
    const monitores = new Set(leerMonitores(canal.metadata));
    const estaba = colaboradores.includes(miembro.userId);

    let siguientes = colaboradores;
    if (linea.estado === "no") {
      if (!estaba) continue;
      siguientes = colaboradores.filter((id) => id !== miembro.userId);
      if (siguientes.length === 0) {
        return {
          error: `No se puede sacar a la última persona de ${canal.name}: la línea quedaría abierta a todo el equipo.`,
        };
      }
      pausados.delete(miembro.userId);
      monitores.delete(miembro.userId);
    } else {
      if (!estaba) siguientes = [...colaboradores, miembro.userId];
      // Mismas reglas que Conexion: quien solo monitorea queda ademas en pausa (no puede contestar).
      if (linea.estado === "monitorea") {
        monitores.add(miembro.userId);
        pausados.add(miembro.userId);
      } else if (linea.estado === "pausa") {
        monitores.delete(miembro.userId);
        pausados.add(miembro.userId);
      } else {
        monitores.delete(miembro.userId);
        pausados.delete(miembro.userId);
      }
    }

    const base =
      canal.metadata && typeof canal.metadata === "object" && !Array.isArray(canal.metadata)
        ? (canal.metadata as Record<string, unknown>)
        : {};
    cambios.push({
      id: canal.id,
      metadata: {
        ...base,
        collaboratorIds: siguientes,
        pausedAssignmentIds: siguientes.filter((id) => pausados.has(id)),
        monitorIds: siguientes.filter((id) => monitores.has(id)),
      },
    });
  }

  for (const cambio of cambios) {
    await prisma.whatsAppChannel.update({
      where: { id: cambio.id },
      data: { metadata: cambio.metadata as Prisma.InputJsonValue },
    });
  }

  if (esEmpleada) {
    await prisma.workspaceMember.update({
      where: { id: miembro.id },
      data: { moduleAccess: sanitizeClientModuleAccess(input.modulos) },
    });
  }

  const supervisoras = await leerSupervisoras(access.workspaceId);
  const conEsta = esEmpleada && input.rol === "supervisora";
  if (conEsta !== supervisoras.includes(miembro.userId)) {
    await guardarSupervisoras(
      access.workspaceId,
      conEsta ? [...supervisoras, miembro.userId] : supervisoras.filter((id) => id !== miembro.userId),
    );
  }

  if (input.horario !== undefined) {
    await guardarHorarioDeReparto(access.workspaceId, miembro.userId, normalizarHorario(input.horario));
  }

  /*
    El WhatsApp de avisos de esta persona (Alex, 05-10-2026: "en Equipo, en las asesoras, el numero
    de WhatsApp para notificar"). Vive en la misma lista que usan los avisos del agente: una asesora
    recibe solo los chats que tiene asignados; un administrador, todos.
  */
  if (textoDelNumero !== null) {
    const actual = await leerConfigDeAvisos(access.workspaceId);
    const sinEsta = (actual?.destinos ?? []).filter(
      (destino) => destino.userId !== miembro.userId && destino.soloDe !== miembro.userId,
    );
    const destinos = numeroDeAvisos
      ? [
          ...sinEsta,
          {
            numero: numeroDeAvisos,
            nombre: miembro.user.name?.trim() || miembro.user.email || undefined,
            soloDe: miembro.role === "ADMIN" ? null : miembro.userId,
            userId: miembro.userId,
          },
        ]
      : sinEsta;
    await guardarConfigDeAvisos(access.workspaceId, {
      // La linea de la config queda solo de respaldo: el aviso sale por la del chat.
      canalId: actual?.canalId ?? canales[0]?.id ?? "",
      activo: actual?.activo ?? true,
      destinos,
    });
  }

  revalidatePath("/cliente/equipo");
  for (const cambio of cambios) {
    revalidatePath(`/cliente/conexion/whatsapp-business/${cambio.id}`);
  }
  return { ok: true };
}
