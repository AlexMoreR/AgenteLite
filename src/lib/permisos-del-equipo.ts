import { cache } from "react";

import { cacheDeSupervisoras } from "@/lib/cache-de-permisos";
import { prisma } from "@/lib/prisma";

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
  if (access.isOwner || access.role === "ADMIN" || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN") {
    return true;
  }
  return esSupervisora(access.workspaceId, access.userId);
}
