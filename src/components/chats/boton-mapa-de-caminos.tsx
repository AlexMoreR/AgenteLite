"use client";

import * as React from "react";
import Link from "next/link";
import { GitBranch, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { agregarChatAlMapaDeCaminosAction } from "@/app/actions/diagram-actions";

/**
 * Suma esta conversación al mapa de caminos de los clientes.
 *
 * No dibuja este chat aparte: lo funde en un ÚNICO mapa donde los pasos iguales se apilan. Un chat
 * solo son cuarenta cajas que no se comparan con nada; treinta chats fundidos dicen "24 preguntan
 * precio, 18 piden envío, 3 compran", que es donde se ve por dónde se cae la venta.
 *
 * Lleva pantalla de espera porque no es instantáneo: hay que leer la conversación entera y
 * resumirla con IA, y son varios segundos. Sin algo que lo diga, el botón parece roto y se aprieta
 * de nuevo —y cada apretón cuesta plata—.
 */
export function BotonDeMapaDeCaminos({ conversationId }: { conversationId: string }) {
  const [trabajando, setTrabajando] = React.useState(false);
  const [listo, setListo] = React.useState<{ diagramId: string; pasos: number } | null>(null);

  const generar = async () => {
    setTrabajando(true);
    try {
      const resultado = await agregarChatAlMapaDeCaminosAction({ conversationId });
      if (resultado?.error) {
        toast.error(resultado.error);
        return;
      }
      if (resultado?.yaEstaba) {
        toast.info("Este chat ya estaba en el mapa");
        return;
      }
      if (resultado?.diagramId) {
        setListo({ diagramId: resultado.diagramId, pasos: resultado.pasos ?? 0 });
      }
    } catch {
      toast.error("No se pudo armar el mapa");
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={trabajando}
        onClick={() => void generar()}
        className="h-8 w-8"
        aria-label="Sumar este chat al mapa de caminos"
        title="Sumar este chat al mapa de caminos"
      >
        {trabajando ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GitBranch className="h-3.5 w-3.5" />
        )}
      </Button>

      {/* La espera se muestra encima y bloquea: evita que se aprete dos veces y se pague dos veces. */}
      <Dialog open={trabajando}>
        <DialogContent showCloseButton={false} className="sm:max-w-xs">
          <DialogTitle className="sr-only">Armando el mapa</DialogTitle>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <LoaderCircle className="size-7 animate-spin text-[var(--primary)]" />
            <p className="text-sm font-medium text-foreground">Leyendo la conversación…</p>
            <p className="text-xs text-muted-foreground">
              La IA la resume en pasos y los suma al mapa. Tarda unos segundos.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(listo)} onOpenChange={(abierto) => (abierto ? null : setListo(null))}>
        <DialogContent className="sm:max-w-sm">
          <DialogTitle>Sumado al mapa</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Esta conversación entró como {listo?.pasos ?? 0} paso
            {(listo?.pasos ?? 0) === 1 ? "" : "s"}. Los pasos que ya hacían otros clientes se
            juntaron en la misma caja.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setListo(null)}>
              Seguir acá
            </Button>
            {listo ? (
              <Link
                href={`/cliente/diagramas/${listo.diagramId}`}
                className="inline-flex items-center justify-center rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                Ver el mapa
              </Link>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
