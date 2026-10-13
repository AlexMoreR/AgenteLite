import Link from "next/link";

import { cn } from "@/lib/utils";

import {
  deltaDelPaso,
  hrefDelChat,
  telefonoEnmascarado,
  textoPct,
  type EmbudoSemanal,
  type MayorFuga,
} from "../dominio/semanal";

/**
 * LA PANTALLA DEL EMBUDO SEMANAL (diseño aprobado por Alex el 12-10-2026: Main.dc.html y
 * Marketplace.dc.html). Solo presenta: los números llegan armados (dominio/semanal.ts). Sin
 * JavaScript del lado del cliente: las flechas, pestañas y "Ver esos chats" son enlaces.
 *
 * Mobile-first: una columna a 375 px, botones de 44 px, pestañas con scroll horizontal. En
 * escritorio, columna centrada con los pasos en dos columnas.
 */

export type FamiliaDeLaPestana = { clave: string; nombre: string; href: string; activa: boolean; leads: number };

export type ChatDeLaLista = {
  conversationId: string;
  telefono4: string | null;
  asesora: string | null;
  ultimoTexto: string | null;
  ultimoEn: Date | string | null;
  ultimoDeCliente: boolean;
};

export type EmbudoSemanalVistaProps = {
  etiquetaSemana: string;
  etiquetaAnterior: string;
  hrefSemanaAnterior: string;
  /** null = ya es la semana más reciente que se puede ver. */
  hrefSemanaSiguiente: string | null;
  familias: FamiliaDeLaPestana[];
  nombreFamilia: string;
  embudo: EmbudoSemanal;
  anterior: EmbudoSemanal | null;
  fuga: MayorFuga | null;
  hrefVerFuga: string;
  hrefCerrarFuga: string;
  /** La lista abierta (?ver=fuga) o null. */
  chats: ChatDeLaLista[] | null;
  hrefClasica: string;
  ahora: Date;
};

const TONO: Record<string, string> = {
  sube: "font-bold text-green-700 dark:text-green-400",
  baja: "font-bold text-red-700 dark:text-red-400",
  igual: "font-semibold text-muted-foreground",
  nada: "text-muted-foreground",
};

/** Con menos de esto, los % se mueven mucho de una semana a otra. */
const BASE_CHICA = 30;

export function EmbudoSemanalVista(props: EmbudoSemanalVistaProps) {
  const { embudo, anterior, fuga } = props;
  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <header className="flex flex-col gap-3 border-b border-border bg-card px-4 pt-5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-extrabold text-foreground">Embudo</h1>
          <nav aria-label="Semana" className="flex items-center gap-1">
            <Link
              href={props.hrefSemanaAnterior}
              aria-label="Semana anterior"
              className="flex size-11 items-center justify-center rounded-full border border-border bg-background text-lg font-semibold text-foreground hover:bg-muted"
            >
              ‹
            </Link>
            <span className="flex min-h-11 items-center rounded-full border border-border bg-background px-3 text-sm font-semibold whitespace-nowrap text-foreground">
              {props.etiquetaSemana}
            </span>
            {props.hrefSemanaSiguiente ? (
              <Link
                href={props.hrefSemanaSiguiente}
                aria-label="Semana siguiente"
                className="flex size-11 items-center justify-center rounded-full border border-border bg-background text-lg font-semibold text-foreground hover:bg-muted"
              >
                ›
              </Link>
            ) : (
              <span
                aria-hidden
                className="flex size-11 items-center justify-center rounded-full border border-border text-lg font-semibold text-muted-foreground/40"
              >
                ›
              </span>
            )}
          </nav>
        </div>
        <nav aria-label="Familia de producto" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:flex-wrap">
          {props.familias.map((familia) => (
            <Link
              key={familia.clave}
              href={familia.href}
              aria-current={familia.activa ? "page" : undefined}
              className={cn(
                "flex min-h-8 flex-none items-center rounded-full px-3 text-xs font-medium whitespace-nowrap",
                familia.activa
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground hover:bg-muted/70",
                !familia.activa && familia.leads === 0 && "text-muted-foreground",
              )}
            >
              {familia.nombre}
            </Link>
          ))}
        </nav>
        <p className="text-[13px] text-muted-foreground">
          Semana del {props.etiquetaSemana} frente a la anterior ({props.etiquetaAnterior})
        </p>
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        {embudo.llegaron === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            No hay leads maduros de {props.nombreFamilia} en esta semana.
          </p>
        ) : null}

        {embudo.llegaron > 0 && embudo.llegaron < BASE_CHICA ? (
          <p className="rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            Base chica ({embudo.llegaron} leads): los porcentajes se mueven mucho de una semana a otra.
          </p>
        ) : null}

        {fuga ? (
          <section
            aria-labelledby="fuga-titulo"
            className="flex flex-col gap-2 rounded-2xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-900/60 dark:bg-orange-950/30"
          >
            <span className="text-xs font-bold tracking-[0.06em] text-orange-800 uppercase dark:text-orange-300">
              ¿Dónde se pierden más?
            </span>
            <h2 id="fuga-titulo" className="text-lg leading-snug font-extrabold text-foreground">
              {fuga.titulo}
            </h2>
            <p className="text-sm leading-relaxed text-foreground/80">
              {fuga.detalle} {fuga.queRevisar}
            </p>
            {props.chats ? (
              <Link
                href={props.hrefCerrarFuga}
                className="flex min-h-11 items-center self-start rounded-full border border-orange-300 px-4 text-sm font-bold text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-950/60"
              >
                Ocultar la lista
              </Link>
            ) : (
              <Link
                href={props.hrefVerFuga}
                className="flex min-h-11 items-center self-start rounded-full bg-orange-700 px-4 text-sm font-bold text-white hover:bg-orange-800"
              >
                Ver {fuga.quedaron === 1 ? "ese chat" : `esos ${fuga.quedaron} chats`}
              </Link>
            )}
          </section>
        ) : null}

        {props.chats ? <ListaDeChats chats={props.chats} total={fuga?.quedaron ?? props.chats.length} ahora={props.ahora} /> : null}

        <ol className="grid gap-2.5 md:grid-cols-2" aria-label="Pasos del embudo">
          {embudo.pasos.map((paso, indice) => {
            const delta = deltaDelPaso(paso, anterior?.pasos[indice]);
            const esFuga = fuga?.hacia === paso.clave;
            const ancho = paso.pct === null ? 0 : Math.max(paso.pct, paso.leads > 0 ? 2 : 0);
            return (
              <li key={paso.clave} className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="flex size-7 flex-none items-center justify-center rounded-full bg-muted text-[13px] font-bold text-muted-foreground">
                    {paso.n}
                  </span>
                  <span className="flex-1 text-[15px] font-semibold text-foreground">{paso.nombre}</span>
                  <span className="text-[22px] font-extrabold tabular-nums text-foreground">{paso.leads.toLocaleString("es-CO")}</span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-muted" aria-hidden>
                  <div
                    className={cn("h-2 rounded", esFuga ? "bg-orange-700 dark:bg-orange-500" : "bg-blue-600 dark:bg-blue-500")}
                    style={{ width: `${ancho}%` }}
                  />
                </div>
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[13px]">
                  <span className="text-muted-foreground">{textoPct(paso.pct)} de los que llegaron</span>
                  {delta.texto ? <span className={TONO[delta.tono]}>{delta.texto}</span> : null}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card px-4 py-3.5">
          <span className="text-sm text-muted-foreground">En curso (menos de 72 h)</span>
          <span className="text-right text-base font-bold text-muted-foreground">
            {embudo.enCurso > 0 ? (
              <>
                {embudo.enCurso} <span className="text-sm font-medium">· se cuentan después</span>
              </>
            ) : (
              "Ninguno"
            )}
          </span>
        </div>

        <div className="flex flex-col gap-1.5 text-xs leading-normal text-muted-foreground">
          <span>
            Calculado desde los mensajes reales de los chats que escribieron por primera vez esta semana (lunes a domingo, hora
            Bogotá). Los pasos 2 a 4 miran sus primeros 14 días; los de menos de 72 h no entran en los números.
          </span>
          <span>Venta = chat marcado Ganado en el CRM. Muchas ventas no se marcan: por eso se ve tan baja.</span>
          <Link href={props.hrefClasica} className="mt-1 inline-flex min-h-11 items-center self-start underline">
            Ver la vista clásica del embudo
          </Link>
        </div>
      </div>
    </div>
  );
}

function haceCuanto(fecha: Date | string | null, ahora: Date): string {
  if (!fecha) return "";
  const minutos = Math.max(0, Math.round((ahora.getTime() - new Date(fecha).getTime()) / 60_000));
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.round(horas / 24)} d`;
}

function ListaDeChats({ chats, total, ahora }: { chats: ChatDeLaLista[]; total: number; ahora: Date }) {
  return (
    <section id="chats" aria-label="Chats que se quedaron" className="flex flex-col gap-2">
      {chats.length === 0 ? <p className="text-sm text-muted-foreground">No hay chats en esta lista.</p> : null}
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {chats.map((chat) => (
          <li key={chat.conversationId} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-semibold tabular-nums text-foreground">{telefonoEnmascarado(chat.telefono4)}</span>
                <span className="text-muted-foreground">{chat.asesora ?? "Sin asesora"}</span>
                <span className="text-xs text-muted-foreground">{haceCuanto(chat.ultimoEn, ahora)}</span>
              </div>
              <p className="truncate text-[13px] text-muted-foreground">
                {chat.ultimoTexto ? `${chat.ultimoDeCliente ? "Cliente: " : "Nosotros: "}${chat.ultimoTexto}` : "Sin mensajes"}
              </p>
            </div>
            <Link
              href={hrefDelChat(chat.conversationId)}
              className="flex min-h-11 flex-none items-center rounded-full border border-border px-3.5 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Abrir chat
            </Link>
          </li>
        ))}
      </ul>
      {total > chats.length ? (
        <p className="text-xs text-muted-foreground">Se muestran {chats.length} de {total}.</p>
      ) : null}
    </section>
  );
}
