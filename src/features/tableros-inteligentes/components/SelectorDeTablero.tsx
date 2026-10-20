"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LayoutGrid, Loader2, Pencil, Plus } from "lucide-react";

import { TituloDeLaBarra } from "@/components/breadcrumb-label-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TableroResumen } from "../services/tableros";
import {
  DialogoDeTablero,
  etiquetaDelDueno,
  linkDelTableroEnPantalla,
  puedeRenombrar,
  RUTA_DEL_INICIO,
  type CuentasDeTableros,
  type EdicionDeTablero,
} from "./DialogoDeTablero";

/*
  El título de la barra superior en el diagrama de Tablero IA: el NOMBRE del tablero abierto, que al
  tocarlo abre la lista de los tableros que la persona ve (cuántas tarjetas tiene cada uno y cuántas
  esperan aprobación). Se ve aunque haya uno solo, y la lista se vuelve a pedir cada vez que se abre:
  así aparecen los tableros que Claude acaba de crear sin recargar. Al final, "Todos los tableros"
  vuelve a la página de inicio.

  Tableros por cuenta: cada persona ve los suyos y tiene el lápiz "Cambiar nombre" en ellos y
  "+ Nuevo tablero"; el dueño (o el ADMIN de la plataforma) ve todos, con "de Emanuel Diaz" en los
  ajenos, y el lápiz en todos. Los dos abren el mismo diálogo (DialogoDeTablero).
*/

type Props = { tableros: TableroResumen[]; tableroId: string | null; cuentas: CuentasDeTableros };

const tarjetasEnTexto = (cuantas: number) => (cuantas === 1 ? "1 tarjeta" : `${cuantas} tarjetas`);

export function SelectorDeTablero({ tableros: iniciales, tableroId, cuentas }: Props) {
  const router = useRouter();
  const [tableros, setTableros] = useState(iniciales);
  const [cargando, setCargando] = useState(false);
  const [edicion, setEdicion] = useState<EdicionDeTablero | null>(null);
  // El menú se cierra en el mismo clic que abre el diálogo: así sabe que el foco no vuelve a la barra.
  const conDialogo = useRef(false);

  const abierto = tableros.find((tablero) => tablero.id === tableroId) ?? null;

  const refrescar = async () => {
    setCargando(true);
    try {
      const respuesta = await fetch("/api/cliente/tableros-inteligentes", { cache: "no-store" });
      if (respuesta.ok) {
        const cuerpo = (await respuesta.json()) as { ok: boolean; tableros?: TableroResumen[] };
        if (cuerpo.ok && cuerpo.tableros) setTableros(cuerpo.tableros);
      }
    } catch {
      // Sin red: se queda la lista que ya había.
    } finally {
      setCargando(false);
    }
  };

  const elegir = (id: string) => {
    if (id === tableroId) return;
    router.push(linkDelTableroEnPantalla(id));
  };

  const abrirEdicion = (siguiente: EdicionDeTablero) => {
    conDialogo.current = true;
    setEdicion(siguiente);
  };

  return (
    <TituloDeLaBarra>
      <DropdownMenu
        onOpenChange={(abrir) => {
          if (!abrir) return;
          conDialogo.current = false;
          void refrescar();
        }}
      >
        <DropdownMenuTrigger
          aria-label="Cambiar de tablero"
          className="flex min-h-9 min-w-0 max-w-[60vw] items-center gap-1 rounded-md px-1.5 text-base font-medium text-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-md"
        >
          <span className="truncate">{abierto?.nombre ?? "Tablero IA"}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-80 max-w-[calc(100vw-1.5rem)]"
          // Si se abrió el diálogo, el foco es de él y no vuelve al nombre de la barra.
          finalFocus={() => !conDialogo.current}
        >
          <DropdownMenuLabel className="flex items-center justify-between">
            Tableros
            {cargando ? <Loader2 className="size-3.5 animate-spin" aria-label="Actualizando" /> : null}
          </DropdownMenuLabel>
          {tableros.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Todavía no hay tableros. Crea uno abajo o pídeselo a Claude.</p>
          ) : (
            tableros.map((tablero) => {
              const actual = tablero.id === tableroId;
              const deQuien = etiquetaDelDueno(cuentas, tablero);
              return (
                <div key={tablero.id} className="flex items-center gap-0.5">
                  <DropdownMenuItem
                    onClick={() => elegir(tablero.id)}
                    className={cn("min-h-11 min-w-0 flex-1 gap-2 md:min-h-10", actual && "font-semibold")}
                  >
                    <Check className={cn("size-4 shrink-0", actual ? "opacity-100" : "opacity-0")} aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{tablero.nombre}</span>
                      <span className="truncate text-xs font-normal text-muted-foreground tabular-nums">
                        {tarjetasEnTexto(tablero.tarjetas)}
                        {deQuien ? ` · ${deQuien}` : ""}
                      </span>
                    </span>
                    {tablero.porAprobar > 0 ? (
                      <span
                        className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[11px] font-medium tabular-nums text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                        title={`${tablero.porAprobar} por aprobar`}
                        aria-label={`${tablero.porAprobar} por aprobar`}
                      >
                        {tablero.porAprobar}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                  {puedeRenombrar(cuentas, tablero) ? (
                    <DropdownMenuItem
                      onClick={() =>
                        abrirEdicion({
                          modo: "renombrar",
                          id: tablero.id,
                          nombre: tablero.nombre,
                          duenoUserId: tablero.duenoUserId,
                          duenoNombre: tablero.duenoNombre,
                        })
                      }
                      className="size-11 shrink-0 justify-center text-muted-foreground md:size-10"
                      aria-label={`Cambiar nombre de ${tablero.nombre}`}
                      title="Cambiar nombre"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </DropdownMenuItem>
                  ) : null}
                </div>
              );
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => abrirEdicion({ modo: "crear" })} className="min-h-11 gap-2 md:min-h-10">
            <Plus className="size-4 shrink-0" aria-hidden />
            Nuevo tablero
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(RUTA_DEL_INICIO)} className="min-h-11 gap-2 md:min-h-10">
            <LayoutGrid className="size-4 shrink-0" aria-hidden />
            Todos los tableros
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogoDeTablero
        edicion={edicion}
        tableros={tableros}
        cuentas={cuentas}
        alCerrar={() => setEdicion(null)}
        alRenombrar={(id, nombre, dueno) => {
          setTableros((lista) => lista.map((tablero) => (tablero.id === id ? { ...tablero, nombre, ...dueno } : tablero)));
          setEdicion(null);
          // La ruta de arriba ("Tablero › …") lleva el nombre que manda el servidor.
          router.refresh();
        }}
        alCrear={(id) => {
          setEdicion(null);
          router.push(linkDelTableroEnPantalla(id));
        }}
      />
    </TituloDeLaBarra>
  );
}
