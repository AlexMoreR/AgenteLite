import type { Metadata } from "next";
import { headers } from "next/headers";

import { ConexionClaudeWorkspace } from "@/features/mcp/components/ConexionClaudeWorkspace";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { listarClavesMcp } from "@/lib/mcp/claves";

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
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Solo el dueño o un administrador del negocio puede conectar Claude.
      </div>
    );
  }

  const [claves, cabeceras] = await Promise.all([listarClavesMcp(access.workspaceId), headers()]);
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "app.aizenbot.com";
  const protocolo = host.startsWith("localhost") ? "http" : "https";

  return (
    <ConexionClaudeWorkspace
      direccion={`${protocolo}://${host}/api/mcp`}
      negocio={access.workspaceName}
      claves={claves.map((clave) => ({
        id: clave.id,
        nombre: clave.nombre,
        creadaEl: clave.creadaEl,
        ultimoUso: clave.ultimoUso,
      }))}
    />
  );
}
