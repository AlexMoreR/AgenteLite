"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Controls, ReactFlow, applyNodeChanges, type NodeChange, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { ArrowLeft, ChevronRight, LayoutGrid, Shapes, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ConexionVista, TableroDelInicio, TableroResumen, TarjetaVista, TipoVista } from "../services/tableros";
import { disponerRadial, type Punto } from "../services/disposicion";
import {
  atenuadaPorGrupos,
  contadoresDelNivel,
  contadoresEnCero,
  contadoresRecursivos,
  contarHijas,
  gruposDelNivel,
  madresVisibles,
  migasDelNivel,
  tarjetasConMias,
  tarjetasDelNivel,
  type Contadores,
  type GrupoDeContador,
} from "../services/niveles";
import { useListaDeTableros, useRefrescoDelTablero, type ContenidoNuevo } from "../hooks/useRefrescoDelTablero";
import { FichaTarjeta } from "./FichaTarjeta";
import { FlechaFlotante, type FlechaDeTablero } from "./FlechaFlotante";
import { MigasDelNivel } from "./MigasDelNivel";
import { NodoTarjeta, type NodoDeTarjeta } from "./NodoTarjeta";
import { PanelTipos } from "./PanelTipos";
import { RUTA_DEL_INICIO } from "./DialogoDeTablero";
import { SelectorDeTablero } from "./SelectorDeTablero";
import type { CuentasDeTableros } from "./DialogoDeTablero";

/*
  La pantalla de Tablero IA, con el estilo del tablero "Tareas Magilus": el mapa POR NIVELES (como
  carpetas) sobre un lienzo liso, los chips de grupo (Te toca / En curso / Sigue / Hecho), el panel
  de Tipos (solo dueño/admin) y la ficha de cada tarjeta. Se actualiza sola cada 5 s mientras la
  pestaña está a la vista. Sigue el tema del CRM (claro/oscuro, clase .dark).

  Niveles (services/niveles.ts): en la raíz, cada tarjeta sin madre ("Magilus") en el centro con sus
  hijas directas (las áreas) ALREDEDOR en un solo anillo (services/disposicion.ts); las nietas no se
  ven. Cada etiqueta muestra sus contadores RECURSIVOS (ella + toda su descendencia): te toca, en
  curso, siguen. Tocar una tarjeta CON hijas entra a ella; tocar una SIN hijas abre su ficha;
  mantener presionada una con hijas, o tocar la del centro, abre su ficha sin entrar. Arriba, en UNA
  fila baja: "←" (sube un nivel), "Tablero IA" (vuelve al listado de tableros, la página de inicio),
  la ruta ("Tablero › Magilus › Ventas") y el ícono de Tipos. El
  nivel va en la URL (?area=<id>) con history.pushState: atrás del navegador vuelve al nivel anterior
  y los links funcionan sin pedirle nada al servidor. La unión con la madre es una línea fina gris
  del centro a cada hija con un punto que viaja (rojo si la hija tiene algo que "te toca"); las
  flechas entre tarjetas visibles del nivel quedan como líneas punteadas tenues, sin punto.

  Los chips cuentan lo del nivel (recursivo). Apagar un chip atenúa las hijas que no tienen nada en
  los grupos encendidos; "Hecho" arranca apagado.

  En el celular: arrastrar y pellizcar mueven y acercan el mapa, tocar una tarjeta abre la ficha
  desde abajo, y la ruta y los chips se deslizan de lado.
*/

const TIPOS_DE_NODO = { tarjeta: NodoTarjeta };
const TIPOS_DE_FLECHA = { flotante: FlechaFlotante };
const ORIGEN_AL_CENTRO: [number, number] = [0.5, 0.5];

/** Los chips: en el orden de la pantalla, con su color (variables de globals.css, .tablero-ia). */
const CHIPS: { grupo: GrupoDeContador; nombre: string; color: string }[] = [
  { grupo: "teToca", nombre: "Te toca", color: "var(--tia-rojo)" },
  { grupo: "enCurso", nombre: "En curso", color: "var(--tia-verde)" },
  { grupo: "siguen", nombre: "Sigue", color: "var(--tia-gris)" },
  { grupo: "hecho", nombre: "Hecho", color: "var(--tia-gris)" },
];
const FILTROS_INICIALES: ReadonlySet<GrupoDeContador> = new Set<GrupoDeContador>(["teToca"]);

/** Dónde se recuerda en el dispositivo qué chips están prendidos (y "Mis tarjetas"). */
const CLAVE_FILTROS = "tablero-ia:filtros";
const GRUPOS_VALIDOS = new Set<string>(CHIPS.map((chip) => chip.grupo));

/** Lo guardado en el dispositivo; null si no hay nada, está dañado o el navegador lo bloquea. */
function leerFiltrosGuardados(): { filtros: Set<GrupoDeContador>; mias: boolean } | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_FILTROS);
    if (!crudo) return null;
    const dato: unknown = JSON.parse(crudo);
    if (typeof dato !== "object" || dato === null) return null;
    const { grupos, mias } = dato as { grupos?: unknown; mias?: unknown };
    if (!Array.isArray(grupos) || !grupos.every((g) => typeof g === "string" && GRUPOS_VALIDOS.has(g))) return null;
    return { filtros: new Set(grupos as GrupoDeContador[]), mias: mias === true };
  } catch {
    return null;
  }
}

function guardarFiltros(filtros: Filtros, mias: boolean) {
  try {
    window.localStorage.setItem(CLAVE_FILTROS, JSON.stringify({ grupos: [...filtros], mias }));
  } catch {
    // Modo privado o almacenamiento bloqueado: la elección solo dura esta visita.
  }
}

type Props = {
  tableros: TableroDelInicio[];
  /** La firma de esa lista (firmaDeLaLista): el selector se mantiene al día aunque esté cerrado. */
  firmaDeTableros: string;
  tableroId: string;
  tableroNombre: string;
  inicial: ContenidoNuevo;
  tarjetaInicial: string | null;
  nivelInicial: string | null;
  /** Puede apretar los botones de aprobar la tarea y el plan (el servidor revisa el alcance). */
  puedeAprobar: boolean;
  /** Puede tocar los tipos (dueño o ADMIN de la plataforma, como en la fase 1). */
  puedeEditarTipos: boolean;
  /** Tableros por cuenta: quién mira, si ve todos y a quién le puede dar uno (selector y diálogo de nombre). */
  cuentas: CuentasDeTableros;
  /** Dueño del negocio: el sí final y quitar zonas protegidas. */
  esDueno: boolean;
  /** Aprobador SISTEMAS vigente (periodo de prueba): da también el sí final en lo que no toca dinero ni Meta Ads. */
  puedeSubirSistemas?: boolean;
  /** Puede usar el cerebro (el dueño o quien él autorizó): "Pasar al cerebro" en las tarjetas hechas. */
  puedeCerebro?: boolean;
  /** Puede cambiar el responsable de las tarjetas de este tablero (quien lo edita). */
  puedeAsignar: boolean;
};

/** Hasta dónde puede acercar el ajuste automático: pocas tarjetas se ven grandes. */
const ZOOM_MAXIMO_AL_AJUSTAR = 1.5;

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

/** Los grupos encendidos (chips). */
type Filtros = ReadonlySet<GrupoDeContador>;

/**
 * ¿El filtro la oculta? Las del centro nunca; las demás si no tienen nada en los grupos encendidos o, con
 * "Mis tarjetas" prendido (`mias` = las tarjetas mías y sus madres), si no hay nada mío en ellas.
 */
const filtrada = (
  id: string,
  centros: ReadonlySet<string>,
  contadores: ReadonlyMap<string, Contadores>,
  filtros: Filtros,
  mias: ReadonlySet<string> | null,
) =>
  !centros.has(id) && (atenuadaPorGrupos(contadores.get(id) ?? contadoresEnCero(), filtros) || (mias !== null && !mias.has(id)));

/** El nivel que de verdad se muestra (uno que ya no existe = la raíz) y sus tarjetas. */
function nivelVisible(tarjetas: TarjetaVista[], nivel: string | null) {
  return tarjetasDelNivel(tarjetas, nivel);
}

/** Las tarjetas del centro del nivel (la del nivel, o cada raíz en la entrada). */
const centrosDelNivel = (tarjetas: TarjetaVista[], nivel: string | null) =>
  new Set(gruposDelNivel(tarjetas, nivel).grupos.map((grupo) => grupo.centro));

const contadoresDe = (contenido: Pick<ContenidoNuevo, "tarjetas" | "tipos">) =>
  contadoresRecursivos(contenido.tarjetas, contenido.tipos);

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
  /** El userId de quien mira si "Mis tarjetas" está prendido; null si no. */
  propias: string | null,
): NodoDeTarjeta[] {
  const { nivel, grupos } = gruposDelNivel(contenido.tarjetas, nivelPedido);
  const porId = new Map(contenido.tarjetas.map((tarjeta) => [tarjeta.id, tarjeta]));
  const centros = new Set(grupos.map((grupo) => grupo.centro));
  const contadores = contadoresDe(contenido);
  const hijas = contarHijas(contenido.tarjetas);
  const mias = propias ? tarjetasConMias(contenido.tarjetas, propias) : null;
  // Lo filtrado no se pinta (ni su línea): el mapa se acomoda solo con lo que se ve.
  const gruposVisibles = grupos.map((grupo) => ({
    centro: grupo.centro,
    hijas: grupo.hijas.filter((id) => !filtrada(id, centros, contadores, filtros, mias)),
  }));
  const visibles = gruposVisibles.flatMap((grupo) => [grupo.centro, ...grupo.hijas]);
  // Si el nivel pedido ya no existe (se borró) se muestra la raíz: las posiciones de antes no sirven.
  const posiciones = disponerRadial(gruposVisibles, nivel === nivelPedido ? previas : new Map());
  const tipoPorId = new Map(contenido.tipos.map((tipo) => [tipo.id, tipo]));
  return visibles.map((id) => {
    const tarjeta = porId.get(id)!;
    const tipo = tipoPorId.get(tarjeta.tipoId);
    return {
      id,
      type: "tarjeta" as const,
      // El centro de la etiqueta (el mapa usa nodeOrigin [0.5, 0.5]).
      position: posiciones.get(id) ?? { x: 0, y: 0 },
      data: {
        titulo: tarjeta.titulo,
        codigo: tarjeta.codigo,
        hijas: hijas.get(id) ?? 0,
        contadores: contadores.get(id) ?? contadoresEnCero(),
        esNivel: centros.has(id),
        atenuado: false,
        responsable: tarjeta.responsableNombre,
        colorTipo: tipo?.color ?? null,
        iconoTipo: tipo?.icono ?? null,
        nombreTipo: tipo?.nombre ?? null,
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
  tableros: tablerosIniciales,
  firmaDeTableros,
  tableroId,
  tableroNombre,
  inicial,
  tarjetaInicial,
  nivelInicial,
  puedeAprobar,
  puedeEditarTipos,
  cuentas,
  esDueno,
  puedeSubirSistemas,
  puedeCerebro = false,
  puedeAsignar,
}: Props) {
  const angosta = useEsAngosta();

  const [contenido, setContenido] = useState<ContenidoNuevo | null>(inicial);
  const [nivel, setNivel] = useState<string | null>(() =>
    inicial ? nivelVisible(inicial.tarjetas, nivelInicial).nivel : null,
  );
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES);
  // Cada vez que sube, el mapa vuelve a ajustar el zoom a lo que se ve (cambio de filtro).
  const [pedidoDeZoom, setPedidoDeZoom] = useState(0);
  const mapa = useRef<ReactFlowInstance<NodoDeTarjeta, FlechaDeTablero> | null>(null);
  // Las tarjetas que el dueño arrastró a mano en este nivel: conservan su sitio al cambiar un filtro.
  const arrastradas = useRef(new Set<string>());
  // "Mis tarjetas": las que no son mías se ven apagadas (como los chips de grupo).
  const [soloMias, setSoloMias] = useState(false);
  const propias = soloMias ? cuentas.yo : null;
  const [abierta, setAbierta] = useState<string | null>(tarjetaInicial);
  const [nodos, setNodos] = useState<NodoDeTarjeta[]>(() =>
    inicial
      ? construirNodos(inicial, nivelVisible(inicial.tarjetas, nivelInicial).nivel, FILTROS_INICIALES, new Map(), setAbierta, null)
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
  const contadores = useMemo(() => contadoresRecursivos(tarjetas, tipos), [tarjetas, tipos]);
  const centros = useMemo(() => centrosDelNivel(tarjetas, nivel), [tarjetas, nivel]);
  const conteoDelNivel = useMemo(
    () => contadoresDelNivel(tarjetas, tipos, nivel, contadores),
    [contadores, nivel, tarjetas, tipos],
  );

  // Lo que necesitan los manejadores de "atrás" del navegador y el refresco automático: siempre los
  // filtros vigentes, no los del cierre de la función.
  const estadoRef = useRef({ contenido, filtros, propias });
  useEffect(() => {
    estadoRef.current = { contenido, filtros, propias };
  }, [contenido, filtros, propias]);
  const mias = useMemo(() => (propias ? tarjetasConMias(tarjetas, propias) : null), [propias, tarjetas]);
  const cuantasMias = useMemo(
    () => tarjetas.filter((tarjeta) => tarjeta.responsableId === cuentas.yo).length,
    [cuentas.yo, tarjetas],
  );

  // Lo que cambia por fuera (Claude, el trabajador, otra pestaña) entra solo: se cambian los datos,
  // no la página, así que el nivel, la ficha abierta, lo arrastrado y el zoom del mapa se quedan.
  const alCambiar = useCallback(
    (nuevo: ContenidoNuevo) => {
      setContenido(nuevo);
      // Mismo nivel: las que ya estaban (o el dueño arrastró) se quedan donde estaban.
      setNodos((previos) =>
        construirNodos(nuevo, nivel, estadoRef.current.filtros, posicionesDe(previos), setAbierta, estadoRef.current.propias),
      );
      // Si borraron la tarjeta de la ficha abierta, la ficha se cierra.
      setAbierta((actual) => (actual && nuevo.tarjetas.some((tarjeta) => tarjeta.id === actual) ? actual : null));
    },
    [nivel],
  );

  const refrescarYa = useRefrescoDelTablero(tableroId, contenido?.actualizadoEn ?? null, alCambiar);

  // La lista de tableros del selector, al día aunque esté cerrado (tableros nuevos, por aprobar, nombres).
  const { tableros, setTableros, preguntarYa: refrescarTableros } = useListaDeTableros(tablerosIniciales, firmaDeTableros);
  const nombreDelTablero = tableros.find((tablero) => tablero.id === tableroId)?.nombre ?? tableroNombre;
  const alRenombrarTablero = useCallback(
    (id: string, cambio: Partial<TableroResumen>) =>
      setTableros((lista) => lista.map((tablero) => (tablero.id === id ? { ...tablero, ...cambio } : tablero))),
    [setTableros],
  );

  /** Cambiar de nivel (y la URL, para que atrás del navegador vuelva). */
  const irANivel = useCallback(
    (destino: string | null, { empujar = true, abrir = null as string | null } = {}) => {
      const actual = estadoRef.current.contenido;
      if (!actual || !tableroId) return;
      const real = nivelVisible(actual.tarjetas, destino).nivel;
      setNivel(real);
      setAbierta(abrir);
      arrastradas.current = new Set();
      setNodos(construirNodos(actual, real, estadoRef.current.filtros, new Map(), setAbierta, estadoRef.current.propias));
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

  /** Aplica filtros nuevos: reacomoda el mapa con lo visible (lo arrastrado a mano se queda) y ajusta el zoom. */
  const aplicarFiltros = useCallback(
    (siguiente: Filtros, soloMiasNuevo: boolean) => {
      const actual = estadoRef.current.contenido;
      const propiasNuevo = soloMiasNuevo ? cuentas.yo : null;
      estadoRef.current = { contenido: actual, filtros: siguiente, propias: propiasNuevo };
      setFiltros(siguiente);
      setSoloMias(soloMiasNuevo);
      if (actual) {
        setNodos((previos) => {
          const fijas = new Map([...posicionesDe(previos)].filter(([id]) => arrastradas.current.has(id)));
          return construirNodos(actual, nivel, siguiente, fijas, setAbierta, propiasNuevo);
        });
      }
      setPedidoDeZoom((n) => n + 1);
    },
    [cuentas.yo, nivel],
  );

  const alternarGrupo = (grupo: GrupoDeContador) => {
    const siguiente = new Set(filtros);
    if (siguiente.has(grupo)) siguiente.delete(grupo);
    else siguiente.add(grupo);
    guardarFiltros(siguiente, soloMias);
    aplicarFiltros(siguiente, soloMias);
  };

  const alternarMias = () => {
    guardarFiltros(filtros, !soloMias);
    aplicarFiltros(filtros, !soloMias);
  };

  // La elección guardada en el dispositivo se lee después de cargar (no antes, para no desajustar el HTML
  // del servidor) y se aplica de una vez. Sin nada guardado o dañado, se queda solo "Te toca".
  useEffect(() => {
    const guardado = leerFiltrosGuardados();
    if (guardado) aplicarFiltros(guardado.filtros, guardado.mias);
    // Solo al abrir la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El zoom se ajusta con una pequeña espera, a que los nodos nuevos ya estén medidos.
  useEffect(() => {
    if (pedidoDeZoom === 0) return;
    const espera = window.setTimeout(() => {
      mapa.current?.fitView({ padding: 0.2, maxZoom: ZOOM_MAXIMO_AL_AJUSTAR, duration: 200 });
    }, 100);
    return () => window.clearTimeout(espera);
  }, [pedidoDeZoom]);

  // Lo que el dueño arrastra se queda donde lo dejó mientras siga en este nivel (las posiciones
  // viven en los nodos; no se guardan en la base).
  const alMoverNodos = useCallback((cambios: NodeChange<NodoDeTarjeta>[]) => {
    setNodos((previos) => applyNodeChanges(cambios, previos));
  }, []);

  const aristas = useMemo<FlechaDeTablero[]>(() => {
    const oculta = (id: string) => filtrada(id, centros, contadores, filtros, mias);
    const esMadreEHija = (a: string, b: string) => madre.get(a) === b || madre.get(b) === a;
    // Las flechas entre tarjetas del nivel: punteadas, tenues y sin punto (lo principal es la madre).
    // Una flecha entre madre e hija no se dibuja: ya la representa la unión con la madre (con su punto).
    const flechas: FlechaDeTablero[] = conexiones
      .filter((conexion) => enNivel.has(conexion.origenId) && enNivel.has(conexion.destinoId))
      .filter((conexion) => !oculta(conexion.origenId) && !oculta(conexion.destinoId))
      .filter((conexion) => !esMadreEHija(conexion.origenId, conexion.destinoId))
      .map((conexion) => {
        return {
          id: conexion.id,
          source: conexion.origenId,
          target: conexion.destinoId,
          type: "flotante" as const,
          data: { color: "var(--tia-gris)", atenuada: false, clase: "flecha" as const, conPunto: false },
          selectable: false,
          style: { stroke: "var(--tia-gris)", strokeWidth: 1, strokeDasharray: "3 4", opacity: 0.6 },
        };
      });
    // La unión con la madre: línea fina gris del centro a cada hija, con UN punto que viaja (rojo si
    // la hija tiene algo que "te toca").
    const uniones: FlechaDeTablero[] = visibles
      .filter((id) => {
        const suMadre = madre.get(id);
        return suMadre && enNivel.has(suMadre) && !oculta(id) && !oculta(suMadre);
      })
      .map((id) => {
        const teToca = (contadores.get(id)?.teToca ?? 0) > 0;
        return {
          id: `madre-${id}`,
          source: madre.get(id)!,
          target: id,
          type: "flotante" as const,
          data: { color: teToca ? "var(--tia-rojo)" : "var(--tia-gris)", atenuada: false, clase: "madre" as const },
          selectable: false,
          style: { stroke: "var(--tia-linea)", strokeWidth: 1, opacity: 1 },
        };
      });
    return [...uniones, ...flechas];
  }, [centros, conexiones, contadores, enNivel, filtros, madre, mias, visibles]);

  const usosDeTipo = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const tarjeta of tarjetas) cuenta.set(tarjeta.tipoId, (cuenta.get(tarjeta.tipoId) ?? 0) + 1);
    return cuenta;
  }, [tarjetas]);

  const tarjetaAbierta = abierta ? (tarjetas.find((tarjeta) => tarjeta.id === abierta) ?? null) : null;
  const entrantes = abierta ? conexiones.filter((c) => c.destinoId === abierta).map((c) => c.origenId) : [];
  const salientes = abierta ? conexiones.filter((c) => c.origenId === abierta).map((c) => c.destinoId) : [];
  const flechasEntrantes = abierta ? conexiones.filter((c) => c.destinoId === abierta) : [];

  return (
    <div className="tablero-ia flex h-[calc(100dvh-3.5rem)] flex-col">
      <SelectorDeTablero
        tableros={tableros}
        tableroId={tableroId}
        cuentas={cuentas}
        alAbrir={refrescarTableros}
        alRenombrar={alRenombrarTablero}
      />
      {/* Arriba, en UNA fila baja: "←" (sube un nivel), "Tablero IA" (el listado), la ruta y, a la
          derecha, el ícono de Tipos (solo dueño/admin). En el celular todo botón mide al menos 40 px
          y "Tablero IA" queda solo con su ícono. */}
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
        <Link
          href={RUTA_DEL_INICIO}
          className="flex min-h-10 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground md:min-h-8 md:px-1.5"
          aria-label="Tablero IA: todos los tableros"
          title="Todos los tableros"
        >
          <LayoutGrid className="size-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">Tablero IA</span>
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <MigasDelNivel tableroNombre={nombreDelTablero}ruta={ruta} alIr={(id) => irANivel(id)} />
        {puedeEditarTipos ? (
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

      {/* Chips de grupo del nivel (recursivos). Apagado = tachado y "○": sus tarjetas desaparecen del mapa.
          Se deslizan de lado en el celular. */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-2 [scrollbar-width:none]">
        {CHIPS.map(({ grupo, nombre, color }) => {
          const activo = filtros.has(grupo);
          return (
            <button
              key={grupo}
              type="button"
              onClick={() => alternarGrupo(grupo)}
              aria-pressed={activo}
              title={activo ? `Ocultar "${nombre}"` : `Mostrar "${nombre}"`}
              className={cn(
                "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium tabular-nums md:min-h-0",
                activo ? "border-border bg-background text-foreground" : "border-dashed text-muted-foreground line-through",
              )}
            >
              <span
                className="size-2 shrink-0 rounded-full border"
                style={{ borderColor: color, background: activo ? color : "transparent" }}
                aria-hidden
              />
              {nombre} {conteoDelNivel[grupo]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={alternarMias}
          aria-pressed={soloMias}
          title={soloMias ? "Ver todas las tarjetas" : "Resaltar solo las tarjetas que me asignaron"}
          className={cn(
            "flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium tabular-nums md:min-h-0",
            soloMias ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground",
          )}
        >
          <UserRound className="size-3.5 shrink-0" aria-hidden />
          Mis tarjetas {cuantasMias}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 bg-zinc-50 dark:bg-zinc-950">
        {tarjetas.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            El tablero está vacío. Las ideas que anote Claude aparecen acá en unos segundos.
          </div>
        ) : (
          <>
          <ReactFlow<NodoDeTarjeta, FlechaDeTablero>
            key={nivel ?? "raiz"}
            nodes={nodos}
            edges={aristas}
            edgeTypes={TIPOS_DE_FLECHA}
            nodeTypes={TIPOS_DE_NODO}
            onNodesChange={alMoverNodos}
            onNodeClick={(_, nodo) => {
              // Una hija con hijas entra; el centro o una sin hijas abre su ficha.
              if (nodo.data.hijas > 0 && !nodo.data.esNivel) irANivel(nodo.id);
              else setAbierta(nodo.id);
            }}
            nodeOrigin={ORIGEN_AL_CENTRO}
            className="chatbot-flow-canvas"
            nodesConnectable={false}
            edgesFocusable={false}
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: ZOOM_MAXIMO_AL_AJUSTAR }}
            onInit={(instancia) => {
              mapa.current = instancia;
            }}
            onNodeDragStop={(_, nodo) => {
              arrastradas.current.add(nodo.id);
            }}
            minZoom={0.15}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
          {nodos.every((nodo) => nodo.data.esNivel) ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-6 text-center text-xs text-muted-foreground">
              No hay tarjetas con estos filtros
            </div>
          ) : null}
          </>
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
        flechasEntrantes={flechasEntrantes}
        abierta={abierta !== null}
        lado={angosta ? "bottom" : "right"}
        puedeAprobar={puedeAprobar}
        esDueno={esDueno}
        puedeSubirSistemas={puedeSubirSistemas}
        puedeCerrarComoFallida={esDueno || puedeEditarTipos}
        puedeCerebro={puedeCerebro}
        miembros={cuentas.miembros}
        puedeAsignar={puedeAsignar}
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
        puedeEditar={puedeEditarTipos}
        alCambiar={refrescarYa}
      />
    </div>
  );
}
