import type { Metadata } from "next";

import { PanelTop } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

import { Explicacion } from "./explicacion";
import { MaquetaCabecera } from "./maqueta-cabecera";

export const metadata: Metadata = { title: "Maqueta: cabecera del chat", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * MAQUETA de la cabecera del chat. Datos inventados: no lee ni escribe en la base
 * y no llama acciones. Sirve para que Alexander dé su visto bueno antes de tocar Chats.
 */
export default async function MaquetaCabeceraPage() {
  await requireClientWorkspaceAccess();

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4">
      <div>
        <PageHeader icon={PanelTop} title="Maqueta: cabecera del chat" />
        <p className="mt-1 text-sm text-muted-foreground">Solo de muestra: Chats no cambió. Nada de lo que se toca aquí se guarda.</p>
      </div>
      <MaquetaCabecera />
      <Explicacion />
    </div>
  );
}
