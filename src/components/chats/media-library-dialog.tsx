"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, Image as ImageIcon, Loader2, Trash2, Upload, Video } from "lucide-react";
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
import { subirArchivoPorPedazos } from "@/lib/subir-archivo-por-pedazos";
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
 * Por eso el boton de mandar NO sube nada. Lo unico que sube es "Agregar archivo", que ademas va
 * por pedazos con reintento, asi que tambien funciona desde el celular con mala señal.
 */
export function MediaLibraryDialog({
  open,
  onClose,
  uploadPath,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  /** Base de la ruta de subida del chat: se usa solo al AGREGAR (con /chunk), no al mandar. */
  uploadPath: string;
  /** Manda el archivo ya subido por el camino normal del chat. */
  onSend: (item: MediaLibraryItemDto) => Promise<boolean>;
}) {
  const [items, setItems] = useState<MediaLibraryItemDto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [avance, setAvance] = useState(0);
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
    setAvance(0);
    try {
      // Por pedazos SIEMPRE, tambien desde la computadora: es el mismo camino para todos, asi el
      // que funciona es el que esta probado. Un segundo camino "para archivos chicos" seria un
      // segundo lugar donde se rompen las subidas.
      const resultado = await subirArchivoPorPedazos({
        file,
        endpoint: `${uploadPath}/chunk`,
        onAvance: setAvance,
      });

      if (resultado.error || !resultado.archivo) {
        toast.error(resultado.error || "No se pudo subir el archivo.");
        return;
      }

      const guardado = await agregarABibliotecaAction({
        title: file.name.replace(/\.[^.]+$/, ""),
        url: resultado.archivo.url,
        fileName: resultado.archivo.fileName,
        mimeType: resultado.archivo.mimeType,
        mediaType: resultado.archivo.mediaType,
        sizeBytes: file.size,
      });

      if (guardado?.error) {
        toast.error(guardado.error);
        return;
      }

      toast.success("Guardado. Ya podés mandarlo desde cualquier chat.");
      await cargar();
    } finally {
      setSubiendo(false);
      setAvance(0);
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
        {/* Misma ventana que la lista: al abrir un archivo se sigue estando en la biblioteca, no
            aparece una tarjeta distinta encima. */}
        <DialogContent
          showCloseButton={false}
          className="inset-0 top-0 left-0 flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ring-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[85vh] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:ring-1"
        >
          <DialogHeader className="flex-row items-center gap-2 border-b p-3 text-left sm:p-4">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setMirando(null)}
              aria-label="Volver a la biblioteca"
              className="shrink-0"
            >
              <ArrowLeft className="size-5" />
            </Button>
            <div className="min-w-0">
              <DialogTitle className="truncate text-sm">{mirando.title}</DialogTitle>
              <DialogDescription className="text-xs">
                Mirá que sea el correcto antes de mandarlo.
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 p-3">
            {mirando.mediaType === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mirando.url}
                alt={mirando.title}
                className="mx-auto max-h-full w-auto rounded-lg object-contain"
              />
            ) : mirando.mediaType === "VIDEO" ? (
              <video src={mirando.url} controls className="mx-auto max-h-full w-full rounded-lg" />
            ) : (
              <>
                {/* El visor de PDF embebido no funciona en todos los celulares —algunos lo bajan
                    en vez de mostrarlo—, por eso siempre va el enlace de abajo como salida. */}
                <iframe
                  src={mirando.url}
                  title={mirando.title}
                  className="h-full min-h-[55vh] w-full rounded-lg border bg-background"
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
              size="sm"
              className="w-full gap-2"
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
      {/*
        Ventana, no tarjeta flotante: la biblioteca es una pantalla donde se BUSCA entre archivos,
        y en un celular una tarjeta al medio deja ver dos o tres. Ocupando la pantalla entra la
        grilla completa, como cualquier explorador de archivos.
      */}
      <DialogContent
        showCloseButton={false}
        className="inset-0 top-0 left-0 flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ring-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[80vh] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:ring-1"
      >
        <DialogHeader className="flex-row items-center gap-2 border-b p-3 text-left sm:p-4">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Volver al chat"
            className="shrink-0 sm:hidden"
          >
            <ArrowLeft className="size-5" />
          </Button>
          <DialogTitle className="text-sm">Biblioteca</DialogTitle>
          {/* Sin subtitulo: explicar como funciona ocupaba dos renglones en cada apertura, y lo
              que hace falta ver son los archivos. */}
          <DialogDescription className="sr-only">
            Archivos guardados para mandar a un chat.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <Input
            value={filtro}
            onChange={(evento) => setFiltro(evento.target.value)}
            placeholder="Buscar…"
            className="h-9"
          />

          {/* En grilla y con tapa, como Drive: los catalogos se reconocen por la portada mucho
              antes que por el titulo, y aca todos empiezan igual ("CATALOGO ..."). Una lista de
              renglones obliga a leer ocho nombres parecidos para encontrar uno. */}
          <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto sm:max-h-[48vh]">
            {cargando ? (
              <p className="col-span-2 p-4 text-center text-xs text-muted-foreground">Abriendo…</p>
            ) : visibles.length === 0 ? (
              <p className="col-span-2 p-4 text-center text-xs text-muted-foreground">
                {items.length === 0
                  ? "Todavía no hay archivos. Agregá tus catálogos y quedan listos para todo el equipo."
                  : "Nada con ese nombre."}
              </p>
            ) : (
              visibles.map((item) => (
                <div
                  key={item.id}
                  className="group relative overflow-hidden rounded-xl border transition hover:border-foreground/20"
                >
                  <button
                    type="button"
                    onClick={() => setMirando(item)}
                    className="block w-full text-left"
                  >
                    <span className="flex h-28 items-center justify-center overflow-hidden bg-muted/50">
                      {item.mediaType === "IMAGE" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.url}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="scale-[2.2]">{icono(item.mediaType)}</span>
                      )}
                    </span>
                    <span className="block px-2 pb-2 pt-1.5">
                      <span className="block truncate text-[12px] font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                        {item.sizeBytes > 0
                          ? `${Math.max(1, Math.round(item.sizeBytes / (1024 * 1024)))} MB`
                          : ""}
                        {item.sentCount > 0 ? ` · ${item.sentCount}×` : ""}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    title={`Quitar "${item.title}" de la biblioteca`}
                    onClick={() => void borrar(item)}
                    className="absolute right-1 top-1 rounded-full bg-background/90 p-1.5 text-muted-foreground opacity-0 transition hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
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
            {subiendo ? `Subiendo… ${Math.round(avance * 100)}%` : "Agregar archivo"}
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            {subiendo
              ? "Va por partes: si se corta la señal, sigue desde donde quedó."
              : "Agregalo una vez y queda disponible para todo el equipo."}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
