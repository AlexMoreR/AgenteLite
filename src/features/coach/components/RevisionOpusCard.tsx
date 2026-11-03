import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { diaCorto } from "../dominio/acciones-de-hoy";
import type { EnlaceDeChatOpus } from "../revision-opus/enlaces";
import { taparTelefonos, type CausaCoach, type ChatRevisado } from "../revision-opus/reglas";
import type { RevisionGuardada } from "../revision-opus/servicio";
import { AbrirChat, Etiqueta } from "./acciones/piezas";
import { CopiarMensajeModelo } from "./CopiarMensajeModelo";

/** El Coach enseña, no castiga: lo que se cayó por el bot o por una política no es culpa de la asesora. */
export function noDependeDeTi(causa: CausaCoach) {
  return causa === "bot" || causa === "politica";
}

/** Primero el chat bien llevado (1) y después los que se pudieron hacer mejor (hasta 2). */
function chatsEnOrden(chats: ChatRevisado[]) {
  return [...chats.filter((c) => c.tipo === "bien").slice(0, 1), ...chats.filter((c) => c.tipo === "mejorable").slice(0, 2)];
}

function Dato({ rotulo, texto }: { rotulo: string; texto: string }) {
  if (!texto.trim()) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
      <p className="text-sm break-words text-foreground">{taparTelefonos(texto)}</p>
    </div>
  );
}

/**
 * "Revisión del día (Opus)": lo que el Coach con Opus (aizen1) leyó de los chats de la asesora.
 * Fecha, resumen y hasta 3 chats con qué pasó, cuándo se cayó el cliente y el mensaje modelo, con
 * "Abrir chat" y "Copiar mensaje modelo". Los teléfonos salen tapados (solo los últimos 4).
 */
export function RevisionOpusCard({
  revision,
  enlaces = {},
}: {
  revision: RevisionGuardada | null;
  enlaces?: Record<string, EnlaceDeChatOpus>;
}) {
  if (!revision) {
    return (
      <Card size="sm" data-testid="revision-opus">
        <CardHeader>
          <CardTitle>Revisión del día (Opus)</CardTitle>
          <CardDescription>Todavía no hay revisión de Opus.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const chats = chatsEnOrden(revision.chats);
  return (
    <Card size="sm" data-testid="revision-opus">
      <CardHeader>
        <CardTitle>Revisión del día (Opus)</CardTitle>
        <CardDescription>
          {diaCorto(revision.fecha)} · {revision.chatsLeidos} {revision.chatsLeidos === 1 ? "chat leído" : "chats leídos"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm break-words whitespace-pre-line text-foreground">{taparTelefonos(revision.resumen)}</p>
        {chats.length ? (
          <ul className="space-y-2">
            {chats.map((chat) => {
              const enlace = enlaces[chat.chatId] ?? { href: null, etiqueta: "Chat" };
              return (
                <li key={chat.chatId} className="space-y-2 rounded-lg border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Etiqueta tono={chat.tipo === "bien" ? "ok" : "aviso"}>
                      {chat.tipo === "bien" ? "Bien llevado" : "Se pudo hacer mejor"}
                    </Etiqueta>
                    <span className="text-xs tabular-nums text-muted-foreground">{enlace.etiqueta}</span>
                    {noDependeDeTi(chat.causa) ? <Etiqueta>No depende de ti</Etiqueta> : null}
                  </div>
                  <Dato rotulo="Qué pasó" texto={chat.quePaso} />
                  <Dato rotulo="Cuándo se cayó el cliente" texto={chat.momentoCaida} />
                  {chat.mensajeModelo.trim() ? (
                    <div className="rounded-lg bg-muted px-3 py-2">
                      <p className="text-xs font-medium text-muted-foreground">Mensaje modelo</p>
                      <p className="text-sm break-words whitespace-pre-line text-foreground">{taparTelefonos(chat.mensajeModelo)}</p>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <AbrirChat chat={enlace} className="w-full sm:w-auto" />
                    {chat.mensajeModelo.trim() ? <CopiarMensajeModelo texto={taparTelefonos(chat.mensajeModelo)} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Ese día no hubo chats para destacar.</p>
        )}
      </CardContent>
    </Card>
  );
}
