"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Background, Controls, ReactFlow, applyNodeChanges, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Network, Shapes } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ESTADOS_TARJETA, NOMBRE_DEL_ESTADO, type EstadoTarjetaTablero } from "../services/reglas";
import type { ConexionVista, TableroResumen, TarjetaVista, TipoVista } from "../services/tableros";
import { disponerRadial, type Punto } from "../services/disposicion";
import { contarHijas, gruposDelNivel, madresVisibles, migasDelNivel, tarjetasDelNivel } from "../services/niveles";
import { useRefrescoDelTablero, type ContenidoNuevo } from "../hooks/useRefrescoDelTablero";
import { COLOR_DEL_ESTADO } from "./colores";
import { FichaTarjeta } from "./FichaTarjeta";
import { FlechaFlotante, type FlechaDeTablero } from "./FlechaFlotante";
import { IconoDeTipo } from "./IconoDeTipo";
import { MigasDelNivel } from "./MigasDelNivel";
import { NodoTarjeta, type NodoDeTarjeta } from "./NodoTarjeta";
import { PanelTipos } from "./PanelTipos";
import { SelectorDeTablero } from "./SelectorDeTablero";

/*
  La pantalla de Tablero IA: el mapa POR NIVELES (como carpetas), los filtros por estado y por tipo,
  el panel de Tipos (solo dueño/admin) y la ficha de cada tarjeta. Se actualiza sola
  cada 5 s mientras la pestaña está a la vista.

  Niveles (services/niveles.ts): en la raíz, cada tarjeta sin madre ("Magilus") en el centro con sus
  hijas directas (las áreas) ALREDEDOR (services/disposicion.ts, radial); las nietas no se ven.
  Tocar una tarjeta CON hijas entra a ella (queda al centro con sus hijas alrededor); tocar una SIN
  hijas abre su ficha; el botón "i" abre la ficha de una con hijas sin entrar. Arriba, en UNA fila
  baja: "←" (sube un nivel), la ruta ("Tablero › Magilus › Ventas") para volver a cualquier nivel y
  el ícono de Tipos. El nivel va
  en la URL (?area=<id>) con history.pushState: atrás del navegador vuelve al nivel anterior y los
  links funcionan sin pedirle nada al servidor. Se ven solo las flechas entre tarjetas visibles del
  nivel; la unión con la madre es una línea del centro a cada hija (si ya hay una flecha entre las
  dos, no se repite). Los filtros de estado aplican al nivel y no tocan las carpetas (tipos sin
  estados, como Área).

  En el celular: arrastrar y pellizcar mueven y acercan el mapa, tocar una tarjeta abre la ficha
  desde abajo, y la ruta se desliza de lado.
*/

const TIPOS_DE_NODO = { tarjeta: NodoTarjeta };
const TIPOS_DE_FLECHA = { flotante: FlechaFlotante };
const COLOR_MADRE = "#a1a1aa";

type Props = {
  tableros: TableroResumen[];
  tableroId: string | null;
  tableroNombre: string | null;
  inicial: ContenidoNuevo | null;
  tarjetaInicial: string | null;
  nivelInicial: string | null;
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

type Filtros = { estados: ReadonlySet<EstadoTarjetaTablero>; tipos: ReadonlySet<string> };

/** Los tipos que son carpetas (sin estados, como Área). */
type Carpetas = ReadonlySet<string>;

/** ¿El filtro la atenúa? El de estado no toca las carpetas (no tienen estado). */
const filtrada = (tarjeta: Pick<TarjetaVista, "estado" | "tipoId">, filtros: Filtros, carpetas: Carpetas) =>
  (filtros.estados.size > 0 && !carpetas.has(tarjeta.tipoId) && !filtros.estados.has(tarjeta.estado)) ||
  (filtros.tipos.size > 0 && !filtros.tipos.has(tarjeta.tipoId));

const carpetasDe = (tipos: TipoVista[]): Carpetas => new Set(tipos.filter((tipo) => !tipo.usaEstados).map((tipo) => tipo.id));

/** El nivel que de verdad se muestra (uno que ya no existe = la raíz) y sus tarjetas. */
function nivelVisible(tarjetas: TarjetaVista[], nivel: string | null) {
  return tarjetasDelNivel(tarjetas, nivel);
}

/**
 * Los nodos del nivel. `previas` son las posiciones que ya tenían en ESTE nivel (dibujadas o
 * arrastradas): no se mueven; las nuevas se acomodan alrededor de su centro sin encimarse.
 */
function construirNodos(
  contenido: ContenidoNuevo,
  nivelPedido: string | null,
  filtros: Filtros,
  previas: ReadonlyMap<string, Punto>,
  alAbrirFicha: (id: string) => void,
): NodoDeTarjeta[] {
  const { nivel, grupos } = gruposDelNivel(contenido.tarjetas, nivelPedido);
  const visibles = grupos.flatMap((grupo) => [grupo.centro, ...grupo.hijas]);
  const porId = new Map(contenido.tarjetas.map((tarjeta) => [tarjeta.id, tarjeta]));
  const tipos = new Map(contenido.tipos.map((tipo) => [tipo.id, tipo]));
  const carpetas = carpetasDe(contenido.tipos);
  const hijas = contarHijas(contenido.tarjetas);
  // Si el nivel pedido ya no existe (se borró) se muestra la raíz: las posiciones de antes no sirven.
  const posiciones = disponerRadial(grupos, nivel === nivelPedido ? previas : new Map());
  return visibles.map((id) => {
    const tarjeta = porId.get(id)!;
    const tipo = tipos.get(tarjeta.tipoId);
    return {
      id,
      type: "tarjeta" as const,
      position: posiciones.get(id) ?? { x: 0, y: 0 },
      data: {
        titulo: tarjeta.titulo,
        area: tarjeta.area,
        estado: tarjeta.estado,
        tipoNombre: tipo?.nombre ?? "Tarjeta",
        tipoColor: tipo?.color ?? "#71717a",
        tipoIcono: tipo?.icono ?? null,
        usaEstados: tipo?.usaEstados ?? true,
        hijas: hijas.get(id) ?? 0,
        tieneLink: Boolean(tarjeta.link),
        esNivel: id === nivel,
        // Lo filtrado se atenúa en vez de desaparecer: así no se rompe el mapa.
        atenuado: filtrada(tarjeta, filtros, carpetas),
        alAbrirFicha: () => alAbrirFicha(id),
      },
    };
  });
}

const posicionesDe = (nodos: NodoDeTarjeta[]) => new Map(nodos.map((nodo) => [nodo.id, nodo.position]));

function urlDelNivel(tableroId: string, nivel: string | null) {
  const parametros = new URLSearchParams({ tablero: tableroId });
  if (nivel) parametros.set("area", nivel);
  return `${window.location.pathname}?${parametros.toString()}`;
}

export function TablerosInteligentesVista({
  tableros,
  tableroId,
  tableroNombre,
  inicial,
  tarjetaInicial,
  nivelInicial,
  puedeAprobar,
}: Props) {
  const angosta = useEsAngosta();

  const [contenido, setContenido] = useState<ContenidoNuevo | null>(inicial);
  const [nivel, setNivel] = useState<string | null>(() =>
    inicial ? nivelVisible(inicial.tarjetas, nivelInicial).nivel : null,
  );
  const [filtros, setFiltros] = useState<Filtros>(() => ({ estados: new Set(), tipos: new Set() }));
  const [abierta, setAbierta] = useState<string | null>(tarjetaInicial);
  const [nodos, setNodos] = useState<NodoDeTarjeta[]>(() =>
    inicial
      ? construirNodos(inicial, nivelVisible(inicial.tarjetas, nivelInicial).nivel, { estados: new Set(), tipos: new Set() }, new Map(), setAbierta)
      : [],
  );
  const [panelTipos, setPanelTipos] = useState(false);

  const tarjetas = useMemo(() => contenido?.tarjetas ?? [], [contenido]);
  const conexiones = useMemo<ConexionVista[]>(() => contenido?.conexiones ?? [], [contenido]);
  const tipos = useMemo<TipoVista[]>(() => contenido?.tipos ?? [], [contenido]);
  const tipoPorId = useMemo(() => new Map(tipos.map((tipo) => [tipo.id, tipo])), [tipos]);
  const hijas = useMemo(() => contarHijas(tarjetas), [tarjetas]);
  const madre = useMemo(() => madresVisibles(tarjetas), [tarjetas]);
  const { visibles } = useMemo(() => nivelVisible(tarjetas, nivel), [tarjetas, nivel]);
  const enNivel = useMemo(() => new Set(visibles), [visibles]);
  const ruta = useMemo(() => migasDelNivel(tarjetas, nivel), [tarjetas, nivel]);
  const carpetas = useMemo(() => carpetasDe(tipos), [tipos]);

  // Lo que necesitan los manejadores de "atrás" del navegador sin recrearse en cada render.
  const estadoRef = useRef({ contenido, filtros });
  useEffect(() => {
    estadoRef.current = { contenido, filtros };
  }, [contenido, filtros]);

  const alCambiar = useCallback(
    (nuevo: ContenidoNuevo) => {
      setContenido(nuevo);
      // Mismo nivel: las que ya estaban (o el dueño arrastró) se quedan donde estaban.
      setNodos((previos) => construirNodos(nuevo, nivel, filtros, posicionesDe(previos), setAbierta));
    },
    [nivel, filtros],
  );

  const refrescarYa = useRefrescoDelTablero(tableroId, contenido?.actualizadoEn ?? null, alCambiar);

  /** Cambiar de nivel (y la URL, para que atrás del navegador vuelva). */
  const irANivel = useCallback(
    (destino: string | null, { empujar = true, abrir = null as string | null } = {}) => {
      const actual = estadoRef.current.contenido;
      if (!actual || !tableroId) return;
      const real = nivelVisible(actual.tarjetas, destino).nivel;
      setNivel(real);
      setAbierta(abrir);
      setNodos(construirNodos(actual, real, estadoRef.current.filtros, new Map(), setAbierta));
      if (empujar) window.history.pushState(null, "", urlDelNivel(tableroId, real));
    },
    [tableroId],
  );

  useEffect(() => {
    const alVolver = () => {
      const parametros = new URLSearchParams(window.location.search);
      if (parametros.get("tablero") && parametros.get("tablero") !== tableroId) return;
      irANivel(parametros.get("area"), { empujar: false });
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, [irANivel, tableroId]);

  /** Mostrar una tarjeta: va al nivel de su madre y abre su ficha. */
  const mostrarTarjeta = useCallback(
    (id: string) => {
      if (enNivel.has(id)) {
        setAbierta(id);
        return;
      }
      irANivel(madre.get(id) ?? null, { abrir: id });
    },
    [enNivel, irANivel, madre],
  );

  const cambiarFiltros = (siguiente: Filtros) => {
    setFiltros(siguiente);
    setNodos((previos) =>
      previos.map((nodo) => {
        const tarjeta = tarjetas.find((una) => una.id === nodo.id);
        return tarjeta ? { ...nodo, data: { ...nodo.data, atenuado: filtrada(tarjeta, siguiente, carpetas) } } : nodo;
      }),
    );
  };

  const alternarEstado = (estado: EstadoTarjetaTablero | null) => {
    const estados = new Set(filtros.estados);
    if (estado === null) estados.clear();
    else if (estados.has(estado)) estados.delete(estado);
    else estados.add(estado);
    cambiarFiltros({ ...filtros, estados });
  };

  const alternarTipo = (tipoId: string) => {
    const deTipo = new Set(filtros.tipos);
    if (deTipo.has(tipoId)) deTipo.delete(tipoId);
    else deTipo.add(tipoId);
    cambiarFiltros({ ...filtros, tipos: deTipo });
  };

  // Lo que el dueño arrastra se queda donde lo dejó mientras siga en este nivel (las posiciones
  // viven en los nodos; no se guardan en la base).
  const alMoverNodos = useCallback((cambios: NodeChange<NodoDeTarjeta>[]) => {
    setNodos((previos) => applyNodeChanges(cambios, previos));
  }, []);

  const aristas = useMemo<FlechaDeTablero[]>(() => {
    const porId = new Map(tarjetas.map((tarjeta) => [tarjeta.id, tarjeta]));
    const atenuadaPor = (id: string) => {
      const tarjeta = porId.get(id);
      return !tarjeta || filtrada(tarjeta, filtros, carpetas);
    };
    const unidas = new Set(conexiones.flatMap((c) => [`${c.origenId}>${c.destinoId}`, `${c.destinoId}>${c.origenId}`]));
    const flechas: FlechaDeTablero[] = conexiones
      .filter((conexion) => enNivel.has(conexion.origenId) && enNivel.has(conexion.destinoId))
      .map((conexion) => {
        const atenuada = atenuadaPor(conexion.origenId) || atenuadaPor(conexion.destinoId);
        const color = COLOR_DEL_ESTADO[porId.get(conexion.origenId)?.estado ?? "IDEA"].trazo;
        return {
          id: conexion.id,
          source: conexion.origenId,
          target: conexion.destinoId,
          type: "flotante" as const,
          data: { color, atenuada, clase: "flecha" as const },
          selectable: false,
          style: { stroke: color, strokeWidth: 1.5, opacity: atenuada ? 0.15 : 0.8 },
        };
      });
    // La unión con la madre: del centro a cada hija (si ya hay una flecha entre las dos, no se repite).
    const uniones: FlechaDeTablero[] = visibles
      .filter((id) => {
        const suMadre = madre.get(id);
        return suMadre && enNivel.has(suMadre) && !unidas.has(`${suMadre}>${id}`);
      })
      .map((id) => {
        const atenuada = atenuadaPor(id) || atenuadaPor(madre.get(id)!);
        return {
          id: `madre-${id}`,
          source: madre.get(id)!,
          target: id,
          type: "flotante" as const,
          data: { color: COLOR_MADRE, atenuada, clase: "madre" as const },
          selectable: false,
          style: { stroke: COLOR_MADRE, strokeWidth: 1.25, opacity: atenuada ? 0.15 : 0.7 },
        };
      });
    return [...uniones, ...flechas];
  }, [carpetas, conexiones, enNivel, filtros, madre, tarjetas, visibles]);

  const delNivel = useMemo(() => tarjetas.filter((tarjeta) => enNivel.has(tarjeta.id)), [tarjetas, enNivel]);
  // Las carpetas (Área) no tienen estado: no cuentan en los filtros de estado.
  const conEstado = useMemo(() => delNivel.filter((tarjeta) => !carpetas.has(tarjeta.tipoId)), [delNivel, carpetas]);
  const conteoEstado = useMemo(() => {
    const cuenta = new Map<EstadoTarjetaTablero, number>();
    for (const tarjeta of conEstado) cuenta.set(tarjeta.estado, (cuenta.get(tarjeta.estado) ?? 0) + 1);
    return cuenta;
  }, [conEstado]);
  const conteoTipo = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const tarjeta of delNivel) cuenta.set(tarjeta.tipoId, (cuenta.get(tarjeta.tipoId) ?? 0) + 1);
    return cuenta;
  }, [delNivel]);
  const usosDeTipo = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const tarjeta of tarjetas) cuenta.set(tarjeta.tipoId, (cuenta.get(tarjeta.tipoId) ?? 0) + 1);
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

  const conFiltros = filtros.estados.size > 0 || filtros.tipos.size > 0;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <SelectorDeTablero tableros={tableros} tableroId={tableroId} />
      {/* Arriba, en UNA fila baja: "←" (sube un nivel), la ruta y, a la derecha, el ícono de Tipos
          (solo dueño/admin). En el celular todo botón mide al menos 40 px. */}
      <div className="flex min-h-10 shrink-0 items-center gap-0.5 border-b border-border bg-card px-1 md:min-h-9 md:px-2">
        {nivel ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 md:size-8"
            onClick={() => irANivel(madre.get(nivel) ?? null)}
            aria-label="Atrás: subir un nivel"
            title="Atrás"
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <MigasDelNivel tableroNombre={tableroNombre ?? "Tablero"} ruta={ruta} alIr={(id) => irANivel(id)} />
        {puedeAprobar ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 text-muted-foreground md:size-8"
            onClick={() => setPanelTipos(true)}
            aria-label="Tipos de tarjeta"
            title="Tipos de tarjeta"
          >
            <Shapes />
          </Button>
        ) : null}
      </div>

      {/* Filtros por estado y por tipo del nivel (se deslizan de lado en el celular). */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-2 [scrollbar-width:none]">
        <button
          type="button"
          onClick={() => cambiarFiltros({ estados: new Set(), tipos: new Set() })}
          className={cn(
            "min-h-10 shrink-0 rounded-full border px-3 py-1 text-xs font-medium md:min-h-0",
            !conFiltros ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
        >
          Todas · {delNivel.length}
        </button>
        {ESTADOS_TARJETA.map((estado) => {
          const activo = filtros.estados.has(estado);
          const cuantas = conteoEstado.get(estado) ?? 0;
          if (!cuantas && !activo) return null;
          return (
            <button
              key={estado}
              type="button"
              onClick={() => alternarEstado(estado)}
              aria-pressed={activo}
              className={cn(
                "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium md:min-h-0",
                activo ? COLOR_DEL_ESTADO[estado].pastilla : "text-muted-foreground",
              )}
            >
              <span className={cn("size-2 rounded-full", COLOR_DEL_ESTADO[estado].punto)} aria-hidden />
              {NOMBRE_DEL_ESTADO[estado]} · {cuantas}
            </button>
          );
        })}
        <span className="mx-1 w-px shrink-0 bg-border" aria-hidden />
        {tipos.map((tipo) => {
          const activo = filtros.tipos.has(tipo.id);
          const cuantas = conteoTipo.get(tipo.id) ?? 0;
          if (!cuantas && !activo) return null;
          return (
            <button
              key={tipo.id}
              type="button"
              onClick={() => alternarTipo(tipo.id)}
              aria-pressed={activo}
              className={cn(
                "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium md:min-h-0",
                activo ? "border-foreground/40 bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              <IconoDeTipo icono={tipo.icono} color={tipo.color} className="size-3.5" />
              {tipo.nombre} · {cuantas}
            </button>
          );
        })}
      </div>

      <div className="relative min-h-0 flex-1">
        {tarjetas.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            El tablero está vacío. Las ideas que anote Claude aparecen acá en unos segundos.
          </div>
        ) : (
          <ReactFlow<NodoDeTarjeta, FlechaDeTablero>
            key={nivel ?? "raiz"}
            nodes={nodos}
            edges={aristas}
            edgeTypes={TIPOS_DE_FLECHA}
            nodeTypes={TIPOS_DE_NODO}
            onNodesChange={alMoverNodos}
            onNodeClick={(_, nodo) => {
              if (nodo.data.hijas > 0 && !nodo.data.esNivel) irANivel(nodo.id);
              else setAbierta(nodo.id);
            }}
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
        )}
      </div>

      <FichaTarjeta
        key={abierta ?? "ninguna"}
        tarjeta={tarjetaAbierta}
        tarjetas={tarjetas}
        tipos={tipoPorId}
        hijas={abierta ? (hijas.get(abierta) ?? 0) : 0}
        entrantes={entrantes}
        salientes={salientes}
        abierta={abierta !== null}
        lado={angosta ? "bottom" : "right"}
        puedeAprobar={puedeAprobar}
        alCerrar={() => setAbierta(null)}
        alElegir={mostrarTarjeta}
        alEntrar={(id) => irANivel(id)}
        alAprobar={refrescarYa}
      />

      <PanelTipos
        abierto={panelTipos}
        alCerrar={() => setPanelTipos(false)}
        lado={angosta ? "bottom" : "right"}
        tableroId={tableroId}
        tipos={tipos}
        usos={usosDeTipo}
        puedeEditar={puedeAprobar}
        alCambiar={refrescarYa}
      />
    </div>
  );
}
