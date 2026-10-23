"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { revisarSiTermino } from "@/features/reuniones/servicios/avisos-de-livekit";
import { cerrarSala, leerConfigLivekit } from "@/features/reuniones/servicios/livekit";
import { puedeTerminarLaReunion, puedeVerReuniones } from "@/features/reuniones/servicios/permisos";

async function contexto() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  return puedeVerReuniones(access) ? access : null;
}

/** "Nueva reunión": deja la reunión lista con su link. La sala se abre cuando entra el primero. */
export async function crearReunionAction(titulo?: string): Promise<{ id?: string; codigo?: string; error?: string }> {
  const access = await contexto();
  if (!access) {
    return { error: "No autorizado" };
  }
  const limpio = titulo?.replace(/\s+/g, " ").trim().slice(0, 120);
  const ahora = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date());
  const reunion = await prisma.reunion.create({
    data: {
      workspaceId: access.workspaceId,
      creadaPorId: access.userId,
      titulo: limpio || `Reunión ${ahora}`,
      // 24 caracteres al azar: el link no se puede adivinar.
      codigo: randomBytes(18).toString("base64url"),
      sala: `reunion_${randomBytes(9).toString("hex")}`,
    },
    select: { id: true, codigo: true },
  });
  revalidatePath("/cliente/reuniones");
  return reunion;
}

/**
 * "Terminar reunión" (botón de la sala, que conoce el código del link): cierra la sala para todos.
 * Solo quien la creó, el dueño o un administrador.
 */
export async function terminarReunionAction(codigo: string): Promise<{ ok?: true; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || typeof codigo !== "string" || !codigo) {
    return { error: "No autorizado" };
  }
  const reunion = await prisma.reunion.findUnique({
    where: { codigo },
    select: { id: true, sala: true, estado: true, workspaceId: true, creadaPorId: true },
  });
  if (!reunion || !(await puedeTerminarLaReunion(session.user.id, reunion))) {
    return { error: "No autorizado" };
  }
  if (reunion.estado !== "EN_VIVO" && reunion.estado !== "ESPERANDO") {
    return { ok: true };
  }
  const config = leerConfigLivekit();
  if (!config) {
    return { error: "LiveKit no está configurado." };
  }
  try {
    await cerrarSala(config, reunion.sala);
  } catch (error) {
    console.error("[reuniones] no se pudo cerrar la sala", reunion.sala, error);
    return { error: "No se pudo cerrar la sala. Intenta de nuevo." };
  }
  // El aviso room_finished de LiveKit termina de cerrarla; esto deja la hora por si se pierde.
  await prisma.reunion.updateMany({ where: { id: reunion.id, terminoEn: null }, data: { terminoEn: new Date() } });
  await revisarSiTermino(reunion.id);
  revalidatePath("/cliente/reuniones");
  return { ok: true };
}

/** "Reintentar": una reunión en Error vuelve a la cola con los intentos en cero. */
export async function reintentarReunionAction(reunionId: string): Promise<{ ok?: true; error?: string }> {
  const access = await contexto();
  if (!access) {
    return { error: "No autorizado" };
  }
  const resultado = await prisma.reunion.updateMany({
    where: { id: reunionId, workspaceId: access.workspaceId, estado: "ERROR" },
    data: { estado: "EN_COLA", intentos: 0, motivoError: null, aviso: null },
  });
  if (!resultado.count) {
    return { error: "La reunión no está en Error." };
  }
  revalidatePath("/cliente/reuniones");
  revalidatePath(`/cliente/reuniones/${reunionId}`);
  return { ok: true };
}
