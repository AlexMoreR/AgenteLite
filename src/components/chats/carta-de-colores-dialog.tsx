"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Palette, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listarCartaParaChatAction } from "@/app/actions/carta-de-colores-actions";
import {
  ELECCION_TODOS,
  imagenesParaMandar,
  mandarEnOrden,
  type ImagenPorMandar,
  type MaterialDeCartaParaChat,
} from "@/lib/carta-de-colores-chat";

/**
 * CARTA DE COLORES en el chat (parte 4).
 *
 * La asesora escoge un material (o "Todos") y pulsa Enviar. Recién ahí se arma la lista y se mandan
 * las imágenes una por una por el mismo camino que la Biblioteca. Solo la última lleva el texto que
 * le pide al cliente el código del color. Si se cierra sin pulsar Enviar, no sale nada: no hay
 * ningún envío automático.
 */
export function CartaDeColoresDialog({
  open,
  onClose,
  mandarImagen,
  onEnviada,
}: {
  open: boolean;
  onClose: () => void;
  /** Manda UNA imagen al chat abierto, con la misma llamada que usa la Biblioteca. */
  mandarImagen: (imagen: ImagenPorMandar) => Promise<{ ok: true } | { error: string }>;
  /** Lo que el panel hace cuando sale un mensaje (bajar al final del chat). */
  onEnviada: () => void;
}) {
  const [materiales, setMateriales] = useState<MaterialDeCartaParaChat[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null);
  const [eleccion, setEleccion] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<{ actual: number; total: number } | null>(null);
  const [errorDeEnvio, setErrorDeEnvio] = useState<string | null>(null);
  // Candado inmediato: dos toques seguidos llegan antes de que el botón se vea deshabilitado.
  const enCurso = useRef(false);

  useEffect(() => {
    if (!open) return;
    // El panel lo monta solo mientras está abierto: cada vez arranca en "cargando" sin tocar el estado acá.
    let vigente = true;
    listarCartaParaChatAction()
      .then((lista) => {
        if (vigente) setMateriales(lista);
      })
      .catch(() => {
        if (vigente) setErrorDeCarga("No se pudo abrir la carta. Revisa la conexión y vuelve a abrirla.");
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [open]);

  const cerrar = () => {
    // Mientras sale no se cierra: si se cerrara, la asesora no vería si alguna falló.
    if (enCurso.current) return;
    setEleccion(null);
    setErrorDeEnvio(null);
    onClose();
  };

  const enviar = async () => {
    if (!eleccion || enCurso.current) return;
    const imagenes = imagenesParaMandar(materiales, eleccion);
    if (imagenes.length === 0) {
      setErrorDeEnvio("Ese material no tiene imágenes para mandar.");
      return;
    }
    enCurso.current = true;
    setErrorDeEnvio(null);
    setEnviando({ actual: 1, total: imagenes.length });
    const resultado = await mandarEnOrden(imagenes, async (imagen, indice) => {
      setEnviando({ actual: indice + 1, total: imagenes.length });
      const salio = await mandarImagen(imagen);
      if ("ok" in salio && salio.ok) onEnviada();
      return salio;
    });
    enCurso.current = false;
    setEnviando(null);
    if (resultado.error) {
      const faltan = imagenes.length - resultado.enviadas;
      setErrorDeEnvio(
        `${resultado.error} ${resultado.enviadas > 0 ? `Salieron ${resultado.enviadas}; ` : ""}no se mandaron las ${faltan} que faltaban.`,
      );
      return;
    }
    toast.success(imagenes.length === 1 ? "Carta enviada" : `Carta enviada (${imagenes.length} imágenes)`);
    setEleccion(null);
    onClose();
  };

  const opciones: Array<{ id: string; nombre: string; miniatura: string | null; cuantas: number }> = [
    ...(materiales.length > 1
      ? [
          {
            id: ELECCION_TODOS,
            nombre: "Todos",
            miniatura: null,
            cuantas: materiales.reduce((total, m) => total + m.imagenesUrl.length, 0),
          },
        ]
      : []),
    ...materiales.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      miniatura: m.imagenesUrl[0] ?? null,
      cuantas: m.imagenesUrl.length,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={(estado) => !estado && cerrar()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Carta de colores</DialogTitle>
          <DialogDescription>Escoge qué carta mandarle al cliente y pulsa Enviar.</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Cargando la carta…
            </div>
          ) : errorDeCarga ? (
            <p className="py-10 text-center text-sm text-destructive">{errorDeCarga}</p>
          ) : opciones.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Todavía no hay carta cargada</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {opciones.map((opcion) => {
                const elegida = eleccion === opcion.id;
                return (
                  <button
                    key={opcion.id}
                    type="button"
                    disabled={Boolean(enviando)}
                    aria-pressed={elegida}
                    onClick={() => {
                      setEleccion(opcion.id);
                      setErrorDeEnvio(null);
                    }}
                    className={`relative flex flex-col overflow-hidden rounded-lg border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                      elegida ? "border-primary ring-2 ring-primary" : "border-border hover:bg-muted"
                    }`}
                  >
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted">
                      {opcion.miniatura ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={opcion.miniatura} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <Palette className="size-8 text-muted-foreground" />
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="truncate text-[13px] font-medium text-foreground">{opcion.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {opcion.cuantas === 1 ? "1 imagen" : `${opcion.cuantas} imágenes`}
                      </p>
                    </div>
                    {elegida ? (
                      <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {errorDeEnvio ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorDeEnvio}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={cerrar} disabled={Boolean(enviando)}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void enviar()} disabled={!eleccion || Boolean(enviando) || cargando}>
            {enviando ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {enviando.total > 1 ? `Enviando ${enviando.actual} de ${enviando.total}…` : "Enviando…"}
              </>
            ) : (
              <>
                <Send className="size-4" />
                Enviar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
