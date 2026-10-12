import type { Metadata } from "next";

import { LibroDeReglasView } from "@/features/agente-v3/components/LibroDeReglasView";
import { revisarLibro } from "@/features/agente-v3/domain/reglas";
import { leerLibro } from "@/features/agente-v3/servicios/almacen";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/*
  El libro de reglas del Agente V3, para mirarlo mientras se dicta por Claude.

  Solo dueño o administrador: son las reglas con las que se vende. Es de lectura: editar se hace
  hablando, y esta pantalla es donde se comprueba que quedó lo que se pidió (Alex, 21-sep-2026).

  Aquí vivía el interruptor "Rescatar mensajes perdidos". Se quitó el 11-10-2026 por pedido de Alex:
  el rescate es una protección del sistema y corre siempre (ver servicios/rescate-de-mensajes.ts).
*/
export default async function AgenteV3Page() {
  const access = await requireClientWorkspaceAccess();
  const esJefe = access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";

  if (!esJefe) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Solo el dueño o un administrador del negocio puede ver el libro de reglas.
      </div>
    );
  }

  const libro = await leerLibro(access.workspaceId);

  return (
    <div className="space-y-4">
      <LibroDeReglasView libro={libro} problemas={revisarLibro(libro)} />
    </div>
  );
}
