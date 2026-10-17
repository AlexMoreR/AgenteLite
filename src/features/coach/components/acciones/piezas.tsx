import Link from "next/link";
import type { ReactNode } from "react";

import type { EnlaceDeChat, EstadoDeAccion } from "../../dominio/acciones-de-hoy";
import { ETIQUETA_DE_CIERRE, type CierreDeChat } from "../../dominio/chats-cerrados";

/**
 * Piezas chicas de "Acciones de hoy": desplegable, enlace "Abrir chat", chip de estado. Sin estado
 * de cliente (funcionan con <details> nativo), asi la pagina sigue siendo de servidor.
 * Botones y enlaces de al menos 44 px de alto (se usan con el dedo en el celular).
 */

export function Desplegable({
  titulo,
  children,
  abierto = false,
  className = "",
  testId,
}: {
  titulo: ReactNode;
  children: ReactNode;
  abierto?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <details open={abierto} data-testid={testId} className={`group rounded-lg border border-border bg-background/60 ${className}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-foreground select-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{titulo}</span>
        <span aria-hidden className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">{children}</div>
    </details>
  );
}

export function AbrirChat({ chat, className = "" }: { chat: Pick<EnlaceDeChat, "href" | "etiqueta">; className?: string }) {
  if (!chat.href) {
    return <span className={`inline-flex min-h-11 items-center text-xs text-muted-foreground ${className}`}>Sin enlace al chat</span>;
  }
  return (
    <Link
      href={chat.href}
      data-testid="abrir-chat"
      aria-label={`Abrir chat ${chat.etiqueta}`}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted ${className}`}
    >
      Abrir chat
    </Link>
  );
}

/** Un chat citado: "#3948 · •••• 0204", el texto y el boton para abrirlo. */
export function FilaDeChat({
  chat,
  texto,
  etiquetas,
  extra,
}: {
  chat: EnlaceDeChat;
  texto?: ReactNode;
  etiquetas?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <li className="space-y-1.5 rounded-lg border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium tabular-nums text-foreground">{chat.etiqueta}</span>
        {chat.nombreCliente ? <span className="text-xs text-muted-foreground">· {chat.nombreCliente}</span> : null}
        {etiquetas}
        <EtiquetaDeCierre cierre={chat.cierre} />
      </div>
      {texto ? <p className="text-sm text-muted-foreground">{texto}</p> : null}
      {extra}
      <AbrirChat chat={chat} className="w-full sm:w-auto" />
    </li>
  );
}

export function Etiqueta({ children, tono = "neutro" }: { children: ReactNode; tono?: "neutro" | "aviso" | "peligro" | "ok" }) {
  const color =
    tono === "aviso"
      ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
      : tono === "peligro"
        ? "bg-destructive/15 text-destructive"
        : tono === "ok"
          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
          : "bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${color}`}>{children}</span>;
}

/** "Resuelto" / "Descartado" / "Ganado": el chat se cerro despues del informe (apagada, no alarma). */
export function EtiquetaDeCierre({ cierre }: { cierre?: CierreDeChat | null }) {
  if (!cierre) return null;
  return (
    <span data-testid="cierre" data-cierre={cierre}>
      <Etiqueta>{ETIQUETA_DE_CIERRE[cierre]}</Etiqueta>
    </span>
  );
}

export const NOMBRE_DEL_ESTADO: Record<EstadoDeAccion, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  cumplido: "Cumplido",
};

export function ChipDeEstado({ estado }: { estado: EstadoDeAccion }) {
  const tono = estado === "cumplido" ? "ok" : estado === "en_progreso" ? "aviso" : "neutro";
  return (
    <span data-testid="estado" data-estado={estado}>
      <Etiqueta tono={tono}>{NOMBRE_DEL_ESTADO[estado]}</Etiqueta>
    </span>
  );
}

/** Una cifra grande con su rotulo (situacion / meta). */
export function Cifra({ rotulo, valor, detalle, resaltada = false }: { rotulo: string; valor: ReactNode; detalle?: ReactNode; resaltada?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${resaltada ? "bg-primary/10 ring-1 ring-primary/20" : "bg-muted"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className="text-2xl font-semibold leading-tight tabular-nums text-foreground">{valor}</div>
      {detalle ? <div className="text-xs leading-snug text-muted-foreground">{detalle}</div> : null}
    </div>
  );
}
