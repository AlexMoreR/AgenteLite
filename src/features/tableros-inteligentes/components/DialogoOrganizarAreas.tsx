"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  areasDelTableroAction,
  borrarAreaAction,
  crearAreaAction,
  moverAreaAction,
  renombrarAreaAction,
} from "@/app/actions/tableros-inteligentes-actions";
import type { AreaVista } from "../services/areas";

/*
  La ventana «Organizar áreas» (24-nov-2026), en el menú de los tres puntos de cada tablero de la página de
  inicio. Muestra las áreas como árbol con sangría y deja crear, renombrar, ordenar con ↑/↓ entre hermanas
  (sin arrastrar), meter una dentro de otra («Dentro de») y borrar solo las vacías, con confirmación. Toda la
  lógica y los permisos están en el servidor (services/areas.ts y sus acciones): si algo no se puede (un ciclo,
  borrar sin ser el dueño), se muestra el mensaje del servidor y no cambia nada. Después de cada cambio vuelve a
  leer la lista y refresca la pantalla, para que el diagrama lo muestre.
*/

/** El valor del selector «Dentro de» que deja el área arriba de todo (en la raíz). */
const RAIZ = "";

type Props = {
  /** El tablero que se organiza; null = la ventana cerrada. */
  tablero: { id: string; nombre: string } | null;
  alCerrar: () => void;
};

export function DialogoOrganizarAreas({ tablero, alCerrar }: Props) {
  return (
    <Dialog
      open={tablero !== null}
      onOpenChange={(abrir) => {
        if (!abrir) alCerrar();
      }}
    >
      {/* Con key: cada vez que se abre arranca leyendo las áreas de ese tablero. */}
      {tablero ? <Contenido key={tablero.id} tablero={tablero} /> : null}
    </Dialog>
  );
}

type Datos = { areas: AreaVista[]; tipoArea: { id: string; nombre: string } | null; puedeBorrar: boolean };

/** Una fila del árbol: el área, su nivel (para la sangría) y su puesto entre las hermanas. */
type Fila = { area: AreaVista; nivel: number; primera: boolean; ultima: boolean };

/** El árbol aplanado en el orden en que se ve: cada área seguida de sus hijas, en el orden del servidor. */
function filasDelArbol(areas: readonly AreaVista[]): Fila[] {
  const hijasDe = new Map<string | null, AreaVista[]>();
  for (const area of areas) {
    const lista = hijasDe.get(area.padreId) ?? [];
    lista.push(area);
    hijasDe.set(area.padreId, lista);
  }
  const filas: Fila[] = [];
  const vistas = new Set<string>();
  const recorrer = (padreId: string | null, nivel: number) => {
    const hermanas = hijasDe.get(padreId) ?? [];
    hermanas.forEach((area, puesto) => {
      if (vistas.has(area.id)) return;
      vistas.add(area.id);
      filas.push({ area, nivel, primera: puesto === 0, ultima: puesto === hermanas.length - 1 });
      recorrer(area.id, nivel + 1);
    });
  };
  recorrer(null, 0);
  return filas;
}

function Contenido({ tablero }: { tablero: { id: string; nombre: string } }) {
  const router = useRouter();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [errorAlCargar, setErrorAlCargar] = useState<string | null>(null);
  // El mensaje del servidor del último cambio que no se pudo hacer (un ciclo, un permiso…).
  const [aviso, setAviso] = useState<string | null>(null);
  // Qué se está guardando: "crear" o el id del área; mientras tanto los botones quedan apagados.
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [nombreNueva, setNombreNueva] = useState("");
  const [madreNueva, setMadreNueva] = useState(RAIZ);
  const [renombrando, setRenombrando] = useState<{ id: string; titulo: string } | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const resultado = await areasDelTableroAction(tablero.id);
      if (!resultado.ok) {
        setErrorAlCargar(resultado.error);
        return;
      }
      setErrorAlCargar(null);
      setDatos({ areas: resultado.areas, tipoArea: resultado.tipoArea, puedeBorrar: resultado.puedeBorrar });
    } catch {
      setErrorAlCargar("No se pudieron leer las áreas. Revisa la conexión e intenta de nuevo.");
    }
  }, [tablero.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filas = useMemo(() => (datos ? filasDelArbol(datos.areas) : []), [datos]);
  // Las opciones de «Dentro de», con la sangría del árbol para que se entienda cuál es cuál.
  const opciones = useMemo(
    () => filas.map(({ area, nivel }) => ({ id: area.id, texto: `${"— ".repeat(nivel)}${area.titulo}` })),
    [filas],
  );
  // Si el área elegida para «Dentro de» ya no existe (la borraron), vuelve a «Arriba de todo».
  const madreNuevaValida = madreNueva === RAIZ || opciones.some((opcion) => opcion.id === madreNueva) ? madreNueva : RAIZ;

  /** Corre un cambio: si sale bien, vuelve a leer las áreas y refresca la pantalla; si no, muestra el error. */
  const cambiar = async (clave: string, accion: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    if (ocupado) return false;
    setOcupado(clave);
    setAviso(null);
    try {
      const resultado = await accion();
      if (!resultado.ok) {
        setAviso(resultado.error);
        return false;
      }
      await cargar();
      router.refresh();
      return true;
    } catch {
      setAviso("No se pudo guardar. Revisa la conexión e intenta de nuevo.");
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const crear = async (evento: FormEvent) => {
    evento.preventDefault();
    const titulo = nombreNueva.trim();
    if (!titulo) {
      setAviso("Escribe el nombre del área.");
      return;
    }
    const ok = await cambiar("crear", () => crearAreaAction(tablero.id, titulo, madreNuevaValida || null));
    if (ok) {
      setNombreNueva("");
      toast.success(`Área «${titulo}» creada`);
    }
  };

  const guardarNombre = async () => {
    if (!renombrando) return;
    const titulo = renombrando.titulo.trim();
    if (!titulo) {
      setAviso("El nombre no puede quedar vacío.");
      return;
    }
    if (await cambiar(renombrando.id, () => renombrarAreaAction(renombrando.id, titulo))) setRenombrando(null);
  };

  const borrar = async (area: AreaVista) => {
    if (await cambiar(area.id, () => borrarAreaAction(area.id))) {
      setBorrando(null);
      toast.success(`Área «${area.titulo}» borrada`);
    }
  };

  const sinTipo = datos !== null && datos.tipoArea === null;

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Organizar áreas</DialogTitle>
        <DialogDescription>
          Las áreas de «{tablero.nombre}»: crea, cambia el nombre, ordena con ↑/↓ y mete una dentro de otra. Solo se borra
          un área vacía.
        </DialogDescription>
      </DialogHeader>

      {errorAlCargar ? (
        <div className="grid gap-2">
          <p className="text-sm text-destructive" role="alert">
            {errorAlCargar}
          </p>
          <Button type="button" variant="outline" className="h-11 justify-self-start md:h-9" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      ) : datos === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Cargando áreas…
        </p>
      ) : (
        <>
          {sinTipo ? (
            <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
              Este tablero no tiene un tipo Área, así que no se pueden crear áreas. Créalo en el panel Tipos del tablero y
              vuelve a abrir esta ventana.
            </p>
          ) : (
            <form onSubmit={crear} className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Nueva área</span>
                <Input
                  value={nombreNueva}
                  onChange={(evento) => setNombreNueva(evento.target.value)}
                  placeholder="Nombre del área"
                  autoComplete="off"
                  className="h-11 text-base md:h-9 md:text-sm"
                  disabled={ocupado !== null}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Dentro de</span>
                <NativeSelect
                  value={madreNuevaValida}
                  onChange={(evento) => setMadreNueva(evento.target.value)}
                  className="w-full sm:w-44"
                  disabled={ocupado !== null}
                >
                  <NativeSelectOption value={RAIZ}>Arriba de todo</NativeSelectOption>
                  {opciones.map((opcion) => (
                    <NativeSelectOption key={opcion.id} value={opcion.id}>
                      {opcion.texto}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <Button type="submit" className="h-11 gap-1.5 md:h-9" disabled={ocupado !== null}>
                {ocupado === "crear" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
                Crear
              </Button>
            </form>
          )}

          {aviso ? (
            <p className="text-sm text-destructive" role="alert">
              {aviso}
            </p>
          ) : null}

          {filas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay áreas en este tablero.</p>
          ) : (
            <ul className="grid gap-2" aria-label="Áreas del tablero">
              {filas.map(({ area, nivel, primera, ultima }) => {
                const enEsta = ocupado === area.id;
                const apagado = ocupado !== null;
                const editando = renombrando?.id === area.id;
                return (
                  <li
                    key={area.id}
                    className="grid gap-2 rounded-lg border bg-card p-2"
                    // La sangría del árbol: 1 rem por nivel, con tope para que no se salga en el celular.
                    style={{ marginInlineStart: `${Math.min(nivel, 4)}rem` }}
                  >
                    <div className="flex items-center gap-1">
                      {editando ? (
                        <Input
                          value={renombrando.titulo}
                          onChange={(evento) => setRenombrando({ id: area.id, titulo: evento.target.value })}
                          onKeyDown={(evento) => {
                            if (evento.key === "Enter") {
                              evento.preventDefault();
                              void guardarNombre();
                            } else if (evento.key === "Escape") {
                              evento.preventDefault();
                              evento.stopPropagation();
                              setRenombrando(null);
                            }
                          }}
                          aria-label={`Nuevo nombre de ${area.titulo}`}
                          autoComplete="off"
                          autoFocus
                          className="h-11 min-w-0 flex-1 text-base md:h-9 md:text-sm"
                          disabled={apagado}
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate font-medium" title={area.titulo}>
                          {area.titulo}
                        </span>
                      )}
                      {editando ? (
                        <>
                          <Button
                            type="button"
                            size="icon"
                            className="size-10 md:size-8"
                            onClick={() => void guardarNombre()}
                            disabled={apagado}
                            aria-label="Guardar nombre"
                            title="Guardar nombre"
                          >
                            {enEsta ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 md:size-8"
                            onClick={() => setRenombrando(null)}
                            disabled={apagado}
                            aria-label="Cancelar"
                            title="Cancelar"
                          >
                            <X aria-hidden />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 md:size-8"
                            onClick={() => void cambiar(area.id, () => moverAreaAction(area.id, { direccion: "subir" }))}
                            disabled={apagado || primera}
                            aria-label={`Subir ${area.titulo}`}
                            title="Subir"
                          >
                            <ArrowUp aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 md:size-8"
                            onClick={() => void cambiar(area.id, () => moverAreaAction(area.id, { direccion: "bajar" }))}
                            disabled={apagado || ultima}
                            aria-label={`Bajar ${area.titulo}`}
                            title="Bajar"
                          >
                            <ArrowDown aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-10 md:size-8"
                            onClick={() => {
                              setAviso(null);
                              setBorrando(null);
                              setRenombrando({ id: area.id, titulo: area.titulo });
                            }}
                            disabled={apagado}
                            aria-label={`Cambiar nombre de ${area.titulo}`}
                            title="Cambiar nombre"
                          >
                            <Pencil aria-hidden />
                          </Button>
                        </>
                      )}
                      {enEsta && !editando ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        Dentro de
                        <NativeSelect
                          size="sm"
                          value={area.padreId ?? RAIZ}
                          onChange={(evento) => {
                            const padreId = evento.target.value || null;
                            void cambiar(area.id, () => moverAreaAction(area.id, { padreId }));
                          }}
                          className="max-w-48"
                          disabled={apagado}
                          aria-label={`Dentro de qué área está ${area.titulo}`}
                        >
                          <NativeSelectOption value={RAIZ}>Arriba de todo</NativeSelectOption>
                          {opciones
                            .filter((opcion) => opcion.id !== area.id)
                            .map((opcion) => (
                              <NativeSelectOption key={opcion.id} value={opcion.id}>
                                {opcion.texto}
                              </NativeSelectOption>
                            ))}
                        </NativeSelect>
                      </label>

                      {datos.puedeBorrar ? (
                        area.hijasVivas > 0 ? (
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            Tiene {area.hijasVivas} {area.hijasVivas === 1 ? "tarjeta" : "tarjetas"} adentro
                            <Button type="button" variant="ghost" size="sm" className="h-9 md:h-7" disabled aria-label={`Borrar ${area.titulo}`}>
                              <Trash2 aria-hidden />
                              Borrar
                            </Button>
                          </span>
                        ) : borrando === area.id ? (
                          <span className="ml-auto flex flex-wrap items-center gap-2 text-xs">
                            ¿Borrar «{area.titulo}»?
                            <Button type="button" variant="outline" size="sm" className="h-9 md:h-7" onClick={() => setBorrando(null)} disabled={apagado}>
                              No
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="h-9 md:h-7"
                              onClick={() => void borrar(area)}
                              disabled={apagado}
                            >
                              {enEsta ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                              Sí, borrar
                            </Button>
                          </span>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="ml-auto h-9 text-destructive md:h-7"
                            onClick={() => {
                              setAviso(null);
                              setRenombrando(null);
                              setBorrando(area.id);
                            }}
                            disabled={apagado}
                          >
                            <Trash2 aria-hidden />
                            Borrar
                          </Button>
                        )
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </DialogContent>
  );
}
