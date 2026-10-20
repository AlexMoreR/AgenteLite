"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, House } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  tableroNombre: string;
  ruta: { id: string; titulo: string }[];
  alIr: (nivelId: string | null) => void;
};

/**
 * La ruta del nivel: "Tablero > Magilus > Ventas > ...". Cada paso vuelve a ese nivel con un toque.
 * En el celular la ruta se desliza de lado, arranca mostrando el final y, si hay pasos escondidos a
 * la izquierda, se ve "…" al inicio.
 */
export function MigasDelNivel({ tableroNombre, ruta, alIr }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const [escondidoAlInicio, setEscondidoAlInicio] = useState(false);

  useEffect(() => {
    const elemento = caja.current;
    if (!elemento) return;
    const revisar = () => setEscondidoAlInicio(elemento.scrollLeft > 4);
    elemento.addEventListener("scroll", revisar, { passive: true });
    // Mover el scroll al final dispara "scroll", que actualiza el "…".
    elemento.scrollLeft = elemento.scrollWidth;
    return () => elemento.removeEventListener("scroll", revisar);
  }, [ruta]);

  const pasos = [{ id: null as string | null, titulo: tableroNombre }, ...ruta];
  return (
    <nav aria-label="Nivel del tablero" className="relative min-w-0 flex-1">
      {escondidoAlInicio ? (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center bg-gradient-to-r from-card via-card to-transparent pr-3 pl-3 text-sm text-muted-foreground"
          aria-hidden
        >
          …
        </span>
      ) : null}
      <div ref={caja} className="flex items-center gap-0.5 overflow-x-auto py-0.5 pl-3 [scrollbar-width:none]">
        {pasos.map((paso, i) => {
          const ultimo = i === pasos.length - 1;
          return (
            <span key={paso.id ?? "raiz"} className="flex shrink-0 items-center gap-0.5">
              {i > 0 ? <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden /> : null}
              <button
                type="button"
                onClick={() => alIr(paso.id)}
                aria-current={ultimo ? "page" : undefined}
                className={cn(
                  "flex max-w-[14rem] items-center gap-1 truncate rounded-md px-1.5 py-1 text-sm",
                  ultimo ? "font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {i === 0 ? <House className="size-3.5 shrink-0" aria-hidden /> : null}
                <span className="truncate">{paso.titulo || "Tarjeta"}</span>
              </button>
            </span>
          );
        })}
      </div>
    </nav>
  );
}
