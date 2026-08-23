"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CheckCircle2, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Vincular el WhatsApp de las llamadas, con el mismo gesto que un canal de chat.
 *
 * El QR de WaCalls se renueva cada ~20 segundos y no se puede pedir a demanda: nuestra ruta se
 * queda esperando el próximo y lo devuelve. Por eso esto es un bucle de preguntar-y-mostrar
 * mientras el diálogo está abierto, y no una sola llamada.
 */
export function VincularLlamadasDialog({
  abierto,
  onOpenChange,
}: {
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
}) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [vinculado, setVinculado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Corta el bucle cuando se cierra el diálogo: sin esto seguiría pidiendo QR para siempre.
  const vivoRef = useRef(false);

  const escuchar = useCallback(async () => {
    while (vivoRef.current) {
      try {
        const respuesta = await fetch("/api/wacalls/vincular", { cache: "no-store" });
        const data = (await respuesta.json().catch(() => null)) as {
          qr?: string | null;
          vinculado?: boolean;
          error?: string;
        } | null;

        if (!vivoRef.current) {
          return;
        }
        if (!respuesta.ok) {
          setError(data?.error || "No se pudo hablar con el servicio de llamadas.");
          return;
        }
        if (data?.vinculado) {
          setVinculado(true);
          setQr(null);
          toast.success("Línea de llamadas vinculada");
          // La tarjeta de Conexión lee el estado en el servidor: hay que refrescar para que
          // aparezca el número en vez de "sin número vinculado".
          router.refresh();
          return;
        }
        if (data?.qr) {
          setQr(data.qr);
        }
      } catch {
        if (!vivoRef.current) {
          return;
        }
        setError("Se perdió la conexión con el servicio de llamadas.");
        return;
      }
    }
  }, [router]);

  /**
   * El dialogo se MONTA al abrirse (ver BotonVincularLlamadas), asi que el estado ya nace limpio
   * y no hay que reiniciarlo a mano: un QR viejo no puede sobrevivir de una apertura a la otra.
   */
  useEffect(() => {
    if (!abierto) {
      vivoRef.current = false;
      return;
    }

    vivoRef.current = true;

    void (async () => {
      const arranque = await fetch("/api/wacalls/vincular", { method: "POST" }).catch(() => null);
      if (!vivoRef.current) {
        return;
      }
      if (!arranque?.ok) {
        const data = (await arranque?.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "No se pudo iniciar la vinculación.");
        return;
      }
      await escuchar();
    })();

    return () => {
      vivoRef.current = false;
    };
  }, [abierto, escuchar]);

  return (
    <Dialog open={abierto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Vincular la línea de llamadas</DialogTitle>
          <DialogDescription>
            Escaneá el código desde el WhatsApp del número con el que vas a llamar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
          {error ? (
            <p className="px-4 text-center text-sm text-rose-600">{error}</p>
          ) : vinculado ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="size-10 text-emerald-600" />
              <p className="text-sm font-medium">Listo, ya podés llamar desde los chats.</p>
            </div>
          ) : qr ? (
            <>
              <Image
                src={qr}
                alt="Código QR para vincular la línea de llamadas"
                width={280}
                height={280}
                unoptimized
                className="rounded-lg border border-border bg-white p-2"
              />
              <ol className="space-y-1 text-xs text-muted-foreground">
                <li>1. Abrí WhatsApp en el teléfono</li>
                <li>2. Menú → Dispositivos vinculados</li>
                <li>3. Escaneá este código</li>
              </ol>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              <p className="text-xs">Generando el código…</p>
            </div>
          )}
        </div>

        {error ? (
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function BotonVincularLlamadas({ etiqueta }: { etiqueta: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAbierto(true)}>
        <QrCode className="mr-1.5 size-4" />
        {etiqueta}
      </Button>
      {abierto ? <VincularLlamadasDialog abierto onOpenChange={setAbierto} /> : null}
    </>
  );
}
