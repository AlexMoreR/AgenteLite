import type { EstadoReunion } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ESTADOS_PARA_ENTRAR } from "@/features/reuniones/estados";
import { codigoOcupado, crearReunion, fechaParaTitulo } from "@/features/reuniones/servicios/crear-reunion";
import { puedeAdministrarSalas } from "@/features/reuniones/servicios/permisos";
import { slugLibre } from "@/features/reuniones/servicios/slug-de-reunion";

/*
  SALAS FIJAS DE REUNIONES (como un canal de Teams): una por área, con un link que no cambia y el
  historial de todas sus reuniones.

  - El link (`codigo`) sale del nombre UNA sola vez, al crearla: "Sistemas - Emanuel" -> sistemas-emanuel
    (-2 si ya existe). Al renombrarla el link sigue igual, para no romper el que ya se compartió.
  - Crear y editar salas: solo el dueño o un administrador (puedeAdministrarSalas).
  - El líder de la sala puede terminar sus reuniones (puedeTerminarLaReunion).
  - Al entrar se usa la reunión de la sala que esté Esperando o En vivo; si no hay, se crea una nueva.
*/

const MAXIMO_NOMBRE = 120;

const limpiarNombre = (nombre: unknown) => (typeof nombre === "string" ? nombre.replace(/\s+/g, " ").trim().slice(0, MAXIMO_NOMBRE) : "");

/** El líder tiene que ser del mismo negocio: el dueño o un miembro activo. */
async function esDelNegocio(userId: string, workspaceId: string): Promise<boolean> {
  const [dueno, miembro] = await Promise.all([
    prisma.workspace.count({ where: { id: workspaceId, ownerId: userId } }),
    prisma.workspaceMember.count({ where: { workspaceId, userId, isActive: true } }),
  ]);
  return dueno + miembro > 0;
}

/** Quienes pueden ser líderes de una sala: el dueño y los miembros activos del negocio. */
export async function usuariosDelNegocio(workspaceId: string) {
  const [negocio, miembros] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { owner: { select: { id: true, name: true, email: true } } } }),
    prisma.workspaceMember.findMany({
      where: { workspaceId, isActive: true },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  const usuarios = new Map<string, string>();
  for (const usuario of [negocio?.owner, ...miembros.map((miembro) => miembro.user)]) {
    if (usuario) {
      usuarios.set(usuario.id, usuario.name?.trim() || usuario.email || "Sin nombre");
    }
  }
  return [...usuarios].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function crearSala(datos: {
  userId: string;
  workspaceId: string;
  nombre: string;
  liderId?: string | null;
  sinGrabar?: boolean;
}): Promise<{ id?: string; codigo?: string; error?: string }> {
  if (!(await puedeAdministrarSalas(datos.userId, datos.workspaceId))) {
    return { error: "No autorizado" };
  }
  const nombre = limpiarNombre(datos.nombre);
  if (!nombre) {
    return { error: "Escribe el nombre de la sala." };
  }
  const liderId = datos.liderId || null;
  if (liderId && !(await esDelNegocio(liderId, datos.workspaceId))) {
    return { error: "El líder tiene que ser del equipo." };
  }
  const codigo = await slugLibre(nombre, (c) => codigoOcupado(prisma, c));
  return prisma.salaDeReuniones.create({
    data: { workspaceId: datos.workspaceId, nombre, codigo, liderId, sinGrabar: datos.sinGrabar === true, creadaPorId: datos.userId },
    select: { id: true, codigo: true },
  });
}

/** Cambia nombre, líder o "Sin grabar". El `codigo` (el link fijo) nunca cambia. */
export async function editarSala(datos: {
  userId: string;
  salaId: string;
  nombre?: string;
  liderId?: string | null;
  sinGrabar?: boolean;
}): Promise<{ ok?: true; error?: string }> {
  const sala = await prisma.salaDeReuniones.findUnique({ where: { id: datos.salaId }, select: { id: true, workspaceId: true } });
  if (!sala || !(await puedeAdministrarSalas(datos.userId, sala.workspaceId))) {
    return { error: "No autorizado" };
  }
  const cambios: { nombre?: string; liderId?: string | null; sinGrabar?: boolean } = {};
  if (datos.nombre !== undefined) {
    const nombre = limpiarNombre(datos.nombre);
    if (!nombre) {
      return { error: "Escribe el nombre de la sala." };
    }
    cambios.nombre = nombre;
  }
  if (datos.liderId !== undefined) {
    const liderId = datos.liderId || null;
    if (liderId && !(await esDelNegocio(liderId, sala.workspaceId))) {
      return { error: "El líder tiene que ser del equipo." };
    }
    cambios.liderId = liderId;
  }
  if (datos.sinGrabar !== undefined) {
    cambios.sinGrabar = datos.sinGrabar === true;
  }
  await prisma.salaDeReuniones.update({ where: { id: sala.id }, data: cambios });
  return { ok: true };
}

/**
 * Al entrar a la sala fija: la reunión que esté Esperando o En vivo, o una nueva si no hay.
 * El bloqueo (por el id de la sala) hace que dos personas que entran a la vez caigan en la misma.
 * Quien llama ya revisó que el usuario puede entrar (es del negocio de la sala o tiene el link).
 */
export async function abrirOCrearReunionDeSala(
  salaId: string,
  userId: string | null,
): Promise<{ id: string; codigo: string; creada: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${salaId}::text))`;
    const sala = await tx.salaDeReuniones.findUnique({ where: { id: salaId }, select: { id: true, workspaceId: true, nombre: true, sinGrabar: true } });
    if (!sala) {
      return null;
    }
    const abierta = await tx.reunion.findFirst({
      where: { salaFijaId: sala.id, estado: { in: ESTADOS_PARA_ENTRAR } },
      orderBy: { createdAt: "desc" },
      select: { id: true, codigo: true },
    });
    if (abierta) {
      return { ...abierta, creada: false };
    }
    const nueva = await crearReunion(tx, {
      workspaceId: sala.workspaceId,
      creadaPorId: userId,
      titulo: `${sala.nombre} ${fechaParaTitulo()}`,
      sinGrabar: sala.sinGrabar,
      salaFijaId: sala.id,
    });
    return { ...nueva, creada: true };
  });
}

/** El resumen del acta (el campo `resumen` del JSON), si hay. */
function resumenDelActa(acta: unknown): string | null {
  if (acta && typeof acta === "object" && !Array.isArray(acta)) {
    const resumen = (acta as { resumen?: unknown }).resumen;
    return typeof resumen === "string" && resumen.trim() ? resumen.trim() : null;
  }
  return null;
}

export type ReunionDelHistorial = {
  id: string;
  titulo: string;
  codigo: string;
  estado: EstadoReunion;
  sinGrabar: boolean;
  empezoEn: Date | null;
  terminoEn: Date | null;
  createdAt: Date;
  participantes: { nombre: string; identidad: string; userId: string | null; entroEn: Date; salioEn: Date | null }[];
  resumen: string | null;
};

/** Las reuniones de la sala, la más nueva primero, con quién entró y el resumen del acta. Quien llama revisa el negocio. */
export async function leerHistorialDeLaSala(salaId: string): Promise<ReunionDelHistorial[]> {
  const reuniones = await prisma.reunion.findMany({
    where: { salaFijaId: salaId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      titulo: true,
      codigo: true,
      estado: true,
      sinGrabar: true,
      empezoEn: true,
      terminoEn: true,
      createdAt: true,
      acta: true,
      participantes: { orderBy: { entroEn: "asc" }, select: { nombre: true, identidad: true, userId: true, entroEn: true, salioEn: true } },
    },
  });
  return reuniones.map(({ acta, ...reunion }) => ({ ...reunion, resumen: resumenDelActa(acta) }));
}

export type SalaDeLaLista = {
  id: string;
  nombre: string;
  codigo: string;
  sinGrabar: boolean;
  lider: { id: string; nombre: string } | null;
  abierta: { id: string; codigo: string; estado: EstadoReunion } | null;
  ultimaReunionEn: Date | null;
  totalDeReuniones: number;
};

/** Las salas del negocio con su líder, la reunión abierta (si hay), la fecha de la última y cuántas lleva. */
export async function listarSalas(workspaceId: string): Promise<SalaDeLaLista[]> {
  const salas = await prisma.salaDeReuniones.findMany({
    where: { workspaceId },
    orderBy: { nombre: "asc" },
    select: {
      id: true,
      nombre: true,
      codigo: true,
      sinGrabar: true,
      lider: { select: { id: true, name: true, email: true } },
      _count: { select: { reuniones: true } },
    },
  });
  if (!salas.length) {
    return [];
  }
  const ids = salas.map((sala) => sala.id);
  const [abiertas, ultimas] = await Promise.all([
    prisma.reunion.findMany({
      where: { salaFijaId: { in: ids }, estado: { in: ESTADOS_PARA_ENTRAR } },
      orderBy: { createdAt: "desc" },
      select: { id: true, codigo: true, estado: true, salaFijaId: true },
    }),
    prisma.reunion.groupBy({ by: ["salaFijaId"], where: { salaFijaId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  return salas.map((sala) => {
    const abierta = abiertas.find((reunion) => reunion.salaFijaId === sala.id);
    return {
      id: sala.id,
      nombre: sala.nombre,
      codigo: sala.codigo,
      sinGrabar: sala.sinGrabar,
      lider: sala.lider ? { id: sala.lider.id, nombre: sala.lider.name?.trim() || sala.lider.email.split("@")[0] } : null,
      abierta: abierta ? { id: abierta.id, codigo: abierta.codigo, estado: abierta.estado } : null,
      ultimaReunionEn: ultimas.find((fila) => fila.salaFijaId === sala.id)?._max.createdAt ?? null,
      totalDeReuniones: sala._count.reuniones,
    };
  });
}
