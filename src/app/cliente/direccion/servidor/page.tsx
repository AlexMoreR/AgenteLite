import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { leerPanelServidor } from "@/lib/metricas-servidor-lectura";
import { puedeVerDireccion } from "@/lib/permisos-del-crm";

import { PanelServidor } from "./panel-servidor";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** SERVIDOR (solo dueño y administradores): CPU, memoria y disco del servidor en las últimas 24 h. Solo lee. */
export default async function ServidorPage() {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  // Segunda puerta: el layout de Dirección ya manda a Mi día a quien no es jefe.
  if (!puedeVerDireccion(access)) {
    redirect("/unauthorized");
  }
  const muestras = await leerPanelServidor();
  return <PanelServidor muestrasIniciales={muestras} />;
}
