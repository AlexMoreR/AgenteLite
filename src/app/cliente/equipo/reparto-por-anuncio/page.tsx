import type { Metadata } from "next";
import Link from "next/link";

import { RepartoPorAnuncioForm } from "@/components/reparto-por-anuncio-form";
import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import { leerReglas } from "@/lib/reparto-por-anuncio";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/*
  REPARTO POR ANUNCIO (dueño, 3-nov-2026): campaña o anuncio de Meta → asesora (o "reparto normal").
  Solo el dueño y los administradores, igual que el resto de Equipo. Las reglas viven en AppSetting;
  el webhook de WhatsApp las aplica al primer mensaje del chat (src/lib/reparto-por-anuncio.ts).
*/
export default async function RepartoPorAnuncioPage() {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });

  const [reglas, canales, miembros] = await Promise.all([
    leerReglas(access.workspaceId).catch(() => []),
    prisma.whatsAppChannel.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: access.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { isActive: true, user: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const nombreDe = (persona: { name: string | null; email: string | null }) =>
    persona.name?.trim() || persona.email || "Sin nombre";
  const asesoras = miembros
    .filter((miembro) => miembro.isActive)
    .map((miembro) => ({ id: miembro.user.id, nombre: nombreDe(miembro.user) }));
  const nombres = Object.fromEntries(miembros.map((miembro) => [miembro.user.id, nombreDe(miembro.user)]));

  return (
    <section className="app-page flex flex-col gap-5 p-4 sm:p-6">
      <NegocioEquipoTabs />

      <div className="flex flex-col gap-1">
        <Link href="/cliente/equipo" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          ← Volver a Equipo
        </Link>
        <h1 className="text-lg font-semibold">Reparto por anuncio</h1>
        <p className="text-sm text-muted-foreground">
          Cada chat nuevo que llega de un anuncio de Meta se le asigna a la asesora de su regla, sin pasar por el reparto
          normal. La regla por anuncio gana sobre la de campaña. Si el anuncio no tiene regla, o la asesora no está activa,
          el chat sigue el reparto normal. Con «Sin bienvenida» el bot no saluda: contesta la asesora.
        </p>
      </div>

      <RepartoPorAnuncioForm
        reglas={reglas.map((regla) => ({
          id: regla.id,
          tipo: regla.tipo,
          metaId: regla.metaId,
          nombre: regla.nombre || regla.metaId,
          channelId: regla.channelId,
          asignarA: regla.asignarA,
          sinBienvenida: regla.sinBienvenida,
          activa: regla.activa,
        }))}
        lineas={canales.map((canal) => ({ id: canal.id, nombre: canal.name }))}
        asesoras={asesoras}
        nombres={nombres}
      />
    </section>
  );
}
