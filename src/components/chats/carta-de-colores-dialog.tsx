"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Palette, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { hayVersionNueva } from "@/components/app-version-guard";
import { listarCartaParaChatAction } from "@/app/actions/carta-de-colores-actions";
import {
  imagenesDeCartaParaEnviar,
  OPCION_TODOS,
  type MaterialDeCartaParaChat,
} from "@/lib/carta-de-colores-envio";

/** Lo que el envío necesita del chat abierto: lo mismo que usa la Biblioteca (el `media` del compositor). */
type EnvioDelChat = {
  conversationId: string;
  source: string;
  agentId: string;
  returnTo: string;
  sendAction: (input: {
    source: string;
    conversationId: string;
    agentId: string;
    mediaUrl: string;
    mediaType: "IMAGE" | "VIDEO" | "DOCUMENT";
    fileName: string;
    mimeType: string;
    caption?: string;
    returnTo: string;
  }) => Promise<{ ok: true } | { error: string }>;
};

/**
 * CARTA DE COLORES: mandar la carta a mano desde el chat.
 *
 * Nada sale solo: se escoge un material (o "Todos") y recién al pulsar "Enviar" se mandan sus
 * imágenes, de a una y en orden, por el mismo camino que una foto de la Biblioteca. La última lleva
 * el texto que le pide al cliente el código del color. Si una falla, se paran las que faltan y se
 * muestra el motivo (por ejemplo, la ventana de 24 h de la API oficial).
 */
export function CartaDeColoresDialog({
  open,
  onClose,
  envio,
  onEnviado,
}: {
  open: boolean;
  onClose: () => void;
  envio: EnvioDelChat;
  /** Lo que el chat hace después de mandar algo (bajar al último mensaje). */
  onEnviado: () => void;
}) {
  const [materiales, setMateriales] = useState<MaterialDeCartaParaChat[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorAlCargar, setErrorAlCargar] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<{ actual: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Candado sincrónico: dos toques rápidos llegan antes de que React pinte el botón deshabilitado.
  const enviandoAhora = useRef(false);

  useEffect(() => {
    if (!open) return;
    let vigente = true;
    setCargando(true);
    setErrorAlCargar(false);
    setElegido(null);
    setError(null);
    listarCartaParaChatAction()
      .then((lista) => {
        if (vigente) setMateriales(lista);
      })
      .catch(() => {
        if (vigente) setErrorAlCargar(true);
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [open]);

  const totalDeTodos = materiales.reduce((suma, material) => suma + material.imagenesUrl.length, 0);
  const opciones = [
    ...(materiales.length > 0
      ? [{ id: OPCION_TODOS, nombre: "Todos", imagenes: totalDeTodos, miniatura: materiales[0]?.imagenesUrl[0] ?? null }]
      : []),
    ...materiales.map((material) => ({
      id: material.id,
      nombre: material.nombre,
      imagenes: material.imagenesUrl.length,
      miniatura: material.imagenesUrl[0] ?? null,
    })),
  ];

  const enviar = async () => {
    // La lista se arma recién acá, al pulsar Enviar, y en el orden de la pantalla.
    const imagenes = imagenesDeCartaParaEnviar(materiales, elegido);
    if (imagenes.length === 0 || enviandoAhora.current) return;
    enviandoAhora.current = true;
    setError(null);
    let salieron = 0;
    try {
      for (const [indice, imagen] of imagenes.entries()) {
        setEnviando({ actual: indice + 1, total: imagenes.length });
        // Los mismos datos con los que el chat manda una foto de la Biblioteca, más el texto en la última.
        const resultado = await envio.sendAction({
          source: envio.source,
          conversationId: envio.conversationId,
          agentId: envio.agentId,
          mediaUrl: imagen.url,
          mediaType: "IMAGE",
          fileName: imagen.fileName,
          mimeType: "image/png",
          caption: imagen.caption,
          returnTo: envio.returnTo,
        });
        if (!resultado || !("ok" in resultado) || !resultado.ok) {
          const motivo = (resultado && "error" in resultado && resultado.error) || "No se pudo enviar la carta.";
          setError(salieron > 0 ? `${motivo} Salieron ${salieron} de ${imagenes.length}; las demás no se mandaron.` : motivo);
          return;
        }
        salieron += 1;
        onEnviado();
      }
      onClose();
    } catch {
      if (await hayVersionNueva()) {
        toast.error("Actualizamos la app. Recarga y vuelve a mandarla.", {
          duration: 15000,
          action: { label: "Recargar", onClick: () => window.location.reload() },
        });
      }
      setError(
        `No se envió la carta. Revisa la conexión y vuelve a intentarlo.${
          salieron > 0 ? ` Salieron ${salieron} de ${imagenes.length}.` : ""
        }`,
      );
    } finally {
      enviandoAhora.current = false;
      setEnviando(null);
    }
  };

  const hayImagenesElegidas = imagenesDeCartaParaEnviar(materiales, elegido).length > 0;

  return (
    // Mientras se envía no se cierra: si no, las que faltan seguirían saliendo sin que se vea.
    <Dialog open={open} onOpenChange={(estado) => !estado && !enviando && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b p-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Palette className="size-4 text-[#ec4899]" />
            Carta de colores
          </DialogTitle>
          <DialogDescription className="text-xs">Escoge qué carta mandarle al cliente.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {cargando ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Abriendo…</p>
          ) : errorAlCargar ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              No se pudo abrir la carta de colores. Cierra y vuelve a intentarlo.
            </p>
          ) : opciones.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Todavía no hay carta cargada.</p>
          ) : (
            <ul className="flex flex-col gap-1" role="radiogroup" aria-label="Carta para mandar">
              {opciones.map((opcion) => {
                const activo = elegido === opcion.id;
                return (
                  <li key={opcion.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={activo}
                      disabled={enviando !== null}
                      onClick={() => {
                        setElegido(opcion.id);
                        setError(null);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg border px-2 py-1.5 text-left transition disabled:opacity-60 ${
                        activo ? "border-[var(--primary)] bg-[var(--primary)]/10" : "border-transparent hover:bg-muted"
                      }`}
                    >
                      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/50">
                        {opcion.miniatura ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={opcion.miniatura}
                            alt=""
                            className="size-full object-cover object-top"
                            loading="lazy"
                            draggable={false}
                          />
                        ) : (
                          <Palette className="size-5 text-muted-foreground" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
                          {opcion.nombre}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground tabular-nums">
                          {opcion.imagenes === 1 ? "1 imagen" : `${opcion.imagenes} imágenes`}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                          activo ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-border"
                        }`}
                      >
                        {activo ? <Check className="size-3" strokeWidth={3} /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error ? (
          <p role="alert" className="mx-3 mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] leading-4 text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-2 border-t p-3">
          <Button type="button" variant="outline" size="sm" disabled={enviando !== null} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            className="flex-1 gap-2"
            disabled={enviando !== null || !hayImagenesElegidas}
            onClick={() => void enviar()}
          >
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {enviando ? `Enviando ${enviando.actual} de ${enviando.total}…` : "Enviar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
