import type { Metadata } from "next";

import { AutomatizacionesWorkspace } from "@/features/crm/components/AutomatizacionesWorkspace";
import { contarLeads, leerAutomatizaciones } from "@/features/crm/automatizaciones/servicio";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ClienteCrmAutomatizacionesPage() {
  const access = await requireClientWorkspaceAccess("crm");
  const esJefe = access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";

  if (!esJefe) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Solo el dueño o un administrador del negocio puede usar las automatizaciones.
      </div>
    );
  }

  const [automatizaciones, miembros, canales] = await Promise.all([
    leerAutomatizaciones(access.workspaceId),
    prisma.workspaceMember.findMany({
      where: { workspaceId: access.workspaceId, isActive: true },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const conteos = await Promise.all(
    automatizaciones.map((automatizacion) => contarLeads(access.workspaceId, automatizacion)),
  );

  return (
    <AutomatizacionesWorkspace
      automatizaciones={automatizaciones}
      conteos={conteos}
      miembros={miembros
        .map((miembro) => ({
          id: miembro.userId,
          nombre: miembro.user?.name?.trim() || miembro.user?.email || "Sin nombre",
        }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))}
      canales={canales.map((canal) => ({ id: canal.id, nombre: canal.name }))}
    />
  );
}
