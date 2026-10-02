import { prisma } from "@/lib/prisma";

/**
 * LOS CHATS FIJADOS DE CADA PERSONA, como en WhatsApp.
 *
 * Pedido de Alex (01-10-2026). Son de cada persona -lo que fija Ingrid no le cambia la bandeja a
 * Maria- y hasta 3: con mas, la parte fijada se vuelve otra lista larga y deja de servir.
 *
 * Se guarda la clave del chat tal como la usa la bandeja (`agent:<id>` u `official:<id>`), en el
 * orden en que se fijaron: el primero que se fijo queda arriba. Vive en AppSetting para no migrar
 * la base.
 */

export const MAXIMO_DE_FIJADOS = 3;

const clave = (userId: string) => `chats:fijados:${userId}`;

export async function leerChatsFijados(userId: string): Promise<string[]> {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave(userId) }, select: { value: true } });
  if (!fila?.value) {
    return [];
  }
  try {
    const lista = JSON.parse(fila.value) as unknown;
    return Array.isArray(lista)
      ? lista.filter((item): item is string => typeof item === "string").slice(0, MAXIMO_DE_FIJADOS)
      : [];
  } catch {
    return [];
  }
}

export async function guardarChatsFijados(userId: string, claves: string[]) {
  const key = clave(userId);
  const value = JSON.stringify(Array.from(new Set(claves)).slice(0, MAXIMO_DE_FIJADOS));
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
