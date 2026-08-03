import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Puente entre el canal de API OFICIAL y el CRM.
 *
 * Quien escribia a "Ventas 1" vivia en una tabla aparte (OfficialApiContact): NO aparecia en el
 * Kanban, ni en "Mi dia", ni en el informe, ni se le podia poner etapa o etiqueta, ni agendarle un
 * seguimiento. Para el CRM, esos clientes no existian.
 *
 * Acá se crea (o se encuentra) la ficha del MISMO cliente en el CRM y se deja enlazada. La persona
 * es una sola aunque escriba por varios numeros: si ya existia por el canal viejo, se reutiliza su
 * ficha y su historial en vez de duplicarla.
 *
 * El canal decide si ese contacto ENTRA al embudo: un numero administrativo (proveedores,
 * logistica) crea la ficha pero la marca fuera del CRM, para no ensuciar las metricas de venta.
 */
export async function ensureCrmContactForOfficialApi(input: {
  workspaceId: string;
  waId: string;
  name?: string | null;
}): Promise<string | null> {
  const phoneNumber = input.waId.replace(/\D/g, "");
  if (!phoneNumber) {
    return null;
  }

  try {
    // ¿El canal por el que entro alimenta el embudo? Se mira el canal de API oficial del
    // workspace; si no hay ninguno configurado, se asume que es de ventas.
    const channel = await prisma.whatsAppChannel.findFirst({
      where: { workspaceId: input.workspaceId, provider: "OFFICIAL_API" },
      select: { purpose: true },
    });
    const feedsCrm = (channel?.purpose ?? "SALES").toUpperCase() === "SALES";

    // La ficha es por telefono dentro del workspace (@@unique), asi que si el cliente ya venia
    // del canal viejo se reutiliza la misma y no se duplica.
    const existing = await prisma.contact.findFirst({
      where: { workspaceId: input.workspaceId, phoneNumber },
      select: { id: true, name: true },
    });

    if (existing) {
      // Solo se completa el nombre si estaba vacio: no pisamos lo que ya escribio una asesora.
      const nextName = input.name?.trim();
      if (nextName && !existing.name?.trim()) {
        await prisma.contact.update({ where: { id: existing.id }, data: { name: nextName } });
      }
      return existing.id;
    }

    /**
     * upsert y no create: entre el findFirst de arriba y esto puede colarse OTRO mensaje del
     * mismo numero (llegan de a varios y se procesan a la vez). Los dos veian "no existe" y los
     * dos insertaban; el segundo reventaba con
     * "duplicate key value violates unique constraint Contact_workspaceId_phoneNumber_key",
     * el catch devolvia null y ESE cliente se quedaba sin ficha en el CRM: no aparecia en el
     * Kanban ni en Mi dia. Con upsert, el que llega segundo se encuentra la ficha del primero.
     */
    const created = await prisma.contact.upsert({
      where: {
        workspaceId_phoneNumber: { workspaceId: input.workspaceId, phoneNumber },
      },
      create: {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        phoneNumber,
        name: input.name?.trim() || null,
        // Numero administrativo: queda fuera del embudo y de las metricas de venta.
        excludedFromCrm: !feedsCrm,
        metadata: { source: "whatsapp oficial" },
      },
      // Ya existia (carrera): no se toca nada de lo que tenga guardado.
      update: {},
      select: { id: true },
    });

    return created.id;
  } catch (error) {
    // Nunca puede tumbar el webhook: si el puente falla, el mensaje igual se guarda y se responde.
    console.error("[OFFICIAL_API] crm_bridge_failed", { waId: input.waId, error });
    return null;
  }
}
