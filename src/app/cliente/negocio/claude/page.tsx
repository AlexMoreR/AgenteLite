import type { Metadata } from "next";
import { headers } from "next/headers";

import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { AvisosAlDueno } from "@/features/tableros-inteligentes/components/AvisosAlDueno";
import { avisosParaLaPantalla } from "@/features/tableros-inteligentes/services/avisos-al-dueno";
import { ConexionClaudeWorkspace } from "@/features/mcp/components/ConexionClaudeWorkspace";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { listarClavesMcp } from "@/lib/mcp/claves";
import { listarCambiosMcp } from "@/lib/mcp/cambios";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/*
  Conectar Claude al CRM por MCP (etapa 1: solo lectura). Aca se crean y revocan las claves.
  Solo dueño o administrador: la clave ve todas las conversaciones del negocio.
*/
export default async function ClienteClaudePage() {
  const access = await requireClientWorkspaceAccess();
  const esJefe = access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";

  if (!esJefe) {
    return (
      <div className="space-y-6 p-4 sm:p-6">
        <NegocioEquipoTabs />
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Solo el dueño o un administrador del negocio puede conectar Claude.
        </div>
      </div>
    );
  }

  const [claves, cambios, avisos, cabeceras] = await Promise.all([
    listarClavesMcp(access.workspaceId),
    listarCambiosMcp(access.workspaceId),
    avisosParaLaPantalla(access.workspaceId),
    headers(),
  ]);
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "app.aizenbot.com";
  const protocolo = host.startsWith("localhost") ? "http" : "https";

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <NegocioEquipoTabs />

      <AvisosAlDueno inicial={avisos} />

      <ConexionClaudeWorkspace
        direccion={`${protocolo}://${host}/api/mcp`}
        negocio={access.workspaceName}
        cambios={cambios.slice(0, 20).map((cambio) => ({
          id: cambio.id,
          at: cambio.at,
          titulo: cambio.titulo,
          accion: cambio.accion,
          deshecho: cambio.deshecho === true,
        }))}
        claves={claves.map((clave) => ({
          id: clave.id,
          nombre: clave.nombre,
          creadaEl: clave.creadaEl,
          ultimoUso: clave.ultimoUso,
        }))}
      />
    </div>
  );
}
