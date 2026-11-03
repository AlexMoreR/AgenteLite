import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { diaCorto } from "../dominio/acciones-de-hoy";
import { taparTelefonos, type ChatRevisado } from "../revision-opus/reglas";
import type { RevisionGuardada } from "../revision-opus/servicio";
import { AbrirChat } from "./acciones/piezas";
import { CopiarMensajeModelo } from "./CopiarMensajeModelo";

/** El enlace de cada chat de la revisión (por chatId): el link de la bandeja y "#1234 · •••• 0204". */
export type EnlaceDeRevision = { href: string | null; etiqueta: string };

/** Lo que causa el bot o una política del negocio no se le cobra a la asesora. */
const noDependeDeTi = (chat: ChatRevisado) => chat.causa === "bot" || chat.causa === "politica";

/** Por si algún texto guardado trae un teléfono: se muestra solo con sus últimos 4 dígitos. */
const limpio = (texto: string) => taparTelefonos(texto ?? "").trim();

function ChatDeLaRevision({ chat, enlace }: { chat: ChatRevisado; enlace?: EnlaceDeRevision }) {
  const etiqueta = enlace?.etiqueta ?? "Chat";
  const mensaje = limpio(chat.mensajeModelo);
  return (
    <li className="space-y-2 rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium tabular-nums text-foreground">{etiqueta}</span>
        {chat.tipo === "bien" ? (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Bien llevado</Badge>
        ) : (
          <Badge variant="secondary">Se pudo hacer mejor</Badge>
        )}
        {noDependeDeTi(chat) ? <Badge variant="outline">No depende de ti</Badge> : null}
      </div>
      {chat.quePaso ? (
        <p className="text-sm text-foreground">
          <span className="font-medium">Qué pasó: </span>
          {limpio(chat.quePaso)}
        </p>
      ) : null}
      {chat.momentoCaida ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Dónde se cayó el cliente: </span>
          {limpio(chat.momentoCaida)}
        </p>
      ) : null}
      {noDependeDeTi(chat) ? (
        <p className="text-xs text-muted-foreground">
          Este chat se cayó por {chat.causa === "bot" ? "el bot" : "una política del negocio"}: no depende de ti.
        </p>
      ) : null}
      {mensaje ? (
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Mensaje modelo</p>
          <p className="text-sm whitespace-pre-line break-words text-foreground">{mensaje}</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
        <AbrirChat chat={{ href: enlace?.href ?? null, etiqueta }} className="w-full sm:w-auto" />
        {mensaje ? <CopiarMensajeModelo texto={mensaje} /> : null}
      </div>
    </li>
  );
}

/**
 * "Revisión del día (Opus)": la última revisión que dejó el Coach con Opus para esta asesora. El
 * resumen, 1 chat bien llevado y hasta 2 que se pudieron hacer mejor, con el mensaje modelo. Sin
 * teléfonos completos. Si no hay revisión, un aviso corto.
 */
export function RevisionOpusCard({
  revision,
  enlaces = {},
}: {
  revision: RevisionGuardada | null;
  enlaces?: Record<string, EnlaceDeRevision>;
}) {
  if (!revision) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>Revisión del día (Opus)</CardTitle>
          <CardDescription>Todavía no hay revisión del Coach con Opus.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Primero el bien llevado y después los que se pudieron hacer mejor (con el tope acordado).
  const bien = revision.chats.filter((chat) => chat.tipo === "bien").slice(0, 1);
  const mejorables = revision.chats.filter((chat) => chat.tipo === "mejorable").slice(0, 2);
  const chats = [...bien, ...mejorables];

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Revisión del día (Opus)</CardTitle>
        <CardDescription>
          {diaCorto(revision.fecha)}
          {revision.chatsLeidos > 0 ? ` · ${revision.chatsLeidos} ${revision.chatsLeidos === 1 ? "chat leído" : "chats leídos"}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {revision.resumen ? <p className="text-sm text-foreground">{limpio(revision.resumen)}</p> : null}
        {chats.length ? (
          <ul className="space-y-2">
            {chats.map((chat) => (
              <ChatDeLaRevision key={chat.chatId} chat={chat} enlace={enlaces[chat.chatId]} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Ese día no hubo chats para comentar.</p>
        )}
      </CardContent>
    </Card>
  );
}
