"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  applyNodeChanges,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { List, Network } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ESTADOS_TARJETA, NOMBRE_DEL_ESTADO, type EstadoTarjetaTablero } from "../services/reglas";
import type { ConexionVista, TableroResumen, TarjetaVista } from "../services/tableros";
import { disponer, type Punto } from "../services/disposicion";
import { useRefrescoDelTablero, type ContenidoNuevo } from "../hooks/useRefrescoDelTablero";
import { COLOR_DEL_ESTADO } from "./colores";
import { FichaTarjeta } from "./FichaTarjeta";
import { FlechaFlotante, type FlechaDeTablero } from "./FlechaFlotante";
import { NodoTarjeta, type NodoDeTarjeta } from "./NodoTarjeta";
import { SelectorDeTablero } from "./SelectorDeTablero";

/*
  La pantalla de Tablero IA: el mapa (estilo Obsidian) o la lista, el filtro por estado
  y la ficha de cada tarjeta. Se actualiza sola cada 5 s mientras la pestaña está a la vista.

  En el celular: arrastrar y pellizcar mueven y acercan el mapa, tocar una tarjeta abre la ficha
  desde abajo, y la Lista es lo más cómodo en una pantalla chica.
*/

const TIPOS_DE_NODO = { tarjeta: NodoTarjeta };
const TIPOS_DE_FLECHA = { flotante: FlechaFlotante };

type Props = {
  tableros: TableroResumen[];
  tableroId: string | null;
  inicial: ContenidoNuevo | null;
  tarjetaInicial: string | null;
  puedeAprobar: boolean;
};

const CONSULTA_ANGOSTA = "(max-width: 767px)";

function suscribirAngosta(avisar: () => void) {
  const consulta = window.matchMedia(CONSULTA_ANGOSTA);
  consulta.addEventListener("change", avisar);
  return () => consulta.removeEventListener("change", avisar);
}

function useEsAngosta() {
  return useSyncExternalStore(
    suscribirAngosta,
    () => window.matchMedia(CONSULTA_ANGOSTA).matches,
    () => false,
  );
}

function construirNodos(
  tarjetas: TarjetaVista[],
  conexiones: ConexionVista[],
  previas: ReadonlyMap<string, Punto>,
  filtro: ReadonlySet<EstadoTarjetaTablero>,
): NodoDeTarjeta[] {
  const posiciones = disponer(
    tarjetas.map((tarjeta) => tarjeta.id),
    conexiones,
    previas,
  );
  return tarjetas.map((tarjeta) => ({
    id: tarjeta.id,
    type: "tarjeta",
    position: posiciones.get(tarjeta.id) ?? { x: 0, y: 0 },
    data: {
      titulo: tarjeta.titulo,
      area: tarjeta.area,
      estado: tarjeta.estado,
      // Lo filtrado se atenúa en vez de desaparecer: así no se rompe el mapa.
      atenuado: filtro.size > 0 && !filtro.has(tarjeta.estado),
    },
  }));
}

const posicionesDe = (nodos: NodoDeTarjeta[]) => new Map(nodos.map((nodo) => [nodo.id, nodo.position]));

export function TablerosInteligentesVista({ tableros, tableroId, inicial, tarjetaInicial, puedeAprobar }: Props) {
  const angosta = useEsAngosta();

  const [contenido, setContenido] = useState<ContenidoNuevo | null>(inicial);
  const [filtro, setFiltro] = useState<Set<EstadoTarjetaTablero>>(() => new Set());
  const [nodos, setNodos] = useState<NodoDeTarjeta[]>(() =>
    inicial ? construirNodos(inicial.tarjetas, inicial.conexiones, new Map(), new Set()) : [],
  );
  const [vista, setVista] = useState<"mapa" | "lista">("mapa");
  const [abierta, setAbierta] = useState<string | null>(tarjetaInicial);

  const tarjetas = useMemo(() => contenido?.tarjetas ?? [], [contenido]);
  const conexiones = useMemo(() => contenido?.conexiones ?? [], [contenido]);

  const alCambiar = useCallback(
    (nuevo: ContenidoNuevo) => {
      setContenido(nuevo);
      // Las que ya tenían lugar se quedan donde estaban (o donde el dueño las arrastró).
      setNodos((previos) => construirNodos(nuevo.tarjetas, nuevo.conexiones, posicionesDe(previos), filtro));
    },
    [filtro],
  );

  const refrescarYa = useRefrescoDelTablero(tableroId, contenido?.actualizadoEn ?? null, alCambiar);

  const cambiarFiltro = (estado: EstadoTarjetaTablero | null) => {
    const siguiente = new Set(filtro);
    if (estado === null) {
      siguiente.clear();
    } else if (siguiente.has(estado)) {
      siguiente.delete(estado);
    } else {
      siguiente.add(estado);
    }
    setFiltro(siguiente);
    setNodos((previos) =>
      previos.map((nodo) => ({
        ...nodo,
        data: { ...nodo.data, atenuado: siguiente.size > 0 && !siguiente.has(nodo.data.estado) },
      })),
    );
  };

  const alMoverNodos = useCallback((cambios: NodeChange<NodoDeTarjeta>[]) => {
    setNodos((previos) => applyNodeChanges(cambios, previos));
  }, []);

  const aristas = useMemo<FlechaDeTablero[]>(() => {
    const estadoDe = new Map(tarjetas.map((tarjeta) => [tarjeta.id, tarjeta.estado]));
    const visible = (id: string) => {
      const estado = estadoDe.get(id);
      return filtro.size === 0 || (estado !== undefined && filtro.has(estado));
    };
    return conexiones.map((conexion) => {
      const atenuada = !visible(conexion.origenId) || !visible(conexion.destinoId);
      const color = COLOR_DEL_ESTADO[estadoDe.get(conexion.origenId) ?? "IDEA"].trazo;
      return {
        id: conexion.id,
        source: conexion.origenId,
        target: conexion.destinoId,
        type: "flotante" as const,
        data: { color, atenuada },
        selectable: false,
        style: { stroke: color, strokeWidth: 1.5, opacity: atenuada ? 0.15 : 0.8 },
      };
    });
  }, [conexiones, filtro, tarjetas]);

  const conteo = useMemo(() => {
    const cuenta = new Map<EstadoTarjetaTablero, number>();
    for (const tarjeta of tarjetas) cuenta.set(tarjeta.estado, (cuenta.get(tarjeta.estado) ?? 0) + 1);
    return cuenta;
  }, [tarjetas]);

  const tarjetaAbierta = abierta ? (tarjetas.find((tarjeta) => tarjeta.id === abierta) ?? null) : null;
  const entrantes = abierta ? conexiones.filter((c) => c.destinoId === abierta).map((c) => c.origenId) : [];
  const salientes = abierta ? conexiones.filter((c) => c.origenId === abierta).map((c) => c.destinoId) : [];

  if (!tableroId) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] flex-col items-center justify-center gap-3 px-6 text-center">
        <SelectorDeTablero tableros={tableros} tableroId={null} />
        <Network className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Todavía no hay tableros</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Pídele a Claude, por ejemplo: “Crea un tablero de Ventas y anota ahí las ideas que hablamos”. Las tarjetas
          aparecen acá solas. Cuando lo cree, búscalo arriba, en el selector de tableros.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <SelectorDeTablero tableros={tableros} tableroId={tableroId} />
      {/* Filtros por estado (se deslizan de lado en el celular) y, a la derecha, Mapa / Lista. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card py-2 pr-3">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 pl-3 [scrollbar-width:none]">
          <button
            type="button"
            onClick={() => cambiarFiltro(null)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium",
              filtro.size === 0 ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            Todas · {tarjetas.length}
          </button>
          {ESTADOS_TARJETA.map((estado) => {
            const activo = filtro.has(estado);
            return (
              <button
                key={estado}
                type="button"
                onClick={() => cambiarFiltro(estado)}
                aria-pressed={activo}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                  activo ? COLOR_DEL_ESTADO[estado].pastilla : "text-muted-foreground",
                )}
              >
                <span className={cn("size-2 rounded-full", COLOR_DEL_ESTADO[estado].punto)} aria-hidden />
                {NOMBRE_DEL_ESTADO[estado]} · {conteo.get(estado) ?? 0}
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 rounded-lg border p-0.5">
          <Button
            size="sm"
            variant={vista === "mapa" ? "secondary" : "ghost"}
            onClick={() => setVista("mapa")}
            aria-pressed={vista === "mapa"}
          >
            <Network /> <span className="sr-only sm:not-sr-only">Mapa</span>
          </Button>
          <Button
            size="sm"
            variant={vista === "lista" ? "secondary" : "ghost"}
            onClick={() => setVista("lista")}
            aria-pressed={vista === "lista"}
          >
            <List /> <span className="sr-only sm:not-sr-only">Lista</span>
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {tarjetas.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            El tablero está vacío. Las ideas que anote Claude aparecen acá en unos segundos.
          </div>
        ) : vista === "mapa" ? (
          <ReactFlow<NodoDeTarjeta, FlechaDeTablero>
            nodes={nodos}
            edges={aristas}
            edgeTypes={TIPOS_DE_FLECHA}
            nodeTypes={TIPOS_DE_NODO}
            onNodesChange={alMoverNodos}
            onNodeClick={(_, nodo) => setAbierta(nodo.id)}
            nodesConnectable={false}
            edgesFocusable={false}
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.15}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        ) : (
          <div className="h-full overflow-y-auto px-3 py-3">
            <div className="mx-auto max-w-2xl space-y-4">
              {ESTADOS_TARJETA.filter((estado) => filtro.size === 0 || filtro.has(estado)).map((estado) => {
                const delEstado = tarjetas.filter((tarjeta) => tarjeta.estado === estado);
                if (!delEstado.length) return null;
                return (
                  <section key={estado} className="space-y-1.5">
                    <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <span className={cn("size-2 rounded-full", COLOR_DEL_ESTADO[estado].punto)} aria-hidden />
                      {NOMBRE_DEL_ESTADO[estado]} · {delEstado.length}
                    </h2>
                    {delEstado.map((tarjeta) => (
                      <button
                        key={tarjeta.id}
                        type="button"
                        onClick={() => setAbierta(tarjeta.id)}
                        className={cn(
                          "block w-full rounded-xl border-2 px-3 py-2.5 text-left",
                          COLOR_DEL_ESTADO[estado].tarjeta,
                        )}
                      >
                        <p className="text-sm font-semibold leading-snug">{tarjeta.titulo}</p>
                        {tarjeta.area || tarjeta.detalle ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                            {[tarjeta.area, tarjeta.detalle].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </button>
                    ))}
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <FichaTarjeta
        key={abierta ?? "ninguna"}
        tarjeta={tarjetaAbierta}
        tarjetas={tarjetas}
        entrantes={entrantes}
        salientes={salientes}
        abierta={abierta !== null}
        lado={angosta ? "bottom" : "right"}
        puedeAprobar={puedeAprobar}
        alCerrar={() => setAbierta(null)}
        alElegir={setAbierta}
        alAprobar={refrescarYa}
      />
    </div>
  );
}
