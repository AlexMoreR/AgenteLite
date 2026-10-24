import { prisma } from "@/lib/prisma";

import { userIdsPorBuscar } from "./nombres-de-participantes";

/** userId -> nombre, solo de los registros viejos que guardaron la identidad en vez del nombre. */
export async function nombresDeUsuariosPara(filas: Array<{ identidad: string; nombre: string; userId?: string | null }>): Promise<Map<string, string>> {
  const ids = userIdsPorBuscar(filas);
  if (!ids.length) {
    return new Map();
  }
  const usuarios = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  return new Map(usuarios.map((usuario) => [usuario.id, usuario.name?.trim() || usuario.email || "Usuario"]));
}
