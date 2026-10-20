"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, Pencil, Plus } from "lucide-react";

import { TituloDeLaBarra } from "@/components/breadcrumb-label-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { crearTableroAction, renombrarTableroAction } from "@/app/actions/tableros-inteligentes-actions";
import { cn } from "@/lib/utils";
import { MAX_NOMBRE_TABLERO, problemaDelNombreDeTablero } from "../services/reglas";
import type { TableroResumen } from "../services/tableros";

/*
  El título de la barra superior en Tablero IA: el NOMBRE del tablero abierto, que al tocarlo
  abre la lista de todos los tableros del negocio (cuántas tarjetas tiene cada uno y cuántas esperan
  aprobación). Se ve aunque haya uno solo, y la lista se vuelve a pedir cada vez que se abre: así
  aparecen los tableros que Claude acaba de crear sin recargar.

  El dueño (o el ADMIN de la plataforma) además ve el lápiz "Cambiar nombre" en cada tablero y
  "+ Nuevo tablero": los dos abren el mismo diálogo (Enter guarda, Esc cancela). El servidor vuelve a
  revisar el permiso y el nombre.
*/

type Props = { tableros: TableroResumen[]; tableroId: string | null; puedeAdministrar: boolean };

/** Lo que edita el diálogo: un tablero que se renombra, o uno nuevo. */
type Edicion = { modo: "renombrar"; id: string; nombre: string } | { modo: "crear" };

const tarjetasEnTexto = (cuantas: number) => (cuantas === 1 ? "1 tarjeta" : `${cuantas} tarjetas`);

export function SelectorDeTablero({ tableros: iniciales, tableroId, puedeAdministrar }: Props) {
  const router = useRouter();
  const [tableros, setTableros] = useState(iniciales);
  const [cargando, setCargando] = useState(false);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
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
    router.push(`/cliente/tablero-ia?tablero=${encodeURIComponent(id)}`);
  };

  const abrirEdicion = (siguiente: Edicion) => {
    conDialogo.current = true;
    setEdicion(siguiente);
    setNombre(siguiente.modo === "renombrar" ? siguiente.nombre : "");
    setError(null);
  };

  const cerrarEdicion = () => {
    if (guardando) return;
    setEdicion(null);
  };

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!edicion || guardando) return;
    const limpio = nombre.trim();
    const salvo = edicion.modo === "renombrar" ? edicion.id : null;
    const problema = problemaDelNombreDeTablero(limpio, tableros, salvo);
    if (problema) {
      setError(problema);
      return;
    }
    if (edicion.modo === "renombrar" && limpio === edicion.nombre) {
      setEdicion(null);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      if (edicion.modo === "renombrar") {
        const resultado = await renombrarTableroAction(edicion.id, limpio);
        if (!resultado.ok) {
          setError(resultado.error);
          return;
        }
        setTableros((lista) => lista.map((tablero) => (tablero.id === edicion.id ? { ...tablero, nombre: limpio } : tablero)));
        setEdicion(null);
        // La ruta de arriba ("Tablero › …") lleva el nombre que manda el servidor.
        router.refresh();
      } else {
        const resultado = await crearTableroAction(limpio);
        if (!resultado.ok) {
          setError(resultado.error);
          return;
        }
        setEdicion(null);
        router.push(`/cliente/tablero-ia?tablero=${encodeURIComponent(resultado.id)}`);
      }
    } catch {
      setError("No se pudo guardar. Revisa la conexión e intenta de nuevo.");
    } finally {
      setGuardando(false);
    }
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
            <p className="px-2 py-2 text-sm text-muted-foreground">
              {puedeAdministrar ? "Todavía no hay tableros. Crea uno abajo o pídeselo a Claude." : "Todavía no hay tableros. Pídele a Claude que cree uno."}
            </p>
          ) : (
            tableros.map((tablero) => {
              const actual = tablero.id === tableroId;
              return (
                <div key={tablero.id} className="flex items-center gap-0.5">
                  <DropdownMenuItem
                    onClick={() => elegir(tablero.id)}
                    className={cn("min-h-11 min-w-0 flex-1 gap-2 md:min-h-10", actual && "font-semibold")}
                  >
                    <Check className={cn("size-4 shrink-0", actual ? "opacity-100" : "opacity-0")} aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{tablero.nombre}</span>
                      <span className="text-xs font-normal text-muted-foreground tabular-nums">
                        {tarjetasEnTexto(tablero.tarjetas)}
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
                  {puedeAdministrar ? (
                    <DropdownMenuItem
                      onClick={() => abrirEdicion({ modo: "renombrar", id: tablero.id, nombre: tablero.nombre })}
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
          {puedeAdministrar ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => abrirEdicion({ modo: "crear" })} className="min-h-11 gap-2 md:min-h-10">
                <Plus className="size-4 shrink-0" aria-hidden />
                Nuevo tablero
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={edicion !== null}
        onOpenChange={(abrir) => {
          if (!abrir) cerrarEdicion();
        }}
      >
        <DialogContent initialFocus={campo}>
          <form onSubmit={guardar} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{edicion?.modo === "crear" ? "Nuevo tablero" : "Cambiar nombre"}</DialogTitle>
              <DialogDescription>
                {edicion?.modo === "crear"
                  ? "Nace con los tipos Área, Idea y Tarea."
                  : "Las tarjetas no cambian: solo el nombre del tablero."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Input
                ref={campo}
                value={nombre}
                onChange={(evento) => {
                  setNombre(evento.target.value);
                  setError(null);
                }}
                maxLength={MAX_NOMBRE_TABLERO}
                placeholder="Ventas"
                aria-label="Nombre del tablero"
                aria-invalid={error ? true : undefined}
                enterKeyHint="done"
                autoComplete="off"
                className="h-11 text-base md:h-9 md:text-sm"
                disabled={guardando}
              />
              <div className="flex justify-between gap-2 text-xs">
                <span className="text-destructive" role={error ? "alert" : undefined}>
                  {error}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {nombre.trim().length}/{MAX_NOMBRE_TABLERO}
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 md:h-9" onClick={cerrarEdicion} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="submit" className="h-11 md:h-9" disabled={guardando}>
                {guardando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {edicion?.modo === "crear" ? "Crear" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </TituloDeLaBarra>
  );
}
