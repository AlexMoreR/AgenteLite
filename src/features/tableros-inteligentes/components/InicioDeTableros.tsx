"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EllipsisVertical, FolderTree, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { NOMBRE_DEL_ESTADO } from "../services/reglas";
import type { AsignadaVista, TableroDelInicio } from "../services/tableros";
import { CoordinadorEnVivo } from "./CoordinadorEnVivo";
import {
  DialogoDeTablero,
  RUTA_DEL_INICIO,
  linkDeLaTarjetaEnPantalla,
  linkDelTableroEnPantalla,
  puedeRenombrar,
  type CuentasDeTableros,
  type EdicionDeTablero,
} from "./DialogoDeTablero";
import { DialogoOrganizarAreas } from "./DialogoOrganizarAreas";
import { ResumenDelDia } from "./ResumenDelDia";
import { VistaDeHoy } from "./VistaDeHoy";
import { CLAVE_VISTA_FEATURES, VistaDeFeatures } from "./VistaDeFeatures";
import { TrabajosTerminados } from "./TrabajosTerminados";
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

/** Las vistas del selector de arriba (solo las ve el dueño o el ADMIN): "Tableros" es lo de siempre. */
export type VistaDelInicio = "tableros" | "hoy" | "coordinador" | "terminados" | "features";
// Orden (20-nov-2026, pedido de Alex): Hoy, Tableros, Coordinador, Terminados.
const PESTANAS: { vista: VistaDelInicio; nombre: string }[] = [
  { vista: "hoy", nombre: "Hoy" },
  { vista: "tableros", nombre: "Espacios" },
  { vista: "coordinador", nombre: "Coordinador en vivo" },
  { vista: "terminados", nombre: "Trabajos terminados" },
];

// "features" no es una pestaña del selector: tiene su botón aparte.
const esVistaDelInicio = (valor: string): valor is VistaDelInicio => PESTANAS.some((pestana) => pestana.vista === valor);

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
  /** Con qué pestaña abre (?vista=hoy, ?vista=coordinador, ?vista=terminados o ?vista=features). Sin permiso de administrar siempre es "tableros". */
  vistaInicial?: VistaDelInicio;
  /** (6-nov-2026) Con ?vista=terminados&dia=AAAA-MM-DD (el link del resumen de las 6 p. m.): el día ya validado, o null. */
  diaInicial?: string | null;
  /** El id del Área Features (para «Ver como mapa»): null si no se pudo leer. */
  areaFeaturesId?: string | null;
};

export function InicioDeTableros({ tableros: iniciales, firma, puedeAdministrar, cuentas, asignadas, vistaInicial = "tableros", diaInicial = null, areaFeaturesId = null }: Props) {
  const router = useRouter();
  // Se actualiza sola (tableros nuevos, contadores, nombres) mientras la pestaña está a la vista.
  const { tableros: lista, setTableros } = useListaDeTableros(iniciales, firma);
  // El último que cambió va primero.
  const tableros = useMemo(
    () => [...lista].sort((a, b) => Date.parse(b.actualizadoEn) - Date.parse(a.actualizadoEn)),
    [lista],
  );
  const [edicion, setEdicion] = useState<EdicionDeTablero | null>(null);
  // «Organizar áreas» (24-nov-2026): el tablero cuya ventana está abierta, o null.
  const [organizando, setOrganizando] = useState<{ id: string; nombre: string } | null>(null);
  // Las pestañas "Tableros", "Hoy", "Coordinador en vivo" y "Trabajos terminados" (solo el dueño o el ADMIN las ven).
  const [vista, setVista] = useState<VistaDelInicio>(puedeAdministrar ? vistaInicial : "tableros");
  const enHoy = puedeAdministrar && vista === "hoy";
  // Las vistas que reemplazan al listado de tableros ("Hoy", "Coordinador en vivo" y "Trabajos terminados").
  const enCoordinador = puedeAdministrar && vista === "coordinador";
  const enTerminados = puedeAdministrar && vista === "terminados";
  const enFeatures = puedeAdministrar && vista === "features";
  const aparte = enHoy || enCoordinador || enTerminados || enFeatures;
  // El filtro por día de "Trabajos terminados" (solo viene en el link); cambiar de pestaña o "Ver todos" lo quita.
  const [diaDeTerminados, setDiaDeTerminados] = useState<string | null>(vistaInicial === "terminados" ? diaInicial : null);
  const elegirVista = (nueva: VistaDelInicio) => {
    setVista(nueva);
    setDiaDeTerminados(null);
    // El link se queda con la pestaña (recargar o compartir vuelve a ella) sin recargar la página.
    window.history.replaceState(null, "", nueva === "tableros" ? RUTA_DEL_INICIO : `${RUTA_DEL_INICIO}?vista=${nueva}`);
  };

  // «Features» (27-nov-2026): si la última vez se eligió el mapa, va al mapa del Área; si no, abre la vista tipo tablero.
  const abrirFeatures = () => {
    let ultima: string | null = null;
    try {
      ultima = window.localStorage.getItem(CLAVE_VISTA_FEATURES);
    } catch {
      // Navegador privado: se abre la vista tipo tablero.
    }
    if (ultima === "mapa" && areaFeaturesId) router.push(`${RUTA_DEL_INICIO}?area=${encodeURIComponent(areaFeaturesId)}`);
    else elegirVista("features");
  };

  return (
    <div className="tablero-ia mx-auto w-full max-w-6xl space-y-8 px-4 py-6 md:px-6">
      <h1 className="sr-only">Espacios</h1>
      {/*
        Arriba de todo, "+ Nuevo" y al lado el selector de vista (21-nov-2026, pedido de Alex: un
        select en vez de las pestañas, y el botón con el tamaño de los de toda la app, como "Nuevo
        contacto" en Contactos).
      */}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className="shrink-0 gap-1.5" onClick={() => setEdicion({ modo: "crear" })}>
          <Plus className="size-4" />
          Nuevo
        </Button>
        {puedeAdministrar ? (
          <Button type="button" variant="outline" className="shrink-0" onClick={abrirFeatures}>
            Features
          </Button>
        ) : null}
        {puedeAdministrar ? (
          <NativeSelect
            aria-label="Vista de Espacio"
            value={esVistaDelInicio(vista) ? vista : ""}
            onChange={(evento) => {
              const nueva = evento.target.value;
              if (esVistaDelInicio(nueva)) elegirVista(nueva);
            }}
          >
            {/* Con la vista Features (botón aparte) el selector no marca ninguna pestaña: así elegir «Hoy» sí cambia de vista. */}
            <NativeSelectOption value="" disabled hidden>
              Vista
            </NativeSelectOption>
            {PESTANAS.map(({ vista: clave, nombre }) => (
              <NativeSelectOption key={clave} value={clave}>
                {nombre}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
      </div>

      {enHoy ? <VistaDeHoy /> : null}

      {enCoordinador ? <CoordinadorEnVivo /> : null}

      {enFeatures ? <VistaDeFeatures /> : null}

      {enTerminados ? <TrabajosTerminados dia={diaDeTerminados} alVerTodos={() => elegirVista("terminados")} /> : null}

      {!aparte && asignadas.length > 0 ? (
        <section aria-labelledby="titulo-asignadas" className="space-y-3">
          <div>
            <h2 id="titulo-asignadas" className="text-lg font-semibold">
              Asignadas a mí
            </h2>
            <p className="text-sm text-muted-foreground">Las tarjetas que te asignaron, estén en el espacio que estén.</p>
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
                      ir al espacio
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!aparte ? (
      <section aria-label="Espacios" className="space-y-4">

        {tableros.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
            <Network className="size-10 text-muted-foreground" aria-hidden />
            <p className="font-medium">Todavía no hay espacios</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Créalo tú con «Nuevo» o pídeselo a Claude, por ejemplo: “Crea un espacio de Ventas y anota ahí
              las ideas que hablamos”.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tableros.map((tablero) => {
              /*
                Solo el título y los tres puntos (22-nov-2026, pedido de Alex): sin la cantidad de tarjetas,
                la fecha, de quién es ni los contadores. «Editar» abre el cambio de nombre; «Eliminar» (solo
                el dueño del negocio) abre directo la confirmación, que archiva el tablero.
              */
              const conMenu = puedeRenombrar(cuentas, tablero);
              const edicionDelTablero = {
                modo: "renombrar" as const,
                id: tablero.id,
                nombre: tablero.nombre,
                duenoUserId: tablero.duenoUserId,
                duenoNombre: tablero.duenoNombre,
              };
              return (
                <li key={tablero.id} className="relative">
                  <Link
                    href={linkDelTableroEnPantalla(tablero.id)}
                    className="flex h-full items-center rounded-xl border bg-card p-4 transition-colors hover:border-foreground/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className={`block min-w-0 truncate font-medium ${conMenu ? "pr-10" : ""}`} title={tablero.nombre}>
                      {tablero.nombre}
                    </span>
                  </Link>
                  {conMenu ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1/2 right-2 size-10 -translate-y-1/2 text-muted-foreground md:size-8"
                            aria-label={`Opciones de ${tablero.nombre}`}
                            title="Opciones"
                          />
                        }
                      >
                        <EllipsisVertical />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40">
                        <DropdownMenuItem onClick={() => setEdicion(edicionDelTablero)}>
                          <Pencil />
                          Editar
                        </DropdownMenuItem>
                        {/* «Organizar áreas» (24-nov-2026): lo ve quien ve «Editar». */}
                        <DropdownMenuItem onClick={() => setOrganizando({ id: tablero.id, nombre: tablero.nombre })}>
                          <FolderTree />
                          Organizar áreas
                        </DropdownMenuItem>
                        {cuentas.esDuenoDelNegocio ? (
                          <DropdownMenuItem variant="destructive" onClick={() => setEdicion({ ...edicionDelTablero, eliminar: true })}>
                            <Trash2 />
                            Eliminar
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      ) : null}

      {puedeAdministrar && !aparte ? <ResumenDelDia /> : null}

      {puedeAdministrar && !aparte ? <SeccionTrabajador /> : null}

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
        alArchivar={(id) => {
          setTableros((lista) => lista.filter((tablero) => tablero.id !== id));
          setEdicion(null);
          toast.success("Espacio eliminado para siempre");
          router.refresh();
        }}
      />

      <DialogoOrganizarAreas tablero={organizando} alCerrar={() => setOrganizando(null)} />
    </div>
  );
}
