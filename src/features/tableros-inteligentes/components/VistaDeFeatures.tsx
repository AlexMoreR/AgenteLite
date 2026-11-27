"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Map as IconoMapa, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useCadaTantoVisible } from "@/hooks/use-cada-tanto-visible";
import { cn } from "@/lib/utils";
import { tableroDeFeaturesAction } from "@/app/actions/tablero-ia-features-actions";
import { NOMBRE_DE_PRIORIDAD, PRIORIDADES, type Prioridad } from "../services/reglas-trabajador";
import type { TableroDeFeatures } from "../services/tablero-de-features";
import { etiquetaDelRepo, filtrarTarjetas } from "../services/tablero-de-features-filtros";
import { COLOR_DE_PRIORIDAD } from "./colores";
import { RUTA_DEL_INICIO, linkDeLaTarjetaEnPantalla } from "./DialogoDeTablero";

/*
  Tablero IA, vista tipo tablero de Features (27-nov-2026, parte 2 de 3): una columna por estado de lo que cuelga del Área
  Features (?vista=features). Solo lectura: no mueve ninguna tarjeta. Se refresca sola cada 30 s con la pestaña a la vista.
  Clic en una tarjeta abre su ficha (?tarjeta=<id>), también las archivadas. «Ver como mapa» lleva al mapa del Área.
*/

const REFRESCO_MS = 30_000;
/** Qué vista abrió la última vez ('tablero' o 'mapa'): el botón «Features» del inicio la lee. */
export const CLAVE_VISTA_FEATURES = "tablero-ia:features:vista";

const guardarVista = (valor: "tablero" | "mapa") => {
  try {
    window.localStorage.setItem(CLAVE_VISTA_FEATURES, valor);
  } catch {
    // Navegador privado o sin permiso: no pasa nada, solo no se recuerda.
  }
};

// Los filtros (valor "" = Todos). En Repo, "sin" es «Sin repo» (la función de filtro usa "" para eso).
const SIN_REPO = "sin";
const REPOS = [
  { valor: "gestion", nombre: "Gestión" },
  { valor: "aizencrm", nombre: "CRM" },
  { valor: SIN_REPO, nombre: "Sin repo" },
];
const SIN_AREA = "sin";

export function VistaDeFeatures() {
  const router = useRouter();
  const [tablero, setTablero] = useState<TableroDeFeatures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [area, setArea] = useState("");
  const [repo, setRepo] = useState("");
  const [prioridad, setPrioridad] = useState("");

  // Evita escribir el estado si la respuesta llega cuando la vista ya no está en pantalla.
  const vigente = useRef(true);
  const leer = useCallback(async () => {
    setLeyendo(true);
    try {
      const respuesta = await tableroDeFeaturesAction();
      if (!vigente.current) return;
      if (respuesta.ok) {
        setTablero(respuesta.tablero);
        setError(respuesta.tablero.error ?? null);
      } else {
        setError(respuesta.error);
      }
    } catch {
      if (vigente.current) setError("No se pudo leer el tablero de Features. Toca Actualizar para reintentar.");
    } finally {
      if (vigente.current) setLeyendo(false);
    }
  }, []);

  useEffect(() => {
    vigente.current = true;
    guardarVista("tablero");
    void leer();
    return () => {
      vigente.current = false;
    };
  }, [leer]);

  // Con la pestaña oculta no se pide nada; al salir de la vista el reloj se apaga.
  useCadaTantoVisible(leer, REFRESCO_MS);

  const columnas = useMemo(() => {
    if (!tablero) return [];
    return tablero.columnas.map((columna) => ({
      ...columna,
      tarjetas: filtrarTarjetas(columna.tarjetas, {
        area: area === "" ? null : area === SIN_AREA ? "" : area,
        repo: repo === "" ? null : repo === SIN_REPO ? "" : repo,
        prioridad: prioridad === "" ? null : (prioridad as Prioridad),
      }),
    }));
  }, [tablero, area, repo, prioridad]);

  const hayFiltros = area !== "" || repo !== "" || prioridad !== "";
  const limpiar = () => {
    setArea("");
    setRepo("");
    setPrioridad("");
  };

  const verComoMapa = () => {
    if (!tablero?.areaFeaturesId) return;
    guardarVista("mapa");
    router.push(`${RUTA_DEL_INICIO}?area=${encodeURIComponent(tablero.areaFeaturesId)}`);
  };

  // Sin el Área Features (o sin permiso, o si falló la lectura) se dice por qué, sin dejar la vista en blanco.
  if (error && (!tablero || tablero.error)) {
    return (
      <section aria-labelledby="titulo-features" className="min-w-0 space-y-3">
        <h2 id="titulo-features" className="text-lg font-semibold">
          Features
        </h2>
        <div role="alert" className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          <p>{error}</p>
          <Button type="button" variant="outline" className="mt-4 gap-1.5" onClick={() => void leer()} disabled={leyendo}>
            <RefreshCw className={cn("size-4", leyendo && "animate-spin")} />
            Actualizar
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="titulo-features" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <h2 id="titulo-features" className="text-lg font-semibold">
            Features
          </h2>
          <p className="text-sm text-muted-foreground">Lo que cuelga del Área Features, por estado. Toca una tarjeta para abrirla.</p>
        </div>
        <Button type="button" variant="outline" className="gap-1.5" onClick={verComoMapa} disabled={!tablero?.areaFeaturesId}>
          <IconoMapa className="size-4" />
          Ver como mapa
        </Button>
        <Button type="button" variant="outline" className="gap-1.5" onClick={() => void leer()} disabled={leyendo}>
          <RefreshCw className={cn("size-4", leyendo && "animate-spin")} />
          Actualizar
        </Button>
      </div>

      {/* Los filtros se acomodan en varias líneas en el celular. */}
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Filtrar por área" value={area} onChange={(evento) => setArea(evento.target.value)}>
          <NativeSelectOption value="">Área: todas</NativeSelectOption>
          {(tablero?.areas ?? []).map((nombre) => (
            <NativeSelectOption key={nombre} value={nombre}>
              {nombre}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value={SIN_AREA}>Sin área</NativeSelectOption>
        </NativeSelect>
        <NativeSelect aria-label="Filtrar por repo" value={repo} onChange={(evento) => setRepo(evento.target.value)}>
          <NativeSelectOption value="">Repo: todos</NativeSelectOption>
          {REPOS.map(({ valor, nombre }) => (
            <NativeSelectOption key={valor} value={valor}>
              {nombre}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filtrar por prioridad" value={prioridad} onChange={(evento) => setPrioridad(evento.target.value)}>
          <NativeSelectOption value="">Prioridad: todas</NativeSelectOption>
          {PRIORIDADES.map((clave) => (
            <NativeSelectOption key={clave} value={clave}>
              {NOMBRE_DE_PRIORIDAD[clave]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {hayFiltros ? (
          <Button type="button" variant="ghost" onClick={limpiar}>
            Limpiar
          </Button>
        ) : null}
      </div>

      {!tablero ? (
        <Loader2 className="mx-auto animate-spin text-muted-foreground" aria-label="Cargando" />
      ) : (
        // Columnas de ancho fijo en una fila que se desliza a los lados: no ensanchan la página en el celular.
        <div className="flex max-w-full items-start gap-3 overflow-x-auto pb-2">
          {columnas.map((columna) => (
            <section
              key={columna.clave}
              aria-label={columna.nombre}
              className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40"
            >
              <header className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
                <span className="truncate">{columna.nombre}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{columna.tarjetas.length}</span>
              </header>
              <ol className="flex min-h-16 flex-col gap-2 px-2 pb-2">
                {columna.tarjetas.map((tarjeta) => (
                  <li key={tarjeta.id}>
                    <button
                      type="button"
                      onClick={() => router.push(linkDeLaTarjetaEnPantalla(tarjeta.id))}
                      className="block w-full rounded-lg border bg-card p-2.5 text-left text-sm shadow-xs transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="tabular-nums">{tarjeta.codigo}</span>
                        {tarjeta.esIdea ? <span className="rounded-full border px-1.5 text-[11px] font-medium">Idea</span> : null}
                        {/* Urgente resaltada; Media sin etiqueta, como el kanban de siempre. */}
                        {tarjeta.prioridad !== "MEDIA" ? (
                          <span
                            className={cn(
                              "ml-auto rounded-full border px-1.5 text-[11px] font-medium",
                              COLOR_DE_PRIORIDAD[tarjeta.prioridad],
                              tarjeta.prioridad === "URGENTE" && "font-semibold ring-1 ring-rose-400",
                            )}
                          >
                            {NOMBRE_DE_PRIORIDAD[tarjeta.prioridad]}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 line-clamp-2 font-medium leading-snug">{tarjeta.titulo}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {tarjeta.area ? <span className="truncate">{tarjeta.area}</span> : null}
                        <span>{etiquetaDelRepo(tarjeta.repo)}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {columna.tarjetas.length === 0 ? (
                  <li className="px-1 py-3 text-center text-xs text-muted-foreground">Sin tarjetas</li>
                ) : null}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
