/*
  VISTAS DEL TABLERO IA (estilo Notion, 3-nov-2026): las mismas tarjetas en Tabla, Tablero (kanban),
  Calendario y Mapa (el diagrama de siempre).

  Funciones puras, sin base ni React, para poder probarlas (scripts/check-tablero-vistas.mjs): el valor
  de cada columna, filtrar, buscar, ordenar y agrupar, las vistas de fábrica, cómo se limpia una vista
  guardada que llega de afuera y las columnas del kanban. Nada de acá cambia una regla: los cambios de
  estado se preguntan a `puedeCambiarEstado` (services/reglas.ts), la misma regla que usa el servidor.
*/
import {
  ESTADOS_DE_LA_FASE_2,
  ESTADOS_SIN_APROBAR,
  ESTADOS_TARJETA,
  NOMBRE_DEL_ESTADO,
  estaTrabajando,
  puedeCambiarEstado,
  type EstadoTarjetaTablero,
  type Veredicto,
} from "./reglas";

/* ------------------------------------------------------------------ vistas */

export const VISTAS = ["tabla", "tablero", "calendario", "mapa"] as const;
export type Vista = (typeof VISTAS)[number];
export const VISTA_POR_DEFECTO: Vista = "tabla";
export const NOMBRE_DE_LA_VISTA: Record<Vista, string> = {
  tabla: "Tabla",
  tablero: "Tablero",
  calendario: "Calendario",
  mapa: "Mapa",
};

export function esVista(valor: unknown): valor is Vista {
  return typeof valor === "string" && (VISTAS as readonly string[]).includes(valor);
}

/* ------------------------------------------------------------------ lo que necesita cada fila */

/** Lo mínimo de una tarjeta que usan las vistas (TarjetaVista lo cumple). */
export type TarjetaDeVista = {
  id: string;
  numero: number | null;
  codigo: string;
  titulo: string;
  detalle: string;
  area: string | null;
  estado: EstadoTarjetaTablero;
  fecha: string | null;
  tipoId: string;
  padreId: string | null;
  repo: string | null;
  urgente: boolean;
  responsableId: string | null;
  responsableNombre: string | null;
};

/** Lo mínimo de un tipo (TipoVista lo cumple). */
export type TipoDeVista = { id: string; nombre: string; requiereAprobacion: boolean; usaEstados: boolean; orden: number };

/** Una fila de la tabla: la tarjeta, lo que se lee de su tipo y el área heredada de su carpeta madre. */
export type FilaDeTabla<T extends TarjetaDeVista = TarjetaDeVista> = {
  tarjeta: T;
  tipoNombre: string;
  tipoOrden: number;
  requiereAprobacion: boolean;
  usaEstados: boolean;
  /** El área que se muestra: la de la tarjeta o, si no tiene, la de la carpeta (tipo sin estados) de la que cuelga. */
  area: string | null;
  /** true si el área sale de la carpeta madre y no de la tarjeta. */
  areaHeredada: boolean;
};

/**
 * Arma las filas. El área de una tarjeta sin área es la carpeta (un tipo sin estados, como Área) más
 * cercana hacia arriba: así "Sistemas en curso" sirve igual si la tarjeta cuelga de la carpeta Sistemas.
 */
export function filasDeTabla<T extends TarjetaDeVista>(tarjetas: readonly T[], tipos: readonly TipoDeVista[]): FilaDeTabla<T>[] {
  const tipoPorId = new Map(tipos.map((tipo) => [tipo.id, tipo]));
  const porId = new Map(tarjetas.map((tarjeta) => [tarjeta.id, tarjeta]));
  const carpetaDe = (tarjeta: T): string | null => {
    const vistas = new Set<string>([tarjeta.id]);
    let madre = tarjeta.padreId ? porId.get(tarjeta.padreId) : undefined;
    while (madre && !vistas.has(madre.id)) {
      vistas.add(madre.id);
      if (madre.area?.trim()) return madre.area.trim();
      if (tipoPorId.get(madre.tipoId)?.usaEstados === false) return madre.titulo;
      madre = madre.padreId ? porId.get(madre.padreId) : undefined;
    }
    return null;
  };
  return tarjetas.map((tarjeta) => {
    const tipo = tipoPorId.get(tarjeta.tipoId);
    const propia = tarjeta.area?.trim() || null;
    const heredada = propia ? null : carpetaDe(tarjeta);
    return {
      tarjeta,
      tipoNombre: tipo?.nombre ?? "Sin tipo",
      tipoOrden: tipo?.orden ?? Number.MAX_SAFE_INTEGER,
      requiereAprobacion: tipo?.requiereAprobacion ?? true,
      usaEstados: tipo?.usaEstados ?? true,
      area: propia ?? heredada,
      areaHeredada: !propia && heredada !== null,
    };
  });
}

/* ------------------------------------------------------------------ columnas */

export const COLUMNAS = [
  { clave: "codigo", nombre: "Código" },
  { clave: "titulo", nombre: "Título" },
  { clave: "tipo", nombre: "Tipo" },
  { clave: "area", nombre: "Área" },
  { clave: "estado", nombre: "Estado" },
  { clave: "prioridad", nombre: "Prioridad" },
  { clave: "responsable", nombre: "Responsable" },
  { clave: "fecha", nombre: "Fecha" },
] as const;
export type ClaveDeColumna = (typeof COLUMNAS)[number]["clave"];
export const NOMBRE_DE_LA_COLUMNA = Object.fromEntries(COLUMNAS.map((c) => [c.clave, c.nombre])) as Record<ClaveDeColumna, string>;

/** Por las que se filtra con opciones y se agrupa (Código y Título se buscan con el buscador). */
export const COLUMNAS_CON_OPCIONES = ["tipo", "area", "estado", "prioridad", "responsable", "fecha"] as const satisfies readonly ClaveDeColumna[];
export type ColumnaConOpciones = (typeof COLUMNAS_CON_OPCIONES)[number];

export function esColumna(valor: unknown): valor is ClaveDeColumna {
  return typeof valor === "string" && COLUMNAS.some((columna) => columna.clave === valor);
}
const esColumnaConOpciones = (valor: unknown): valor is ColumnaConOpciones =>
  typeof valor === "string" && (COLUMNAS_CON_OPCIONES as readonly string[]).includes(valor);

/** Sin tildes, en minúsculas y sin espacios de sobra: para comparar y buscar. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const DIA_BOGOTA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });

/** El día (AAAA-MM-DD) de una fecha en la hora de Colombia; null si no hay fecha. */
export function diaDeBogota(iso: string | null): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? null : DIA_BOGOTA.format(fecha);
}

const MES = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", month: "long", year: "numeric" });

/** Lo que vale una fila en una columna: `clave` para filtrar y agrupar, `texto` para mostrar. "" = vacío. */
export function valorDeColumna(fila: FilaDeTabla, columna: ClaveDeColumna): { clave: string; texto: string } {
  const { tarjeta } = fila;
  switch (columna) {
    case "codigo":
      return { clave: tarjeta.codigo, texto: tarjeta.codigo || "—" };
    case "titulo":
      return { clave: normalizar(tarjeta.titulo), texto: tarjeta.titulo };
    case "tipo":
      return { clave: tarjeta.tipoId, texto: fila.tipoNombre };
    case "area":
      return fila.area ? { clave: normalizar(fila.area), texto: fila.area } : { clave: "", texto: "Sin área" };
    case "estado":
      // Las carpetas (tipos sin estados) no tienen estado: en la base quedan IDEA, pero no son ideas.
      return fila.usaEstados
        ? { clave: tarjeta.estado, texto: NOMBRE_DEL_ESTADO[tarjeta.estado] }
        : { clave: "", texto: "Sin estado" };
    case "prioridad":
      return tarjeta.urgente ? { clave: "URGENTE", texto: "Urgente" } : { clave: "NORMAL", texto: "Normal" };
    case "responsable":
      return tarjeta.responsableId
        ? { clave: tarjeta.responsableId, texto: tarjeta.responsableNombre ?? "Otra persona" }
        : { clave: "", texto: "Nadie" };
    case "fecha": {
      // Para filtrar y agrupar, el mes; el día exacto se ve en la celda.
      const dia = diaDeBogota(tarjeta.fecha);
      if (!dia) return { clave: "", texto: "Sin fecha" };
      const mes = MES.format(new Date(`${dia.slice(0, 7)}-15T12:00:00Z`));
      return { clave: dia.slice(0, 7), texto: mes.charAt(0).toUpperCase() + mes.slice(1) };
    }
  }
}

/** Las opciones de una columna para el filtro (las que hay en las filas), en el orden en que se agrupan. */
export function opcionesDeColumna(filas: readonly FilaDeTabla[], columna: ColumnaConOpciones) {
  return agrupar(filas, columna).map((grupo) => ({ clave: grupo.clave, texto: grupo.texto, cuantas: grupo.filas.length }));
}

/* ------------------------------------------------------------------ configuración de una vista */

export type OrdenDeTabla = { columna: ClaveDeColumna; direccion: "asc" | "desc" };

/** Lo que se guarda de una vista de la tabla: el texto buscado, los filtros, el orden y el agrupado. */
export type ConfigDeTabla = {
  busqueda: string;
  /** Por columna, las claves que se dejan ver (vacío o sin la columna = todas). Dentro de una columna es "o"; entre columnas, "y". */
  filtros: Partial<Record<ColumnaConOpciones, string[]>>;
  orden: OrdenDeTabla | null;
  agrupar: ColumnaConOpciones | null;
};

export const CONFIG_VACIA: ConfigDeTabla = { busqueda: "", filtros: {}, orden: null, agrupar: null };

const MAX_BUSQUEDA = 100;
const MAX_VALORES_POR_FILTRO = 50;
const MAX_LARGO_DE_VALOR = 200;

/** Una configuración que llega de afuera (la base, el navegador) limpia: lo que no se entiende se descarta. */
export function limpiarConfig(valor: unknown): ConfigDeTabla {
  if (typeof valor !== "object" || valor === null) return { ...CONFIG_VACIA, filtros: {} };
  const dato = valor as Record<string, unknown>;
  const busqueda = typeof dato.busqueda === "string" ? dato.busqueda.slice(0, MAX_BUSQUEDA) : "";
  const filtros: ConfigDeTabla["filtros"] = {};
  if (typeof dato.filtros === "object" && dato.filtros !== null) {
    for (const [columna, valores] of Object.entries(dato.filtros as Record<string, unknown>)) {
      if (!esColumnaConOpciones(columna) || !Array.isArray(valores)) continue;
      const limpios = [...new Set(valores.filter((v): v is string => typeof v === "string" && v.length <= MAX_LARGO_DE_VALOR))].slice(
        0,
        MAX_VALORES_POR_FILTRO,
      );
      if (limpios.length) filtros[columna] = limpios;
    }
  }
  const crudo = dato.orden as Record<string, unknown> | null | undefined;
  const orden =
    crudo && typeof crudo === "object" && esColumna(crudo.columna) && (crudo.direccion === "asc" || crudo.direccion === "desc")
      ? { columna: crudo.columna, direccion: crudo.direccion as OrdenDeTabla["direccion"] }
      : null;
  const agrupar = esColumnaConOpciones(dato.agrupar) ? dato.agrupar : null;
  return { busqueda, filtros, orden, agrupar };
}

/** Los estados "en curso": aprobados y los que tiene el Coordinador (planeando, plan listo, construyendo, por revisar, subiendo, error). */
export const ESTADOS_EN_CURSO: readonly EstadoTarjetaTablero[] = ["APROBADO", "EN_CURSO", ...ESTADOS_DE_LA_FASE_2];

export type VistaDeTabla = { id: string; nombre: string; config: ConfigDeTabla; deFabrica?: boolean };

/** Las que vienen de fábrica para todos (no se borran). El área se compara sin mayúsculas ni tildes. */
export const VISTAS_DE_FABRICA: readonly VistaDeTabla[] = [
  { id: "fabrica:ideas", nombre: "Ideas", deFabrica: true, config: { ...CONFIG_VACIA, filtros: { estado: ["IDEA"] } } },
  {
    id: "fabrica:sistemas-en-curso",
    nombre: "Sistemas en curso",
    deFabrica: true,
    config: { ...CONFIG_VACIA, filtros: { area: [normalizar("Sistemas")], estado: [...ESTADOS_EN_CURSO] } },
  },
];

/* ------------------------------------------------------------------ buscar, filtrar, ordenar, agrupar */

/** ¿La fila tiene el texto buscado en el título, el detalle o el código? (sin mayúsculas, tildes ni guion del código). */
export function coincideBusqueda(fila: FilaDeTabla, busqueda: string): boolean {
  const pedido = normalizar(busqueda);
  if (!pedido) return true;
  const { tarjeta } = fila;
  if (normalizar(tarjeta.titulo).includes(pedido) || normalizar(tarjeta.detalle).includes(pedido)) return true;
  const codigo = normalizar(tarjeta.codigo);
  if (!codigo) return false;
  const sinGuion = (texto: string) => texto.replace(/[-\s]/g, "");
  return codigo.includes(pedido) || sinGuion(codigo) === sinGuion(pedido) || (/^\d+$/.test(pedido) && String(tarjeta.numero) === pedido);
}

export function filtrarFilas<F extends FilaDeTabla>(filas: readonly F[], config: Pick<ConfigDeTabla, "busqueda" | "filtros">): F[] {
  const activos = Object.entries(config.filtros).filter(([, valores]) => valores && valores.length) as [ColumnaConOpciones, string[]][];
  return filas.filter(
    (fila) =>
      coincideBusqueda(fila, config.busqueda) &&
      activos.every(([columna, valores]) => valores.includes(valorDeColumna(fila, columna).clave)),
  );
}

const indiceDelEstado = (estado: EstadoTarjetaTablero) => ESTADOS_TARJETA.indexOf(estado);
const COMPARAR_TEXTO = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Compara dos filas por una columna (ascendente). Los vacíos van siempre al final. */
function compararPor(a: FilaDeTabla, b: FilaDeTabla, columna: ClaveDeColumna): number {
  switch (columna) {
    case "codigo":
      return (a.tarjeta.numero ?? Number.MAX_SAFE_INTEGER) - (b.tarjeta.numero ?? Number.MAX_SAFE_INTEGER);
    case "estado":
      return (a.usaEstados ? indiceDelEstado(a.tarjeta.estado) : 99) - (b.usaEstados ? indiceDelEstado(b.tarjeta.estado) : 99);
    case "prioridad":
      return Number(b.tarjeta.urgente) - Number(a.tarjeta.urgente);
    case "tipo":
      return a.tipoOrden - b.tipoOrden || COMPARAR_TEXTO.compare(a.tipoNombre, b.tipoNombre);
    case "fecha":
      return (a.tarjeta.fecha ?? "9999").localeCompare(b.tarjeta.fecha ?? "9999");
    default: {
      const x = valorDeColumna(a, columna);
      const y = valorDeColumna(b, columna);
      if (!x.clave !== !y.clave) return x.clave ? -1 : 1;
      return COMPARAR_TEXTO.compare(x.texto, y.texto);
    }
  }
}

/** Ordena (sin tocar la lista que llega). Sin orden, quedan como vienen. */
export function ordenarFilas<F extends FilaDeTabla>(filas: readonly F[], orden: OrdenDeTabla | null): F[] {
  if (!orden) return [...filas];
  const signo = orden.direccion === "asc" ? 1 : -1;
  return filas
    .map((fila, indice) => ({ fila, indice }))
    .sort((a, b) => signo * compararPor(a.fila, b.fila, orden.columna) || a.indice - b.indice)
    .map(({ fila }) => fila);
}

export type GrupoDeFilas<F extends FilaDeTabla = FilaDeTabla> = { clave: string; texto: string; filas: F[] };

/** Agrupa por una columna: un grupo por valor, en el orden de la columna; el grupo vacío ("Sin área") al final. */
export function agrupar<F extends FilaDeTabla>(filas: readonly F[], columna: ColumnaConOpciones): GrupoDeFilas<F>[] {
  const grupos = new Map<string, GrupoDeFilas<F>>();
  for (const fila of ordenarFilas(filas, { columna, direccion: "asc" })) {
    const { clave, texto } = valorDeColumna(fila, columna);
    const grupo = grupos.get(clave);
    if (grupo) grupo.filas.push(fila);
    else grupos.set(clave, { clave, texto, filas: [fila] });
  }
  const lista = [...grupos.values()];
  return [...lista.filter((g) => g.clave), ...lista.filter((g) => !g.clave)];
}

/** Todo junto: filtra, busca y ordena; y agrupa si se pidió (sin agrupar, un solo grupo con todo). */
export function aplicarConfig<F extends FilaDeTabla>(filas: readonly F[], config: ConfigDeTabla): GrupoDeFilas<F>[] {
  const ordenadas = ordenarFilas(filtrarFilas(filas, config), config.orden);
  if (!config.agrupar) return [{ clave: "*", texto: "", filas: ordenadas }];
  // Dentro de cada grupo se respeta el orden pedido.
  return agrupar(ordenadas, config.agrupar).map((grupo) => ({ ...grupo, filas: ordenarFilas(grupo.filas, config.orden) }));
}

/* ------------------------------------------------------------------ estados que ofrece el menú */

/** Los estados a los que se puede pasar la tarjeta a mano (la misma regla del servidor). Nunca APROBADO: aprobar es su botón. */
export function estadosPermitidos(fila: FilaDeTabla): EstadoTarjetaTablero[] {
  if (!fila.usaEstados) return [];
  return ESTADOS_SIN_APROBAR.filter(
    (estado) =>
      estado !== fila.tarjeta.estado &&
      puedeCambiarEstado(fila.tarjeta.estado, estado, fila.requiereAprobacion, fila.usaEstados, Boolean(fila.tarjeta.repo)) === null,
  );
}

/** Si no se puede cambiar a ningún estado, el porqué (el de la regla); null si hay alguno. */
export function motivoSinCambios(fila: FilaDeTabla): string | null {
  if (estadosPermitidos(fila).length) return null;
  const { tarjeta } = fila;
  const otro = ESTADOS_SIN_APROBAR.find((estado) => estado !== tarjeta.estado) ?? "IDEA";
  return (
    puedeCambiarEstado(tarjeta.estado, otro, fila.requiereAprobacion, fila.usaEstados, Boolean(tarjeta.repo)) ??
    "Esta tarjeta no se puede cambiar de estado a mano."
  );
}

/* ------------------------------------------------------------------ kanban */

export const COLUMNA_DEL_COORDINADOR = "coordinador";

export type ColumnaDeKanban = {
  clave: string;
  nombre: string;
  /** El estado que queda al soltar una tarjeta aquí; null = no se suelta nada (la del Coordinador). */
  destino: EstadoTarjetaTablero | null;
};

export const COLUMNAS_DEL_KANBAN: readonly ColumnaDeKanban[] = [
  { clave: "IDEA", nombre: NOMBRE_DEL_ESTADO.IDEA, destino: "IDEA" },
  { clave: "POR_APROBAR", nombre: NOMBRE_DEL_ESTADO.POR_APROBAR, destino: "POR_APROBAR" },
  { clave: "APROBADO", nombre: NOMBRE_DEL_ESTADO.APROBADO, destino: "APROBADO" },
  { clave: "EN_CURSO", nombre: NOMBRE_DEL_ESTADO.EN_CURSO, destino: "EN_CURSO" },
  { clave: COLUMNA_DEL_COORDINADOR, nombre: "Con el Coordinador", destino: null },
  { clave: "HECHO", nombre: NOMBRE_DEL_ESTADO.HECHO, destino: "HECHO" },
  { clave: "FALLIDO", nombre: NOMBRE_DEL_ESTADO.FALLIDO, destino: "FALLIDO" },
];

/** La columna de una tarjeta; null para las carpetas (no tienen estado y no salen en el kanban). */
export function columnaDelKanban(fila: FilaDeTabla): string | null {
  if (!fila.usaEstados) return null;
  const { estado, repo } = fila.tarjeta;
  const delCoordinador = (ESTADOS_DE_LA_FASE_2 as readonly string[]).includes(estado) || (estaTrabajando(estado) && Boolean(repo));
  return delCoordinador ? COLUMNA_DEL_COORDINADOR : estado;
}

export const NO_SE_ARRASTRA_AL_COORDINADOR = "En la columna del Coordinador no se suelta nada: esos estados los pone él.";
export const NO_SE_ARRASTRA_DEL_COORDINADOR =
  "El Coordinador tiene esta tarjeta: se mueve desde su ficha, con los botones de aprobar o reintentar.";

/** ¿Se puede soltar la tarjeta en esa columna? null si sí; si no, el motivo de la regla (para mostrarlo). */
export function veredictoDelKanban(fila: FilaDeTabla, columna: ColumnaDeKanban): Veredicto {
  const actual = columnaDelKanban(fila);
  if (actual === null) return "Las carpetas (como Área) no tienen estado.";
  if (actual === COLUMNA_DEL_COORDINADOR) return NO_SE_ARRASTRA_DEL_COORDINADOR;
  if (columna.destino === null) return NO_SE_ARRASTRA_AL_COORDINADOR;
  return puedeCambiarEstado(fila.tarjeta.estado, columna.destino, fila.requiereAprobacion, fila.usaEstados, Boolean(fila.tarjeta.repo));
}

/** Las columnas a las que se puede soltar (para el menú "Mover a" y para resaltar). */
export function destinosDelKanban(fila: FilaDeTabla): ColumnaDeKanban[] {
  return COLUMNAS_DEL_KANBAN.filter((columna) => columna.clave !== columnaDelKanban(fila) && veredictoDelKanban(fila, columna) === null);
}

/** ¿Pasar a este estado pide confirmación? POR_APROBAR puede hacer que el Coordinador arranque solo. */
export const pideConfirmacion = (estado: EstadoTarjetaTablero) => estado === "POR_APROBAR";
