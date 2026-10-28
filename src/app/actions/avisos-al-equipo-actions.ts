"use server";

import { auth } from "@/auth";
import { guardarAvisosDeLaPersona } from "@/features/tableros-inteligentes/services/avisos-al-equipo";

/** La casilla del perfil: cada persona prende o apaga SUS avisos del Tablero IA por WhatsApp. */
export async function guardarAvisosDelTableroAction(activo: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Tu sesión venció. Entra de nuevo." };
  try {
    await guardarAvisosDeLaPersona(session.user.id, activo === true);
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo guardar. Intenta de nuevo." };
  }
}
