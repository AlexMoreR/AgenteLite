"use client";

import * as React from "react";
import Link from "next/link";
import { BellOff, LoaderCircle, Search } from "lucide-react";

import { ContactAvatar } from "@/components/chats/contact-avatar";
import { NotificationPermissionInline } from "@/components/chats/notification-permission-inline";

/**
 * Cada cuanto vuelve a preguntar.
 *
 * Es el mismo minuto de la campanita, y por el mismo motivo: la consulta trae la lista de chats
 * con su ultimo mensaje. Pero aca casi nunca llega a cumplirse, porque el aviso del altavoz la
 * adelanta en cuanto entra un mensaje.
 */
const CADA_CUANTO_MS = 60000;

type Conversacion = {
  key?: string;
  label?: string;
  avatarUrl?: string | null;
  incomingCount?: number | null;
  lastMessage?: string | null;
  lastMessageType?: string | null;
  lastMessageAt?: string | null;
};

const horaCorta = new Intl.DateTimeFormat("es-CO", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "America/Bogota",
});

const fechaCorta = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  timeZone: "America/Bogota",
});

/** Hoy la hora; antes, la fecha. Es lo que uno necesita saber de un aviso. */
function cuando(iso?: string | null) {
  if (!iso) return "";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";

  const ahora = new Date();
  const mismoDia =
    fecha.getFullYear() === ahora.getFullYear() &&
    fecha.getMonth() === ahora.getMonth() &&
    fecha.getDate() === ahora.getDate();

  return mismoDia ? horaCorta.format(fecha) : fechaCorta.format(fecha);
}

function vistaPrevia(conversacion: Conversacion) {
  const texto = (conversacion.lastMessage ?? "").trim();
  if (texto) return texto;

  switch (conversacion.lastMessageType) {
    case "AUDIO":
      return "Audio";
    case "IMAGE":
      return "Foto";
    case "VIDEO":
      return "Video";
    case "STICKER":
      return "Sticker";
    case "DOCUMENT":
      return "Documento";
    case "LOCATION":
      return "Ubicación";
    default:
      return "Mensaje nuevo";
  }
}

export function NotificacionesWorkspace() {
  const [conversaciones, setConversaciones] = React.useState<Conversacion[]>([]);
  const [cargando, setCargando] = React.useState(true);
  const [busqueda, setBusqueda] = React.useState("");

  React.useEffect(() => {
    let cancelado = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const pedir = async () => {
      try {
        /*
          `assigned=all`: los avisos son de TODO lo que uno puede ver, no solo de sus chats.

          La ruta le impone "mias" a quien no es jefe y filtra por los canales visibles de cada
          quien, asi que pedir "todas" no destapa nada: a una asesora le sigue mostrando lo suyo.
        */
        const respuesta = await fetch("/api/cliente/chats/list?limit=40&assigned=all", {
          cache: "no-store",
        });
        if (!respuesta.ok) {
          return;
        }
        const datos = (await respuesta.json().catch(() => null)) as {
          ok?: boolean;
          conversations?: Conversacion[];
        } | null;
        if (!cancelado && datos?.ok && Array.isArray(datos.conversations)) {
          setConversaciones(datos.conversations);
        }
      } catch {
        // Sin red se reintenta en el siguiente turno; no tiene sentido molestar con un error.
      } finally {
        if (!cancelado) {
          setCargando(false);
          timeoutId = setTimeout(pedir, CADA_CUANTO_MS);
        }
      }
    };

    void pedir();

    // El altavoz avisa en el instante en que entra un mensaje: sin esto, la pantalla de avisos
    // podia tardar hasta un minuto en enterarse de algo que ya habia pasado.
    const alLlegarAlgo = () => void pedir();
    window.addEventListener("official-realtime-poke", alLlegarAlgo);

    return () => {
      cancelado = true;
      window.removeEventListener("official-realtime-poke", alLlegarAlgo);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const sinLeer = React.useMemo(
    () =>
      conversaciones
        .filter((conversacion) => (conversacion.incomingCount ?? 0) > 0)
        .sort((a, b) => {
          const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
          const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
          return tb - ta;
        }),
    [conversaciones],
  );

  const filtradas = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return sinLeer;
    return sinLeer.filter((conversacion) =>
      `${conversacion.label ?? ""} ${conversacion.lastMessage ?? ""}`.toLowerCase().includes(q),
    );
  }, [busqueda, sinLeer]);

  const total = sinLeer.reduce(
    (suma, conversacion) => suma + (conversacion.incomingCount ?? 0),
    0,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-foreground">Notificaciones</h1>
        {total > 0 ? (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#ef4444] px-2 text-[12px] font-semibold text-white">
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </div>

      {/* El permiso del celular se pedia desde el menu de la campanita. Al mudar los avisos aca,
          se muda con ellos: si no, no quedaba ningun lugar donde activarlos. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <NotificationPermissionInline />
      </div>

      {sinLeer.length > 3 ? (
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Buscar en las notificaciones"
            className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </label>
      ) : null}

      {cargando ? (
        <div className="flex flex-1 items-center justify-center py-16 text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
        </div>
      ) : filtradas.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <BellOff className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            {busqueda.trim() ? "Nada con esa búsqueda" : "No tenés mensajes nuevos"}
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {busqueda.trim()
              ? "Probá con el nombre del contacto o una palabra del mensaje."
              : "Acá van a aparecer los chats con mensajes sin responder."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtradas.map((conversacion) => {
            const cuenta = conversacion.incomingCount ?? 0;
            const href = conversacion.key
              ? `/cliente/chats?chatKey=${encodeURIComponent(conversacion.key)}`
              : "/cliente/chats";

            return (
              <li key={conversacion.key ?? conversacion.label}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 transition hover:bg-muted"
                >
                  <ContactAvatar
                    avatarUrl={conversacion.avatarUrl}
                    label={conversacion.label ?? "Sin nombre"}
                    className="size-11 shrink-0 rounded-full border-0 bg-muted text-muted-foreground after:border-0"
                    fallbackClassName="rounded-full bg-muted text-muted-foreground"
                  />

                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
                        {conversacion.label?.trim() || "Sin nombre"}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted-foreground">
                        {cuando(conversacion.lastMessageAt)}
                      </span>
                    </span>
                    <span className="truncate text-[13px] text-muted-foreground">
                      {vistaPrevia(conversacion)}
                    </span>
                  </span>

                  <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[#2563eb] px-1.5 text-[12px] font-semibold leading-none text-white">
                    {cuenta > 99 ? "99+" : cuenta}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
