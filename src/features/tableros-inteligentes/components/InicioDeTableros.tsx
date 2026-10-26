"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Network, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { GrupoDeContador } from "../services/niveles";
import { NOMBRE_DEL_ESTADO } from "../services/reglas";
import type { AsignadaVista, TableroDelInicio } from "../services/tableros";
import { CoordinadorEnVivo } from "./CoordinadorEnVivo";
import {
  DialogoDeTablero,
  RUTA_DEL_INICIO,
  etiquetaDelDueno,
  linkDeLaTarjetaEnPantalla,
  linkDelTableroEnPantalla,
  puedeRenombrar,
  type CuentasDeTableros,
  type EdicionDeTablero,
} from "./DialogoDeTablero";
import { VistaDeHoy } from "./VistaDeHoy";
import { ResumenDelDia } from "./ResumenDelDia";
import { SeccionTrabajador } from "./SeccionTrabajador";
import { useListaDeTableros } from "../hooks/useRefrescoDelTablero";

/*
  La PÁGINA DE INICIO de Tablero IA (/cliente/tablero-ia sin ?tablero, ?tarjeta ni ?area): una
  tarjeta por tablero del negocio con su nombre, los mismos contadores que los chips del diagrama
  (te toca / en curso / siguen / hecho, de todo el tablero) y la última actividad. Tocarla abre el
  diagrama. Se actualiza sola cada 5 s con la pestaña a la vista (useListaDeTableros). Tableros por cuenta: cada persona ve los suyos y los crea ("+ Nuevo tablero") y renombra
  (el lápiz); el dueño o el ADMIN de la plataforma ven todos, con "de Emanuel Diaz" en los que no son
  suyos, eligen de quién es cada uno y, abajo, ven la sección Trabajador. Una columna en el celular;
  grilla en pantallas anchas.
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

/** Las dos pestañas de arriba (solo las ve el dueño o el ADMIN): "Tableros" es lo de siempre. */
export type VistaDelInicio = "tableros" | "hoy" | "coordinador";
const PESTANAS: { vista: VistaDelInicio; nombre: string }[] = [
  { vista: "tableros", nombre: "Tableros" },
  { vista: "hoy", nombre: "Hoy" },
  { vista: "coordinador", nombre: "Coordinador en vivo" },
];

const tarjetasEnTexto = (cuantas: number) => (cuantas === 1 ? "1 tarjeta" : `${cuantas} tarjetas`);

type Props = {
  tableros: TableroDelInicio[];
  /** La firma de esa lista (firmaDeLaLista): el refresco de 5 s pregunta si cambió. */
  firma: string;
  /** Dueño o ADMIN de la plataforma: la sección Trabajador. */
  puedeAdministrar: boolean;
  /** Tableros por cuenta: quién mira, si ve todos y a quién le puede dar uno. */
  cuentas: CuentasDeTableros;
  /** Las tarjetas que le asignaron a quien mira, en cualquier tablero del negocio ("Asignadas a mí"). */
  asignadas: AsignadaVista[];
  /** Con qué pestaña abre (?vista=coordinador o ?vista=hoy). Sin permiso de administrar siempre es "tableros". */
  vistaInicial?: VistaDelInicio;
};

export function InicioDeTableros({ tableros: iniciales, firma, puedeAdministrar, cuentas, asignadas, vistaInicial = "tableros" }: Props) {
  const router = useRouter();
  // Se actualiza sola (tableros nuevos, contadores, nombres) mientras la pestaña está a la vista.
  const { tableros: lista, setTableros } = useListaDeTableros(iniciales, firma);
  // El último que cambió va primero.
  const tableros = useMemo(
    () => [...lista].sort((a, b) => Date.parse(b.actualizadoEn) - Date.parse(a.actualizadoEn)),
    [lista],
  );
  const [edicion, setEdicion] = useState<EdicionDeTablero | null>(null);
  // Las pestañas "Tableros" y "Coordinador en vivo" (solo el dueño o el ADMIN las ven).
  const [vista, setVista] = useState<VistaDelInicio>(puedeAdministrar ? vistaInicial : "tableros");
  const enCoordinador = puedeAdministrar && vista === "coordinador";
  const enHoy = puedeAdministrar && vista === "hoy";
  const elegirVista = (nueva: VistaDelInicio) => {
    setVista(nueva);
    // El link se queda con la pestaña (recargar o compartir vuelve a ella) sin recargar la página.
    window.history.replaceState(null, "", nueva === "tableros" ? RUTA_DEL_INICIO : `${RUTA_DEL_INICIO}?vista=${nueva}`);
  };

  return (
    <div className="tablero-ia mx-auto w-full max-w-6xl space-y-8 px-4 py-6 md:px-6">
      {puedeAdministrar ? (
        <div role="tablist" aria-label="Vistas de Tablero IA" className="flex gap-1 rounded-xl border bg-muted/40 p-1">
          {PESTANAS.map(({ vista: clave, nombre }) => (
            <button
              key={clave}
              type="button"
              role="tab"
              aria-selected={vista === clave}
              onClick={() => elegirVista(clave)}
              className={`h-11 flex-1 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9 ${
                vista === clave ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {nombre}
            </button>
          ))}
        </div>
      ) : null}

      {enCoordinador ? <CoordinadorEnVivo /> : null}

      {enHoy ? <VistaDeHoy /> : null}

      {!enCoordinador && !enHoy && asignadas.length > 0 ? (
        <section aria-labelledby="titulo-asignadas" className="space-y-3">
          <div>
            <h2 id="titulo-asignadas" className="text-lg font-semibold">
              Asignadas a mí
            </h2>
            <p className="text-sm text-muted-foreground">Las tarjetas que te asignaron, estén en el tablero que estén.</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {asignadas.map((tarjeta) => (
              <li key={tarjeta.id} className="flex flex-col gap-1 rounded-xl border bg-card p-3">
                <Link
                  href={linkDeLaTarjetaEnPantalla(tarjeta.id)}
                  className="line-clamp-2 text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={tarjeta.titulo}
                >
                  {tarjeta.titulo}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {tarjeta.tipoNombre}
                  {tarjeta.usaEstados ? ` · ${NOMBRE_DEL_ESTADO[tarjeta.estado]}` : ""}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="truncate" title={tarjeta.tableroNombre}>
                    En {tarjeta.tableroNombre}
                  </span>
                  {tarjeta.puedeVerElTablero ? (
                    <Link href={linkDelTableroEnPantalla(tarjeta.tableroId)} className="underline-offset-2 hover:underline">
                      ir al tablero
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!enCoordinador && !enHoy ? (
      <section aria-labelledby="titulo-tableros" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="titulo-tableros" className="text-lg font-semibold">
              Tableros
            </h1>
            <p className="text-sm text-muted-foreground">Las ideas que arma Claude contigo, un tablero por tema.</p>
          </div>
          <Button className="h-11 md:h-9" onClick={() => setEdicion({ modo: "crear" })}>
            <Plus />
            Nuevo tablero
          </Button>
        </div>

        {tableros.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
            <Network className="size-10 text-muted-foreground" aria-hidden />
            <p className="font-medium">Todavía no hay tableros</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Créalo tú con «Nuevo tablero» o pídeselo a Claude, por ejemplo: “Crea un tablero de Ventas y anota ahí
              las ideas que hablamos”.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tableros.map((tablero) => {
              const conLapiz = puedeRenombrar(cuentas, tablero);
              const deQuien = etiquetaDelDueno(cuentas, tablero);
              return (
                <li key={tablero.id} className="relative">
                  <Link
                    href={linkDelTableroEnPantalla(tablero.id)}
                    className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={conLapiz ? "min-w-0 pr-10" : "min-w-0"}>
                      <span className="block truncate font-medium" title={tablero.nombre}>
                        {tablero.nombre}
                      </span>
                      {deQuien ? <span className="block truncate text-xs text-muted-foreground">{deQuien}</span> : null}
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
                  {conLapiz ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 size-10 text-muted-foreground md:size-8"
                      onClick={() =>
                        setEdicion({
                          modo: "renombrar",
                          id: tablero.id,
                          nombre: tablero.nombre,
                          duenoUserId: tablero.duenoUserId,
                          duenoNombre: tablero.duenoNombre,
                        })
                      }
                      aria-label={`Cambiar nombre de ${tablero.nombre}`}
                      title="Cambiar nombre"
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      ) : null}

      {puedeAdministrar && !enCoordinador && !enHoy ? <ResumenDelDia /> : null}

      {puedeAdministrar && !enCoordinador && !enHoy ? <SeccionTrabajador /> : null}

      <DialogoDeTablero
        edicion={edicion}
        tableros={tableros}
        cuentas={cuentas}
        alCerrar={() => setEdicion(null)}
        alRenombrar={(id, nombre, dueno) => {
          setTableros((lista) => lista.map((tablero) => (tablero.id === id ? { ...tablero, nombre, ...dueno } : tablero)));
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
