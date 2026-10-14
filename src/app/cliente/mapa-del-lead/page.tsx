import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Network } from "lucide-react";

import { MapaDelLead } from "@/features/mapa-del-lead/components/MapaDelLead";
import { contactoDelChat, leerDatosDelLead } from "@/features/mapa-del-lead/servicios/leer";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = { title: "Mapa del lead", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * MAPA DEL LEAD en su propia página (/cliente/mapa-del-lead?chatKey=agent:<id>). Es la misma vista
 * del botón de la bandeja; existe para enlazarla desde otras pantallas (Recuperación) y para abrirla
 * aparte. Permiso: el de la bandeja.
 */
export default async function MapaDelLeadPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("chats");
  const params = await searchParams;
  const chatKey = typeof params.chatKey === "string" ? params.chatKey.trim() : "";
  const contactId = chatKey ? await contactoDelChat(access.workspaceId, chatKey) : null;
  const resultado = contactId ? await leerDatosDelLead(access.workspaceId, contactId) : { error: "Este chat no tiene ficha en el CRM" };
  const volver = chatKey ? `/cliente/chats?chatKey=${encodeURIComponent(chatKey)}&assigned=all` : "/cliente/chats";

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Link href={volver} aria-label="Volver al chat" className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted">
          <ArrowLeft className="size-4" />
        </Link>
        <Network className="size-4 text-[#7c3aed]" />
        <h1 className="truncate text-sm font-semibold">
          Mapa del lead
          {"datos" in resultado ? ` · ${resultado.datos.contacto.nombre?.trim() || `•••• ${resultado.datos.contacto.telefono4 ?? ""}`}` : ""}
        </h1>
      </div>
      {"datos" in resultado ? (
        <MapaDelLead datos={resultado.datos} />
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">{resultado.error}</div>
      )}
    </div>
  );
}
