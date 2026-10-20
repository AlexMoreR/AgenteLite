"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2 } from "lucide-react";

import { TituloDeLaBarra } from "@/components/breadcrumb-label-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TableroResumen } from "../services/tableros";

/*
  El título de la barra superior en Tablero IA: el NOMBRE del tablero abierto, que al tocarlo
  abre la lista de todos los tableros del negocio (con cuántas tarjetas esperan aprobación).
  Se ve aunque haya uno solo, y la lista se vuelve a pedir cada vez que se abre: así aparecen los
  tableros que Claude acaba de crear sin recargar.
*/

type Props = { tableros: TableroResumen[]; tableroId: string | null };

export function SelectorDeTablero({ tableros: iniciales, tableroId }: Props) {
  const router = useRouter();
  const [tableros, setTableros] = useState(iniciales);
  const [cargando, setCargando] = useState(false);

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
    router.push(`/cliente/tablero-ia?tablero=${encodeURIComponent(id)}`);
  };

  return (
    <TituloDeLaBarra>
      <DropdownMenu
        onOpenChange={(abrir) => {
          if (abrir) void refrescar();
        }}
      >
        <DropdownMenuTrigger
          aria-label="Cambiar de tablero"
          className="flex min-h-9 min-w-0 max-w-[60vw] items-center gap-1 rounded-md px-1.5 text-base font-medium text-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-md"
        >
          <span className="truncate">{abierto?.nombre ?? "Tablero IA"}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-1.5rem)]">
          <DropdownMenuLabel className="flex items-center justify-between">
            Tableros
            {cargando ? <Loader2 className="size-3.5 animate-spin" aria-label="Actualizando" /> : null}
          </DropdownMenuLabel>
          {tableros.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              Todavía no hay tableros. Pídele a Claude que cree uno.
            </p>
          ) : (
            tableros.map((tablero) => {
              const actual = tablero.id === tableroId;
              return (
                <DropdownMenuItem
                  key={tablero.id}
                  onClick={() => elegir(tablero.id)}
                  className={cn("min-h-10 gap-2", actual && "font-semibold")}
                >
                  <Check className={cn("size-4 shrink-0", actual ? "opacity-100" : "opacity-0")} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{tablero.nombre}</span>
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
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </TituloDeLaBarra>
  );
}
