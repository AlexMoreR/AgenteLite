import { redirect } from "next/navigation";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { puedeVerDireccion } from "@/lib/permisos-del-crm";

/**
 * Puerta única de Dirección: solo el dueño y los administradores (Alex, 26-10-2026).
 * Las demás cuentas, también las que llegan por un link viejo, terminan en Mi día.
 * Los chequeos de cada página se mantienen.
 */
export default async function DireccionLayout({ children }: { children: React.ReactNode }) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!puedeVerDireccion(access)) redirect("/cliente/crm/mi-dia");
  return children;
}
