import Link from "next/link";
import { Network } from "lucide-react";

import { hrefDelChat, telefonoEnmascarado } from "@/features/embudo/dominio/semanal";
import { nombreDelMotivo } from "@/features/seguimiento-inteligente/dominio/motivos-de-tarea";
import { cn } from "@/lib/utils";

import { haceCuanto, nombreDeEtapa, textoDeVencimiento, type AsesoraConTareas, type Grupo } from "../dominio/listas";
import { EncabezadoDeRecuperacion, type EncabezadoProps } from "./encabezado";

/**
 * RECUPERACIÓN · vista "Leads": los chats detrás de cada número de "Semana". Solo presenta (los
 * grupos se arman en dominio/listas.ts). Sin JavaScript del lado del cliente: chips, asesoras y
 * "Ver más" son enlaces. Cada chat con su "Abrir chat" (el mismo enlace de la bandeja que usan
 * Embudo y Supervisor). Mobile-first: una columna, botones de 44 px.
 */

export type ChipDeGrupo = { grupo: Grupo; nombre: string; total: number | null; href: string };

export type ItemDeLista = {
  conversationId: string;
  nombre: string | null;
  telefono4: string | null;
  linea: string | null;
  asesora: string | null;
  producto: string | null;
  etapa: string | null;
  ultimoClienteEn: Date | null;
  ultimoTexto: string | null;
  /** Por qué está en la lista. */
  razon: string;
  /** Solo tareas: el motivo y el vencimiento. */
  motivo?: string | null;
  vence?: Date | null;
};

export type LeadsDeRecuperacionVistaProps = {
  encabezado: Omit<EncabezadoProps, "vista">;
  grupo: Grupo;
  titulo: string;
  /** Qué es esta lista, en una línea. */
  explicacion: string;
  chips: ChipDeGrupo[];
  total: number;
  items: ItemDeLista[];
  /** null = ya se ven todos. */
  hrefVerMas: string | null;
  ahora: Date;
  /** Solo en tareas: filtro por asesora. */
  asesoras?: Array<AsesoraConTareas & { href: string; activa: boolean }>;
  hrefTodasLasAsesoras?: string;
};

const CHIP = "flex min-h-10 flex-none items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap";

export function LeadsDeRecuperacionVista(props: LeadsDeRecuperacionVistaProps) {
  const n = (valor: number) => valor.toLocaleString("es-CO");
  const esTareas = props.grupo === "vencidas" || props.grupo === "llamadas72";
  const conAsesora = props.items.map((item, i) => ({ item, cabecera: esTareas && (i === 0 || props.items[i - 1].asesora !== item.asesora) }));

  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <EncabezadoDeRecuperacion vista="leads" {...props.encabezado} />

      <div className="flex flex-col gap-3.5 p-4">
        <nav aria-label="Listas" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {props.chips.map((chip) =>
            chip.grupo === props.grupo ? (
              <span key={chip.grupo} aria-current="page" className={cn(CHIP, "border-foreground bg-foreground text-background")}>
                {chip.nombre}
                {chip.total !== null ? <span className="tabular-nums opacity-80">{n(chip.total)}</span> : null}
              </span>
            ) : (
              <Link key={chip.grupo} href={chip.href} className={cn(CHIP, "border-border bg-card text-foreground hover:bg-muted")}>
                {chip.nombre}
                {chip.total !== null ? <span className="tabular-nums text-muted-foreground">{n(chip.total)}</span> : null}
              </Link>
            ),
          )}
        </nav>

        <section aria-labelledby="lista-titulo" className="flex flex-col gap-1">
          <h2 id="lista-titulo" className="flex items-baseline justify-between gap-2 text-[17px] font-extrabold text-foreground">
            <span>{props.titulo}</span>
            <span className="tabular-nums">{n(props.total)}</span>
          </h2>
          <span className="text-[13px] text-muted-foreground">{props.explicacion}</span>
        </section>

        {props.asesoras && props.asesoras.length > 1 ? (
          <nav aria-label="Asesora" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <Link
              href={props.hrefTodasLasAsesoras ?? "#"}
              aria-current={props.asesoras.some((a) => a.activa) ? undefined : "page"}
              className={cn(
                CHIP,
                props.asesoras.some((a) => a.activa) ? "border-border bg-card text-foreground hover:bg-muted" : "border-foreground bg-foreground text-background",
              )}
            >
              Todas
            </Link>
            {props.asesoras.map((a) => (
              <Link
                key={a.asesora}
                href={a.href}
                aria-current={a.activa ? "page" : undefined}
                className={cn(CHIP, a.activa ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted")}
              >
                {a.asesora}
                <span className={cn("tabular-nums", a.activa ? "opacity-80" : "text-muted-foreground")}>{n(a.tareas)}</span>
              </Link>
            ))}
          </nav>
        ) : null}

        {props.items.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">No hay chats en esta lista.</p>
        ) : (
          <ul className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
            {conAsesora.map(({ item, cabecera }) => (
              <li key={item.conversationId} className="flex flex-col">
                {cabecera ? (
                  <span className="border-b border-border bg-muted px-4 py-2 text-xs font-bold tracking-[0.06em] text-muted-foreground uppercase">
                    {item.asesora ?? "Sin asesora"}
                  </span>
                ) : null}
                <Fila item={item} ahora={props.ahora} esTarea={esTareas} />
              </li>
            ))}
          </ul>
        )}

        {props.hrefVerMas ? (
          <Link
            href={props.hrefVerMas}
            className="flex min-h-11 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold text-foreground hover:bg-muted"
          >
            Ver más ({n(props.items.length)} de {n(props.total)})
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Fila({ item, ahora, esTarea }: { item: ItemDeLista; ahora: Date; esTarea: boolean }) {
  const quien = item.nombre ?? telefonoEnmascarado(item.telefono4);
  const datos = [item.linea, esTarea ? null : (item.asesora ?? "Sin asesora"), item.producto, nombreDeEtapa(item.etapa)].filter(Boolean);
  const vencida = esTarea && item.vence && item.vence.getTime() <= ahora.getTime();
  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] font-bold text-foreground">{quien}</span>
          {datos.length ? <span className="text-[13px] text-muted-foreground">{datos.join(" · ")}</span> : null}
        </div>
        <Link
          href={`/cliente/mapa-del-lead?chatKey=${encodeURIComponent(`agent:${item.conversationId}`)}`}
          aria-label={`Mapa del lead de ${quien}`}
          title="Mapa del lead"
          className="flex size-11 flex-none items-center justify-center rounded-full border border-border bg-background text-foreground hover:bg-muted"
        >
          <Network className="size-4 text-[#7c3aed]" />
        </Link>
        <Link
          href={hrefDelChat(item.conversationId)}
          aria-label={`Abrir chat de ${quien}`}
          className="flex min-h-11 flex-none items-center rounded-full border border-border bg-background px-3.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Abrir chat
        </Link>
      </div>
      {esTarea ? (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <span className="font-semibold text-foreground">{nombreDelMotivo(item.motivo)}</span>
          <span className={cn("font-semibold", vencida ? "text-red-700 dark:text-red-400" : "text-orange-800 dark:text-orange-300")}>
            {textoDeVencimiento(item.vence ?? null, ahora)}
          </span>
        </span>
      ) : (
        <span className="text-[13px] font-semibold text-foreground">{item.razon}</span>
      )}
      <p className="line-clamp-2 text-[13px] text-muted-foreground">
        {item.ultimoClienteEn ? (
          <>
            <span className="font-semibold">Cliente {haceCuanto(item.ultimoClienteEn, ahora)}</span>
            {item.ultimoTexto ? <>: “{item.ultimoTexto}”</> : null}
          </>
        ) : (
          "El cliente no ha escrito"
        )}
      </p>
    </div>
  );
}
