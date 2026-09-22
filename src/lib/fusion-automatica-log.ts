import { prisma } from "@/lib/prisma";

/**
 * Rastro de cada fusion automatica de chats (LID <-> telefono, duplicados).
 *
 * Nace porque una de estas fusiones se llevo por delante una conversacion entera -mensajes
 * incluidos- sin dejar ningun rastro de por que, y no habia forma de reconstruir que paso
 * (Alex, 22-sep-2026: "puede estarle pasando a otras conversaciones sin que nadie lo note").
 *
 * Se anota ANTES de borrar nada, con los conteos exactos. Si algo asi vuelve a pasar, esto es lo
 * que permite decir con certeza que se movio, cuanto, y de donde a donde -en vez de teorizar
 * leyendo codigo despues del hecho.
 *
 * Vive en AppSetting, una sola fila por negocio, sin migracion. Guarda las ultimas 200.
 */

const CLAVE = "fusion-automatica:log:";
const MAXIMO = 200;

export type FusionAutomaticaLog = {
  at: string;
  tipo: "lid-a-telefono" | "chat-duplicado";
  workspaceId: string;
  /** Lo que sobrevive. */
  destino: { contactId: string; conversationId?: string };
  /** Lo que se iba a borrar. */
  origen: { contactId?: string; conversationId: string };
  mensajesMovidos: number;
};

export async function anotarFusionAutomatica(entrada: FusionAutomaticaLog): Promise<void> {
  const key = `${CLAVE}${entrada.workspaceId}`;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key } });
    const previas = fila?.value ? (JSON.parse(fila.value) as FusionAutomaticaLog[]) : [];
    const value = JSON.stringify([entrada, ...(Array.isArray(previas) ? previas : [])].slice(0, MAXIMO));
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  } catch {
    // El log es una ayuda, no una condicion: si falla, la fusion sigue su curso igual.
  }
}
