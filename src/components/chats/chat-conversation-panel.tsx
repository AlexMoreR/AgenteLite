"use client";

import Link from "next/link";
import { esperarLaApertura, tomarFichaDeLaApertura } from "@/components/chats/datos-de-la-apertura";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarPlus,
  ArrowLeft,
  BookOpen,
  Camera,
  ChevronDown,
  Copy,
  CornerUpLeft,
  Forward,
  FileText,
  Headphones,
  ImageIcon,
  LoaderCircle,
  MapPin,
  Megaphone,
  MessageSquareText,
  MoreVertical,
  PenLine,
  Mic,
  Palette,
  Pause,
  Pencil,
  Plus,
  RotateCcw,
  SendHorizonal,
  Smile,
  Sparkles,
  StickyNote,
  Trash2,
  TriangleAlert,
  Workflow,
  FolderOpen,
  X,
} from "lucide-react";

/** Cuantas barras tiene la onda mientras se graba una nota de voz. */
const BARRAS_DE_GRABACION = 36;

/*
  Los datos del contacto se traen ANTES de que se abra su panel.

  Se pedian al tocar el boton, y recien ahi salia el viaje al servidor -que ademas revalida sesion
  y permisos antes de leer-, asi que el panel aparecia vacio y se llenaba un segundo despues (Alex,
  21-sep-2026). Ahora se piden al entrar al chat y quedan listos: abrir el panel no espera nada.

  La cache es por contacto y dura poco: si alguien agrega una etiqueta desde otro lado, en medio
  minuto se vuelve a pedir. Ademas el propio control de etiquetas avisa por evento cuando cambia.
*/
const VIDA_DE_LA_CACHE_MS = 30_000;
type DetalleDeContacto = Awaited<ReturnType<typeof getContactDetailsAction>>;
const cacheDeContactos = new Map<string, { pedido: Promise<DetalleDeContacto>; at: number }>();

function pedirDetalleDeContacto(contactId: string): Promise<DetalleDeContacto> {
  const guardado = cacheDeContactos.get(contactId);
  if (guardado && Date.now() - guardado.at < VIDA_DE_LA_CACHE_MS) {
    return guardado.pedido;
  }
  /*
    Al abrir un chat la ficha viaja dentro de /live (velocidad, 10-nov-2026): se espera esa
    respuesta y, si la trajo, no sale la accion de servidor (iba en fila detras de las demas).
  */
  const pedido = esperarLaApertura().then(() => {
    const deLaApertura = tomarFichaDeLaApertura(contactId);
    if (deLaApertura) {
      return { details: deLaApertura } as DetalleDeContacto;
    }
    return getContactDetailsAction(contactId).catch(
      (error) => ({ error: error instanceof Error ? error.message : "No se pudo cargar" }) as DetalleDeContacto,
    );
  });
  cacheDeContactos.set(contactId, { pedido, at: Date.now() });
  return pedido;
}
import { ChatScrollAnchor } from "@/components/agents/chat-scroll-anchor";
import {
  ESPERA_GUARDAR_BORRADOR_MS,
  borrarBorrador,
  guardarBorrador,
  leerBorrador,
  marcarOcupada,
  registrarLectorDeTexto,
} from "@/lib/actualizacion-automatica";
import { ACCEPT_DOCUMENTOS_CHAT, revisarArchivoAntesDeSubir } from "@/lib/chat-envio-seguro";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { imagenesDelPortapapeles } from "@/components/chats/imagenes-del-portapapeles";
import {
  getContactDetailsAction,
  generateSuggestedReplyAction,
  marcarFlujoDeSugerenciaAction,
  refreshContactAvatarNowAction,
} from "@/app/actions/chats-actions";
import { enviarUbicacionPorRuta } from "@/lib/chats/enviar-por-ruta";
import { leerOrigenDelContactoAction } from "@/app/actions/origen-del-contacto-actions";
import type { OrigenDelCliente } from "@/lib/origen-del-cliente";
import { clearPendingConversationSelection } from "@/components/chats/chat-selection-store";
import { ChatTagsControl } from "@/components/chats/chat-tags-control";
import { QuickRepliesDialog } from "@/components/chats/quick-replies-dialog";
import { MediaLibraryDialog } from "@/components/chats/media-library-dialog";
import { CartaDeColoresDialog } from "@/components/chats/carta-de-colores-dialog";
import { subirArchivoPorPedazos } from "@/lib/subir-archivo-por-pedazos";
import { comprimirFotoParaEnviar } from "@/lib/comprimir-foto";
import { toProxiedMediaUrl } from "@/components/chats/chat-inbox-media";
import {
  actualizarFoto,
  agregarArchivosFallidos,
  agregarFotos,
  clasificarRespuestaDeEnvio,
  conReintentosAutomaticos,
  decidirReintento,
  encolarFoto,
  esFotoEnEnvio,
  fotoComoMensaje,
  fotosDelChat,
  fotosQueYaLlegaron,
  leerFoto,
  marcarFotoEnviada,
  nuevaClaveDeEnvio,
  nuevoIdDeFoto,
  plazoDe,
  quitarArchivosFallidos,
  quitarFotos,
  reanudarEnviosGuardados,
  tipoDeArchivo,
  useArchivosFallidos,
  useFotosEnEnvio,
  type DestinoDeFoto,
  type FotoEnEnvio,
  type PasoDeEnvio,
  type SubidaDeEnvio,
} from "@/components/chats/fotos-en-envio";
import {
  AVISO_REINTENTO_VENCIDO,
  MOTIVO_PASO_LA_HORA,
  claveParaReintentar,
  plazoVencido,
} from "@/components/chats/plazo-de-envio";
import {
  MENSAJE_MICROFONO_OCUPADO,
  MOTIVO_NOTA_ILEGIBLE,
  esFaltaDeArchivo,
  leerArchivoEntero,
  mensajeDeFallaDelMicrofono,
  motivoDeArchivoPerdido,
  tipoDeNotaDeVoz,
} from "@/components/chats/archivo-legible";
import { cuandoEsteLibre } from "@/lib/cuando-este-libre";
import { TIEMPO_LIMITE_SUBIDA_MS, clasificarSubida } from "@/lib/nota-de-voz-reintento";
import { PlaybookPanelDialog } from "@/components/chats/playbook-panel-dialog";
import { ForwardMessageDialog } from "@/components/chats/forward-message-dialog";
import { SendFlowDialog, enviarFlujoAlChat } from "@/components/chats/send-flow-dialog";
import { InternalNoteDialog } from "@/components/chats/internal-note-dialog";
import { FollowUpDialog } from "@/components/chats/follow-up-dialog";
import { MediaPreviewDialog } from "@/components/chats/media-preview-dialog";
import { quitarArchivo } from "@/components/chats/quitar-archivo-de-la-vista-previa";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  ComposerReplyTarget,
  SharedInboxMessageItem,
  SharedInboxProps,
  SharedInboxSelectedConversation,
} from "./chat-inbox-types";
import { FichaDeCotizacion } from "@/features/cotizaciones/components/FichaDeCotizacion";
import { CHAT_COMPOSER_RECENT_KEY, type ComposerEmojiTab } from "./chat-inbox-emojis";
import { MessageBubble } from "./chat-message-bubble";
import { useHayMasALaDerecha } from "./use-hay-mas-a-la-derecha";
import { ChatFloatingDateBadge } from "./chat-floating-date-badge";
import { esNotaInternaDelAgente } from "@/lib/notas-internas-del-agente";
import { ComposerEmojiPicker, ComposerSendButton } from "./chat-composer";
import { AvisoDeCierre } from "./aviso-de-cierre";
import { AvisoDeLlamada } from "./aviso-de-llamada";
import { BotonDeMapaDeCaminos } from "./boton-mapa-de-caminos";
import { dondeVaLaSugerencia } from "./destino-de-la-sugerencia";
import { copiarAlPortapapeles, textoDeVariosParaCopiar } from "./copiar-mensaje";
import { ALTO_DE_LA_BARRA, CLASES_BOTON_DE_LA_BARRA, CLASES_ETIQUETA_DE_LA_BARRA, mostrarNombreAlMantener } from "./boton-de-la-barra";
import { textoTraeElTotal } from "@/lib/etapa-automatica-crm-texto";

// El panel de envio se baja recien cuando se abre la ficha del contacto: no pesa en la carga del chat.
const PanelDeEnvio = dynamic(() => import("./panel-de-envio").then((modulo) => modulo.PanelDeEnvio), {
  ssr: false,
  // Si el archivo no baja (ChunkLoadError tras un despliegue) no se queda en "Cargando…" para siempre.
  loading: ({ error }) =>
    error ? (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>No se pudo cargar el panel</span>
        <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reintentar
        </Button>
      </div>
    ) : (
      <p className="text-xs text-muted-foreground">Cargando…</p>
    ),
});

/** Hasta este peso una foto sube en un solo pedido (ver subirArchivoEnEnvio). */
const TROZO_DE_FOTO_ACHICADA_BYTES = 1024 * 1024;

/** iPhone, iPad (que se presenta como Mac con pantalla tactil) o Mac: graban la nota en audio/mp4. */
function esEquipoApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

/*
  Sube el archivo de un envio y dice si vale reintentarlo solo.

  Fotos, videos y documentos van por pedazos (subirArchivoPorPedazos, que ya reintenta cada pedazo):
  una subida que se corto se vuelve a probar; un no del servidor (formato, peso, permisos) o un
  archivo que el telefono ya no puede leer, no. La nota de voz va de una, con tiempo limite, como
  antes (clasificarSubida).
*/
async function subirArchivoEnEnvio(
  foto: FotoEnEnvio,
  archivo: File,
  onAvance: (avance: number) => void,
): Promise<PasoDeEnvio<SubidaDeEnvio>> {
  if (foto.tipo === "AUDIO") {
    const destino = foto.destinoDeAudio;
    if (!destino) {
      return { ok: false, motivo: "No se pudo preparar el envio.", reintentable: false };
    }
    // Un archivo vacio no se sube: el servidor contestaria "No se recibió ningún archivo".
    if (!(archivo.size > 0)) {
      return { ok: false, motivo: MOTIVO_NOTA_ILEGIBLE, reintentable: false };
    }
    // Con tiempo limite: sin esto, con mala señal se quedaba "pensando" para siempre.
    const control = new AbortController();
    let vencio = false;
    const temporizador = setTimeout(() => {
      vencio = true;
      control.abort();
    }, TIEMPO_LIMITE_SUBIDA_MS);
    try {
      // Un File con nombre y tipo (nota-de-voz-….m4a / audio/mp4 en el iPhone), nunca un Blob suelto.
      const formData = new FormData();
      formData.append("file", archivo, archivo.name || "nota.m4a");
      const response = await fetch(destino.uploadPath, { method: "POST", body: formData, signal: control.signal });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      const paso = clasificarSubida({ status: response.status, url: data?.url, error: data?.error });
      if (!paso.ok && esFaltaDeArchivo(data?.error)) {
        // Para cruzar con la linea [nota-de-voz] del servidor: que se mando de verdad.
        console.warn(
          `[nota-de-voz] ${JSON.stringify({
            paso: "subida-sin-archivo",
            bytes: archivo.size,
            mime: archivo.type || null,
            nombre: archivo.name || null,
            esFile: typeof File !== "undefined" && archivo instanceof File,
            retomada: Boolean(foto.retomada),
            navegador: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 160) : null,
          })}`,
        );
      }
      return paso.ok
        ? { ok: true, valor: { url: paso.valor, fileName: archivo.name, mimeType: archivo.type, mediaType: "AUDIO" } }
        : { ok: false, motivo: paso.falla.mensaje, reintentable: paso.falla.reintentable };
    } catch {
      const paso = clasificarSubida({ status: null, vencio });
      return { ok: false, motivo: paso.ok ? "No se pudo subir el audio." : paso.falla.mensaje, reintentable: true };
    } finally {
      clearTimeout(temporizador);
    }
  }

  const destino = foto.destino;
  if (!destino) {
    return { ok: false, motivo: "No se pudo preparar el envio.", reintentable: false };
  }
  /*
    Por pedazos, con reintento por pedazo: con la señal de la calle (14-32 KB/s medidos el
    14-ago-2026) 15 MB en una sola peticion tardan entre 8 y 18 minutos y no llegan a terminar.

    La foto ya achicada (comprimirFotoParaEnviar, ~200-600 KB) va en UN solo pedido (velocidad de
    fotos, 11-nov-2026): en pedazos de 512 KB una de 600 KB eran dos pedidos en fila, cada uno con su
    sesion y su permiso. Con 15 KB/s 1 MB son ~70 s, todavia una peticion que termina.
  */
  const resultado = await subirArchivoPorPedazos({
    file: archivo,
    endpoint: `${destino.uploadPath}/chunk`,
    onAvance,
    ...(foto.tipo === "IMAGE" && archivo.size <= TROZO_DE_FOTO_ACHICADA_BYTES ? { tamanoTrozo: TROZO_DE_FOTO_ACHICADA_BYTES } : {}),
  });
  if (resultado.archivo) {
    return { ok: true, valor: resultado.archivo };
  }
  const motivo = resultado.error || `No se pudo subir "${archivo.name}".`;
  return { ok: false, motivo, reintentable: /^(Se cortó la subida|La subida)/.test(motivo) };
}

const CHAT_MESSAGES_BACKGROUND_BASE_STYLE = {
  // Token por defecto de shadcn: blanco con una tonalidad un poco mas oscura.
  backgroundColor: "var(--muted)",
} as const;

const CHAT_MESSAGES_BACKGROUND_OVERLAY_STYLE = {
  backgroundImage: 'url("https://static.whatsapp.net/rsrc.php/yx/r/voSdkk88H7C.svg")',
  backgroundRepeat: "repeat",
  backgroundSize: "540px 960px",
  backgroundPosition: "0 0",
} as const;

type ConversationPanelProps = {
  backHref: string;
  composer: SharedInboxProps["composer"];
  composerHiddenFields: Array<{ name: string; value: string }>;
  hasSettledConversation: boolean;
  /**
   * La barra de abajo se dibuja YA, antes de que el chat este asentado: con los datos de la fila
   * de la lista o, si faltan, en silueta del mismo alto. Asi no aparece "al rato" ni empuja.
   */
  barraAnticipada?: boolean;
  /** El contacto segun la fila de la lista, para dibujar las etiquetas mientras llega el chat. */
  contactIdDeLaFila?: string | null;
  isLoadingOlderMessages: boolean;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  messageScrollBehavior: "bottom" | "preserve";
  messagesScrollRef: RefObject<HTMLDivElement | null>;
  unreadCount: number;
  /** La firma de quien escribe. Se muestra en el campo para poder editarla o borrarla. */
  chatSignature: string;
  showJumpToBottom: boolean;
  onScrollToBottom: () => void;
  onEditContact: () => void;
  /** Dueño/admin: solo ellos pueden sumar el chat al mapa de caminos (cada uno cuesta IA). */
  isManager?: boolean;
  /** Devuelve false si no se acepto (ya hay un texto en camino en ese chat): el cuadro no se limpia. */
  onComposerDraft: (message: string, formData: FormData) => boolean;
  /** Hay un texto en camino en este chat: el boton y el Enter no envian otro. */
  enviandoTexto?: boolean;
  /** El chat abierto todavia no cargo: Enviar queda apagado (el texto nunca sale al chat anterior). */
  envioBloqueado?: boolean;
  /** "error" = el chat no cargo (fallo o paso el limite): se muestra el aviso con Reintentar. */
  estadoCarga?: "listo" | "cargando" | "error";
  onReintentarCarga?: () => void;
  /** Reintentar un texto que no salio (la burbuja dice cual). */
  onRetryFailedMessage?: (message: SharedInboxMessageItem) => void;
  onReplyToMessage?: (message: SharedInboxMessageItem) => void;
  onDeleteMessage?: (message: SharedInboxMessageItem) => void;
  onEditMessage?: (message: SharedInboxMessageItem) => void;
  replyTarget?: ComposerReplyTarget | null;
  onCancelReply?: () => void;
  renderedConversation: SharedInboxSelectedConversation | null;
  renderedMessages: SharedInboxMessageItem[];
  selectedConversationId: string;
  selectedConversationScrollKey: string;
  selectedConversationTags: Array<{
    label: string;
    color: string;
  }>;
  emptySelectionTitle: string;
  emptySelectionDescription: string;
  headerActions?: ReactNode;
  headerBadge?: ReactNode;
  /** Barra de abajo de la cabecera con la cabecera angosta: etapa, agente, resolver, posponer, asignar. */
  headerBar?: ReactNode;
  contactPanelActions?: ReactNode;
  /**
   * Acciones de la CABECERA del panel de contacto, al lado del titulo.
   *
   * Traer el historial vivia en la barra del chat, apretado entre la etapa, el interruptor de la
   * IA y "Resolver". Es algo que se usa una vez por cliente y estaba compitiendo por lugar con
   * lo que se usa todo el dia; ademas en el celular ese renglon quedaba a reventar.
   */
  contactPanelHeaderActions?: ReactNode;
  canDeleteTags: boolean;
  /**
   * Se llama tras un envio BUENO de foto, archivo, nota de voz, ubicacion, biblioteca, carta de
   * colores o flujo. Reemplaza al router.refresh() que rearmaba la bandeja entera: la bandeja sube
   * la fila al instante (si viene `tipo`) y trae el mensaje real con /live solo de ese chat.
   *
   * `conversationId` es el chat DESTINO del envio, no el abierto: en computador el panel no se
   * vuelve a montar al cambiar de chat y una foto puede terminar de salir con otro chat abierto.
   */
  onEnvioTerminado?: (envio: EnvioTerminado) => void;
};

export type EnvioTerminado = {
  conversationId: string;
  /** Lo que se mando, para la fila de la lista. Sin tipo (un flujo) solo se refresca el chat. */
  tipo?: SharedInboxMessageItem["type"];
  /** Texto de la fila cuando el tipo no tiene uno propio (la ubicacion). */
  texto?: string;
};

/*
  Se copia el archivo a memoria APENAS se elige, no al enviarlo.

  En Android lo que devuelve el selector no es el archivo: es un permiso prestado para leerlo. Ese
  permiso se cae solo -la app de fotos limpia su cache, el sistema recorta memoria, pasan unos
  minutos mientras se escribe el mensaje- y entonces el File deja de apuntar a nada. Se ve clarito
  en la pantalla de "Enviar archivo": la miniatura sale ROTA, porque el navegador tampoco lo puede
  leer.

  Al enviarlo, el fetch falla con "Failed to fetch" ANTES de salir a la red: por eso los seis
  reintentos caen instantaneos y en el servidor no queda ni un pedido. Visto el 3 y 4-sep-2026 con
  1001685636.mp4 y 1001687585.jpg.

  Copiandolo apenas se elige, el archivo pasa a ser nuestro y ya no depende de ese permiso. Y si no
  se puede leer, se avisa AHI, antes de que escriba el mensaje y espere la subida.
*/
/** Hasta aca se copia a memoria. Un video de 85 MB en memoria puede tumbar la pestaña. */
const LIMITE_PARA_COPIAR_EN_MEMORIA = 30 * 1024 * 1024;

async function copiarArchivosAMemoria(
  files: File[],
): Promise<{ archivos: File[]; ilegible: string | null }> {
  const archivos: File[] = [];
  for (const file of files) {
    if (file.size > LIMITE_PARA_COPIAR_EN_MEMORIA) {
      archivos.push(file);
      continue;
    }
    try {
      const datos = await file.arrayBuffer();
      archivos.push(
        new File([datos], file.name, { type: file.type, lastModified: file.lastModified }),
      );
    } catch {
      return { archivos: [], ilegible: file.name };
    }
  }
  return { archivos, ilegible: null };
}

/** Si la barra de primera accion del celular quedo escondida ("no") o visible ("si"). */
const CLAVE_BARRA_VISIBLE = "chat:barra-de-acciones";

export const ConversationPanel = memo(function ConversationPanel({
  backHref,
  composer,
  composerHiddenFields,
  hasSettledConversation,
  barraAnticipada = false,
  contactIdDeLaFila = null,
  isLoadingOlderMessages,
  loadMoreSentinelRef,
  messageScrollBehavior,
  messagesScrollRef,
  unreadCount,
  chatSignature,
  showJumpToBottom,
  onScrollToBottom,
  onEditContact,
  isManager = false,
  onComposerDraft,
  enviandoTexto = false,
  envioBloqueado = false,
  estadoCarga = "listo",
  onReintentarCarga,
  onRetryFailedMessage,
  onReplyToMessage,
  onDeleteMessage,
  onEditMessage,
  replyTarget,
  onCancelReply,
  renderedConversation,
  renderedMessages,
  selectedConversationId,
  selectedConversationScrollKey,
  emptySelectionTitle,
  emptySelectionDescription,
  headerActions,
  headerBadge,
  headerBar,
  contactPanelActions,
  contactPanelHeaderActions,
  canDeleteTags,
  onEnvioTerminado,
}: ConversationPanelProps) {
  /*
    Se lee desde una referencia: enviarFoto se crea una sola vez (useCallback sin dependencias) y
    con la prop directa se quedaria con la de la primera vez.
  */
  const onEnvioTerminadoRef = useRef(onEnvioTerminado);
  useEffect(() => {
    onEnvioTerminadoRef.current = onEnvioTerminado;
  }, [onEnvioTerminado]);
  const avisarEnvioTerminado = useCallback((envio: EnvioTerminado) => {
    onEnvioTerminadoRef.current?.(envio);
  }, []);
  /**
   * Ya se respondio la pregunta del cierre en esta pantalla.
   *
   * El servidor tambien deja de mandarla, pero eso llega en el proximo repintado: sin este
   * estado la barra se queda un rato mas y parece que el toque no hizo nada.
   */
  const [cierreRespondido, setCierreRespondido] = useState(false);

  /**
   * El id PELADO del chat, para el mapa de caminos.
   *
   * `selectedConversationId` es la CLAVE del chat, con su fuente adelante ("agent:cmxxx"). Pasarla
   * tal cual a una accion que busca por id ya rompio el envio de mensajes una vez (commit 571d10e):
   * el WHERE no encontraba nada y fallaba en silencio.
   *
   * Los chats de la API oficial quedan afuera a proposito: viven en otra tabla y el mapa lee
   * Conversation. Mejor que el boton no aparezca a que aparezca y falle.
   */
  const idDeLaConversacionParaElMapa = selectedConversationId?.startsWith("agent:")
    ? selectedConversationId.slice("agent:".length)
    : "";
  const idDelChat = renderedConversation?.contactId ?? null;
  useEffect(() => {
    // Al cambiar de chat vuelve a preguntarse por el nuevo cliente.
    setCierreRespondido(false);
  }, [idDelChat]);

  const canLoadOlderMessages = Boolean(renderedConversation?.loadMoreCursor && renderedConversation.hasMoreMessages);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isQuickRepliesOpen, setIsQuickRepliesOpen] = useState(false);
  const [isPlaybookOpen, setIsPlaybookOpen] = useState(false);
  const [isSendFlowOpen, setIsSendFlowOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isCartaDeColoresOpen, setIsCartaDeColoresOpen] = useState(false);
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  // Mensaje que se esta reenviando (null = dialogo cerrado).
  const [mensajeAReenviar, setMensajeAReenviar] = useState<SharedInboxMessageItem | null>(null);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  // Archivos elegidos pendientes de confirmar en la vista previa (con caption) antes de enviar.
  const [pendingMediaFiles, setPendingMediaFiles] = useState<File[]>([]);
  /**
   * Lo que no se pudo subir, para poder reintentarlo.
   *
   * Antes solo salia un aviso que se desvanecia y el archivo se perdia: habia que volver a la
   * galeria, buscar la misma foto y empezar de nuevo. Con la señal de la calle eso pasa seguido, y
   * es la diferencia entre reintentar de un toque o dejar al cliente sin la foto.
   *
   * Es una LISTA y vive fuera del panel (fotos-en-envio.ts), cada tarjeta con su chat y su destino:
   * se ve solo en su chat y reintenta hacia ese destino, aunque la asesora haya cambiado de chat.
   * Las fotos que fallan no vienen aca: quedan como burbuja en el chat, con su Reintentar.
   */
  const todosLosArchivosFallidos = useArchivosFallidos();
  const [isSuggestingReply, setIsSuggestingReply] = useState(false);
  /*
    La sugerencia de la estrella que esta en la caja, para registrar al enviar que salio de ahi (y
    si se edito). Se suelta si la caja queda vacia -lo que se escriba despues ya es de ella- o al
    cambiar de chat.
  */
  const sugerenciaEnLaCaja = useRef<{ id: string; chat: string } | null>(null);
  /*
    El total que inserto el panel de envio en la caja (ya con formato), para saber al ENVIAR si el
    texto todavia lo trae. Solo entonces el servidor pasa el lead a Caliente: insertar no alcanza.
  */
  const totalDelPanelEnLaCaja = useRef<{ total: string; chat: string } | null>(null);
  /*
    El flujo que la estrella propone junto al texto ("Enviar flujo: Video combo armado"). Es un
    boton: nunca se envia solo. Se ve solo en el chat donde se pidio.
  */
  const [flujoSugerido, setFlujoSugerido] = useState<{
    id: string;
    titulo: string;
    sugerenciaId: string | null;
    chat: string;
  } | null>(null);
  const [emojiSearchQuery, setEmojiSearchQuery] = useState("");
  const [pestanaChat, setPestanaChat] = useState<"mensajes" | "cotizaciones">("mensajes");
  // "Enviar al cliente" de la cotizacion: mismo camino que el composer (burbuja optimista, chat
  // esperado, sin firma). Solo con un toque explicito de la asesora.
  const enviarTextoAlChat = useCallback(
    (texto: string): boolean => {
      if (!composer || enviandoTexto || envioBloqueado || !texto.trim()) {
        return false;
      }
      const formData = new FormData();
      for (const field of composerHiddenFields) {
        formData.append(field.name, field.value);
      }
      formData.set("message", texto);
      formData.set("skipSignature", "1");
      return onComposerDraft(texto, formData);
    },
    [composer, composerHiddenFields, enviandoTexto, envioBloqueado, onComposerDraft],
  );
  /*
    La barra de primera accion se puede esconder con la flecha de arriba, para ganar alto de chat
    en el celular. Se recuerda en ese aparato: quien la esconde no quiere volver a hacerlo en cada
    chat. Arranca visible y se lee despues de montar, porque el servidor no sabe que eligio.
  */
  const [barraVisible, setBarraVisible] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(CLAVE_BARRA_VISIBLE) === "no") setBarraVisible(false);
    } catch {
      // Sin almacenamiento (ventana privada): queda visible.
    }
  }, []);
  const alternarBarra = () => {
    setBarraVisible((actual) => {
      const siguiente = !actual;
      try {
        window.localStorage.setItem(CLAVE_BARRA_VISIBLE, siguiente ? "si" : "no");
      } catch {
        // Idem: vale mientras la pantalla siga abierta.
      }
      return siguiente;
    });
  };
  // Si en la barra quedan botones a la derecha, escondidos debajo de Resolver (que va fijo): con
  // eso se muestra la flechita que avisa que hay mas al deslizar.
  const [refBarraQueSeDesliza, barraHayMas] = useHayMasALaDerecha<HTMLDivElement>();
  /**
   * "Escribiendo…", como en WhatsApp.
   *
   * No se guarda en la base: dura segundos y no es historia. Llega por el altavoz con el dato
   * adentro, porque un simple "algo cambio" no serviria -para cuando el navegador volviera a
   * preguntar, la persona ya paro-.
   */
  const [escribiendo, setEscribiendo] = useState<"escribiendo" | "grabando" | null>(null);
  /*
    "En linea", debajo del nombre, como en WhatsApp.

    Va aparte del "escribiendo" porque son dos cosas distintas y una tapa a la otra: mientras
    escribe se muestra eso, y cuando para queda "en linea" hasta que cierre la app.
  */
  const [enLinea, setEnLinea] = useState(false);

  /*
    Los mensajes marcados, como en WhatsApp.

    Se mantiene apretada una burbuja y la conversacion entra en "modo seleccion": la fila se pinta,
    y los accesos rapidos reemplazan a la cabecera -ARRIBA, que es donde WhatsApp los pone y donde
    no tapan lo que se esta leyendo-. Con una sola marcada ademas flotan los emoticones sobre ella.

    Se guardan ids y no mensajes: la lista se refresca sola con cada mensaje nuevo, y un objeto
    viejo guardado aca quedaria congelado con datos de hace un rato.
  */
  const [seleccionados, setSeleccionados] = useState<string[]>([]);

  const alternarSeleccion = useCallback((mensaje: SharedInboxMessageItem) => {
    setSeleccionados((actuales) =>
      actuales.includes(mensaje.id)
        ? actuales.filter((id) => id !== mensaje.id)
        : [...actuales, mensaje.id],
    );
  }, []);

  // Cambiar de chat limpia la seleccion: mensajes marcados en una charla no significan nada en
  // otra, y la barra de arriba quedaria ofreciendo borrar lo que ya no esta a la vista.
  useEffect(() => {
    setSeleccionados([]);
  }, [selectedConversationId]);
  const telefonoDelChat = renderedConversation?.secondaryLabel?.replace(/\D/g, "") ?? "";

  useEffect(() => {
    if (!telefonoDelChat) {
      return;
    }
    let apagar: ReturnType<typeof setTimeout> | null = null;
    let apagarEnLinea: ReturnType<typeof setTimeout> | null = null;

    const alLlegar = (evento: Event) => {
      const detalle = (evento as CustomEvent).detail as
        | {
            telefono?: string;
            activo?: boolean;
            que?: "escribiendo" | "grabando" | null;
            enLinea?: boolean;
          }
        | null;
      if (!detalle?.telefono) {
        return;
      }
      if (detalle.telefono.replace(/\D/g, "") !== telefonoDelChat) {
        return;
      }

      if (apagar) {
        clearTimeout(apagar);
        apagar = null;
      }
      setEscribiendo(detalle.activo ? detalle.que ?? "escribiendo" : null);

      /*
        Apagado por las dudas a los 10 segundos.

        WhatsApp avisa cuando alguien PARA de escribir, pero ese aviso se puede perder -se corto la
        red, se cerro el chat-. Sin este limite, el "escribiendo…" quedaria clavado para siempre y
        la asesora esperaria un mensaje que no viene.
      */
      if (detalle.activo) {
        apagar = setTimeout(() => setEscribiendo(null), 10_000);
      }

      /*
        El "en linea" se apaga solo a los 2 minutos.

        WhatsApp avisa cuando la persona cierra la app, pero ese aviso se puede perder igual que el
        de "dejo de escribir", y ademas la suscripcion caduca sola a los pocos minutos. Sin este
        limite el chat diria "en linea" para siempre, que es peor que no decir nada: la asesora
        insiste creyendo que la estan leyendo.
      */
      if (apagarEnLinea) {
        clearTimeout(apagarEnLinea);
        apagarEnLinea = null;
      }
      setEnLinea(Boolean(detalle.enLinea));
      if (detalle.enLinea) {
        apagarEnLinea = setTimeout(() => setEnLinea(false), 120_000);
      }
    };

    window.addEventListener("chat-presence", alLlegar);
    return () => {
      window.removeEventListener("chat-presence", alLlegar);
      if (apagar) {
        clearTimeout(apagar);
      }
      if (apagarEnLinea) {
        clearTimeout(apagarEnLinea);
      }
    };
  }, [telefonoDelChat]);

  // Al cambiar de chat se limpia: si no, se arrastraria el "escribiendo…" del anterior.
  useEffect(() => {
    setEscribiendo(null);
    setEnLinea(false);
  }, [selectedConversationId]);
  const [emojiPickerTab, setEmojiPickerTab] = useState<ComposerEmojiTab>("todos");
  const [recentComposerEmojis, setRecentComposerEmojis] = useState<string[]>([]);
  const [recentComposerEmojisReady, setRecentComposerEmojisReady] = useState(false);
  const composerTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerSelectionRef = useRef({ start: 0, end: 0 });
  const composerRouter = useRouter();
  const [isRefreshingAvatar, setIsRefreshingAvatar] = useState(false);
  const [fotoDelContactoAbierta, setFotoDelContactoAbierta] = useState(false);
  const [composerHasText, setComposerHasText] = useState(false);
  /**
   * El texto del cuadro salio de una respuesta rapida.
   *
   * Las respuestas rapidas son mensajes YA redactados (el catalogo, la garantia, los medios de
   * pago). Pegarles arriba "👩‍💻 Ingrid Sánchez" los arruina: quedan como si la asesora hubiera
   * escrito un anuncio. La firma tiene sentido cuando ella escribe de su puño, no acá.
   */
  const [desdeRespuestaRapida, setDesdeRespuestaRapida] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [grabacionPausada, setGrabacionPausada] = useState(false);
  // Nivel del microfono de las ultimas lecturas (0 a 1), para dibujar la onda mientras se graba.
  const [ondaEnVivo, setOndaEnVivo] = useState<number[]>([]);
  /*
    La nota de voz ya no bloquea la caja mientras sale ni deja una tarjeta si falla: va a la cola
    de archivos en envio (fotos-en-envio.ts) y, si no sale, queda su burbuja en rojo con Reintentar,
    con el audio guardado.
  */

  // Trae la foto de perfil del contacto abierto AL INSTANTE (acción manual del usuario).
  const handleRefreshAvatar = useCallback(async () => {
    const contactId = renderedConversation?.contactId;
    if (!contactId || isRefreshingAvatar) {
      return;
    }
    setIsRefreshingAvatar(true);
    try {
      const result = await refreshContactAvatarNowAction(contactId);
      if (result.ok) {
        toast.success("Foto actualizada");
        composerRouter.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("No se pudo traer la foto");
    } finally {
      setIsRefreshingAvatar(false);
    }
  }, [renderedConversation?.contactId, isRefreshingAvatar, composerRouter]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordCancelledRef = useRef(false);
  const analizadorDeGrabacionRef = useRef<{
    contexto: AudioContext;
    temporizador: ReturnType<typeof setInterval>;
  } | null>(null);
  const audioConfig = composer?.audio;
  const mediaConfig = composer?.media;
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);
  // Aparte del de fotos: con un solo input, el selector del celular ofrece la galeria y esconde
  // el explorador de archivos, que es justo donde esta el PDF.
  const documentoFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isSendingLocation, setIsSendingLocation] = useState(false);
  /*
    Los archivos en envio -fotos, videos, documentos y notas de voz- (fotos-en-envio.ts): aparecen
    al tocar Enviar con el archivo local, como ya enviados, y viven fuera del panel para sobrevivir
    al cambio de chat. Aca solo se muestran los de ESTE chat.
  */
  const chatDeLasFotos = mediaConfig?.conversationId ?? audioConfig?.conversationId ?? null;
  const todasLasFotosEnEnvio = useFotosEnEnvio();
  const fotosDeEsteChat = useMemo(
    () => fotosDelChat(todasLasFotosEnEnvio, chatDeLasFotos),
    [todasLasFotosEnEnvio, chatDeLasFotos],
  );
  const fotosPorId = useMemo(() => new Map(fotosDeEsteChat.map((foto) => [foto.id, foto])), [fotosDeEsteChat]);
  // Lista final a renderizar: mensajes reales + archivos en envio que aún no llegaron (misma
  // direccion del servidor ⇒ ya está el real, se descarta el de envio para no duplicar).
  const displayedMessages = useMemo(() => {
    /*
      Las notas internas del Agente V3 fuera de la vista (ver notas-internas-del-agente). El
      servidor ya no las manda, pero un chat guardado en la cache del navegador de antes del cambio
      todavia las trae: se filtran tambien aca.
    */
    const sinNotasInternas = renderedMessages.some(esNotaInternaDelAgente)
      ? renderedMessages.filter((mensaje) => !esNotaInternaDelAgente(mensaje))
      : renderedMessages;
    if (fotosDeEsteChat.length === 0) {
      return sinNotasInternas;
    }
    /*
      Se compara contra la direccion del SERVIDOR (la vista previa `blob:` nunca coincidiria). El
      que ya llego se deja de dibujar en este mismo render, para que no se vean dos un instante; el
      efecto de abajo lo retira del almacen y libera su vista previa.
    */
    const yaLlegaron = new Set(fotosQueYaLlegaron(fotosDeEsteChat, chatDeLasFotos, sinNotasInternas));
    const enEnvio = fotosDeEsteChat
      .filter((foto) => !yaLlegaron.has(foto.id))
      .map(fotoComoMensaje)
      .sort((izquierda, derecha) => new Date(izquierda.createdAt).getTime() - new Date(derecha.createdAt).getTime());
    if (enEnvio.length === 0) {
      return sinNotasInternas;
    }
    return [...sinNotasInternas, ...enEnvio];
  }, [renderedMessages, fotosDeEsteChat, chatDeLasFotos]);
  // Llego el mensaje real de una foto: se retira la burbuja y se libera su vista previa local.
  useEffect(() => {
    const llegaron = fotosQueYaLlegaron(fotosDeEsteChat, chatDeLasFotos, renderedMessages);
    if (llegaron.length > 0) {
      quitarFotos(llegaron);
    }
  }, [fotosDeEsteChat, chatDeLasFotos, renderedMessages]);
  // Mientras un archivo sube o se envia (de cualquier chat), la app no se recarga sola. Cerrar la
  // pestaña en ese momento pregunta antes (beforeunload en fotos-en-envio.ts).
  const hayFotosEnCurso = todasLasFotosEnEnvio.some(
    (foto) => foto.estado === "subiendo" || foto.estado === "enviando",
  );
  // Un archivo que fallo y espera Reintentar tambien cuenta: la recarga en segundo plano no lo toca.
  const hayArchivosSinSalir =
    todasLasFotosEnEnvio.some((foto) => foto.estado === "fallida") || todosLosArchivosFallidos.length > 0;
  useEffect(() => {
    marcarOcupada("fotos-en-envio", hayFotosEnCurso, "envio");
    marcarOcupada("archivos-sin-salir", hayArchivosSinSalir, "envio");
  }, [hayFotosEnCurso, hayArchivosSinSalir]);
  const [isContactPanelOpen, setIsContactPanelOpen] = useState(false);
  const isMobile = useIsMobile();
  const [contactCity, setContactCity] = useState("");
  const [contactOrigin, setContactOrigin] = useState<OrigenDelCliente | null>(null);
  // Chat en el que la asesora abrio "Calcular envio" (null = ninguno; otro chat = cerrado).
  const [envioAbiertoEn, setEnvioAbiertoEn] = useState<string | null>(null);
  // Etiquetas REALES del contacto para el panel. renderedConversation.tags viene del detalle
  // (loader + /live), que NO incluye tags → al abrir un chat con clic el panel salía vacío
  // aunque la lista sí mostraba "Lead". Las traemos de getContactDetailsAction (ContactTag real)
  // y las mantenemos en sync con el evento global al agregar/quitar.
  const [contactPanelTags, setContactPanelTags] = useState<Array<{ label: string; color: string }> | null>(null);

  const panelContactId = renderedConversation?.contactId ?? null;

  // Al entrar a un chat se piden los datos del contacto, aunque el panel este cerrado: asi abrirlo
  // es instantaneo. Es una consulta chica y se guarda en cache por contacto. Va cuando el navegador
  // queda libre: las server actions van en fila y no debe tapar un envio hecho apenas se abre.
  useEffect(() => {
    if (!panelContactId) {
      return;
    }
    return cuandoEsteLibre(() => {
      void pedirDetalleDeContacto(panelContactId);
    });
  }, [panelContactId]);

  // Origen del cliente (anuncio, Marketplace u orgánico). Si falla, la línea simplemente no sale.
  useEffect(() => {
    if (!isContactPanelOpen || !panelContactId) {
      setContactOrigin(null);
      return;
    }
    // Al cambiar de chat se borra el origen anterior para no mostrar el de otro cliente.
    setContactOrigin(null);
    let cancelled = false;
    leerOrigenDelContactoAction({ contactId: panelContactId })
      .then((result) => {
        if (!cancelled) setContactOrigin("origen" in result ? result.origen : null);
      })
      .catch(() => {
        if (!cancelled) setContactOrigin(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isContactPanelOpen, panelContactId]);

  useEffect(() => {
    if (!isContactPanelOpen || !panelContactId) {
      setContactCity("");
      setContactPanelTags(null);
      return;
    }

    let cancelled = false;
    pedirDetalleDeContacto(panelContactId).then((result) => {
      if (cancelled) return;
      if ("details" in result) {
        setContactCity(result.details.city);
        setContactPanelTags(result.details.tags.map((tag) => ({ label: tag.name, color: tag.color })));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isContactPanelOpen, panelContactId]);

  // Sincroniza las etiquetas del panel cuando se agregan/quitan (ChatTagsControl emite este
  // evento). Sin esto, mostrar contactPanelTags (que preferimos sobre renderedConversation.tags)
  // dejaría el badge "pegado" tras quitar una etiqueta.
  useEffect(() => {
    if (!panelContactId) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { contactId?: string; tags?: Array<{ label: string; color: string }> }
        | undefined;
      if (!detail || detail.contactId !== panelContactId) return;
      setContactPanelTags(detail.tags ?? []);
    };
    window.addEventListener("chat-tags-updated", handler as EventListener);
    return () => window.removeEventListener("chat-tags-updated", handler as EventListener);
  }, [panelContactId]);

  // Manda la ubicación del local con un toque. Las coordenadas viven en la configuración de
  // Negocio (no las elige quien envía), así que acá solo hace falta saber a qué chat va.
  const handleSendLocation = useCallback(async () => {
    const conversationId = mediaConfig?.conversationId ?? audioConfig?.conversationId;
    if (!conversationId || isSendingLocation) {
      return;
    }

    setIsSendingLocation(true);
    try {
      // Por la ruta fija: sigue andando en una pestaña abierta antes de un despliegue.
      const result = await enviarUbicacionPorRuta({
        conversationId,
        agentId: mediaConfig?.agentId ?? audioConfig?.agentId ?? undefined,
        returnTo: mediaConfig?.returnTo ?? audioConfig?.returnTo ?? undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Ubicación enviada");
      avisarEnvioTerminado({ conversationId, tipo: "LOCATION", texto: "Ubicación" });
      onScrollToBottom?.();
    } catch {
      toast.error("No se pudo enviar la ubicación");
    } finally {
      setIsSendingLocation(false);
    }
  }, [mediaConfig, audioConfig, isSendingLocation, onScrollToBottom, avisarEnvioTerminado]);

  /*
    Sube (si hace falta) y envia UN archivo en envio -foto, video, documento o nota de voz- que ya
    tiene su burbuja en el chat. Devuelve si salio. Lo llama la cola del chat (encolarFoto).

    Todo sale del envio guardado y no del chat abierto: la asesora puede cambiar de chat a mitad de
    la subida y el archivo tiene que seguir yendo al chat donde toco Enviar, con su mismo texto.

    Los cortes se reintentan solos, sin mostrar nada (conReintentosAutomaticos), y siempre con la
    misma clave: el servidor reconoce el envio repetido y no lo manda dos veces a WhatsApp. Solo si
    sigue fallando la burbuja queda en rojo con Reintentar. Una respuesta `{ error }` del servidor
    no se reintenta sola (ver clasificarRespuestaDeEnvio).

    Cada envio deja una linea [envio-medio] en la consola con cuanto tardo cada tramo.
  */
  const enviarFoto = useCallback(async (id: string): Promise<boolean> => {
    const inicial = leerFoto(id);
    if (!inicial) {
      return false;
    }
    const arranque = performance.now();
    // Desde que se toco Enviar hasta que arranca: la espera en la cola del chat (otro archivo del
    // mismo chat saliendo). En un reintento o al retomar cuenta desde el envio original.
    const colaMs = Math.max(0, Date.now() - inicial.creadaEn.getTime());
    const tiempos = { comprimirMs: 0, subirMs: 0, enviarMs: 0, intentosDeSubida: 0, intentosDeEnvio: 0 };
    const medir = (resultado: "ok" | "fallida", motivo?: string) => {
      const linea = `[envio-medio] ${JSON.stringify({
        paso: "navegador",
        tipo: inicial.tipo,
        resultado,
        bytes: leerFoto(id)?.archivo.size ?? inicial.archivo.size,
        colaMs,
        comprimirMs: Math.round(tiempos.comprimirMs),
        subirMs: Math.round(tiempos.subirMs),
        enviarMs: Math.round(tiempos.enviarMs),
        intentosDeSubida: tiempos.intentosDeSubida,
        intentosDeEnvio: tiempos.intentosDeEnvio,
        totalMs: Math.round(performance.now() - arranque),
        ...(motivo ? { motivo } : {}),
      })}`;
      if (resultado === "ok") {
        console.info(linea);
      } else {
        console.warn(linea);
      }
    };
    const fallar = (motivo: string) => {
      actualizarFoto(id, { estado: "fallida", motivo });
      medir("fallida", motivo);
      return false;
    };

    let subida = inicial.subida;
    if (!subida) {
      actualizarFoto(id, { estado: "subiendo", motivo: null, avance: 0 });
      /*
        Antes de subir, el archivo tiene que leerse entero (archivo-legible.ts). Uno retomado tras
        una recarga puede venir ilegible de Safari: subirlo daba "No se recibió ningún archivo" en
        cada Reintentar. Ese queda en rojo con "se perdió" y sin Reintentar.
      */
      const lectura = await leerArchivoEntero(inicial.archivo);
      if (!lectura.ok) {
        console.warn(
          `[envio-medio] ${JSON.stringify({
            paso: "leer-archivo",
            tipo: inicial.tipo,
            resultado: lectura.motivo,
            bytes: inicial.archivo?.size ?? null,
            mime: inicial.archivo?.type ?? null,
            retomada: Boolean(inicial.retomada),
          })}`,
        );
        actualizarFoto(id, { archivoPerdido: true });
        return fallar(motivoDeArchivoPerdido(inicial.tipo, Boolean(inicial.retomada)));
      }
      // Fotos (JPEG, PNG, WEBP) a 1600 px y unos 400 KB. Si no se puede comprimir, sale la original.
      // Se guarda la comprimida: un reintento no la vuelve a comprimir.
      let archivo = inicial.archivo;
      if (inicial.tipo === "AUDIO") {
        // La nota sube con los bytes recien leidos, con su nombre y tipo (nota-de-voz-….m4a en iOS).
        const { tipo, extension } = tipoDeNotaDeVoz(inicial.archivo.type, esEquipoApple());
        archivo = new File([lectura.bytes], `nota-de-voz-${inicial.creadaEn.getTime()}.${extension}`, { type: tipo });
      }
      if (inicial.tipo === "IMAGE" && !inicial.comprimida) {
        const desde = performance.now();
        archivo = await comprimirFotoParaEnviar(archivo);
        tiempos.comprimirMs = performance.now() - desde;
        actualizarFoto(id, { archivo, comprimida: true });
      }
      const desde = performance.now();
      const resultado = await conReintentosAutomaticos(() =>
        subirArchivoEnEnvio(inicial, archivo, (avance) => actualizarFoto(id, { avance })),
      );
      tiempos.subirMs = performance.now() - desde;
      tiempos.intentosDeSubida = resultado.intentos;
      if (!resultado.ok) {
        return fallar(resultado.motivo);
      }
      subida = resultado.valor;
      actualizarFoto(id, { subida, avance: 1 });
      /*
        Se deja la foto ya descargada en el navegador antes de que llegue el mensaje real: la
        burbuja real la pide con esta misma direccion y aparece sin parpadear.
      */
      if (inicial.tipo === "IMAGE") {
        try {
          const precarga = new Image();
          precarga.decoding = "async";
          precarga.src = toProxiedMediaUrl(subida.url);
        } catch {
          // Sin precarga solo se pierde el "sin parpadeo".
        }
      }
    }

    actualizarFoto(id, { estado: "enviando", motivo: null });
    const subidaFinal = subida;
    const desdeElEnvio = performance.now();
    let intentosDeEnvio = 0;
    const envio = await conReintentosAutomaticos(async () => {
      /*
        Tope de 1 hora (plazo-de-envio.ts): un reintento automatico solo sale si el intento anterior
        fue hace menos de una hora; si no, el servidor ya no reconoceria la clave y podria duplicar.
        Con esperas de 1,5 s y 4 s no deberia pasar nunca: es la red de seguridad.
      */
      const actual = leerFoto(id);
      if (intentosDeEnvio > 0 && actual && plazoVencido(plazoDe(actual), Date.now())) {
        return { ok: false as const, motivo: MOTIVO_PASO_LA_HORA, reintentable: false };
      }
      intentosDeEnvio += 1;
      actualizarFoto(id, { intentoDeEnvioEn: Date.now() });
      try {
        let resultado: unknown;
        if (inicial.tipo === "AUDIO") {
          const destino = inicial.destinoDeAudio;
          if (!destino) {
            return { ok: false as const, motivo: "No se pudo preparar el envio.", reintentable: false };
          }
          resultado = await destino.sendAction({
            source: destino.source,
            conversationId: destino.conversationId,
            agentId: destino.agentId,
            // La nota de voz no lleva clave: el servidor reconoce la misma URL (NOTAS_DE_VOZ_EN_CURSO).
            audioUrl: subidaFinal.url,
            returnTo: destino.returnTo,
          });
        } else {
          const destino = inicial.destino;
          if (!destino || subidaFinal.mediaType === "AUDIO") {
            return { ok: false as const, motivo: "No se pudo preparar el envio.", reintentable: false };
          }
          resultado = await destino.sendAction({
            source: destino.source,
            conversationId: destino.conversationId,
            agentId: destino.agentId,
            mediaUrl: subidaFinal.url,
            mediaType: subidaFinal.mediaType,
            fileName: subidaFinal.fileName || inicial.archivo.name,
            mimeType: subidaFinal.mimeType || inicial.archivo.type,
            caption: inicial.caption || undefined,
            returnTo: destino.returnTo,
            clientMessageId: inicial.clave,
          });
        }
        return clasificarRespuestaDeEnvio({ resultado });
      } catch {
        return clasificarRespuestaDeEnvio({ excepcion: true });
      }
    });
    tiempos.enviarMs = performance.now() - desdeElEnvio;
    tiempos.intentosDeEnvio = envio.intentos;
    if (!envio.ok) {
      return fallar(envio.motivo);
    }
    marcarFotoEnviada(id);
    // Sin router.refresh(): la bandeja trae el mensaje real con /live (onEnvioTerminado).
    avisarEnvioTerminado({ conversationId: inicial.conversationId, tipo: subidaFinal.mediaType });
    medir("ok");
    return true;
  }, [avisarEnvioTerminado]);

  /*
    Lo que quedo guardado en el navegador de una pestaña anterior (se cerro o se recargo a mitad
    del envio) vuelve al chat y, si es reciente, se retoma solo (reanudarEnviosGuardados). Va con
    la version mas nueva de enviarFoto aunque el panel cambie.
  */
  const enviarFotoRef = useRef(enviarFoto);
  useEffect(() => {
    enviarFotoRef.current = enviarFoto;
  }, [enviarFoto]);
  useEffect(() => {
    void reanudarEnviosGuardados((foto) => {
      void encolarFoto(foto.id, foto.conversationId, (id) => enviarFotoRef.current(id));
    });
  }, []);

  /*
    Reintentar desde la burbuja roja: el mismo archivo y la misma clave, sin duplicar.

    Pasada la hora (plazo-de-envio.ts) el servidor ya no reconoce la clave: sale con una NUEVA, como
    envio nuevo, y se le avisa a la asesora que si ya habia llegado el cliente lo recibe dos veces.
  */
  const reintentarFoto = useCallback(
    (id: string) => {
      const foto = leerFoto(id);
      const decision = decidirReintento(foto);
      if (decision === "nada" || !foto) {
        return;
      }
      const { clave, nueva } = claveParaReintentar({ ...plazoDe(foto), clave: foto.clave }, Date.now(), nuevaClaveDeEnvio);
      if (nueva) {
        toast.warning(AVISO_REINTENTO_VENCIDO, { duration: 10000 });
      }
      // Se saca de "fallida" ANTES de empezar: un segundo toque ya no la reintenta.
      actualizarFoto(id, {
        ...(decision === "solo-enviar" ? { estado: "enviando" as const, motivo: null } : { estado: "subiendo" as const, motivo: null, avance: 0 }),
        // La clave nueva empieza de cero: su hora cuenta desde el proximo intento.
        ...(nueva ? { clave, intentoDeEnvioEn: null } : {}),
      });
      void encolarFoto(id, foto.conversationId, enviarFoto);
    },
    [enviarFoto],
  );

  const descartarFoto = useCallback((id: string) => {
    if (leerFoto(id)?.estado === "fallida") {
      quitarFotos([id]);
    }
  }, []);

  /*
    Uno o varios archivos: aparecen en el chat AL TOCAR ENVIAR, todos de una vez y como ya
    enviados, y salen por debajo en la cola del chat, en el orden elegido. No bloquea nada.

    Las revisiones de hoy van primero: un archivo que no se puede mandar (Excel/Word, HEIC, mas de
    100 MB) no crea burbuja, se avisa al instante y queda en la tarjeta de arriba del compositor. El
    mensaje escrito va con el primer archivo, como WhatsApp.
  */
  const uploadAndSendMediaFiles = useCallback(
    (files: File[], caption?: string, destinoDelReintento?: DestinoDeFoto) => {
      // El reintento de una tarjeta va a SU chat, no al que esta abierto ahora.
      const destino = destinoDelReintento ?? mediaConfig;
      if (!destino || files.length === 0) {
        return;
      }

      const nuevas: FotoEnEnvio[] = [];
      const rechazados: File[] = [];
      let motivoDelRechazo = "";
      const creadaEn = new Date();
      files.forEach((file, index) => {
        const revision = revisarArchivoAntesDeSubir(file);
        if (!revision.ok) {
          toast.error(revision.motivo, { duration: 10000 });
          rechazados.push(file);
          motivoDelRechazo = revision.motivo;
          return;
        }
        if (revision.aviso) {
          toast.warning(revision.aviso, { duration: 10000 });
        }
        // Si el telefono no dijo el tipo (Android con .xlsx o .csv), va el deducido por la extension.
        const archivo =
          revision.mime !== file.type
            ? new File([file], file.name, { type: revision.mime, lastModified: file.lastModified })
            : file;
        nuevas.push({
          id: nuevoIdDeFoto(),
          conversationId: destino.conversationId,
          tipo: tipoDeArchivo(revision.mime),
          clave: nuevaClaveDeEnvio(),
          destino,
          destinoDeAudio: null,
          archivo,
          comprimida: false,
          vistaPrevia: URL.createObjectURL(archivo),
          caption: index === 0 ? caption?.trim() || "" : "",
          duracionMs: null,
          subida: null,
          avance: 0,
          estado: "subiendo",
          motivo: null,
          // Un milisegundo de diferencia: el orden en el chat es el orden elegido.
          creadaEn: new Date(creadaEn.getTime() + index),
          enviadaEn: null,
          intentoDeEnvioEn: null,
        });
      });

      if (nuevas.length > 0) {
        agregarFotos(nuevas);
        window.requestAnimationFrame(() => onScrollToBottom());
        for (const nueva of nuevas) {
          void encolarFoto(nueva.id, nueva.conversationId, enviarFoto);
        }
      }

      // Lo rechazado se guarda para poder reintentarlo, en vez de perderse con el aviso. Cada
      // tarjeta con su chat y su destino.
      if (rechazados.length > 0) {
        agregarArchivosFallidos({
          id: nuevoIdDeFoto(),
          conversationId: destino.conversationId,
          destino,
          files: rechazados,
          // El mensaje escrito solo se repite si iba con el archivo rechazado.
          caption: rechazados[0] === files[0] ? caption : undefined,
          motivo: motivoDelRechazo,
        });
      }
    },
    [mediaConfig, enviarFoto, onScrollToBottom],
  );

  const stopRecordTracks = useCallback(() => {
    recordStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordStreamRef.current = null;
    const analizador = analizadorDeGrabacionRef.current;
    if (analizador) {
      clearInterval(analizador.temporizador);
      void analizador.contexto.close().catch(() => undefined);
      analizadorDeGrabacionRef.current = null;
    }
    setOndaEnVivo([]);
    setGrabacionPausada(false);
  }, []);

  const clearRecordTimer = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }, []);

  /*
    Una nota de voz grabada: aparece en el chat al instante, como ya enviada, y sale por debajo en
    la cola del chat (enviarFoto), igual que las fotos. Si falla tras los reintentos automaticos, la
    burbuja queda en rojo con Reintentar: el audio no se pierde, y el servidor reconoce la misma URL
    para no mandarla dos veces.
  */
  const uploadAndSendAudio = useCallback(
    (blob: Blob, mimeType: string, duracionMs: number) => {
      const destino = audioConfig;
      if (!destino) {
        return;
      }
      // El mime de MediaRecorder suele venir como "audio/webm;codecs=opus" (en el iPhone, audio/mp4
      // o nada): va el tipo base con su extension, nota-de-voz-….m4a / audio/mp4 en iOS.
      const { tipo, extension } = tipoDeNotaDeVoz(mimeType, esEquipoApple());
      const archivo = new File([blob], `nota-de-voz-${Date.now()}.${extension}`, { type: tipo });
      const nueva: FotoEnEnvio = {
        id: nuevoIdDeFoto(),
        conversationId: destino.conversationId,
        tipo: "AUDIO",
        clave: nuevaClaveDeEnvio(),
        destino: null,
        destinoDeAudio: destino,
        archivo,
        comprimida: false,
        vistaPrevia: URL.createObjectURL(archivo),
        caption: "",
        duracionMs,
        subida: null,
        avance: 0,
        estado: "subiendo",
        motivo: null,
        creadaEn: new Date(),
        enviadaEn: null,
        intentoDeEnvioEn: null,
      };
      agregarFotos([nueva]);
      window.requestAnimationFrame(() => onScrollToBottom());
      void encolarFoto(nueva.id, nueva.conversationId, enviarFoto);
    },
    [audioConfig, enviarFoto, onScrollToBottom],
  );

  const startAudioRecording = useCallback(async () => {
    if (!audioConfig || isRecordingAudio) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;

      /*
        La onda se mueve con la voz, como en WhatsApp: es lo que confirma que el microfono de verdad
        esta tomando sonido. Si el navegador no deja medir, se graba igual, sin onda.
      */
      try {
        const Contexto =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Contexto) {
          const contexto = new Contexto();
          const analizador = contexto.createAnalyser();
          analizador.fftSize = 512;
          contexto.createMediaStreamSource(stream).connect(analizador);
          const muestras = new Uint8Array(analizador.fftSize);
          const temporizador = setInterval(() => {
            if (mediaRecorderRef.current?.state === "paused") {
              return;
            }
            analizador.getByteTimeDomainData(muestras);
            let pico = 0;
            for (let indice = 0; indice < muestras.length; indice += 1) {
              pico = Math.max(pico, Math.abs(muestras[indice] - 128));
            }
            const nivel = Math.min(1, pico / 60);
            setOndaEnVivo((actual) => [...actual.slice(-(BARRAS_DE_GRABACION - 1)), nivel]);
          }, 110);
          analizadorDeGrabacionRef.current = { contexto, temporizador };
        }
      } catch {
        // Sin onda: la grabacion no depende de esto.
      }

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recordCancelledRef.current = false;
      // Para saber cuanto duro de verdad: el contador de la pantalla es estado y adentro de
      // `onstop` llegaria congelado en el valor del primer render.
      const arrancoEn = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearRecordTimer();
        stopRecordTracks();
        setIsRecordingAudio(false);
        setRecordSeconds(0);

        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        const cancelled = recordCancelledRef.current;
        // Sin tipo (pasa en Safari) se deduce despues, en uploadAndSendAudio (tipoDeNotaDeVoz).
        const mimeType = recorder.mimeType || "";

        if (cancelled) {
          return;
        }

        /*
          Grabo y no salio nada (0 bytes): el microfono lo tiene otra cosa, casi siempre una
          llamada de WhatsApp en curso (WaCalls). Se avisa y no se encola una nota vacia.
        */
        const grabado = new Blob(chunks, { type: mimeType });
        if (chunks.length === 0 || grabado.size === 0) {
          toast.error(MENSAJE_MICROFONO_OCUPADO, { duration: 10000 });
          return;
        }

        /*
          Una nota de voz de cero segundos NO se manda.

          Medido en produccion: 21 de 657 notas de voz pesan menos de 20 KB, y la mas chica 110
          bytes —un contenedor vacio—. Son las que la asesora toca y suelta al instante, o donde
          el microfono todavia no habia arrancado. Se subian igual, llegaban al cliente como una
          burbuja que no suena, y quedaban asi para siempre: el archivo no se puede reparar.

          Se miran las dos cosas porque ninguna alcanza sola: el tiempo no sirve si el microfono
          tardo en arrancar (medio segundo de silencio igual da un archivo inutil) y el peso
          depende del codec. Cualquiera de las dos que falle, se descarta y se avisa.
        */
        const duroMs = Date.now() - arrancoEn;
        if (duroMs < 1000) {
          toast.error("La nota de voz quedó muy corta. Mantén el botón mientras hablas.");
          return;
        }
        // Mas de un segundo y casi sin bytes: el microfono no estaba entregando sonido.
        if (grabado.size < 2000) {
          toast.error(MENSAJE_MICROFONO_OCUPADO, { duration: 10000 });
          return;
        }

        void uploadAndSendAudio(grabado, mimeType, duroMs);
      };

      /*
        Si una llamada le quita el microfono a mitad de la nota (la pista termina o el grabador
        falla), se corta sin mandar un pedazo y se avisa.
      */
      const cortarPorMicrofono = () => {
        if (recorder.state === "inactive" || recordCancelledRef.current) {
          return;
        }
        recordCancelledRef.current = true;
        toast.error(MENSAJE_MICROFONO_OCUPADO, { duration: 10000 });
        try {
          recorder.stop();
        } catch {
          clearRecordTimer();
          stopRecordTracks();
          setIsRecordingAudio(false);
          setRecordSeconds(0);
        }
      };
      recorder.onerror = cortarPorMicrofono;
      stream.getAudioTracks().forEach((pista) => {
        pista.addEventListener("ended", cortarPorMicrofono);
      });

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecordingAudio(true);
      setRecordSeconds(0);
      setGrabacionPausada(false);
      recordTimerRef.current = setInterval(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          setRecordSeconds((value) => value + 1);
        }
      }, 1000);
    } catch (error) {
      // getUserMedia o MediaRecorder no arrancaron: sin permiso, o el microfono esta ocupado.
      console.warn(
        `[nota-de-voz] ${JSON.stringify({ paso: "microfono", resultado: (error as { name?: string } | null)?.name ?? "desconocido" })}`,
      );
      toast.error(mensajeDeFallaDelMicrofono(error), { duration: 10000 });
      stopRecordTracks();
      setIsRecordingAudio(false);
    }
  }, [audioConfig, clearRecordTimer, isRecordingAudio, stopRecordTracks, uploadAndSendAudio]);

  const stopAndSendAudio = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      recordCancelledRef.current = false;
      mediaRecorderRef.current.stop();
    }
  }, []);

  const alternarPausaDeGrabacion = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      return;
    }
    if (recorder.state === "recording" && typeof recorder.pause === "function") {
      recorder.pause();
      setGrabacionPausada(true);
    } else if (recorder.state === "paused") {
      recorder.resume();
      setGrabacionPausada(false);
    }
  }, []);

  const cancelAudioRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      recordCancelledRef.current = true;
      mediaRecorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    return () => {
      clearRecordTimer();
      stopRecordTracks();
    };
  }, [clearRecordTimer, stopRecordTracks]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHAT_COMPOSER_RECENT_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return;
      }

      const nextRecent = parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
      if (nextRecent.length > 0) {
        setRecentComposerEmojis(nextRecent.slice(0, 24));
      }
    } catch {
      // Ignore storage parsing issues.
    } finally {
      setRecentComposerEmojisReady(true);
    }
  }, []);

  useEffect(() => {
    if (!recentComposerEmojisReady) {
      return;
    }

    try {
      window.localStorage.setItem(CHAT_COMPOSER_RECENT_KEY, JSON.stringify(recentComposerEmojis.slice(0, 24)));
    } catch {
      // Ignore storage write issues.
    }
  }, [recentComposerEmojis, recentComposerEmojisReady]);

  useEffect(() => {
    composerSelectionRef.current = { start: 0, end: 0 };
    setIsEmojiPickerOpen(false);
    setEmojiSearchQuery("");
    setEmojiPickerTab("todos");
  }, [selectedConversationId]);

  const syncComposerSelection = useCallback((target: HTMLTextAreaElement | null) => {
    if (!target) {
      return;
    }

    composerSelectionRef.current = {
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length,
    };
  }, []);

  // Ajusta la altura del textarea al contenido para que se expanda hacia arriba
  // (el composer esta anclado abajo) en lugar de mostrar scroll. Solo aparece
  // scroll una vez superada la altura maxima.
  const autoResizeComposer = useCallback((target: HTMLTextAreaElement | null) => {
    if (!target) {
      return;
    }

    // Tope de unas 6 lineas segun el alto real de la linea de cada pantalla (16px celular, 15px compu).
    const estilo = window.getComputedStyle(target);
    const altoLinea = Number.parseFloat(estilo.lineHeight) || 22;
    const relleno = Number.parseFloat(estilo.paddingTop) + Number.parseFloat(estilo.paddingBottom) || 0;
    const maxHeight = Math.round(altoLinea * 6 + relleno);
    target.style.height = "auto";
    const nextHeight = Math.min(target.scrollHeight, maxHeight);
    target.style.height = `${nextHeight}px`;
    target.style.overflowY = target.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  /*
    Borrador por chat: el texto a medias se guarda en la pestaña y vuelve igual al cambiar de chat o
    al recargar. La caja es no controlada: se lee y se escribe directo en el textarea. Con algo
    escrito la app nunca se recarga sola (src/lib/actualizacion-automatica.ts).
  */
  const hayCajaDeTexto = Boolean(composer && renderedConversation);
  const borradorTimerRef = useRef<number | null>(null);
  /*
    El chat abierto AHORA MISMO. Lo que llega tarde del servidor (la sugerencia de la ✨) lo mira
    para no escribir en la caja de otro chat: la caja es la misma al cambiar de chat.
  */
  const chatAbiertoRef = useRef(selectedConversationId ?? "");
  useEffect(() => {
    chatAbiertoRef.current = selectedConversationId ?? "";
  }, [selectedConversationId]);
  const guardarBorradorAhora = useCallback((chat: string) => {
    if (borradorTimerRef.current !== null) {
      window.clearTimeout(borradorTimerRef.current);
      borradorTimerRef.current = null;
    }
    const textarea = composerTextAreaRef.current;
    if (textarea && chat) {
      guardarBorrador(chat, textarea.value);
    }
  }, []);
  useEffect(() => {
    const chat = selectedConversationId ?? "";
    const textarea = composerTextAreaRef.current;
    if (textarea && chat) {
      const borrador = leerBorrador(chat);
      textarea.value = borrador;
      setComposerHasText(borrador.trim().length > 0);
      autoResizeComposer(textarea);
    }
    const guardarYa = () => guardarBorradorAhora(chat);
    window.addEventListener("pagehide", guardarYa);
    return () => {
      window.removeEventListener("pagehide", guardarYa);
      // Al cambiar de chat, el texto del que se deja queda guardado en el suyo.
      guardarYa();
    };
  }, [selectedConversationId, hayCajaDeTexto, autoResizeComposer, guardarBorradorAhora]);
  // El texto de la caja se lee en el momento de decidir (tambien cuenta el que se puso sin teclear).
  useEffect(
    () =>
      registrarLectorDeTexto("caja-del-chat", () => (composerTextAreaRef.current?.value ?? "").trim().length > 0),
    [],
  );
  // Avisos de "ocupada": mientras haya algo en curso, la app no se recarga sola.
  useEffect(() => {
    // Los archivos en envio se marcan aparte ("fotos-en-envio", mas arriba).
    marcarOcupada("enviando", enviandoTexto, "envio");
    marcarOcupada("grabando", isRecordingAudio);
    marcarOcupada("adjuntar", isAttachMenuOpen || pendingMediaFiles.length > 0);
    return () => {
      marcarOcupada("enviando", false);
      marcarOcupada("grabando", false);
      marcarOcupada("adjuntar", false);
    };
  }, [enviandoTexto, isRecordingAudio, isAttachMenuOpen, pendingMediaFiles.length]);

  const firma = chatSignature.trim();

  /**
   * Interruptor para mandar SIN firma.
   *
   * La firma la agrega el servidor al enviar, asi que en el campo no se ve y no habia forma de
   * sacarla cuando no correspondia: un dato suelto, una respuesta seca, un reenvio. Esto la apaga
   * para los mensajes que siguen —queda apagada hasta que se vuelva a prender— sin tener que
   * borrarla a mano cada vez.
   */
  const [firmaActiva, setFirmaActiva] = useState(true);

  const insertComposerEmoji = useCallback((emoji: string) => {
    const textarea = composerTextAreaRef.current;
    if (!textarea) {
      return;
    }

    const currentValue = textarea.value;
    const fallbackSelection = composerSelectionRef.current;
    const start = textarea.selectionStart ?? fallbackSelection.start ?? currentValue.length;
    const end = textarea.selectionEnd ?? fallbackSelection.end ?? currentValue.length;
    const nextCursor = start + emoji.length;

    textarea.setRangeText(emoji, start, end, "end");
    composerSelectionRef.current = { start: nextCursor, end: nextCursor };
    setComposerHasText(textarea.value.trim().length > 0);
    autoResizeComposer(textarea);
    setIsEmojiPickerOpen(false);
    setEmojiSearchQuery("");
    setRecentComposerEmojis((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, 24));

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [autoResizeComposer]);

  // Inserta el texto de una respuesta rápida en el cuadro (en la posición del cursor),
  // sin enviarlo, para que la chica lo revise/edite antes de mandar.
  const insertQuickReply = useCallback((content: string) => {
    const textarea = composerTextAreaRef.current;
    if (!textarea) {
      return;
    }

    const currentValue = textarea.value;
    const fallbackSelection = composerSelectionRef.current;
    const start = textarea.selectionStart ?? fallbackSelection.start ?? currentValue.length;
    const end = textarea.selectionEnd ?? fallbackSelection.end ?? currentValue.length;
    const nextCursor = start + content.length;

    textarea.setRangeText(content, start, end, "end");
    composerSelectionRef.current = { start: nextCursor, end: nextCursor };
    setComposerHasText(textarea.value.trim().length > 0);
    setDesdeRespuestaRapida(true);
    autoResizeComposer(textarea);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }, [autoResizeComposer]);

  // El panel de envio inserta su mensaje como una respuesta rapida y deja anotado su total.
  const insertarDesdePanelDeEnvio = useCallback(
    (content: string, total?: string) => {
      insertQuickReply(content);
      totalDelPanelEnLaCaja.current = total ? { total, chat: selectedConversationId ?? "" } : null;
    },
    [insertQuickReply, selectedConversationId],
  );

  const handleSuggestReply = useCallback(async () => {
    // Se usa el chat REALMENTE abierto y no mediaConfig: en los chats de la API oficial ese
    // config no existía, así que el botón ✨ se veía pero al tocarlo no pasaba NADA (ni un aviso).
    const conversationId =
      renderedConversation?.id ?? mediaConfig?.conversationId ?? audioConfig?.conversationId;
    if (!conversationId || isSuggestingReply) {
      return;
    }

    // El chat donde se toco ✨: la sugerencia es para este cliente y no para otro.
    const chatPedido = selectedConversationId ?? "";
    setIsSuggestingReply(true);
    try {
      // La fuente sale de la clave del chat abierto: los de la API oficial se leen de otra tabla.
      const fuente = selectedConversationId?.startsWith("official:") ? "official" : "agent";
      const result = await generateSuggestedReplyAction(conversationId, fuente);
      if (result.error || !result.suggestion) {
        toast.error(result.error || "No se pudo generar la sugerencia");
        return;
      }
      // El boton "Enviar flujo" se ve solo en el chat donde se pidio, igual que antes.
      setFlujoSugerido(
        result.flujo
          ? { ...result.flujo, sugerenciaId: result.sugerenciaId ?? null, chat: chatPedido }
          : null,
      );

      // Si la asesora ya esta en otro chat, la caja a la vista es la de ese otro cliente: no se toca.
      const destino = dondeVaLaSugerencia({
        chatPedido,
        chatAbierto: chatAbiertoRef.current,
        borradorDelChatPedido: leerBorrador(chatPedido),
      });
      if (destino === "borrador") {
        guardarBorrador(chatPedido, result.suggestion);
        toast.info("La sugerencia era para otro chat: quedó en su caja.");
        return;
      }
      if (destino === "descartar") {
        toast.info("La sugerencia era para otro chat y no se usó.");
        return;
      }

      sugerenciaEnLaCaja.current = result.sugerenciaId
        ? { id: result.sugerenciaId, chat: chatPedido }
        : null;
      const textarea = composerTextAreaRef.current;
      if (textarea) {
        const suggestion = result.suggestion;
        textarea.value = suggestion;
        composerSelectionRef.current = { start: suggestion.length, end: suggestion.length };
        setComposerHasText(suggestion.trim().length > 0);
        autoResizeComposer(textarea);
        window.requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(suggestion.length, suggestion.length);
        });
      }
    } catch (error) {
      console.error("[handleSuggestReply] error", error);
      toast.error("No se pudo generar la sugerencia");
    } finally {
      setIsSuggestingReply(false);
    }
  }, [renderedConversation?.id, mediaConfig?.conversationId, audioConfig?.conversationId, isSuggestingReply, autoResizeComposer, selectedConversationId]);

  /*
    Envio a la ubicacion del cliente, consultado en Gestion (ver panel-de-envio.tsx). Va en las dos
    fichas (celular y escritorio). Al guardar la ubicacion se actualiza la ciudad de la ficha y se
    descarta la cache del contacto para que la proxima lectura traiga la nueva.
  */
  const contactoDelEnvio = renderedConversation?.contactId || null;
  // El panel se monta solo cuando la asesora lo pide, y por chat: al cambiar de chat vuelve al botón.
  // Asi no consulta Gestion en cada cambio de chat ni retrasa el envio de mensajes (server actions en serie).
  const chatDelEnvio = selectedConversationId || null;
  const envioAbierto = Boolean(chatDelEnvio) && envioAbiertoEn === chatDelEnvio;
  const panelDeEnvio = contactoDelEnvio ? (
    <div className="mt-5 space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Envío
      </h4>
      {!envioAbierto ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => setEnvioAbiertoEn(chatDelEnvio)}
          disabled={!chatDelEnvio}
        >
          Calcular envío
        </Button>
      ) : (
      <PanelDeEnvio
        key={`${chatDelEnvio}|${contactoDelEnvio}`}
        contactId={contactoDelEnvio}
        chatKey={selectedConversationId || null}
        contactCity={contactCity}
        puedeEscribir={Boolean(composer)}
        onInsertar={insertarDesdePanelDeEnvio}
        onCiudadGuardada={(city) => {
          setContactCity(city);
          cacheDeContactos.delete(contactoDelEnvio);
        }}
      />
      )}
    </div>
  ) : null;

  const contactPanelContent = renderedConversation ? (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="flex items-center gap-3">
        <ContactAvatar
          avatarUrl={renderedConversation.avatarUrl}
          label={renderedConversation.label}
          className="h-12 w-12 shrink-0 rounded-full border border-border bg-muted text-muted-foreground"
          fallbackClassName="rounded-full bg-muted text-muted-foreground"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-semibold text-foreground">
            {renderedConversation.label}
          </p>
          {renderedConversation.secondaryLabel ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{renderedConversation.secondaryLabel}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(renderedConversation.secondaryLabel);
                  toast.success("Copiado");
                }}
                aria-label="Copiar número"
                title="Copiar"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          {contactCity ? (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{contactCity}</span>
            </p>
          ) : null}
          {contactOrigin ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Megaphone className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate" title={contactOrigin.etiqueta}>
                {contactOrigin.anuncioUrl ? (
                  <a href={contactOrigin.anuncioUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                    {contactOrigin.etiqueta}
                  </a>
                ) : (
                  contactOrigin.etiqueta
                )}
              </span>
            </p>
          ) : null}
          {contactOrigin?.campanaNombre ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate" title={`Campaña: ${contactOrigin.campanaNombre}`}>
                Campaña: {contactOrigin.campanaNombre}
              </span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {renderedConversation.contactId ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onEditContact}
            className="h-8 w-8"
            aria-label="Editar"
            title="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {/*
          Sumar este chat al mapa de caminos.

          Solo para dueño/admin: cada chat que entra cuesta una llamada a la IA, y esto se enciende
          para ver si sirve antes de dejarlo suelto para todo el equipo.
        */}
        {isManager && idDeLaConversacionParaElMapa ? (
          <BotonDeMapaDeCaminos conversationId={idDeLaConversacionParaElMapa} />
        ) : null}
      </div>

      <div className="mt-5">
        <ChatTagsControl
          contactId={renderedConversation.contactId}
          conversationId={renderedConversation.id}
          tags={contactPanelTags ?? renderedConversation.tags ?? []}
          canDelete={canDeleteTags}
        />
      </div>

      {panelDeEnvio}

      {contactPanelActions ? (
        <div className="mt-5 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Agente asignado
          </h4>
          {contactPanelActions}
        </div>
      ) : null}
    </div>
  ) : null;

  const mensajesSeleccionados = displayedMessages.filter((mensaje) =>
    seleccionados.includes(mensaje.id),
  );
  /*
    Con UNA sola marcada se puede responder y reenviar; con varias, no.

    Responder cita un mensaje: citar cinco no existe. Reenviar de a varios si existe en WhatsApp,
    pero la ventana de reenvio de aca manda uno; antes que reenviar el primero y perder los otros
    en silencio, el boton no aparece.
  */
  const unicoSeleccionado = mensajesSeleccionados.length === 1 ? mensajesSeleccionados[0] : null;

  // Lo que se copiaria de los marcados; null si ninguno tiene texto (el boton Copiar no aparece).
  const textoDeLosSeleccionados = textoDeVariosParaCopiar(mensajesSeleccionados);

  const copiarSeleccionados = () => {
    const texto = textoDeLosSeleccionados;
    if (!texto) {
      toast.error("Los mensajes marcados no tienen texto para copiar");
      return;
    }
    // Se copia en el mismo toque (sin esperar nada antes): si no, Safari no deja copiar.
    void Promise.resolve(copiarAlPortapapeles(texto)).then((copiado) => {
      if (!copiado) {
        toast.error("No se pudo copiar");
        return;
      }
      toast.success("Copiado");
      setSeleccionados([]);
    });
  };

  // overflow-clip (no overflow-hidden) en la tarjeta: con hidden el navegador podia correr la
  // tarjeta de lado al enfocar la caja de escribir y su borde izquierdo quedaba cortado (T-314).
  return (
    <Card
      className={`${selectedConversationId ? "flex md:flex" : "!hidden md:!flex"} chat-inbox-panel relative min-h-0 flex-1 overflow-clip rounded-none border border-border bg-transparent p-0 shadow-none md:h-full md:shadow-[0_24px_60px_-44px_rgba(15,23,42,0.18)]`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={CHAT_MESSAGES_BACKGROUND_BASE_STYLE} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.14] dark:invert" style={CHAT_MESSAGES_BACKGROUND_OVERLAY_STYLE} />
      {renderedConversation ? (
        <div className="relative z-10 flex min-h-0 h-full w-full flex-1">
        {/* @container/chathdr: la cabecera y la barra de abajo deciden por el ANCHO DEL CHAT, no
            de la pantalla, asi reaccionan tambien a la ficha del contacto abierta. */}
        <div className="@container/chathdr flex min-h-0 h-full min-w-0 flex-1 flex-col overflow-x-clip">
          <div className="shrink-0 border-b border-border bg-card px-3 pb-2 pt-[max(env(safe-area-inset-top),0.5rem)] min-h-[3.25rem] md:min-h-0 md:px-[10px] md:py-[10px]">
            {/*
              Los accesos rapidos de la seleccion, en el lugar de la cabecera.

              WhatsApp no agrega una barra: REEMPLAZA la de arriba mientras haya mensajes marcados.
              Asi la conversacion no se corre ni un pixel al marcar, y los botones caen donde el
              pulgar ya estaba. Al salir, la cabecera vuelve tal cual estaba.
            */}
            {seleccionados.length > 0 ? (
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSeleccionados([])}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted"
                  aria-label="Salir de la seleccion"
                >
                  <X className="h-5 w-5" />
                </button>
                <span className="text-[16px] font-semibold tabular-nums text-foreground">
                  {seleccionados.length}
                </span>

                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  {unicoSeleccionado && onReplyToMessage ? (
                    <button
                      type="button"
                      onClick={() => {
                        onReplyToMessage(unicoSeleccionado);
                        setSeleccionados([]);
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-muted"
                      aria-label="Responder"
                      title="Responder"
                    >
                      <CornerUpLeft className="h-5 w-5" />
                    </button>
                  ) : null}

                  {unicoSeleccionado ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMensajeAReenviar(unicoSeleccionado);
                        setSeleccionados([]);
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-muted"
                      aria-label="Reenviar"
                      title="Reenviar"
                    >
                      <Forward className="h-5 w-5" />
                    </button>
                  ) : null}

                  {textoDeLosSeleccionados ? (
                    <button
                      type="button"
                      onClick={copiarSeleccionados}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-muted"
                      aria-label="Copiar"
                      title="Copiar"
                    >
                      <Copy className="h-5 w-5" />
                    </button>
                  ) : null}

                  {onDeleteMessage ? (
                    <button
                      type="button"
                      onClick={() => {
                        // Se copia la lista antes de borrar: cada borrado cambia la conversacion y
                        // `mensajesSeleccionados` se recalcularia en el medio del recorrido.
                        const aBorrar = [...mensajesSeleccionados];
                        setSeleccionados([]);
                        aBorrar.forEach((mensaje) => onDeleteMessage(mensaje));
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-muted"
                      aria-label="Eliminar"
                      title="Eliminar"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  ) : null}

                  <Popover>
                    <PopoverTrigger
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-muted"
                      aria-label="Mas opciones"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-44 border border-border bg-popover p-1 text-popover-foreground">
                      <button
                        type="button"
                        onClick={copiarSeleccionados}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition hover:bg-muted"
                      >
                        <Copy className="size-4" /> Copiar texto
                      </button>
                      <button
                        type="button"
                        onClick={() => setSeleccionados(displayedMessages.filter((m) => !esFotoEnEnvio(m.id)).map((m) => m.id))}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground transition hover:bg-muted"
                      >
                        <MessageSquareText className="size-4" /> Marcar todos
                      </button>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            ) : (
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Link
                  href={backHref}
                  prefetch={false}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
                      return;
                    }

                    // Volver a la lista tampoco navega: alcanza con cerrar el chat en la fuente
                    // unica (es lo que decide que vista se ve en movil) y devolver la URL.
                    // Navegando se re-ejecutarian las consultas caras de la pagina solo para
                    // pintar la lista que ya esta en memoria.
                    event.preventDefault();
                    clearPendingConversationSelection();
                    window.history.pushState(null, "", backHref);
                  }}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-foreground transition hover:opacity-70 md:hidden"
                  aria-label="Volver a chats"
                >
                  <ArrowLeft className="h-6 w-6" />
                </Link>
                <div
                  className={`flex min-w-0 items-center gap-3 transition-opacity duration-200 ease-out ${
                    hasSettledConversation ? "opacity-100" : "opacity-80"
                  }`}
                >
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        onClick={() => setIsContactPanelOpen((open) => !open)}
                        className="group relative shrink-0 rounded-full transition focus:outline-none focus:ring-2 focus:ring-ring/50"
                        aria-label={isContactPanelOpen ? "Cerrar detalles del contacto" : "Abrir detalles del contacto"}
                        title="Contacto"
                      >
                        <span className="relative block">
                          {/*
                            La MISMA miniatura de la lista (iPhone, 11-11-2026): ya esta en el
                            navegador, asi que la foto sale al abrir el chat y no un circulo vacio.
                            Para un circulo de 36 px alcanza y sobra.
                          */}
                          <ContactAvatar
                            avatarUrl={renderedConversation.avatarUrl}
                            label={renderedConversation.label}
                            className="h-9 w-9 rounded-full border-0 bg-muted text-muted-foreground after:border-0 transition"
                            fallbackClassName="rounded-full bg-muted text-muted-foreground"
                            miniatura
                          />
                        </span>
                      </TooltipTrigger>
                      {renderedConversation.secondaryLabel ? (
                        <TooltipContent side="right">
                          {renderedConversation.secondaryLabel}
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                  </TooltipProvider>
                  <div className="min-w-0 space-y-0.5">
                    {/*
                      Nombre y telefono en grande: es el dato que confirma A QUIEN le estas
                      escribiendo, y se mira de reojo mientras se escribe. Con 13px se leia como
                      un detalle secundario del encabezado.
                    */}
                    <h2 className="truncate text-[14px] font-semibold leading-tight text-foreground">
                      {renderedConversation.label}
                    </h2>
                    {/*
                      El telefono, a la vista. Antes solo aparecia al pasar el mouse por la foto:
                      en el celular eso no existe, asi que para saber a quien le estaban
                      escribiendo tocaba abrir el panel del contacto. Se omite cuando el nombre
                      YA es el numero (contacto sin nombre), para no escribirlo dos veces.
                    */}
                    {escribiendo || enLinea ? (
                      /* Reemplaza al telefono, como hace WhatsApp: el dato de ahora importa mas. */
                      <p className="truncate text-[13px] font-medium leading-tight text-emerald-600 dark:text-emerald-400">
                        {escribiendo === "grabando"
                          ? "grabando audio…"
                          : escribiendo
                            ? "escribiendo…"
                            : "en línea"}
                      </p>
                    ) : renderedConversation.secondaryLabel &&
                      renderedConversation.secondaryLabel !== renderedConversation.label ? (
                      <p className="truncate text-[13px] leading-tight text-muted-foreground">
                        {renderedConversation.secondaryLabel}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              {/*
                Con los botones listos se dibujan YA, aunque el chat siga cargando (iPhone,
                11-11-2026): salen de la fila de la lista (ver clientHeaderActions en shared-inbox) y
                al llegar /live solo cambian los datos, sin correr nada.
              */}
              {(hasSettledConversation || headerActions) && (headerActions || headerBadge || headerBar || mediaConfig) ? (
                <div className="flex shrink-0 items-center justify-end gap-2">
                  {headerActions}
                  {headerBadge}
                  {/* Esconde o muestra la barra de abajo. Solo existe donde existe la barra. */}
                  {headerBar || mediaConfig ? (
                    <button
                      type="button"
                      onClick={alternarBarra}
                      aria-expanded={barraVisible}
                      aria-label={barraVisible ? "Ocultar la barra de acciones" : "Mostrar la barra de acciones"}
                      title={barraVisible ? "Ocultar acciones" : "Mostrar acciones"}
                      className="-ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted @min-[520px]/chathdr:hidden"
                    >
                      <ChevronDown className={`size-5 transition-transform ${barraVisible ? "rotate-180" : ""}`} />
                    </button>
                  ) : null}
                </div>
              ) : !hasSettledConversation && barraAnticipada && headerBar ? (
                /*
                  Mientras llega el chat: el lugar de "Llamar" en silueta y el boton de la barra ya
                  funcionando, con el mismo ancho que tendran. Solo con la cabecera angosta, que es
                  donde vive la barra; los botones del chat anterior no se muestran.
                */
                <div className="flex shrink-0 items-center justify-end gap-2 @min-[520px]/chathdr:hidden">
                  <Skeleton aria-hidden="true" className="size-8 rounded-full" />
                  <button
                    type="button"
                    onClick={alternarBarra}
                    aria-expanded={barraVisible}
                    aria-label={barraVisible ? "Ocultar la barra de acciones" : "Mostrar la barra de acciones"}
                    title={barraVisible ? "Ocultar acciones" : "Mostrar acciones"}
                    className="-ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted"
                  >
                    <ChevronDown className={`size-5 transition-transform ${barraVisible ? "rotate-180" : ""}`} />
                  </button>
                </div>
              ) : null}
            </div>
            )}
          </div>

          {/*
            Barra de primera accion, solo con la cabecera angosta (celular, o ficha abierta): arriba
            no entra y antes vivia escondida en tres puntos. Con la cabecera ancha todo esto ya
            esta arriba, en linea.
          */}
          {(hasSettledConversation || barraAnticipada) && seleccionados.length === 0 && barraVisible && (headerBar || mediaConfig) ? (
            /*
              Resolver va fijo a la derecha (sticky, en chat-header-actions) y trae su propio
              espacio a la derecha: por eso aca no hay pr-3 cuando hay barra, si no quedaria un
              hueco al lado de Resolver. data-hay-mas prende la flechita que va pegada a Resolver.
            */
            <div
              ref={refBarraQueSeDesliza}
              data-hay-mas={barraHayMas ? "true" : "false"}
              className={`group/barra flex min-w-0 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card py-1.5 pl-3 @min-[520px]/chathdr:hidden ${headerBar ? "" : "pr-3"}`}
            >
              {headerBar}
              {!mediaConfig && barraAnticipada ? (
                // Nota, seguimiento y etiquetas, en silueta hasta que el chat este cargado.
                <div className="ml-auto flex items-center gap-1.5" aria-hidden="true">
                  <Skeleton className={`${ALTO_DE_LA_BARRA} w-8 rounded-lg`} />
                  <Skeleton className={`${ALTO_DE_LA_BARRA} w-12 rounded-lg`} />
                  <Skeleton className={`${ALTO_DE_LA_BARRA} w-8 rounded-lg`} />
                </div>
              ) : null}
              {mediaConfig ? (
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsNoteOpen(true)}
                    aria-label="Nota interna"
                    title="Nota interna"
                    className={CLASES_BOTON_DE_LA_BARRA}
                    onContextMenu={mostrarNombreAlMantener("Nota interna")}
                  >
                    <StickyNote className="size-4 text-[#eab308]" />
                    <span className={CLASES_ETIQUETA_DE_LA_BARRA}>Nota</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFollowUpOpen(true)}
                    aria-label="Agendar seguimiento"
                    title="Agendar seguimiento"
                    className={CLASES_BOTON_DE_LA_BARRA}
                    onContextMenu={mostrarNombreAlMantener("Agendar seguimiento")}
                  >
                    <CalendarPlus className="size-4 text-[#0ea5e9]" />
                    <span className={CLASES_ETIQUETA_DE_LA_BARRA}>Agendar</span>
                  </button>
                  {/* Mientras carga, el contacto sale de la fila de la lista: el boton no aparece despues. */}
                  {renderedConversation.contactId || contactIdDeLaFila ? (
                    <ChatTagsControl
                      contactId={(renderedConversation.contactId || contactIdDeLaFila) as string}
                      conversationId={renderedConversation.id}
                      tags={contactPanelTags ?? renderedConversation.tags ?? []}
                      canDelete={canDeleteTags}
                      soloBoton
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/*
            Pestañas del chat. "Cotizaciones" tiene la ficha de datos del cliente: la que hoy se
            llena releyendo la conversacion hacia arriba para copiar la cedula y la direccion.
          */}
          {/* overflow-x-clip (no auto): recorta solo de lado y deja ver el -mb-px del subrayado activo. */}
          <div className="flex min-w-0 shrink-0 items-center gap-4 overflow-x-clip border-b border-border bg-card px-3 md:px-5">
            {(["mensajes", "cotizaciones"] as const).map((pestana) => {
              const activa = pestanaChat === pestana;
              return (
                <button
                  key={pestana}
                  type="button"
                  onClick={() => setPestanaChat(pestana)}
                  aria-current={activa ? "page" : undefined}
                  className={`-mb-px border-b-2 px-1 py-2 text-[13px] font-medium transition ${
                    activa
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {pestana === "mensajes" ? "Mensajes" : "Cotizaciones"}
                </button>
              );
            })}
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col bg-transparent">
            {pestanaChat === "cotizaciones" ? (
              <div className="absolute inset-0 z-30 flex flex-col bg-background">
                {renderedConversation?.contactId ? (
                  /*
                    Con `key` por contacto: al saltar de un chat a otro el componente arranca de
                    cero. Sin eso quedaban a la vista las sugerencias de un cliente sobre la ficha
                    del siguiente, que es la peor forma posible de equivocar una direccion.
                  */
                  <FichaDeCotizacion
                    key={renderedConversation.contactId}
                    contactId={renderedConversation.contactId}
                    conversationId={selectedConversationId ?? undefined}
                    enviarAlChat={composer ? enviarTextoAlChat : undefined}
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                    <FileText className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">Cotizaciones</p>
                    <p className="max-w-xs text-xs text-muted-foreground">
                      Abre un chat para ver los datos del cliente.
                    </p>
                  </div>
                )}
              </div>
            ) : null}
            {/*
              La pregunta del cierre, arriba de los mensajes.

              Va acá y no en el Kanban porque este es el momento y el lugar donde la asesora sabe
              si se cerró. Pedirle que se acuerde de ir a arrastrar la tarjeta despues es
              exactamente lo que no pasaba: 4 ventas registradas en toda la historia del CRM.
            */}
            {renderedConversation?.cierrePendiente && renderedConversation.contactId && !cierreRespondido ? (
              <AvisoDeCierre
                contactId={renderedConversation.contactId}
                alResponder={() => setCierreRespondido(true)}
              />
            ) : null}
            {/* Que paso en la ultima llamada con este cliente, y "¿Cómo quedó?" si falta. */}
            {renderedConversation?.contactId ? (
              <AvisoDeLlamada
                key={renderedConversation.contactId}
                contactId={renderedConversation.contactId}
                conversationId={selectedConversationId ?? null}
                nombre={renderedConversation.label}
                // Llega con los mensajes (/live): sin server action aparte ni salto.
                inicial={renderedConversation.ultimaLlamada}
              />
            ) : null}
            <div className="relative min-h-0 flex-1">
              <div
                ref={messagesScrollRef}
                className="chat-messages-scroll h-full overflow-y-auto overscroll-contain bg-transparent px-2.5 py-2.5 pb-3 [-webkit-overflow-scrolling:touch] md:px-5 md:py-5 md:pb-5"
              >
                <div className="flex min-h-full flex-col justify-end">
                  {renderedConversation?.isPreview && estadoCarga === "error" ? (
                    // Antes la ruedita giraba sin fin si /live fallaba: ahora se dice y se puede reintentar.
                    <div className="flex justify-center pb-2.5 pt-1" role="alert">
                      <div className="flex max-w-xs flex-col items-center gap-2 rounded-2xl border border-amber-500/40 bg-card px-4 py-3 text-center text-[13px] text-foreground shadow-sm">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300">
                          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                          No se pudo abrir el chat
                        </span>
                        <span className="text-muted-foreground">Revisa la conexión. Mientras no cargue, no se puede enviar.</span>
                        {onReintentarCarga ? (
                          <button
                            type="button"
                            onClick={onReintentarCarga}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[var(--primary)] px-4 font-semibold text-[var(--primary-foreground)] transition hover:opacity-90"
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            Reintentar
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : renderedConversation?.isPreview ? (
                    <div
                      className="flex justify-center pb-2.5 pt-1"
                      role="status"
                      aria-label="Cargando conversación"
                    >
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted text-foreground shadow-sm">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      </span>
                    </div>
                  ) : null}
                  {canLoadOlderMessages ? (
                    <div className="pb-2 pt-1">
                      <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-px w-full" />
                      {/*
                        Mismo tratamiento que la pastilla de fecha, y por el mismo motivo: flota
                        sobre el fondo estampado del chat, asi que en tema oscuro un gris medio
                        sobre `bg-card` (casi negro) no se leia. Es el unico camino para ver lo
                        que se hablo antes.
                      */}
                      {/*
                        Sin boton: al subir, el historial se carga solo.

                        El centinela de arriba avisa 300 px antes de llegar al tope y ahi se piden
                        los mensajes anteriores, como en WhatsApp. El boton era un paso de mas
                        justo cuando uno esta leyendo hacia atras, y ademas disparaba la version
                        pesada -recargaba la pagina entera para traer veinte mensajes-.

                        Queda la ruedita, que no es decoracion: sin ella, subir y que no pase nada
                        durante un segundo se lee como que el chat se quedo sin historial.
                      */}
                      {isLoadingOlderMessages ? (
                        <div className="flex justify-center px-3 py-1.5">
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-muted text-foreground shadow-sm"
                            aria-label="Cargando historial"
                            role="status"
                          >
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {/*
                    Las burbujas, mas juntas.

                    Estaban a 10px en celular y 12 en computadora, que es la separacion de una
                    lista, no de una conversacion: dos mensajes seguidos de la misma persona se
                    leian como dos cosas distintas. WhatsApp las deja casi pegadas. A 4 y 6 se
                    sigue viendo donde termina una y empieza la otra -cada una tiene su fondo- y
                    entran mas mensajes por pantalla, que en el celular es lo que mas cuenta.
                  */}
                  <div className="space-y-1 md:space-y-1.5">
                    {displayedMessages.map((message, index) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        previousMessage={displayedMessages[index - 1]}
                        onRetry={
                          message.outboundStatusLabel === "error" ? onRetryFailedMessage : undefined
                        }
                        /*
                          Una foto en envio o fallida no ofrece responder, reenviar, eliminar ni
                          seleccionar: su direccion local no sirve fuera de este navegador.
                        */
                        onReply={esFotoEnEnvio(message.id) ? undefined : onReplyToMessage}
                        onForward={esFotoEnEnvio(message.id) ? undefined : setMensajeAReenviar}
                        onEdit={esFotoEnEnvio(message.id) ? undefined : onEditMessage}
                        onDelete={esFotoEnEnvio(message.id) ? undefined : onDeleteMessage}
                        seleccionado={seleccionados.includes(message.id)}
                        haySeleccion={seleccionados.length > 0}
                        onSeleccionar={esFotoEnEnvio(message.id) ? undefined : alternarSeleccion}
                        fotoEstado={fotosPorId.get(message.id)?.estado}
                        fotoMotivo={fotosPorId.get(message.id)?.motivo}
                        /* Un archivo perdido al recargar no se puede reintentar: solo Descartar. */
                        onReintentarFoto={fotosPorId.get(message.id)?.archivoPerdido ? undefined : reintentarFoto}
                        onDescartarFoto={descartarFoto}
                        /*
                          Los emoticones salen solo sobre la UNICA marcada: con varias no hay un
                          mensaje al cual reaccionar, y seis filas de emojis a la vez serian ruido.
                        */
                        mostrarReacciones={unicoSeleccionado?.id === message.id}
                        /* Para la nota de voz: WhatsApp muestra la foto de quien habla. */
                        avatarUrl={renderedConversation.avatarUrl}
                        contactLabel={renderedConversation.label}
                      />
                    ))}
                    {/*
                      La burbujita de los tres puntos, al final de la conversacion.

                      Va DESPUES del ultimo mensaje y no en el encabezado porque es ahi donde uno
                      esta mirando mientras espera una respuesta. Es la misma senal que da WhatsApp
                      y significa lo mismo: no te vayas, esta contestando.
                    */}
                    {escribiendo ? (
                      <div className="flex justify-start px-1 pb-1 pt-0.5">
                        <div className="inline-flex items-center gap-1 rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 shadow-sm">
                          <span className="sr-only">
                            {escribiendo === "grabando" ? "Grabando audio" : "Escribiendo"}
                          </span>
                          {[0, 1, 2].map((punto) => (
                            <span
                              key={punto}
                              aria-hidden="true"
                              className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
                              // El desfase es lo que hace que "salten" en ola en vez de a la vez.
                              style={{ animationDelay: `${punto * 150}ms`, animationDuration: "1s" }}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {messageScrollBehavior === "preserve" ? (
                      <ChatScrollAnchor dependencyKey={selectedConversationScrollKey} behavior="preserve" />
                    ) : null}
                  </div>
                </div>
              </div>
              {/* El dia del mensaje de arriba mientras se hace scroll, como en WhatsApp. */}
              <ChatFloatingDateBadge scrollRef={messagesScrollRef} />
              {/*
                Bajar al ultimo mensaje, como en WhatsApp. Aparece apenas se sube lo suficiente
                como para perder de vista el final —antes solo salia si habian llegado mensajes,
                asi que quien subia a buscar algo tenia que devolverse a mano— y si mientras tanto
                llega algo, lleva encima cuantos mensajes son.

                Si entraron mensajes mientras la asesora lee arriba, el boton dice "Ir al final" con
                el numero de nuevos (7-nov-2026): la vista no se mueve sola, asi que tiene que saber
                que llego algo. Sin mensajes nuevos queda la flecha redonda de siempre.
              */}
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={onScrollToBottom}
                  aria-label={`Ir al final (${unreadCount} ${unreadCount === 1 ? "mensaje nuevo" : "mensajes nuevos"})`}
                  title="Ir al último mensaje"
                  className="chat-ir-al-final absolute bottom-4 right-4 z-10 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-2 text-[13px] font-semibold text-foreground shadow-lg transition hover:bg-muted"
                >
                  <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Ir al final</span>
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[11px] font-semibold leading-none text-[var(--primary-foreground)]">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                </button>
              ) : showJumpToBottom ? (
                <button
                  type="button"
                  onClick={onScrollToBottom}
                  aria-label="Ir al ultimo mensaje"
                  title="Ir al último mensaje"
                  className="absolute bottom-4 right-4 z-10 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition hover:bg-muted"
                >
                  <ChevronDown className="h-5 w-5" />
                </button>
              ) : null}
            </div>

            {/*
              El relleno de abajo sale del AREA SEGURA y no de un piso fijo.

              Un piso fijo levantaba el compositor en Android, donde no hay barra de gestos que
              esquivar. `env(safe-area-inset-bottom)` da justo lo que hace falta en cada aparato:
              en iPhone la altura de la barra, en Android 0. Para que iOS lo informe, el viewport
              se declara con `viewport-fit: cover` (ver generateViewport en app/layout).
            */}
            {composer && renderedConversation ? (
              <div className="chat-composer z-20 shrink-0 bg-transparent px-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] pt-1.5 md:px-5 md:py-2">
                {/* md:max-w-none: en escritorio la barra mide lo mismo que el area de mensajes (T-314). */}
                <form
                  className="mx-auto w-full min-w-0 max-w-5xl md:max-w-none"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const formData = new FormData(form);
                    const message = String(formData.get("message") || "").trim();

                    if (!message || !renderedConversation || enviandoTexto) {
                      return;
                    }
                    // El chat todavia carga: no se envia y el texto se queda en el cuadro.
                    if (envioBloqueado) {
                      toast.info("Espera a que cargue el chat para enviar.");
                      return;
                    }

                    // Salio de la estrella: se marca para medir cuanto se usa (y si se edito).
                    const sugerencia = sugerenciaEnLaCaja.current;
                    if (sugerencia && sugerencia.chat === (selectedConversationId ?? "")) {
                      formData.set("sugerenciaId", sugerencia.id);
                    }
                    sugerenciaEnLaCaja.current = null;

                    // Panel de envio: solo cuenta si lo que sale todavia trae el total insertado.
                    const totalDelPanel = totalDelPanelEnLaCaja.current;
                    totalDelPanelEnLaCaja.current = null;
                    if (
                      totalDelPanel &&
                      totalDelPanel.chat === (selectedConversationId ?? "") &&
                      textoTraeElTotal(message, totalDelPanel.total)
                    ) {
                      formData.set("conTotalDePanel", "1");
                    }

                    // Respuesta rapida: va tal cual, sin la firma encima.
                    if (desdeRespuestaRapida) {
                      formData.set("skipSignature", "1");
                    }

                    // Firma apagada: el mensaje sale tal cual, sin encabezado.
                    if (!firmaActiva) {
                      formData.set("skipSignature", "1");
                    }

                    // El handler externo crea la burbuja optimista y envia sin
                    // navegacion (la accion valida internamente y devuelve resultado).
                    // Si ya hay un texto en camino en este chat no se acepta: el cuadro queda como esta.
                    if (!onComposerDraft(message, formData)) {
                      return;
                    }
                    setComposerHasText(false);
                    setDesdeRespuestaRapida(false);
                    // El mensaje salio de la caja: ya no hay borrador (y se cancela el guardado pendiente).
                    if (borradorTimerRef.current !== null) {
                      window.clearTimeout(borradorTimerRef.current);
                      borradorTimerRef.current = null;
                    }
                    borrarBorrador(selectedConversationId ?? "");
                    form.reset();
                    autoResizeComposer(composerTextAreaRef.current);
                  }}
                >
                  {composerHiddenFields.map((field) => (
                    <input key={`${field.name}-${field.value}`} type="hidden" name={field.name} value={field.value} />
                  ))}

                  {replyTarget ? (
                    <div className="mb-1.5 flex items-center gap-2 rounded-xl border-l-4 border-[var(--primary)] bg-muted/70 px-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-[var(--primary)]">
                          {replyTarget.direction === "OUTBOUND" ? "Tú" : "Cliente"}
                        </p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {replyTarget.content || "Mensaje"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={onCancelReply}
                        aria-label="Cancelar respuesta"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : null}

                  {/* El flujo que propone la estrella: un boton, nunca se manda solo. */}
                  {flujoSugerido && mediaConfig && flujoSugerido.chat === (selectedConversationId ?? "") && !isSuggestingReply ? (
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          // Lo mismo que usa "Enviar flujos" del menu +: asi se comportan igual.
                          if (!mediaConfig) return;
                          enviarFlujoAlChat({
                            source: mediaConfig.source === "official" ? "official" : "agent",
                            conversationId: mediaConfig.conversationId,
                            flowId: flujoSugerido.id,
                            titulo: flujoSugerido.titulo,
                            agentId: mediaConfig.agentId ?? undefined,
                            alTerminar: avisarEnvioTerminado,
                          });
                          if (flujoSugerido.sugerenciaId) {
                            void marcarFlujoDeSugerenciaAction(flujoSugerido.sugerenciaId);
                          }
                          setFlujoSugerido(null);
                        }}
                        className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-3 py-1.5 text-[13px] font-medium text-[var(--primary)] transition hover:bg-[var(--primary)]/15"
                      >
                        <Workflow className="size-4 shrink-0" />
                        <span className="truncate">Enviar flujo: {flujoSugerido.titulo}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFlujoSugerido(null)}
                        aria-label="Descartar el flujo sugerido"
                        title="Descartar"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : null}

                  {/* Mientras la estrella redacta: que se vea que esta trabajando, y donde va a aparecer. */}
                  {isSuggestingReply ? (
                    <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-muted/70 px-3 py-1.5 text-[13px] text-muted-foreground" role="status">
                      <Sparkles className="size-4 shrink-0 text-[var(--primary)]" />
                      <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
                      Generando sugerencia…
                    </div>
                  ) : null}

                  <div className="flex w-full min-w-0 items-end gap-2 md:gap-3">
                    {isRecordingAudio ? (
                      /*
                        Grabando, como en WhatsApp: arriba el tiempo y la onda que se mueve con la voz;
                        abajo borrar, pausar y enviar, grandes para el dedo. Antes era un renglon con
                        "Grabando" y dos iconos chicos: no se podia pausar y no se veia si el
                        microfono estaba tomando sonido.
                      */
                      <div className="flex w-full min-w-0 flex-1 flex-col gap-2.5 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-[0_1px_6px_#0000001f]">
                        <div className="flex items-center gap-3">
                          <span className="w-12 shrink-0 text-lg font-medium tabular-nums text-foreground">
                            {`${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, "0")}`}
                          </span>
                          <div className="flex h-8 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden" aria-hidden="true">
                            {Array.from({ length: BARRAS_DE_GRABACION }, (_, indice) => {
                              const posicion = ondaEnVivo.length - (BARRAS_DE_GRABACION - indice);
                              const nivel = posicion >= 0 ? ondaEnVivo[posicion] : undefined;
                              return (
                                <span
                                  key={indice}
                                  className={`w-[3px] shrink-0 rounded-full transition-[height] duration-100 ${
                                    nivel === undefined ? "bg-muted-foreground/25" : "bg-foreground/70"
                                  }`}
                                  style={{ height: `${nivel === undefined ? 3 : Math.max(4, Math.round(nivel * 28))}px` }}
                                />
                              );
                            })}
                          </div>
                          {grabacionPausada ? (
                            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">En pausa</span>
                          ) : (
                            <span className="inline-block size-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={cancelAudioRecording}
                            aria-label="Borrar grabacion"
                            title="Borrar"
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 transition hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-ring/50 dark:text-red-400"
                          >
                            <Trash2 className="size-5" />
                          </button>
                          <button
                            type="button"
                            onClick={alternarPausaDeGrabacion}
                            className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-muted text-[14px] font-medium text-foreground transition hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-ring/50"
                          >
                            {grabacionPausada ? (
                              <>
                                <Mic className="size-5" />
                                Reanudar
                              </>
                            ) : (
                              <>
                                <Pause className="size-5 fill-current" />
                                Pausar
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={stopAndSendAudio}
                            aria-label="Enviar nota de voz"
                            title="Enviar"
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring/50"
                          >
                            <SendHorizonal className="size-5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-[48px] w-full min-w-0 flex-1 items-end gap-0.5 rounded-3xl border border-border bg-card px-2 py-1 shadow-[0_1px_6px_#0000001f] transition focus-within:border-[var(--primary)] focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/50 md:min-h-[48px]">
                        {mediaConfig ? (
                          <>
                            <input
                              ref={mediaFileInputRef}
                              type="file"
                              accept="image/*,video/*"
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                const files = Array.from(event.currentTarget.files ?? []);
                                event.currentTarget.value = "";
                                if (files.length > 0) {
                                  void copiarArchivosAMemoria(files).then((copia) => {
                                    if (copia.ilegible) {
                                      toast.error(
                                        `No se pudo leer "${copia.ilegible}" desde el telefono. Ábrela en la galería y compártela a la app, o elígela de nuevo.`,
                                        { duration: 10000 },
                                      );
                                      return;
                                    }
                                    setPendingMediaFiles(copia.archivos);
                                  });
                                }
                              }}
                            />
                            <input
                              ref={documentoFileInputRef}
                              type="file"
                              /*
                                Se listan los tipos en vez de aceptar cualquier cosa: WhatsApp
                                rechaza los ejecutables, y descubrirlo recien al enviar deja el
                                archivo subido y el mensaje en rojo.
                              */
                              accept={ACCEPT_DOCUMENTOS_CHAT}
                              multiple
                              className="hidden"
                              onChange={(event) => {
                                const files = Array.from(event.currentTarget.files ?? []);
                                event.currentTarget.value = "";
                                if (files.length > 0) {
                                  void copiarArchivosAMemoria(files).then((copia) => {
                                    if (copia.ilegible) {
                                      toast.error(
                                        `No se pudo leer "${copia.ilegible}" desde el telefono. Ábrela en la galería y compártela a la app, o elígela de nuevo.`,
                                        { duration: 10000 },
                                      );
                                      return;
                                    }
                                    setPendingMediaFiles(copia.archivos);
                                  });
                                }
                              }}
                            />
                            <Popover
                              open={isAttachMenuOpen}
                              onOpenChange={setIsAttachMenuOpen}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Adjuntar"
                                  title="Adjuntar"
                                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-9"
                                >
                                  <Plus className="size-5" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="start"
                                side="top"
                                sideOffset={12}
                                className="w-[min(80vw,15rem)] rounded-lg border border-border bg-popover p-1 leading-5 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.30)]"
                              >
                                {/* Prender o apagar la firma sin salir del compositor. Solo si la
                                    persona tiene una configurada: sin firma, el interruptor no
                                    controlaria nada. */}
                                {firma ? (
                                  <label className="flex w-full cursor-pointer items-center justify-between gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted">
                                    <span className="flex items-center gap-3">
                                      <PenLine className="size-4 shrink-0 text-[#8b5cf6]" />
                                      <span>
                                        Firmar mensajes
                                        <span className="block text-[11px] font-normal text-muted-foreground">
                                          {firmaActiva ? firma : "Salen sin tu nombre"}
                                        </span>
                                      </span>
                                    </span>
                                    <Switch
                                      checked={firmaActiva}
                                      onCheckedChange={(valor) => setFirmaActiva(Boolean(valor))}
                                    />
                                  </label>
                                ) : null}
                                {firma ? <div className="-mx-1 my-0.5 h-px bg-border" /> : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsQuickRepliesOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <MessageSquareText className="size-4 shrink-0 text-[#10b981]" />
                                  <span>Respuestas rápidas</span>
                                </Button>
                                {/* Guion del Playbook segun la etapa de ESTE cliente: la asesora no
                                    tiene que abrir el documento aparte ni acordarse de nada. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsPlaybookOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <BookOpen className="size-4 shrink-0 text-[#f59e0b]" />
                                  <span>Qué decir ahora</span>
                                </Button>
                                {/* Mandar el catalogo completo con un toque, en vez de buscar el
                                    PDF en el celular y subirlo de nuevo en cada conversacion. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsSendFlowOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <Workflow className="size-4 shrink-0 text-[#0ea5e9]" />
                                  <span>Enviar flujos</span>
                                </Button>
                                {/* Los catalogos de siempre, ya subidos. Mandarlos desde aca NO
                                    sube nada: con la señal de un celular en la calle, subir un
                                    catalogo de 15 MB tarda entre 8 y 18 minutos y se corta antes
                                    de terminar. Como son siempre los mismos archivos, se suben una
                                    vez y despues salen en un segundo. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsLibraryOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <FolderOpen className="size-4 shrink-0 text-[#8b5cf6]" />
                                  <span>Biblioteca</span>
                                </Button>
                                {/* Carta de colores: la asesora escoge el material y la manda a mano. */}
                                {mediaConfig ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                      setIsAttachMenuOpen(false);
                                      setIsCartaDeColoresOpen(true);
                                    }}
                                    className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                  >
                                    <Palette className="size-4 shrink-0 text-[#d946ef]" />
                                    <span>Colores</span>
                                  </Button>
                                ) : null}
                                <div className="-mx-1 my-0.5 h-px bg-border" />
                                {/* Lo que el equipo necesita saber del cliente y no se le manda
                                    a el. Antes se lo pasaban por WhatsApp entre ellas y se
                                    perdia. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsNoteOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <StickyNote className="size-4 shrink-0 text-[#eab308]" />
                                  <span>Nota interna</span>
                                </Button>
                                {/* Agendar el proximo toque sin salir del chat: es donde la
                                    asesora se acuerda de que hay que volver a escribirle. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    setIsFollowUpOpen(true);
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <CalendarPlus className="size-4 shrink-0 text-[#0ea5e9]" />
                                  <span>Agendar seguimiento</span>
                                </Button>
                                <div className="-mx-1 my-0.5 h-px bg-border" />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    mediaFileInputRef.current?.click();
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <ImageIcon className="size-4 shrink-0 text-[#2f9bff]" />
                                  <span>Fotos y videos</span>
                                </Button>
                                {/*
                                  Documentos, al lado de la Biblioteca y no en su lugar.

                                  Esto estuvo sacado un tiempo, y con razon: para mandar un catalogo
                                  obligaba a buscarlo en Drive, bajarlo al celular y volver a
                                  subirlo, 15 MB por cliente que con la señal de la calle no
                                  terminaban de subir. Para eso esta la Biblioteca, donde los ocho
                                  catalogos de siempre salen en un segundo.

                                  Pero un archivo suelto -la cotizacion de ESE cliente, una remision,
                                  la cedula que mandan por correo- no vive en la Biblioteca y no
                                  tiene por que ensuciarla. Ese es el caso que quedaba sin salida.
                                */}
                                <Button
                                  type="button"
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    documentoFileInputRef.current?.click();
                                  }}
                                  variant="ghost"
                                  className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <FileText className="size-4 shrink-0 text-[#ec4899]" />
                                  <span>Documento</span>
                                </Button>
                                {/* Ubicación del local con UN toque: las coordenadas salen de la
                                    configuración de Negocio, la asesora no tiene que buscar nada. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  disabled={isSendingLocation}
                                  onClick={() => {
                                    setIsAttachMenuOpen(false);
                                    void handleSendLocation();
                                  }}
                                  className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted"
                                >
                                  <MapPin className="size-4 shrink-0 text-[#ef4444]" />
                                  <span>{isSendingLocation ? "Enviando ubicación…" : "Ubicación del local"}</span>
                                </Button>
                                {audioConfig ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                      setIsAttachMenuOpen(false);
                                      void startAudioRecording();
                                    }}
                                    className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-foreground md:py-1.5 transition hover:bg-muted focus:outline-none focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <Headphones className="size-4 shrink-0 text-[#ff7a59]" />
                                    <span>Audio</span>
                                  </Button>
                                ) : null}
                              </PopoverContent>
                            </Popover>
                          </>
                        ) : null}
                        <Popover
                          open={isEmojiPickerOpen}
                          onOpenChange={(open) => {
                            setIsEmojiPickerOpen(open);
                            if (!open) {
                              setEmojiSearchQuery("");
                            }
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-background hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-9"
                              aria-label="Abrir selector de emoticones"
                              title="Emoticones"
                            >
                              <Smile className="size-5" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            side="top"
                            sideOffset={12}
                            className="w-[min(90vw,26rem)] rounded-[26px] border border-border bg-popover p-3.5 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
                          >
                            <ComposerEmojiPicker
                              query={emojiSearchQuery}
                              activeTab={emojiPickerTab}
                              recentEmojis={recentComposerEmojis}
                              onQueryChange={setEmojiSearchQuery}
                              onActiveTabChange={setEmojiPickerTab}
                              onSelectEmoji={insertComposerEmoji}
                            />
                          </PopoverContent>
                        </Popover>
                        <textarea
                          ref={composerTextAreaRef}
                          name="message"
                          rows={1}
                          placeholder={composer.placeholder || "Escribe un mensaje..."}
                          onChange={(event) => {
                            const conTexto = event.currentTarget.value.trim().length > 0;
                            setComposerHasText(conTexto);
                            const chatDelBorrador = selectedConversationId ?? "";
                            if (borradorTimerRef.current !== null) window.clearTimeout(borradorTimerRef.current);
                            borradorTimerRef.current = window.setTimeout(
                              () => guardarBorradorAhora(chatDelBorrador),
                              ESPERA_GUARDAR_BORRADOR_MS,
                            );
                            if (!conTexto) sugerenciaEnLaCaja.current = null;
                            autoResizeComposer(event.currentTarget);
                          }}
                          onKeyDown={(event) => {
                            /*
                              En computadora Enter envia y Shift+Enter hace un renglon nuevo, como en
                              WhatsApp Web. En el celular Enter sigue siendo un renglon y se envia con el
                              boton, igual que en WhatsApp. Con teclados que arman letras (isComposing),
                              Enter confirma la letra y no envia.
                            */
                            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                              return;
                            }
                            if (window.matchMedia("(pointer: coarse)").matches) {
                              return;
                            }
                            event.preventDefault();
                            if (event.currentTarget.value.trim() && !enviandoTexto) {
                              event.currentTarget.form?.requestSubmit();
                            }
                          }}
                          onSelect={(event) => syncComposerSelection(event.currentTarget)}
                          onKeyUp={(event) => syncComposerSelection(event.currentTarget)}
                          onMouseUp={(event) => syncComposerSelection(event.currentTarget)}
                          onBlur={(event) => syncComposerSelection(event.currentTarget)}
                          onPaste={(event) => {
                            // Pegar (Ctrl+V o "Pegar" del celular) una imagen: se envía por el
                            // mismo flujo que "Fotos y videos" (previsualización + envío).
                            const images = imagenesDelPortapapeles(event.clipboardData);
                            if (images.length === 0) {
                              // Sin imagen: se deja pegar el texto normal.
                              return;
                            }
                            event.preventDefault();
                            if (!mediaConfig) {
                              return;
                            }
                            // Los envios ya no bloquean (van por la cola): solo una grabacion en curso.
                            if (isRecordingAudio) {
                              toast.info("Termina la grabación para pegar la imagen.");
                              return;
                            }
                            void copiarArchivosAMemoria(images).then((copia) => {
                              if (copia.ilegible) {
                                toast.error(`No se pudo leer "${copia.ilegible}". Intenta copiarla de nuevo.`);
                                return;
                              }
                              setPendingMediaFiles(copia.archivos);
                            });
                          }}
                          /**
                           * 16px en el celular no es capricho: por debajo de eso el navegador
                           * del iPhone HACE ZOOM solo al tocar el campo y deja la pantalla
                           * corrida. Ademas se lee, que era la queja: con 14px las asesoras no
                           * veian bien lo que escribian.
                           *
                           * Una linea mide lo mismo que los botones (40px celular, 36px compu:
                           * linea de 24px + relleno), asi el texto y los iconos quedan centrados.
                           * Con varias lineas la fila esta en items-end y los iconos se quedan
                           * abajo, a la altura de la ultima linea, como en WhatsApp.
                           */
                          className="min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[16px] leading-6 md:text-[15px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-70 md:min-h-9 md:py-1.5"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleSuggestReply()}
                          disabled={isSuggestingReply}
                          aria-label="Respuesta sugerida con IA"
                          title="Respuesta sugerida con IA"
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted-foreground/20 hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-9"
                        >
                          {isSuggestingReply ? (
                            <LoaderCircle className="size-5 animate-spin" />
                          ) : (
                            <Sparkles className="size-5" />
                          )}
                        </Button>
                        {composerHasText || !audioConfig ? (
                          <ComposerSendButton enviando={enviandoTexto} bloqueado={envioBloqueado} />
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={startAudioRecording}
                            aria-label="Grabar nota de voz"
                            title="Grabar nota de voz"
                            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-muted-foreground/20 focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 md:size-9"
                          >
                            <Mic className="size-5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </form>
              </div>
            ) : renderedConversation ? (
              /*
                Sin cuadro de escribir, se dice POR QUE.

                Un chat abierto sin donde escribir se lee como que la pantalla se rompio. Este
                renglon convierte una ausencia rara en una regla entendible, y de paso le recuerda
                a quien mira que esta viendo trabajar al agente, no atendiendo.
              */
              <div className="z-20 shrink-0 px-1.5 pb-[calc(env(safe-area-inset-bottom)+0.375rem)] pt-1.5 md:px-5 md:py-2">
                <p className="mx-auto w-full max-w-5xl rounded-xl border border-border bg-muted/60 px-3 py-2.5 text-center text-[13px] leading-snug text-muted-foreground">
                  Modo monitoreo: puedes ver la conversación, pero no escribir.
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <QuickRepliesDialog
          open={isQuickRepliesOpen}
          onClose={() => setIsQuickRepliesOpen(false)}
          onSelect={insertQuickReply}
        />
        {/* El guion se INSERTA en el compositor (mismo mecanismo que las respuestas rápidas):
            la asesora lo ajusta y envía cuando quiere, nunca se manda solo. */}
        <ForwardMessageDialog message={mensajeAReenviar} onClose={() => setMensajeAReenviar(null)} />
        {mediaConfig ? (
          <InternalNoteDialog
            open={isNoteOpen}
            onClose={() => setIsNoteOpen(false)}
            conversationId={mediaConfig.conversationId}
            source={mediaConfig.source === "official" ? "official" : "agent"}
          />
        ) : null}
        {mediaConfig ? (
          <SendFlowDialog
            open={isSendFlowOpen}
            onClose={() => setIsSendFlowOpen(false)}
            source={mediaConfig.source === "official" ? "official" : "agent"}
            conversationId={mediaConfig.conversationId}
            agentId={mediaConfig.agentId ?? undefined}
            onEnviado={avisarEnvioTerminado}
          />
        ) : null}
        {/* Montado solo mientras esta abierto: un modal que queda puesto y apagado puede dejar su
            fondo en el DOM tapando la pantalla y comiendose los clicks (paso el 13-ago-2026). */}
        {mediaConfig && isLibraryOpen ? (
          <MediaLibraryDialog
            open
            onClose={() => setIsLibraryOpen(false)}
            uploadPath={mediaConfig.uploadPath}
            onSend={async (item) => {
              const result = await mediaConfig.sendAction({
                source: mediaConfig.source,
                conversationId: mediaConfig.conversationId,
                agentId: mediaConfig.agentId,
                mediaUrl: item.url,
                mediaType: item.mediaType,
                fileName: item.fileName,
                mimeType: item.mimeType,
                returnTo: mediaConfig.returnTo,
              });
              if (result && "ok" in result && result.ok) {
                avisarEnvioTerminado({ conversationId: mediaConfig.conversationId, tipo: item.mediaType });
                onScrollToBottom();
                return true;
              }
              toast.error((result && "error" in result && result.error) || `No se pudo enviar "${item.title}".`);
              return false;
            }}
          />
        ) : null}
        {mediaConfig && isCartaDeColoresOpen ? (
          <CartaDeColoresDialog
            open
            onClose={() => setIsCartaDeColoresOpen(false)}
            onEnviada={onScrollToBottom}
            mandarImagen={async (imagen) => {
              const conversationId = mediaConfig.conversationId;
              const result = await mediaConfig.sendAction({
                source: mediaConfig.source,
                conversationId,
                agentId: mediaConfig.agentId,
                mediaUrl: imagen.url,
                mediaType: "IMAGE",
                fileName: imagen.url.split("/").pop() || "carta-de-colores.png",
                mimeType: "image/png",
                caption: imagen.texto,
                returnTo: mediaConfig.returnTo,
              });
              if (result && "ok" in result && result.ok) {
                avisarEnvioTerminado({ conversationId, tipo: "IMAGE" });
              }
              return result;
            }}
          />
        ) : null}
        <PlaybookPanelDialog
          open={isPlaybookOpen}
          onClose={() => setIsPlaybookOpen(false)}
          onSelect={insertQuickReply}
          stage={renderedConversation?.crmStage ?? null}
        />
        <FollowUpDialog
          open={isFollowUpOpen}
          onClose={() => setIsFollowUpOpen(false)}
          contactId={renderedConversation?.contactId ?? null}
        />
        {/*
          Lo que se corto, con su boton de reintentar.

          Va pegado arriba del compositor y no como aviso flotante: un aviso se va solo y el archivo
          se pierde con el. Aca se queda hasta que ella decida reintentar o descartar.
        */}
        {fotosDelChat(todosLosArchivosFallidos, mediaConfig?.conversationId).map((mediaFallida) => (
          <div
            key={mediaFallida.id}
            className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40"
          >
            <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1 text-[12px] leading-4 text-amber-900 dark:text-amber-200">
              No se pudo enviar{" "}
              {mediaFallida.files.length === 1
                ? `"${mediaFallida.files[0].name}"`
                : `${mediaFallida.files.length} archivos`}
              {/* El motivo REAL, no un "revisa la señal" que casi nunca es cierto. */}
              {mediaFallida.motivo ? `. ${mediaFallida.motivo}` : ". Revisa la señal."}
            </span>
            <button
              type="button"
              onClick={() => {
                // Va al chat y al destino donde se toco Enviar, no al que este abierto.
                quitarArchivosFallidos(mediaFallida.id);
                uploadAndSendMediaFiles(mediaFallida.files, mediaFallida.caption, mediaFallida.destino);
              }}
              className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => quitarArchivosFallidos(mediaFallida.id)}
              aria-label="Descartar"
              className="shrink-0 rounded-lg px-1.5 py-1 text-amber-800 transition hover:bg-amber-100 dark:text-amber-300"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}

        {pendingMediaFiles.length > 0 ? (
          <MediaPreviewDialog
            files={pendingMediaFiles}
            onCancel={() => setPendingMediaFiles([])}
            // Saca un archivo de la selección; si no queda ninguno, la ventana se cierra sola.
            onRemove={(index) => setPendingMediaFiles((prev) => quitarArchivo(prev, index, 0).archivos)}
            onSend={(caption) => {
              const files = pendingMediaFiles;
              setPendingMediaFiles([]);
              uploadAndSendMediaFiles(files, caption);
            }}
          />
        ) : null}
        <Sheet open={isContactPanelOpen && isMobile} onOpenChange={setIsContactPanelOpen}>
          <SheetContent side="right" className="w-full border-l border-border bg-card p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md md:hidden" showCloseButton={false}>
            <SheetHeader className="border-b border-border px-4 py-3 text-left">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <SheetTitle>Contacto</SheetTitle>
                  {/* Queda solo para lectores de pantalla: ocupaba dos renglones para explicar
                      lo que ya se ve abajo (el nombre, el telefono, las etiquetas). */}
                  <SheetDescription className="sr-only">
                    Información del cliente y etiquetas.
                  </SheetDescription>
                </div>
                <div className="flex items-center gap-1">
                {contactPanelHeaderActions}
                <button
                  type="button"
                  onClick={() => setIsContactPanelOpen(false)}
                  aria-label="Cerrar panel"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
                </div>
              </div>
            </SheetHeader>
            {contactPanelContent}
          </SheetContent>
        </Sheet>
        <Dialog open={fotoDelContactoAbierta} onOpenChange={setFotoDelContactoAbierta}>
          <DialogContent className="sm:max-w-sm">
            <DialogTitle className="truncate">{renderedConversation?.label ?? "Contacto"}</DialogTitle>
            <div className="flex justify-center">
              <ContactAvatar
                avatarUrl={renderedConversation?.avatarUrl}
                label={renderedConversation?.label ?? ""}
                className="h-56 w-56 rounded-2xl border border-border bg-muted text-3xl text-muted-foreground"
                fallbackClassName="rounded-2xl bg-muted text-muted-foreground"
              />
            </div>
            {/*
              WhatsApp solo entrega la foto de quien la tiene visible para desconocidos, que es la
              minoria. Por eso se dice que puede no haber ninguna: si no, uno aprieta, no pasa nada
              y parece que la app fallo.
            */}
            <p className="text-center text-[12px] leading-4 text-muted-foreground">
              La foto la trae WhatsApp, y solo si el cliente la tiene visible para quien no lo tiene
              agendado.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={handleRefreshAvatar}
              disabled={isRefreshingAvatar || !renderedConversation?.contactId}
            >
              {isRefreshingAvatar ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              {renderedConversation?.avatarUrl ? "Actualizar la foto" : "Traer la foto"}
            </Button>
          </DialogContent>
        </Dialog>

        {isContactPanelOpen ? (
          <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-card md:flex xl:w-96">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Contacto</h3>
              <div className="flex items-center gap-1">
              {contactPanelHeaderActions}
              <button
                type="button"
                onClick={() => setIsContactPanelOpen(false)}
                aria-label="Cerrar panel"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex items-center gap-3">
                {/*
                  La foto se toca y se ve en grande; el boton de traerla esta adentro.

                  Antes habia una camarita pegada al borde de la miniatura que disparaba la
                  descarga de una. En una foto de 48 pixeles ese boton es mas chico que un dedo, y
                  lo que uno quiere al tocar una foto es VERLA, no reemplazarla sin querer.
                */}
                <button
                  type="button"
                  onClick={() => setFotoDelContactoAbierta(true)}
                  aria-label="Ver la foto del contacto"
                  title="Ver la foto"
                  className="shrink-0 rounded-full transition hover:opacity-90"
                >
                  <ContactAvatar
                    avatarUrl={renderedConversation.avatarUrl}
                    label={renderedConversation.label}
                    className="h-12 w-12 rounded-full border border-border bg-muted text-muted-foreground"
                    fallbackClassName="rounded-full bg-muted text-muted-foreground"
                  />
                </button>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {renderedConversation.label}
                    </p>
                    {renderedConversation.contactId ? (
                      <button
                        type="button"
                        onClick={onEditContact}
                        aria-label="Editar"
                        title="Editar"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  {renderedConversation.secondaryLabel ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">{renderedConversation.secondaryLabel}</span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(renderedConversation.secondaryLabel);
                          toast.success("Copiado");
                        }}
                        aria-label="Copiar número"
                        title="Copiar"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  {contactCity ? (
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{contactCity}</span>
                    </p>
                  ) : null}
                  {contactOrigin ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Megaphone className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate" title={contactOrigin.etiqueta}>
                        {contactOrigin.anuncioUrl ? (
                          <a href={contactOrigin.anuncioUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                            {contactOrigin.etiqueta}
                          </a>
                        ) : (
                          contactOrigin.etiqueta
                        )}
                      </span>
                    </p>
                  ) : null}
                  {contactOrigin?.campanaNombre ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate" title={`Campaña: ${contactOrigin.campanaNombre}`}>
                        Campaña: {contactOrigin.campanaNombre}
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-5">
                <ChatTagsControl
                  contactId={renderedConversation.contactId}
                  conversationId={renderedConversation.id}
                  tags={contactPanelTags ?? renderedConversation.tags ?? []}
                  canDelete={canDeleteTags}
                />
              </div>

              {/* En celular el aside queda montado (solo oculto por CSS) junto a la hoja: sin esta
                  condicion habria dos paneles de envio consultando Gestion a la vez. */}
              {isMobile ? null : panelDeEnvio}

              {contactPanelActions ? (
                <div className="mt-5 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Agente asignado
                  </h4>
                  {contactPanelActions}
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
        </div>
      ) : (
        <div className="relative z-10 flex h-full w-full flex-1 items-center justify-center px-6 py-10 text-center">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-4">
            <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
                <MessageSquareText className="h-7 w-7" />
              </span>
            </span>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">{emptySelectionTitle}</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                {emptySelectionDescription}
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
});

