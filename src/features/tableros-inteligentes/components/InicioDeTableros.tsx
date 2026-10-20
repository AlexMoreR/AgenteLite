"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Network, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { GrupoDeContador } from "../services/niveles";
import type { TableroDelInicio } from "../services/tableros";
import { DialogoDeTablero, linkDelTableroEnPantalla, type EdicionDeTablero } from "./DialogoDeTablero";
import { SeccionTrabajador } from "./SeccionTrabajador";

/*
  La PÁGINA DE INICIO de Tablero IA (/cliente/tablero-ia sin ?tablero, ?tarjeta ni ?area): una
  tarjeta por tablero del negocio con su nombre, los mismos contadores que los chips del diagrama
  (te toca / en curso / siguen / hecho, de todo el tablero) y la última actividad. Tocarla abre el
  diagrama. El dueño o el ADMIN de la plataforma ven además "+ Nuevo tablero", el lápiz "Cambiar
  nombre" de cada tablero y, abajo, la sección Trabajador. Una columna en el celular; grilla en
  pantallas anchas.
*/

/** Los contadores: en el orden y con los colores de los chips del diagrama (variables de .tablero-ia). */
const CONTADORES: { grupo: GrupoDeContador; nombre: string; color: string }[] = [
  { grupo: "teToca", nombre: "Te toca", color: "var(--tia-rojo)" },
  { grupo: "enCurso", nombre: "En curso", color: "var(--tia-verde)" },
  { grupo: "siguen", nombre: "Sigue", color: "var(--tia-gris)" },
  { grupo: "hecho", nombre: "Hecho", color: "var(--tia-gris)" },
];

const CUANDO = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const tarjetasEnTexto = (cuantas: number) => (cuantas === 1 ? "1 tarjeta" : `${cuantas} tarjetas`);

type Props = {
  tableros: TableroDelInicio[];
  /** Dueño o ADMIN de la plataforma: crear y renombrar tableros, y la sección Trabajador. */
  puedeAdministrar: boolean;
};

export function InicioDeTableros({ tableros: iniciales, puedeAdministrar }: Props) {
  const router = useRouter();
  const [tableros, setTableros] = useState(iniciales);
  const [edicion, setEdicion] = useState<EdicionDeTablero | null>(null);

  return (
    <div className="tablero-ia mx-auto w-full max-w-6xl space-y-8 px-4 py-6 md:px-6">
      <section aria-labelledby="titulo-tableros" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="titulo-tableros" className="text-lg font-semibold">
              Tableros
            </h1>
            <p className="text-sm text-muted-foreground">Las ideas que arma Claude contigo, un tablero por tema.</p>
          </div>
          {puedeAdministrar ? (
            <Button className="h-11 md:h-9" onClick={() => setEdicion({ modo: "crear" })}>
              <Plus />
              Nuevo tablero
            </Button>
          ) : null}
        </div>

        {tableros.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
            <Network className="size-10 text-muted-foreground" aria-hidden />
            <p className="font-medium">Todavía no hay tableros</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Pídele a Claude, por ejemplo: “Crea un tablero de Ventas y anota ahí las ideas que hablamos”. Aparece acá solo
              {puedeAdministrar ? ", o créalo tú con «Nuevo tablero»" : ""}.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tableros.map((tablero) => (
              <li key={tablero.id} className="relative">
                <Link
                  href={linkDelTableroEnPantalla(tablero.id)}
                  className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className={puedeAdministrar ? "min-w-0 pr-10" : "min-w-0"}>
                    <span className="block truncate font-medium">{tablero.nombre}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {tarjetasEnTexto(tablero.tarjetas)} · {CUANDO.format(new Date(tablero.actualizadoEn))}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {CONTADORES.map(({ grupo, nombre, color }) => (
                      <span
                        key={grupo}
                        className="flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums"
                      >
                        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                        {nombre} {tablero.contadores[grupo]}
                      </span>
                    ))}
                  </span>
                </Link>
                {puedeAdministrar ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 size-10 text-muted-foreground md:size-8"
                    onClick={() => setEdicion({ modo: "renombrar", id: tablero.id, nombre: tablero.nombre })}
                    aria-label={`Cambiar nombre de ${tablero.nombre}`}
                    title="Cambiar nombre"
                  >
                    <Pencil />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {puedeAdministrar ? <SeccionTrabajador /> : null}

      <DialogoDeTablero
        edicion={edicion}
        tableros={tableros}
        alCerrar={() => setEdicion(null)}
        alRenombrar={(id, nombre) => {
          setTableros((lista) => lista.map((tablero) => (tablero.id === id ? { ...tablero, nombre } : tablero)));
          setEdicion(null);
          router.refresh();
        }}
        alCrear={(id) => {
          setEdicion(null);
          router.push(linkDelTableroEnPantalla(id));
        }}
      />
    </div>
  );
}
