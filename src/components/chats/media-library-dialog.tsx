"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, Trash2, Upload, Video } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  agregarABibliotecaAction,
  borrarDeBibliotecaAction,
  listarBibliotecaAction,
  marcarEnvioDeBibliotecaAction,
  type MediaLibraryItemDto,
} from "@/app/actions/media-library-actions";

/**
 * BIBLIOTECA: mandar un catalogo que YA esta en el servidor.
 *
 * Esta pantalla existe por un motivo medido: con la señal de un celular en la calle, un catalogo
 * de 15 MB tarda entre 8 y 18 minutos en subir y la subida se corta antes de terminar. Como son
 * siempre los mismos archivos, subirlos una vez convierte el envio en una referencia a algo que ya
 * esta guardado: sale en un segundo, sin importar la señal.
 *
 * Por eso el boton de mandar NO sube nada. Lo unico que sube es "Agregar archivo", que se usa una
 * vez y conviene hacerlo desde una computadora.
 */
export function MediaLibraryDialog({
  open,
  onClose,
  uploadPath,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  /** La misma ruta de subida del chat: se usa solo al AGREGAR, no al mandar. */
  uploadPath: string;
  /** Manda el archivo ya subido por el camino normal del chat. */
  onSend: (item: MediaLibraryItemDto) => Promise<boolean>;
}) {
  const [items, setItems] = useState<MediaLibraryItemDto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const inputArchivo = useRef<HTMLInputElement | null>(null);
  const [filtro, setFiltro] = useState("");
  /**
   * El archivo que se esta mirando antes de mandarlo.
   *
   * Se mira ANTES y no se manda de un toque a proposito: hay ocho catalogos con nombres
   * parecidos, y mandarle el de camillas a alguien que pregunto por sillas cuesta mucho mas caro
   * que el segundo que tarda abrirlo.
   */
  const [mirando, setMirando] = useState<MediaLibraryItemDto | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const resultado = await listarBibliotecaAction();
      setItems(resultado.items ?? []);
    } catch {
      toast.error("No se pudo abrir la biblioteca");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void cargar();
    }
  }, [open, cargar]);

  const mandar = async (item: MediaLibraryItemDto) => {
    setEnviando(item.id);
    try {
      const salio = await onSend(item);
      if (salio) {
        void marcarEnvioDeBibliotecaAction({ id: item.id });
        setMirando(null);
        onClose();
      }
    } finally {
      setEnviando(null);
    }
  };

  // Al cerrar y volver a abrir se arranca siempre en la lista, no en lo ultimo que se miro.
  useEffect(() => {
    if (!open) {
      setMirando(null);
      setFiltro("");
    }
  }, [open]);

  const agregar = async (file: File) => {
    setSubiendo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const respuesta = await fetch(uploadPath, { method: "POST", body: formData });
      const datos = (await respuesta.json().catch(() => null)) as
        | { url?: string; fileName?: string; mimeType?: string; mediaType?: string; error?: string }
        | null;

      if (!respuesta.ok || !datos?.url || !datos.mediaType) {
        toast.error(datos?.error || "No se pudo subir el archivo. Probá desde la computadora.");
        return;
      }

      const guardado = await agregarABibliotecaAction({
        title: file.name.replace(/\.[^.]+$/, ""),
        url: datos.url,
        fileName: datos.fileName || file.name,
        mimeType: datos.mimeType || file.type,
        mediaType: datos.mediaType,
        sizeBytes: file.size,
      });

      if (guardado?.error) {
        toast.error(guardado.error);
        return;
      }

      toast.success("Guardado. Ya podés mandarlo desde cualquier chat.");
      await cargar();
    } catch {
      // La subida se corta cuando la señal es mala: decirlo asi evita que se busque el problema
      // en el archivo o en el chat, que es donde no esta.
      toast.error("Se cortó la subida. Con señal débil, subilo desde la computadora.");
    } finally {
      setSubiendo(false);
    }
  };

  const borrar = async (item: MediaLibraryItemDto) => {
    const resultado = await borrarDeBibliotecaAction({ id: item.id });
    if (resultado?.error) {
      toast.error(resultado.error);
      return;
    }
    setItems((actual) => actual.filter((otro) => otro.id !== item.id));
  };

  const visibles = filtro.trim()
    ? items.filter((item) => item.title.toLowerCase().includes(filtro.trim().toLowerCase()))
    : items;

  const icono = (tipo: MediaLibraryItemDto["mediaType"]) => {
    if (tipo === "IMAGE") return <ImageIcon className="size-4 shrink-0 text-sky-500" />;
    if (tipo === "VIDEO") return <Video className="size-4 shrink-0 text-violet-500" />;
    return <FileText className="size-4 shrink-0 text-rose-500" />;
  };

  if (mirando) {
    return (
      <Dialog open={open} onOpenChange={(estado) => !estado && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b p-4 text-left">
            <DialogTitle className="text-sm">{mirando.title}</DialogTitle>
            <DialogDescription className="text-xs">
              Mirá que sea el correcto antes de mandarlo.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto bg-muted/40 p-3">
            {mirando.mediaType === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mirando.url}
                alt={mirando.title}
                className="mx-auto max-h-[50vh] w-auto rounded-lg object-contain"
              />
            ) : mirando.mediaType === "VIDEO" ? (
              <video src={mirando.url} controls className="mx-auto max-h-[50vh] w-full rounded-lg" />
            ) : (
              <>
                {/* El visor de PDF embebido no funciona en todos los celulares —algunos lo bajan
                    en vez de mostrarlo—, por eso siempre va el enlace de abajo como salida. */}
                <iframe
                  src={mirando.url}
                  title={mirando.title}
                  className="h-[45vh] w-full rounded-lg border bg-background"
                />
                <a
                  href={mirando.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block text-center text-[11px] text-muted-foreground underline underline-offset-2"
                >
                  ¿No se ve? Abrilo en otra pestaña
                </a>
              </>
            )}
          </div>

          <div className="flex gap-2 border-t p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setMirando(null)}
            >
              Volver
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1 gap-2"
              disabled={enviando !== null}
              onClick={() => void mandar(mirando)}
            >
              {enviando === mirando.id ? <Loader2 className="size-4 animate-spin" /> : null}
              Enviar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(estado) => !estado && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b p-4 text-left">
          <DialogTitle className="text-sm">Biblioteca</DialogTitle>
          <DialogDescription className="text-xs">
            Se manda al instante: el archivo ya está guardado, no se sube nada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 p-3">
          <Input
            value={filtro}
            onChange={(evento) => setFiltro(evento.target.value)}
            placeholder="Buscar…"
            className="h-9"
          />

          <div className="max-h-[45vh] space-y-1 overflow-y-auto">
            {cargando ? (
              <p className="p-4 text-center text-xs text-muted-foreground">Abriendo…</p>
            ) : visibles.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                {items.length === 0
                  ? "Todavía no hay archivos. Agregá los catálogos desde la computadora y quedan listos para todo el equipo."
                  : "Nada con ese nombre."}
              </p>
            ) : (
              visibles.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-muted"
                >
                  {/* Miniatura para las imagenes: entre ocho catalogos con nombres parecidos, se
                      reconoce mucho mas rapido por la tapa que por el titulo. */}
                  {item.mediaType === "IMAGE" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.url}
                      alt=""
                      className="size-9 shrink-0 rounded-md border object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
                      {icono(item.mediaType)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setMirando(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-[13px] text-foreground">{item.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                      {item.sizeBytes > 0 ? `${Math.max(1, Math.round(item.sizeBytes / (1024 * 1024)))} MB` : ""}
                      {item.sentCount > 0 ? ` · enviado ${item.sentCount} ${item.sentCount === 1 ? "vez" : "veces"}` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    title={`Quitar "${item.title}" de la biblioteca`}
                    onClick={() => void borrar(item)}
                    className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-background hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t p-3">
          <input
            ref={inputArchivo}
            type="file"
            className="hidden"
            accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf"
            onChange={(evento) => {
              const file = evento.target.files?.[0];
              evento.target.value = "";
              if (file) {
                void agregar(file);
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2"
            disabled={subiendo}
            onClick={() => inputArchivo.current?.click()}
          >
            {subiendo ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {subiendo ? "Subiendo…" : "Agregar archivo"}
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Agregalo una vez desde la computadora y queda disponible para todas.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
