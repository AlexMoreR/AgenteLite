"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AREA_VENTAS } from "@/features/agentes-de-area/dominio/reglas";
import { fijarInterruptor } from "@/features/agentes-de-area/servicios/config";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";

/**
 * Prender o apagar el Agente de Ventas. Solo el dueño o un administrador (la supervisora ve la pantalla,
 * pero no decide si el agente manda mensajes). Escribe únicamente `agente-area:ventas:<negocio>` en AppSetting:
 * no toca chats, el bot ni nada de Gestión.
 */
export async function cambiarInterruptorAgenteDeVentasAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const access = await getClientWorkspaceAccessForUser(session.user.id);
  if (!access) return;
  const esJefe = access.isOwner || access.role === "ADMIN" || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";
  if (!esJefe) return;
  await fijarInterruptor(access.workspaceId, AREA_VENTAS, String(formData.get("activo")) === "true");
  revalidatePath("/cliente/crm/agente-de-ventas");
}
