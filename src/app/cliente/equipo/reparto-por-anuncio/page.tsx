import type { Metadata } from "next";
import Link from "next/link";

import { RepartoPorAnuncioForm } from "@/components/reparto-por-anuncio-form";
import { NegocioEquipoTabs } from "@/components/negocio-equipo-tabs";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { metaAdsConfigurado } from "@/features/pauta/servicios/meta-ads-lectura";
import { prisma } from "@/lib/prisma";
import { anunciosConocidosPorCampana, leerReglas, usoDeLasReglas } from "@/lib/reparto-por-anuncio";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// La fecha del último chat se arma aquí (servidor) como texto, en hora de Colombia, para que el
// navegador no la vuelva a formatear con otra zona y descuadre la hidratación.
const FECHA_DEL_ULTIMO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/*
  REPARTO POR ANUNCIO (dueño, 3-nov-2026): campaña o anuncio de Meta → asesora (o "reparto normal").
  Solo el dueño y los administradores, igual que el resto de Equipo. Las reglas viven en AppSetting;
  el webhook de WhatsApp las aplica al primer mensaje del chat (src/lib/reparto-por-anuncio.ts).
*/
export default async function RepartoPorAnuncioPage() {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });

  const metaConectado = metaAdsConfigurado();
  // El contador y los anuncios conocidos son de ayuda: si fallan, la pantalla sale igual (en cero).
  const [reglas, uso, anunciosConocidos, canales, miembros] = await Promise.all([
    leerReglas(access.workspaceId).catch(() => []),
    usoDeLasReglas(access.workspaceId).catch(() => ({}) as Awaited<ReturnType<typeof usoDeLasReglas>>),
    anunciosConocidosPorCampana().catch(() => ({}) as Record<string, number>),
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
          el chat sigue el reparto normal. Cuando la regla le asigna el chat a una asesora, el bot queda en pausa en ese
          chat y no manda el combo. Con «Sin bienvenida» el bot no escribe nada; sin esa casilla, en las líneas V3 sale
          solo el aviso general de pausa.
        </p>
      </div>

      {metaConectado ? (
        <p className="text-sm">
          Meta conectado: <span className="font-medium">sí</span>
        </p>
      ) : (
        <p
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <span className="font-medium">Meta conectado: no</span> — las reglas por campaña no pueden funcionar sin la
          conexión de lectura de Meta. Las reglas por anuncio sí funcionan.
        </p>
      )}

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
          chats: uso[regla.id]?.chats ?? 0,
          ultimoChat: uso[regla.id] ? FECHA_DEL_ULTIMO.format(uso[regla.id].ultimo) : null,
          anunciosConocidos: regla.tipo === "campana" ? (anunciosConocidos[regla.metaId] ?? 0) : null,
        }))}
        lineas={canales.map((canal) => ({ id: canal.id, nombre: canal.name }))}
        asesoras={asesoras}
        nombres={nombres}
      />
    </section>
  );
}
