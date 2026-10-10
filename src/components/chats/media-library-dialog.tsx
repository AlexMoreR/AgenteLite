"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  Eye,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  MoreVertical,
  Send,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hayVersionNueva } from "@/components/app-version-guard";
import { subirArchivoPorPedazos } from "@/lib/subir-archivo-por-pedazos";
import { generarPortadaDePdf } from "@/lib/portada-de-pdf";
import { generarMiniaturaDeImagen } from "@/lib/miniatura-de-imagen";
import {
  agregarABibliotecaAction,
  borrarDeBibliotecaAction,
  listarBibliotecaAction,
  marcarEnvioDeBibliotecaAction,
  type MediaLibraryItemDto,
} from "@/app/actions/media-library-actions";

type Vista = "cuadricula" | "lista";
type Tipo = "todos" | MediaLibraryItemDto["mediaType"];

/** Los badges de abajo del buscador. Salen solos del tipo de archivo: no hay que clasificar nada. */
const TIPOS: Array<{ valor: Tipo; texto: string }> = [
  { valor: "todos", texto: "Todos" },
  { valor: "DOCUMENT", texto: "Catálogos" },
  { valor: "IMAGE", texto: "Fotos" },
  { valor: "VIDEO", texto: "Videos" },
];

const CLAVE_VISTA = "biblioteca:vista";

function leerVista(): Vista {
  try {
    return window.localStorage.getItem(CLAVE_VISTA) === "lista" ? "lista" : "cuadricula";
  } catch {
    return "cuadricula";
  }
}

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
  // Se pueden elegir varias fotos de la galeria de una: "2 de 5" dice por cual va.
  const [enCola, setEnCola] = useState<{ actual: number; total: number } | null>(null);
  // Cuadricula (con tapa) o lista (renglones, entran muchos mas). Se recuerda en ese aparato.
  const [vista, setVista] = useState<Vista>("cuadricula");
  const [tipo, setTipo] = useState<Tipo>("todos");
  /**
   * Varios archivos de una (Alex, 03-10-2026): manteniendo presionado uno se entra a elegir, y
   * despues cada toque suma o saca. En el orden en que se eligieron, que es el orden en que salen.
   */
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [enviandoVarios, setEnviandoVarios] = useState<{ actual: number; total: number } | null>(null);
  const temporizador = useRef<number | null>(null);
  const inicioDelToque = useRef<{ x: number; y: number } | null>(null);
  // El toque largo termina en un clic: sin esto, el mismo dedo que eligio abria el archivo.
  const fueToqueLargo = useRef(false);
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
      setVista(leerVista());
    }
  }, [open, cargar]);

  const cambiarVista = () => {
    const siguiente: Vista = vista === "cuadricula" ? "lista" : "cuadricula";
    setVista(siguiente);
    try {
      window.localStorage.setItem(CLAVE_VISTA, siguiente);
    } catch {
      // Sin almacenamiento (ventana privada): la vista vale solo mientras este abierta.
    }
  };

  const mandar = async (item: MediaLibraryItemDto) => {
    setEnviando(item.id);
    try {
      const salio = await onSend(item);
      if (salio) {
        void marcarEnvioDeBibliotecaAction({ id: item.id });
        setMirando(null);
        onClose();
      }
    } catch {
      // Antes no habia catch: si se cortaba la red o habia version nueva, la ruedita se apagaba
      // sin aviso y la asesora podia creer que el archivo salio.
      if (await hayVersionNueva()) {
        toast.error("Actualizamos la app. Recarga y vuelve a mandarlo.", {
          duration: 15000,
          action: { label: "Recargar", onClick: () => window.location.reload() },
        });
      } else {
        toast.error(`No se envió "${item.title}". Revisa la conexión y vuelve a intentarlo.`, { duration: 10000 });
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
      setTipo("todos");
      setSeleccion([]);
    }
  }, [open]);

  /** Sube y guarda UN archivo. Devuelve si quedo guardado; los avisos de error los da el mismo. */
  const agregar = async (file: File): Promise<boolean> => {
    setAvance(0);
    // Por pedazos SIEMPRE, tambien desde la computadora: es el mismo camino para todos, asi el
    // que funciona es el que esta probado. Un segundo camino "para archivos chicos" seria un
    // segundo lugar donde se rompen las subidas.
    const resultado = await subirArchivoPorPedazos({
      file,
      endpoint: `${uploadPath}/chunk`,
      onAvance: setAvance,
    });

    if (resultado.error || !resultado.archivo) {
      toast.error(`${file.name}: ${resultado.error || "no se pudo subir."}`);
      return false;
    }

    /**
     * La tapa se saca del archivo LOCAL, antes de tener nada en el servidor.
     *
     * Es lo que la hace gratis: leer 15 MB del disco del celular es instantaneo, bajarlos de
     * internet para dibujarlos seria justo el problema que vinimos a resolver. Si no sale
     * —PDF protegido, roto— el archivo se guarda igual y muestra el icono de siempre: una tapa
     * que falta no puede impedir mandar un catalogo.
     */
    let thumbnailUrl: string | null = null;
    const tapa =
      resultado.archivo.mediaType === "DOCUMENT" && file.type.includes("pdf")
        ? generarPortadaDePdf(file)
        : resultado.archivo.mediaType === "IMAGE"
          ? generarMiniaturaDeImagen(file)
          : null;
    if (tapa) {
      const portada = await tapa;
      if (portada) {
        const subidaPortada = await subirArchivoPorPedazos({
          file: portada,
          endpoint: `${uploadPath}/chunk`,
        });
        thumbnailUrl = subidaPortada.archivo?.url ?? null;
      }
    }

    const guardado = await agregarABibliotecaAction({
      title: file.name.replace(/\.[^.]+$/, ""),
      url: resultado.archivo.url,
      fileName: resultado.archivo.fileName,
      mimeType: resultado.archivo.mimeType,
      mediaType: resultado.archivo.mediaType,
      thumbnailUrl,
      sizeBytes: file.size,
    });

    if (guardado?.error) {
      toast.error(guardado.error);
      return false;
    }
    return true;
  };

  const agregarVarios = async (archivos: File[]) => {
    if (archivos.length === 0) return;
    setSubiendo(true);
    let guardados = 0;
    try {
      // De a uno y en orden: varias subidas a la vez con la señal de la calle se cortan todas.
      for (const [indice, archivo] of archivos.entries()) {
        setEnCola({ actual: indice + 1, total: archivos.length });
        if (await agregar(archivo)) guardados += 1;
      }
    } finally {
      setSubiendo(false);
      setAvance(0);
      setEnCola(null);
    }
    if (guardados > 0) {
      toast.success(
        guardados === 1
          ? "Guardado. Ya puedes mandarlo desde cualquier chat."
          : `${guardados} archivos guardados. Ya puedes mandarlos desde cualquier chat.`,
      );
      await cargar();
    }
  };

  const enSeleccion = seleccion.length > 0;

  const alternar = (id: string) =>
    setSeleccion((actual) => (actual.includes(id) ? actual.filter((otro) => otro !== id) : [...actual, id]));

  const soltarToque = () => {
    if (temporizador.current !== null) {
      window.clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    inicioDelToque.current = null;
  };

  /** Toque normal: abre el archivo (o, eligiendo, lo suma/saca). Mantener presionado: elige. */
  const toquesDe = (item: MediaLibraryItemDto) => ({
    onPointerDown: (evento: React.PointerEvent) => {
      if (evento.button !== 0) return;
      soltarToque();
      fueToqueLargo.current = false;
      inicioDelToque.current = { x: evento.clientX, y: evento.clientY };
      temporizador.current = window.setTimeout(() => {
        temporizador.current = null;
        fueToqueLargo.current = true;
        alternar(item.id);
        navigator.vibrate?.(15);
      }, 450);
    },
    // Si el dedo se mueve es que esta scrolleando, no eligiendo.
    onPointerMove: (evento: React.PointerEvent) => {
      const inicio = inicioDelToque.current;
      if (inicio && Math.hypot(evento.clientX - inicio.x, evento.clientY - inicio.y) > 8) soltarToque();
    },
    onPointerUp: soltarToque,
    onPointerLeave: soltarToque,
    onPointerCancel: soltarToque,
    // En el celular, mantener presionada una imagen abre el menu de "guardar imagen".
    onContextMenu: (evento: React.MouseEvent) => evento.preventDefault(),
    onClick: () => {
      if (fueToqueLargo.current) {
        fueToqueLargo.current = false;
        return;
      }
      if (enSeleccion) alternar(item.id);
      else setMirando(item);
    },
  });

  const enviarSeleccion = async () => {
    const elegidos = seleccion
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is MediaLibraryItemDto => Boolean(item));
    if (elegidos.length === 0) return;
    const fallaron: string[] = [];
    try {
      // De a uno y en orden, para que le lleguen a la clienta en el orden en que se eligieron.
      for (const [indice, item] of elegidos.entries()) {
        setEnviandoVarios({ actual: indice + 1, total: elegidos.length });
        if (await onSend(item)) void marcarEnvioDeBibliotecaAction({ id: item.id });
        else fallaron.push(item.id);
      }
    } finally {
      setEnviandoVarios(null);
    }
    if (fallaron.length === 0) {
      setSeleccion([]);
      onClose();
      return;
    }
    // Quedan elegidos solo los que no salieron, para reintentar sin volver a mandar los otros.
    setSeleccion(fallaron);
  };

  const menuDe = (item: MediaLibraryItemDto, claseDelBoton: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Opciones de "${item.title}"`}
          title="Opciones"
          className={claseDelBoton}
        >
          <MoreVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52 whitespace-nowrap">
        {/* onClick y no onSelect: el menu es de Base UI y onSelect no se dispara. */}
        <DropdownMenuItem onClick={() => setMirando(item)} className="gap-2">
          <Eye className="size-4" />
          Ver
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void mandar(item)} className="gap-2">
          <Send className="size-4" />
          Enviar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => alternar(item.id)} className="gap-2">
          <CheckSquare className="size-4" />
          Elegir varios
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void borrar(item)} className="gap-2">
          <Trash2 className="size-4" />
          Quitar de la biblioteca
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const marcaDeElegido = (item: MediaLibraryItemDto, posicion: string) =>
    enSeleccion ? (
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute ${posicion} flex size-5 items-center justify-center rounded-full border-2 shadow-sm ${
          seleccion.includes(item.id)
            ? "border-[var(--primary)] bg-[var(--primary)] text-white"
            : "border-white bg-black/20"
        }`}
      >
        {seleccion.includes(item.id) ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
    ) : null;

  const borrar = async (item: MediaLibraryItemDto) => {
    const resultado = await borrarDeBibliotecaAction({ id: item.id });
    if (resultado?.error) {
      toast.error(resultado.error);
      return;
    }
    setItems((actual) => actual.filter((otro) => otro.id !== item.id));
  };

  const buscado = filtro.trim().toLowerCase();
  const visibles = items.filter(
    (item) =>
      (tipo === "todos" || item.mediaType === tipo) && (!buscado || item.title.toLowerCase().includes(buscado)),
  );
  const cuantos = (valor: Tipo) =>
    valor === "todos" ? items.length : items.filter((item) => item.mediaType === valor).length;
  // Videos aparece solo si hay alguno; Catalogos y Fotos siempre, para que se vea que se pueden agregar.
  const tiposVisibles = TIPOS.filter((opcion) => opcion.valor !== "VIDEO" || cuantos("VIDEO") > 0);

  const tamano = (item: MediaLibraryItemDto) =>
    [
      item.sizeBytes > 0
        ? item.sizeBytes < 1024 * 1024
          ? `${Math.max(1, Math.round(item.sizeBytes / 1024))} KB`
          : `${Math.round(item.sizeBytes / (1024 * 1024))} MB`
        : "",
      item.sentCount > 0 ? `${item.sentCount}×` : "",
    ]
      .filter(Boolean)
      .join(" · ");

  const vacio = () => {
    if (items.length === 0) return "Todavía no hay archivos. Agrega tus catálogos y fotos y quedan listos para todo el equipo.";
    if (buscado) return "Nada con ese nombre.";
    if (tipo === "IMAGE") return "Todavía no hay fotos. Agrégalas con el botón de abajo.";
    if (tipo === "VIDEO") return "Todavía no hay videos.";
    return "Todavía no hay catálogos.";
  };

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
                Mira que sea el correcto antes de mandarlo.
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
                {/*
                  NADA de PDF incrustado: Chrome en Android no sabe dibujar un PDF dentro de un
                  iframe y lo DESCARGA. Abrir la vista previa terminaba bajando 15 MB al celular
                  de la asesora, que es justo lo que la biblioteca vino a evitar.

                  Se muestra la portada que ya se genero al agregarlo. Alcanza para lo unico que
                  se necesita aca: confirmar que es el catalogo correcto antes de mandarlo.
                */}
                {mirando.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mirando.thumbnailUrl}
                    alt={`Portada de ${mirando.title}`}
                    className="mx-auto max-h-full w-auto rounded-lg border bg-background object-contain"
                  />
                ) : (
                  <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
                    <FileText className="size-10 text-rose-500" />
                    <p className="text-xs text-muted-foreground">
                      Este archivo se agregó antes de que se guardaran las portadas.
                      <br />
                      Quítalo y vuelve a agregarlo para verla acá.
                    </p>
                  </div>
                )}
                <a
                  href={mirando.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block text-center text-[11px] text-muted-foreground underline underline-offset-2"
                >
                  Abrir el archivo completo
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
        {/* Sin titulo arriba (Alex, 03-10-2026): en el celular el renglon "Biblioteca" se comia
            espacio y lo primero que se usa es el buscador. El titulo queda para lectores de
            pantalla. */}
        <DialogHeader className="sr-only">
          <DialogTitle>Biblioteca</DialogTitle>
          <DialogDescription>Archivos guardados para mandar a un chat.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 border-b p-3">
          <div className="flex items-center gap-2">
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
            <Input
              value={filtro}
              onChange={(evento) => setFiltro(evento.target.value)}
              placeholder="Buscar en la biblioteca"
              aria-label="Buscar en la biblioteca"
              // 16px en el celular: por debajo de eso el iPhone hace zoom al tocar el campo.
              className="h-9 flex-1 text-[16px] md:text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={cambiarVista}
              aria-label={vista === "cuadricula" ? "Ver como lista" : "Ver como cuadrícula"}
              title={vista === "cuadricula" ? "Ver como lista" : "Ver como cuadrícula"}
              className="size-9 shrink-0"
            >
              {vista === "cuadricula" ? <List className="size-4" /> : <LayoutGrid className="size-4" />}
            </Button>
          </div>

          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">
            {tiposVisibles.map((opcion) => {
              const activo = tipo === opcion.valor;
              return (
                <button
                  key={opcion.valor}
                  type="button"
                  onClick={() => setTipo(opcion.valor)}
                  aria-pressed={activo}
                  className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition ${
                    activo
                      ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                      : "border-border bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  {opcion.texto}
                  <span className={`tabular-nums ${activo ? "text-white/80" : "text-muted-foreground"}`}>
                    {cuantos(opcion.valor)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* El scroll va en una caja aparte y la grilla adentro, sin alto propio.

            Antes la grilla misma era la que scrolleaba con flex-1: en el celular las filas se
            achicaban para entrar en el alto disponible (las tarjetas tienen overflow-hidden, y
            eso les quita el alto minimo), y quedaba a la vista solo el borde de arriba de cada
            tapa. El nombre, que va abajo, no se veia nunca.

            El pb-6 es para el celular: en Chrome de Android la barra de direcciones aparece y
            desaparece, y el alto de la ventana cambia bajo los pies del scroll; ese colchon deja
            que la ultima fila entre entera igual. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-6 sm:max-h-[52vh] sm:pb-3">
          {cargando ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Abriendo…</p>
          ) : visibles.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">{vacio()}</p>
          ) : vista === "lista" ? (
            <ul className="flex flex-col">
              {visibles.map((item) => (
                <li
                  key={item.id}
                  className={`flex items-center gap-1 rounded-lg transition ${
                    seleccion.includes(item.id) ? "bg-[var(--primary)]/10" : "hover:bg-muted"
                  }`}
                >
                  <button
                    type="button"
                    {...toquesDe(item)}
                    aria-pressed={enSeleccion ? seleccion.includes(item.id) : undefined}
                    className="flex min-w-0 flex-1 select-none items-center gap-3 px-2 py-1.5 text-left [-webkit-touch-callout:none]"
                  >
                    <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/50">
                      {item.mediaType === "IMAGE" || item.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnailUrl ?? item.url}
                          alt=""
                          className="size-full object-cover object-top"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <span className="scale-125">{icono(item.mediaType)}</span>
                      )}
                      {marcaDeElegido(item, "left-0.5 top-0.5")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                        {icono(item.mediaType)}
                        {tamano(item)}
                      </span>
                    </span>
                  </button>
                  {enSeleccion
                    ? null
                    : menuDe(
                        item,
                        "mr-1 shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-background hover:text-foreground",
                      )}
                </li>
              ))}
            </ul>
          ) : (
            /* En grilla y con tapa, como Drive: los catalogos se reconocen por la portada mucho
               antes que por el titulo, y aca todos empiezan igual ("CATALOGO ..."). */
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibles.map((item) => (
                <div
                  key={item.id}
                  className={`group relative overflow-hidden rounded-xl border transition ${
                    seleccion.includes(item.id)
                      ? "border-[var(--primary)] ring-2 ring-[var(--primary)]"
                      : "hover:border-foreground/20"
                  }`}
                >
                  <button
                    type="button"
                    {...toquesDe(item)}
                    aria-pressed={enSeleccion ? seleccion.includes(item.id) : undefined}
                    className="block w-full select-none text-left [-webkit-touch-callout:none]"
                  >
                    {/* La tapa: la miniatura de la foto, o la primera pagina del PDF si se pudo
                        sacar. object-top porque en un catalogo lo que identifica es el
                        encabezado, no el medio de la pagina. */}
                    <span className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted/50">
                      {item.mediaType === "IMAGE" || item.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.thumbnailUrl ?? item.url}
                          alt=""
                          className="size-full object-cover object-top"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <span className="scale-[2.2]">{icono(item.mediaType)}</span>
                      )}
                    </span>
                    <span className="block border-t px-2 pb-2 pt-1.5">
                      <span className="line-clamp-2 text-[12px] font-medium leading-snug text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground tabular-nums">
                        {tamano(item)}
                      </span>
                    </span>
                  </button>
                  {marcaDeElegido(item, "left-1.5 top-1.5")}
                  {enSeleccion
                    ? null
                    : menuDe(
                        item,
                        "absolute right-1 top-1 rounded-full bg-background/90 p-1 text-foreground/80 opacity-0 shadow-sm transition hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100 max-sm:opacity-100",
                      )}
                </div>
              ))}
            </div>
          )}
        </div>

        {enSeleccion ? (
          <div className="flex items-center gap-2 border-t p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={enviandoVarios !== null}
              onClick={() => setSeleccion([])}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1 gap-2"
              disabled={enviandoVarios !== null}
              onClick={() => void enviarSeleccion()}
            >
              {enviandoVarios ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {enviandoVarios
                ? `Enviando ${enviandoVarios.actual} de ${enviandoVarios.total}…`
                : seleccion.length === 1
                  ? "Enviar 1 archivo"
                  : `Enviar ${seleccion.length} archivos`}
            </Button>
          </div>
        ) : null}
        <div className={`border-t p-3 ${enSeleccion ? "hidden" : ""}`}>
          <input
            ref={inputArchivo}
            type="file"
            multiple
            className="hidden"
            accept="image/*,video/mp4,video/webm,video/quicktime,application/pdf"
            onChange={(evento) => {
              const archivos = Array.from(evento.target.files ?? []);
              evento.target.value = "";
              void agregarVarios(archivos);
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
            {subiendo
              ? `Subiendo${enCola && enCola.total > 1 ? ` ${enCola.actual} de ${enCola.total}` : ""}… ${Math.round(avance * 100)}%`
              : "Agregar archivos"}
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            {subiendo
              ? "Va por partes: si se corta la señal, sigue desde donde quedó."
              : "Mantén presionado un archivo para enviar varios a la vez."}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
