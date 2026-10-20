"use client";

import { Mic } from "lucide-react";

import { ContactAvatar } from "./contact-avatar";
import { borrarChatsRecientes, type ChatReciente } from "./busqueda-de-chats-store";
import type { MensajeEncontrado } from "./chat-inbox-types";

/*
  Las secciones del buscador de chats que copian a WhatsApp (Alex, 19-10-2026): "Búsquedas
  recientes" al tocar la caja, y "Mensajes" debajo de los chats encontrados.
*/

export type ChatParaAbrir = { chatKey: string; nombre: string; telefono: string; avatarUrl: string | null };

/** La fila de caras de arriba, con los ultimos chats abiertos desde el buscador. */
export function ChatsRecientes({
  recientes,
  alAbrir,
}: {
  recientes: ChatReciente[];
  alAbrir: (chat: ChatParaAbrir) => void;
}) {
  return (
    <section
      // El dedo NO saca el foco de la caja: si lo sacara, la fila se esconderia antes del toque.
      onPointerDown={(evento) => evento.preventDefault()}
      className="border-b border-border bg-card px-3 py-3"
      aria-label="Búsquedas recientes"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-foreground">Búsquedas recientes</h3>
        <button
          type="button"
          onClick={borrarChatsRecientes}
          className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground transition hover:bg-muted/70"
        >
          Borrar todo
        </button>
      </div>
      <div className="-mx-1 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {recientes.map((chat) => (
          <button
            key={chat.chatKey}
            type="button"
            onClick={() => alAbrir(chat)}
            className="flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-1 text-center transition hover:bg-muted/60"
          >
            <ContactAvatar
              avatarUrl={chat.avatarUrl}
              label={chat.nombre}
              className="size-14 rounded-full"
              fallbackClassName="rounded-full bg-muted text-muted-foreground"
            />
            <span className="line-clamp-2 w-full break-words text-[12px] leading-tight text-foreground">
              {chat.nombre}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function horaDelMensaje(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  const hoy = new Date();
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  if (fecha.toDateString() === hoy.toDateString()) {
    return fecha.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
  }
  if (fecha.toDateString() === ayer.toDateString()) {
    return "Ayer";
  }
  return fecha.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** El texto con lo buscado en negrita, sin importar mayusculas. */
function ConLoBuscadoResaltado({ texto, buscado }: { texto: string; buscado: string }) {
  const q = buscado.trim();
  if (!q) return <>{texto}</>;
  const partes: Array<{ texto: string; coincide: boolean }> = [];
  const enMinusculas = texto.toLowerCase();
  const qMinusculas = q.toLowerCase();
  let desde = 0;
  for (;;) {
    const donde = enMinusculas.indexOf(qMinusculas, desde);
    if (donde < 0) {
      partes.push({ texto: texto.slice(desde), coincide: false });
      break;
    }
    if (donde > desde) partes.push({ texto: texto.slice(desde, donde), coincide: false });
    partes.push({ texto: texto.slice(donde, donde + q.length), coincide: true });
    desde = donde + q.length;
  }
  return (
    <>
      {partes.map((parte, indice) =>
        parte.coincide ? (
          <strong key={indice} className="font-semibold text-foreground">
            {parte.texto}
          </strong>
        ) : (
          <span key={indice}>{parte.texto}</span>
        ),
      )}
    </>
  );
}

/** La seccion "Mensajes": cada mensaje que contiene lo buscado, para abrir el chat ahi. */
export function MensajesEncontradosLista({
  mensajes,
  buscado,
  alAbrir,
}: {
  mensajes: MensajeEncontrado[];
  buscado: string;
  alAbrir: (chat: ChatParaAbrir, messageId: string) => void;
}) {
  return (
    <section aria-label="Mensajes encontrados" className="bg-card">
      <h3 className="px-4 pb-1 pt-4 text-[15px] font-semibold text-foreground">Mensajes</h3>
      <ul className="divide-y divide-border">
        {mensajes.map((mensaje) => (
          <li key={mensaje.id}>
            <button
              type="button"
              onClick={() =>
                alAbrir(
                  {
                    chatKey: mensaje.chatKey,
                    nombre: mensaje.nombre,
                    telefono: mensaje.telefono,
                    avatarUrl: mensaje.avatarUrl,
                  },
                  mensaje.id,
                )
              }
              className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition hover:bg-muted/50"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[14px] font-semibold text-foreground">{mensaje.nombre}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{horaDelMensaje(mensaje.createdAt)}</span>
              </span>
              <span className="flex min-w-0 items-start gap-1 text-[13px] leading-snug text-muted-foreground">
                {mensaje.esDeUnAudio ? <Mic className="mt-0.5 size-3.5 shrink-0" aria-label="Dicho en un audio" /> : null}
                <span className="line-clamp-2 min-w-0">
                  {mensaje.deQuien === "nosotros" ? "Tú: " : ""}
                  <ConLoBuscadoResaltado texto={mensaje.fragmento} buscado={buscado} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
