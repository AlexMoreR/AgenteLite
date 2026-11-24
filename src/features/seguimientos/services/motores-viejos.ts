import { prisma } from "@/lib/prisma";
import { agenteEnPausa, esSeguimientoDelV2, PREFIJO_SIN_RESPONDER } from "@/features/seguimientos/dominio/motores-viejos";

/**
 * ¿Es un seguimiento del agente V1/V2 ("Sin responder …" o de una regla AGENT_NODE) y el agente de su
 * línea está en pausa? Si sí, no sale. Ver dominio/motores-viejos.ts. Sin línea no se sabe de quién
 * es: no se frena.
 */
export async function seguimientoDelV2EnPausa(follow: {
  name: string | null;
  followRuleId: string | null;
  channelId: string | null;
}): Promise<boolean> {
  if (!follow.channelId) return false;
  const nombre = (follow.name ?? "").trim();
  let reglaSourceType: string | null = null;
  if (!nombre.startsWith(PREFIJO_SIN_RESPONDER) && follow.followRuleId) {
    const regla = await prisma.followRule.findUnique({
      where: { id: follow.followRuleId },
      select: { sourceType: true },
    });
    reglaSourceType = regla?.sourceType ?? null;
  }
  if (!esSeguimientoDelV2({ nombre, reglaSourceType })) return false;
  const linea = await prisma.whatsAppChannel.findUnique({
    where: { id: follow.channelId },
    select: { agent: { select: { status: true, isActive: true } } },
  });
  return agenteEnPausa(linea?.agent ?? null);
}
