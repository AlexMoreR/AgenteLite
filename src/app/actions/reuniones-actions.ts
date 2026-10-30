"use server";

import { rmdir } from "node:fs/promises";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { revisarSiTermino } from "@/features/reuniones/servicios/avisos-de-livekit";
import { crearReunion } from "@/features/reuniones/servicios/crear-reunion";
import { cerrarSala, leerConfigLivekit } from "@/features/reuniones/servicios/livekit";
import { carpetaDeReuniones, rutaDeArchivo } from "@/features/reuniones/servicios/archivos-de-reuniones";
import { puedeBorrarLaReunionDe, sePuedeBorrarPorEstado } from "@/features/reuniones/servicios/borrar-reunion";
import { esDuenoOAdmin, puedeIniciarLaSala, puedeTerminarLaReunion, puedeVerReuniones } from "@/features/reuniones/servicios/permisos";
import { abrirOCrearReunionDeSala, crearSala, editarSala } from "@/features/reuniones/servicios/salas";

async function contexto() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  return puedeVerReuniones(access) ? access : null;
}

/**
 * "Nueva reunión": deja la reunión lista con su link. La sala se abre cuando entra el primero.
 * Con `sinGrabar` la videollamada funciona igual, pero no se graba, no se transcribe y no hay acta.
 * Solo se elige aquí: después no se puede cambiar, para que no queden reuniones grabadas a medias.
 */
export async function crearReunionAction(titulo?: string, sinGrabar?: boolean): Promise<{ id?: string; codigo?: string; error?: string }> {
  const access = await contexto();
  if (!access) {
    return { error: "No autorizado" };
  }
  const reunion = await crearReunion(prisma, { workspaceId: access.workspaceId, creadaPorId: access.userId, titulo, sinGrabar });
  revalidatePath("/cliente/reuniones");
  return reunion;
}

type DatosDeLaSala = { nombre: string; liderId?: string | null; sinGrabar?: boolean };

/** Lo que llega del navegador se revisa aquí: solo textos y un sí/no. */
function limpiarDatosDeLaSala(datos: DatosDeLaSala | null | undefined) {
  return {
    nombre: typeof datos?.nombre === "string" ? datos.nombre : "",
    liderId: typeof datos?.liderId === "string" && datos.liderId ? datos.liderId : null,
    sinGrabar: datos?.sinGrabar === true,
  };
}

/**
 * «Nueva sala»: una sala fija de un área con su link que no cambia. Solo el dueño o un administrador
 * (lo revisa crearSala con puedeAdministrarSalas), y el líder tiene que ser del equipo.
 */
export async function crearSalaAction(datos: DatosDeLaSala): Promise<{ id?: string; codigo?: string; error?: string }> {
  const access = await contexto();
  if (!access) {
    return { error: "No autorizado" };
  }
  const resultado = await crearSala({ userId: access.userId, workspaceId: access.workspaceId, ...limpiarDatosDeLaSala(datos) });
  if (!resultado.error) {
    revalidatePath("/cliente/reuniones");
  }
  return resultado;
}

/** «Editar» una sala: nombre, líder y si se graba. El link (codigo) no cambia. Mismas reglas que crear. */
export async function editarSalaAction(salaId: string, datos: DatosDeLaSala): Promise<{ ok?: true; error?: string }> {
  const access = await contexto();
  if (!access || typeof salaId !== "string" || !salaId) {
    return { error: "No autorizado" };
  }
  const sala = await prisma.salaDeReuniones.findUnique({ where: { id: salaId }, select: { id: true, workspaceId: true } });
  if (!sala || sala.workspaceId !== access.workspaceId) {
    return { error: "No autorizado" };
  }
  const resultado = await editarSala({ userId: access.userId, salaId: sala.id, ...limpiarDatosDeLaSala(datos) });
  if (!resultado.error) {
    revalidatePath("/cliente/reuniones");
  }
  return resultado;
}

/**
 * «Iniciar reunión» en el link fijo de una sala (/reunion/sala/<codigo>): usa la reunión que esté
 * Esperando o En vivo, o crea una nueva. Devuelve el código para entrar por /reunion/<codigo>.
 */
export async function iniciarReunionDeSalaAction(salaId: string): Promise<{ codigo?: string; error?: string }> {
  const access = await contexto();
  if (!access || typeof salaId !== "string" || !salaId) {
    return { error: "No autorizado" };
  }
  const sala = await prisma.salaDeReuniones.findUnique({ where: { id: salaId }, select: { id: true, workspaceId: true } });
  if (!sala || !puedeIniciarLaSala(access, sala)) {
    return { error: "No autorizado" };
  }
  const reunion = await abrirOCrearReunionDeSala(sala.id, access.userId);
  if (!reunion) {
    return { error: "Esta sala ya no existe." };
  }
  if (reunion.creada) {
    revalidatePath("/cliente/reuniones");
  }
  return { codigo: reunion.codigo };
}

/**
 * "Terminar reunión" (botón de la sala, que conoce el código del link): cierra la sala para todos.
 * Solo quien la creó, el líder de su sala fija, el dueño o un administrador.
 */
export async function terminarReunionAction(codigo: string): Promise<{ ok?: true; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || typeof codigo !== "string" || !codigo) {
    return { error: "No autorizado" };
  }
  const reunion = await prisma.reunion.findUnique({
    where: { codigo },
    select: { id: true, sala: true, estado: true, workspaceId: true, creadaPorId: true, salaFija: { select: { liderId: true } } },
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

/**
 * "Borrar": quita una reunión SIN grabación (Esperando o Error). La regla se revisa aquí, no solo en
 * la pantalla. Solo quien la creó, el dueño o un administrador. Participantes y pistas caen en cascada.
 */
export async function borrarReunionAction(reunionId: string): Promise<{ ok?: true; error?: string }> {
  const access = await contexto();
  if (!access || typeof reunionId !== "string" || !reunionId) {
    return { error: "No autorizado" };
  }
  const reunion = await prisma.reunion.findFirst({
    where: { id: reunionId, workspaceId: access.workspaceId },
    select: { id: true, sala: true, estado: true, creadaPorId: true },
  });
  if (!reunion || !puedeBorrarLaReunionDe({ userId: access.userId, esDuenoOAdmin: esDuenoOAdmin(access) }, reunion)) {
    return { error: "No autorizado" };
  }
  if (!sePuedeBorrarPorEstado(reunion.estado)) {
    return { error: "Solo se borran reuniones sin grabación (Esperando o Error)." };
  }
  // El estado va en el where: si cambió mientras tanto (alguien entró), no se borra.
  const borradas = await prisma.reunion.deleteMany({
    where: { id: reunion.id, workspaceId: access.workspaceId, estado: { in: ["ESPERANDO", "ERROR"] } },
  });
  if (!borradas.count) {
    return { error: "La reunión cambió de estado y ya no se puede borrar." };
  }
  // La carpeta de la sala, solo si quedó vacía (rmdir no borra carpetas con archivos). Si falla, no importa.
  try {
    await rmdir(rutaDeArchivo(reunion.sala, carpetaDeReuniones()));
  } catch {
    // no existe, no está vacía o no hay permiso
  }
  revalidatePath("/cliente/reuniones");
  return { ok: true };
}
