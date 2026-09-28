import type { Metadata } from "next";

import { cambiarBanderaDeRescateAction } from "@/app/actions/agente-v3-actions";
import { LibroDeReglasView } from "@/features/agente-v3/components/LibroDeReglasView";
import { revisarLibro } from "@/features/agente-v3/domain/reglas";
import { leerLibro } from "@/features/agente-v3/servicios/almacen";
import { rescateEncendido } from "@/features/agente-v3/servicios/rescate-de-mensajes";
import { FormActionSwitch } from "@/components/ui/form-action-switch";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/*
  El libro de reglas del Agente V3, para mirarlo mientras se dicta por Claude.

  Solo dueño o administrador: son las reglas con las que se vende. Es de lectura: editar se hace
  hablando, y esta pantalla es donde se comprueba que quedó lo que se pidió (Alex, 21-sep-2026).
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

  const [libro, rescate] = await Promise.all([
    leerLibro(access.workspaceId),
    rescateEncendido(access.workspaceId),
  ]);

  return (
    <div className="space-y-4">
      {/*
        El interruptor del rescate de mensajes.

        Vive en esta pantalla y no en una variable de entorno porque tiene que poder apagarse EN EL
        ACTO, con clientes de verdad delante, sin reiniciar el servidor (Alex, 28-09-2026).
      */}
      <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">Rescatar mensajes perdidos</p>
          <p className="text-xs text-muted-foreground">
            Si un mensaje del cliente se pierde —el servidor se cae o se está actualizando— el agente lo
            vuelve a mirar a los 3 minutos. Nunca toca un chat que ya tiene asesora ni uno con la IA pausada.
          </p>
        </div>
        <FormActionSwitch
          action={cambiarBanderaDeRescateAction}
          checked={rescate}
          ariaLabel="Rescatar mensajes perdidos"
          hiddenFields={[{ name: "encendido", value: String(rescate) }]}
        />
      </div>

      <LibroDeReglasView libro={libro} problemas={revisarLibro(libro)} />
    </div>
  );
}
