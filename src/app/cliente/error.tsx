"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Pantalla de error del área de cliente (chats, CRM, contactos...).
 *
 * Sin esto, cualquier excepción del servidor dejaba la pantalla EN BLANCO con el texto crudo
 * de Next ("Application error: a server-side exception has occurred"). Para una asesora en
 * medio de una venta eso es indistinguible de "el CRM se cayó": cierra y se va a WhatsApp,
 * que es justo lo que no queremos.
 *
 * Ahora el fallo queda contenido: la barra lateral sigue ahí (esto reemplaza solo el
 * contenido), se explica en castellano y hay un botón para reintentar sin recargar. El
 * código de error se muestra porque es el ÚNICO dato que conecta lo que vio la asesora con
 * el log del servidor: sin él, un reporte de "me salió error" no se puede rastrear.
 */
export default function ClienteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[cliente] error de pantalla", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 text-center">
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-amber-50">
          <TriangleAlert className="size-5 text-amber-600" />
        </div>

        <h1 className="text-base font-semibold text-foreground">No se pudo cargar esta pantalla</h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          Fue una falla al cargar, no se perdió ningún mensaje ni ningún dato. Probá de nuevo; si
          vuelve a pasar, mandá una captura al grupo de errores.
        </p>

        <Button type="button" className="mt-4 w-full" onClick={() => reset()}>
          <RotateCcw className="size-4" />
          Reintentar
        </Button>

        {error.digest ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Código: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
