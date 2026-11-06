import { cache } from "react";

import { elegirLiderDeVentas } from "@/features/listo-para-pagar/dominio/lider-de-ventas";
import { cacheDeSupervisoras } from "@/lib/cache-de-permisos";
import { prisma } from "@/lib/prisma";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

/*
  Quien puede SUPERVISAR al equipo, decidido en un solo lugar.

  Antes cada pantalla lo decidia a su manera: unas miraban el rol de la plataforma (ADMIN de
  Aizenbot), otras el rol dentro del negocio. Con eso, darle "administrador" a alguien le abria
  Automatizaciones pero no el tablero de llamadas (Alex, 15-sep-2026).

  Supervisar = ver al equipo (tableros, llamadas y grabaciones, informes), asignar chats a cualquiera
  y correr automatizaciones. Lo tienen el dueño, los administradores y las SUPERVISORAS: asesoras a las
  que el dueño les dio ese rol en Mi empresa -> Equipo (primera: Stheffani). Administrar la cuenta
  (conexiones, agente, claves) sigue siendo solo de dueño y administradores.

  Las supervisoras se guardan en AppSetting para no migrar la base de produccion.
*/

const clave = (workspaceId: string) => `equipo:supervisoras:${workspaceId}`;

/*
  Con cache del proceso (45 s, ver cache-de-permisos.ts): la bandeja lo preguntaba en cada pedido.
  `guardarSupervisoras` escribe por Prisma, y esa escritura la vacia sola (prisma.ts). Se devuelve
  una copia para que nadie toque la lista guardada.
*/
export const leerSupervisoras = cache(async (workspaceId: string): Promise<string[]> => {
  const lista = await cacheDeSupervisoras.obtener(workspaceId, () => leerSupervisorasDeLaBase(workspaceId));
  return [...lista];
});

async function leerSupervisorasDeLaBase(workspaceId: string): Promise<string[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave(workspaceId) } });
  if (!fila) {
    return [];
  }
  try {
    const lista = JSON.parse(fila.value) as unknown;
    return Array.isArray(lista) ? lista.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function guardarSupervisoras(workspaceId: string, userIds: string[]) {
  const valor = JSON.stringify(Array.from(new Set(userIds)));
  await prisma.appSetting.upsert({
    where: { key: clave(workspaceId) },
    create: { key: clave(workspaceId), value: valor },
    update: { value: valor },
  });
  // prisma.ts ya la invalida al escribir; se repite aca para que no dependa solo de eso.
  cacheDeSupervisoras.invalidar(workspaceId);
}

export async function esSupervisora(workspaceId: string, userId: string) {
  return (await leerSupervisoras(workspaceId)).includes(userId);
}

/** Dueño, administrador (del negocio o de la plataforma) o supervisora. */
export async function puedeSupervisar(access: {
  workspaceId: string;
  userId: string;
  isOwner: boolean;
  role: string;
  membershipRole: string;
}) {
  if (esJefeDelNegocio(access)) {
    return true;
  }
  return esSupervisora(access.workspaceId, access.userId);
}

/*
  El LIDER DE VENTAS del negocio: a quien le llega el aviso "Listo para pagar" cuando nadie le
  escribe al cliente a tiempo. Lo elige el dueño en Mi empresa -> Equipo. Se guarda en AppSetting
  (el id de la persona) para no migrar la base. Sin elegir, hace de lider la primera supervisora.
*/
const claveDelLider = (workspaceId: string) => `equipo:lider-ventas:${workspaceId}`;

/** El id que eligió el dueño, o null si no eligió a nadie. No mira si sigue en el equipo. */
export async function leerLiderDeVentasElegido(workspaceId: string): Promise<string | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: claveDelLider(workspaceId) } });
  const valor = fila?.value?.trim();
  return valor ? valor : null;
}

/** Guarda al lider elegido. Con null se borra la fila y vuelve a mandar la primera supervisora. */
export async function guardarLiderDeVentas(workspaceId: string, userId: string | null): Promise<void> {
  const key = claveDelLider(workspaceId);
  if (!userId) {
    await prisma.appSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: userId }, update: { value: userId } });
}

/**
 * Quien es hoy el lider de ventas: el elegido si sigue activo en el negocio; si no, la primera
 * supervisora que siga activa; si no hay ninguna, null.
 */
export async function resolverLiderDeVentas(workspaceId: string): Promise<string | null> {
  const [elegido, supervisoras] = await Promise.all([
    leerLiderDeVentasElegido(workspaceId),
    leerSupervisoras(workspaceId),
  ]);
  const candidatos = [...new Set([...(elegido ? [elegido] : []), ...supervisoras])];
  if (candidatos.length === 0) {
    return null;
  }
  const activos = await prisma.workspaceMember.findMany({
    where: { workspaceId, userId: { in: candidatos }, isActive: true },
    select: { userId: true },
  });
  return elegirLiderDeVentas(elegido, supervisoras, new Set(activos.map((fila) => fila.userId)));
}
