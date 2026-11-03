import {
  ESTADOS_DE_LA_FASE_2,
  ESTADOS_TARJETA,
  NOMBRE_DEL_ESTADO,
  estadoPermitidoParaTipo,
  puedeCambiarEstado,
  type EstadoTarjetaTablero,
} from "./reglas";

/*
  TABLERO IA ESTILO NOTION (2-nov-2026): las vistas de los MISMOS datos del tablero.

  Pedido del dueño: el mapa es complicado para el día a día; quiere una base de datos con varias
  vistas, como Notion. La vista principal es la TABLA (una fila por tarjeta); además el TABLERO por
  estado (kanban), el CALENDARIO por fecha y el MAPA de siempre. Todo lo de acá es lógica sin base
  ni React: filtrar, ordenar, agrupar, buscar, las vistas de fábrica, las columnas del kanban y la
  limpieza de lo que se guarda por persona en AppSetting (services/vistas-guardadas.ts). Lo prueba
  scripts/check-tablero-vistas.mjs.

  No cambia ninguna regla: el menú de Estado y el arrastre del kanban ofrecen solo lo que permiten
  `puedeCambiarEstado` y `estadoPermitidoParaTipo`, y el servidor lo vuelve a revisar al guardar.
*/

/* ── Las vistas ── */

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

/* ── Las columnas de la tabla ── */

export const COLUMNAS = ["codigo", "titulo", "tipo", "area", "estado", "prioridad", "responsable", "fecha", "madre"] as const;
export type Columna = (typeof COLUMNAS)[number];
export const NOMBRE_DE_LA_COLUMNA: Record<Columna, string> = {
  codigo: "Código",
  titulo: "Título",
  tipo: "Tipo",
  area: "Área",
  estado: "Estado",
  prioridad: "Prioridad",
  responsable: "Responsable",
  fecha: "Fecha",
  madre: "De qué cuelga",
};

export function esColumna(valor: unknown): valor is Columna {
  return typeof valor === "string" && (COLUMNAS as readonly string[]).includes(valor);
}

/** Lo que muestra el valor vacío de una columna (y su grupo). */
export const SIN_VALOR = "—";

/** Lo mínimo de una tarjeta que necesita la tabla (es un pedazo de TarjetaVista). */
export type TarjetaParaTabla = {
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
  responsableId: string | null;
  responsableNombre: string | null;
  urgente?: boolean;
};

export type TipoParaTabla = { id: string; nombre: string; requiereAprobacion: boolean; usaEstados: boolean; orden: number };

/** Una fila de la tabla: la tarjeta con sus valores ya listos para mostrar, filtrar y ordenar. */
export type FilaDeTabla = {
  id: string;
  numero: number | null;
  codigo: string;
  titulo: string;
  detalle: string;
  tipoId: string;
  tipo: string;
  tipoOrden: number;
  area: string | null;
  /** null = carpeta (tipo sin estados, como Área): no tiene estado. */
  estado: EstadoTarjetaTablero | null;
  prioridad: "Urgente" | "Normal";
  responsableId: string | null;
  responsable: string | null;
  /** El día (AAAA-MM-DD, hora de Colombia) o null. */
  fecha: string | null;
  madreId: string | null;
  madre: string | null;
  conRepo: boolean;
  requiereAprobacion: boolean;
  usaEstados: boolean;
};

const DIA_EN_BOGOTA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** El día de una fecha guardada (ISO) en hora de Colombia: "2026-11-02"; null si no hay o no se entiende. */
export function diaDeLaFecha(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return DIA_EN_BOGOTA.format(fecha);
}

/** Las filas de la tabla, una por tarjeta, en el orden en que llegan. */
export function filasDeLaTabla(tarjetas: readonly TarjetaParaTabla[], tipos: readonly TipoParaTabla[]): FilaDeTabla[] {
  const tipoPorId = new Map(tipos.map((tipo) => [tipo.id, tipo]));
  const tituloPorId = new Map(tarjetas.map((tarjeta) => [tarjeta.id, tarjeta.titulo]));
  return tarjetas.map((tarjeta) => {
    const tipo = tipoPorId.get(tarjeta.tipoId);
    const usaEstados = tipo?.usaEstados ?? true;
    const madreId = tarjeta.padreId && tituloPorId.has(tarjeta.padreId) ? tarjeta.padreId : null;
    return {
      id: tarjeta.id,
      numero: tarjeta.numero,
      codigo: tarjeta.codigo,
      titulo: tarjeta.titulo,
      detalle: tarjeta.detalle,
      tipoId: tarjeta.tipoId,
      tipo: tipo?.nombre ?? "",
      tipoOrden: tipo?.orden ?? Number.MAX_SAFE_INTEGER,
      area: tarjeta.area?.trim() || null,
      estado: usaEstados ? tarjeta.estado : null,
      prioridad: tarjeta.urgente ? "Urgente" : "Normal",
      responsableId: tarjeta.responsableId,
      responsable: tarjeta.responsableNombre,
      fecha: diaDeLaFecha(tarjeta.fecha),
      madreId,
      madre: madreId ? (tituloPorId.get(madreId) ?? null) : null,
      conRepo: Boolean(tarjeta.repo),
      requiereAprobacion: tipo?.requiereAprobacion ?? true,
      usaEstados,
    };
  });
}

/** El valor de una columna como texto (para filtrar y agrupar). Vacío = "". */
export function valorDeColumna(fila: FilaDeTabla, columna: Columna): string {
  switch (columna) {
    case "codigo":
      return fila.codigo;
    case "titulo":
      return fila.titulo;
    case "tipo":
      return fila.tipo;
    case "area":
      return fila.area ?? "";
    case "estado":
      return fila.estado ?? "";
    case "prioridad":
      return fila.prioridad;
    case "responsable":
      return fila.responsable ?? "";
    case "fecha":
      return fila.fecha ?? "";
    case "madre":
      return fila.madre ?? "";
  }
}

/** Cómo se muestra el valor de una columna (el estado con su nombre en español). */
export function textoDeColumna(fila: FilaDeTabla, columna: Columna): string {
  if (columna === "estado") return fila.estado ? NOMBRE_DEL_ESTADO[fila.estado] : SIN_VALOR;
  return valorDeColumna(fila, columna) || SIN_VALOR;
}

/** Texto sin tildes y en minúsculas, para comparar ("Área" = "area"). */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** ¿La fila tiene el texto buscado en su título, su detalle o su código ("T-12", "12")? */
export function coincideBusqueda(fila: FilaDeTabla, busqueda: string): boolean {
  const pedido = normalizar(busqueda);
  if (!pedido) return true;
  if (normalizar(fila.titulo).includes(pedido) || normalizar(fila.detalle).includes(pedido)) return true;
  if (fila.codigo && normalizar(fila.codigo).includes(pedido)) return true;
  // Solo el número: "12" encuentra T-12 (no T-120).
  return /^\d+$/.test(pedido) && fila.numero === Number(pedido);
}

/* ── Filtrar, ordenar y agrupar ── */

/** Un filtro: la columna y los valores que se dejan (uno o varios; "" = vacío). */
export type Filtro = { columna: Columna; valores: string[] };
export type Orden = { columna: Columna; direccion: "asc" | "desc" };

/** Cómo está la tabla: lo que se guarda en una vista. */
export type ConfigDeTabla = {
  busqueda: string;
  filtros: Filtro[];
  orden: Orden | null;
  agrupar: Columna | null;
};

export const CONFIG_VACIA: ConfigDeTabla = { busqueda: "", filtros: [], orden: null, agrupar: null };

/** ¿La fila pasa el filtro? Se compara sin tildes ni mayúsculas. */
export function pasaFiltro(fila: FilaDeTabla, filtro: Filtro): boolean {
  if (!filtro.valores.length) return true;
  const valor = normalizar(valorDeColumna(fila, filtro.columna));
  return filtro.valores.some((pedido) => normalizar(pedido) === valor);
}

const POSICION_DEL_ESTADO = new Map<string, number>(ESTADOS_TARJETA.map((estado, i) => [estado, i]));

/** Compara dos filas por una columna (los vacíos siempre al final, también en orden descendente). */
function compararPor(a: FilaDeTabla, b: FilaDeTabla, columna: Columna): number {
  if (columna === "codigo") {
    if (a.numero === null || b.numero === null) return a.numero === b.numero ? 0 : a.numero === null ? 1 : -1;
    return a.numero - b.numero;
  }
  if (columna === "estado") {
    if (a.estado === null || b.estado === null) return a.estado === b.estado ? 0 : a.estado === null ? 1 : -1;
    return (POSICION_DEL_ESTADO.get(a.estado) ?? 0) - (POSICION_DEL_ESTADO.get(b.estado) ?? 0);
  }
  if (columna === "tipo") return a.tipoOrden - b.tipoOrden || a.tipo.localeCompare(b.tipo, "es");
  if (columna === "prioridad") return a.prioridad === b.prioridad ? 0 : a.prioridad === "Urgente" ? -1 : 1;
  const x = valorDeColumna(a, columna);
  const y = valorDeColumna(b, columna);
  if (!x || !y) return x === y ? 0 : !x ? 1 : -1;
  return x.localeCompare(y, "es", { sensitivity: "base", numeric: true });
}

function vacio(fila: FilaDeTabla, columna: Columna) {
  return columna === "codigo" ? fila.numero === null : valorDeColumna(fila, columna) === "";
}

/** Ordena (sin tocar la lista que llega). Sin orden: por código, de la más nueva a la más vieja. */
export function ordenarFilas(filas: readonly FilaDeTabla[], orden: Orden | null): FilaDeTabla[] {
  const efectivo: Orden = orden ?? { columna: "codigo", direccion: "desc" };
  return [...filas].sort((a, b) => {
    // Los vacíos van al final en las dos direcciones.
    const va = vacio(a, efectivo.columna);
    const vb = vacio(b, efectivo.columna);
    if (va !== vb) return va ? 1 : -1;
    const base = compararPor(a, b, efectivo.columna);
    return efectivo.direccion === "asc" ? base : -base;
  });
}

/** Busca, filtra y ordena. */
export function aplicarConfig(filas: readonly FilaDeTabla[], config: ConfigDeTabla): FilaDeTabla[] {
  const quedan = filas.filter(
    (fila) => coincideBusqueda(fila, config.busqueda) && config.filtros.every((filtro) => pasaFiltro(fila, filtro)),
  );
  return ordenarFilas(quedan, config.orden);
}

export type GrupoDeFilas = { clave: string; nombre: string; filas: FilaDeTabla[] };

/**
 * Agrupa por una columna, conservando el orden de las filas dentro de cada grupo. Los grupos van en el
 * orden natural de la columna (el estado en su orden, el resto alfabético) y el vacío ("—") al final.
 */
export function agruparFilas(filas: readonly FilaDeTabla[], columna: Columna): GrupoDeFilas[] {
  const grupos = new Map<string, GrupoDeFilas>();
  for (const fila of filas) {
    const valor = valorDeColumna(fila, columna);
    const clave = normalizar(valor);
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = { clave, nombre: textoDeColumna(fila, columna), filas: [] };
      grupos.set(clave, grupo);
    }
    grupo.filas.push(fila);
  }
  return [...grupos.values()].sort((a, b) => {
    if (!a.clave || !b.clave) return a.clave === b.clave ? 0 : !a.clave ? 1 : -1;
    return compararPor(a.filas[0], b.filas[0], columna);
  });
}

/** Los valores distintos de una columna (para el menú del filtro), en su orden natural, el vacío al final. */
export function valoresDeColumna(filas: readonly FilaDeTabla[], columna: Columna): { valor: string; texto: string }[] {
  return agruparFilas(filas, columna).map((grupo) => ({
    valor: valorDeColumna(grupo.filas[0], columna),
    texto: grupo.nombre,
  }));
}

/* ── Vistas guardadas ── */

export type VistaGuardada = { id: string; nombre: string; config: ConfigDeTabla };

/** Los estados "en curso" (algo se está moviendo: aprobado, en curso o en manos del Coordinador). */
export const ESTADOS_EN_CURSO: readonly EstadoTarjetaTablero[] = ["APROBADO", "EN_CURSO", ...ESTADOS_DE_LA_FASE_2];

/** Las que vienen de fábrica: no se borran y no se guardan en la base. */
export const VISTAS_DE_FABRICA: readonly VistaGuardada[] = [
  {
    id: "fabrica:ideas",
    nombre: "Ideas",
    config: { ...CONFIG_VACIA, filtros: [{ columna: "estado", valores: ["IDEA"] }] },
  },
  {
    id: "fabrica:sistemas-en-curso",
    nombre: "Sistemas en curso",
    config: {
      ...CONFIG_VACIA,
      filtros: [
        { columna: "area", valores: ["Sistemas"] },
        { columna: "estado", valores: [...ESTADOS_EN_CURSO] },
      ],
    },
  },
];

export const MAX_VISTAS_GUARDADAS = 20;
export const MAX_NOMBRE_DE_VISTA = 40;
const MAX_BUSQUEDA = 120;
const MAX_VALORES = 50;
const MAX_VALOR = 120;

/** Lo que se guarda por persona: su última vista y sus vistas con nombre. */
export type PreferenciasDeVistas = { ultimaVista: Vista; guardadas: VistaGuardada[] };

export const PREFERENCIAS_INICIALES: PreferenciasDeVistas = { ultimaVista: VISTA_POR_DEFECTO, guardadas: [] };

/** La clave de AppSetting de cada persona (como "chats:filtros:<userId>"). */
export function claveDeVistas(userId: string): string {
  const limpio = typeof userId === "string" ? userId.trim() : "";
  if (!limpio) throw new Error("Falta la persona para guardar sus vistas.");
  return `tablero-ia:vistas:${limpio}`;
}

const textoCorto = (valor: unknown, maximo: number) => (typeof valor === "string" ? valor.trim().slice(0, maximo) : "");

/** Deja solo una configuración válida (lo dañado o desconocido se descarta, nunca rompe la pantalla). */
export function limpiarConfig(valor: unknown): ConfigDeTabla {
  if (typeof valor !== "object" || valor === null) return { ...CONFIG_VACIA };
  const crudo = valor as Record<string, unknown>;
  const filtros: Filtro[] = Array.isArray(crudo.filtros)
    ? crudo.filtros
        .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null && esColumna((f as Filtro).columna))
        .map((f) => ({
          columna: f.columna as Columna,
          valores: Array.isArray(f.valores)
            ? f.valores.filter((v): v is string => typeof v === "string").map((v) => v.slice(0, MAX_VALOR)).slice(0, MAX_VALORES)
            : [],
        }))
        .filter((f) => f.valores.length > 0)
        .slice(0, COLUMNAS.length)
    : [];
  const ordenCrudo = crudo.orden as Record<string, unknown> | null | undefined;
  const orden: Orden | null =
    ordenCrudo && typeof ordenCrudo === "object" && esColumna(ordenCrudo.columna)
      ? { columna: ordenCrudo.columna, direccion: ordenCrudo.direccion === "desc" ? "desc" : "asc" }
      : null;
  return {
    busqueda: textoCorto(crudo.busqueda, MAX_BUSQUEDA),
    filtros,
    orden,
    agrupar: esColumna(crudo.agrupar) ? crudo.agrupar : null,
  };
}

/** Lo guardado en AppSetting, limpio. Un valor ilegible empieza de cero (no deja la pantalla sin abrir). */
export function limpiarPreferencias(valor: unknown): PreferenciasDeVistas {
  let dato = valor;
  if (typeof dato === "string") {
    try {
      dato = JSON.parse(dato);
    } catch {
      return { ...PREFERENCIAS_INICIALES, guardadas: [] };
    }
  }
  if (typeof dato !== "object" || dato === null) return { ...PREFERENCIAS_INICIALES, guardadas: [] };
  const crudo = dato as Record<string, unknown>;
  const vistos = new Set<string>();
  const guardadas: VistaGuardada[] = Array.isArray(crudo.guardadas)
    ? crudo.guardadas
        .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
        .map((v) => ({ id: textoCorto(v.id, 60), nombre: textoCorto(v.nombre, MAX_NOMBRE_DE_VISTA), config: limpiarConfig(v.config) }))
        .filter((v) => v.id && v.nombre && !v.id.startsWith("fabrica:") && !vistos.has(v.id) && vistos.add(v.id))
        .slice(0, MAX_VISTAS_GUARDADAS)
    : [];
  return { ultimaVista: esVista(crudo.ultimaVista) ? crudo.ultimaVista : VISTA_POR_DEFECTO, guardadas };
}

/** Agrega (o reemplaza, si ya hay una con ese nombre) una vista guardada. Devuelve las preferencias nuevas. */
export function agregarVista(
  preferencias: PreferenciasDeVistas,
  nombre: unknown,
  config: unknown,
  nuevoId: string,
): PreferenciasDeVistas {
  const limpio = textoCorto(nombre, MAX_NOMBRE_DE_VISTA);
  if (!limpio) throw new Error("Ponle un nombre a la vista.");
  if (VISTAS_DE_FABRICA.some((vista) => normalizar(vista.nombre) === normalizar(limpio))) {
    throw new Error(`"${limpio}" ya es una vista de fábrica. Usa otro nombre.`);
  }
  const existente = preferencias.guardadas.find((vista) => normalizar(vista.nombre) === normalizar(limpio));
  const vista: VistaGuardada = { id: existente?.id ?? nuevoId, nombre: limpio, config: limpiarConfig(config) };
  const otras = preferencias.guardadas.filter((v) => v.id !== vista.id);
  if (!existente && otras.length >= MAX_VISTAS_GUARDADAS) {
    throw new Error(`Puedes guardar hasta ${MAX_VISTAS_GUARDADAS} vistas. Borra una antes de guardar otra.`);
  }
  return { ...preferencias, guardadas: [...otras, vista] };
}

/* ── El kanban (vista Tablero) ── */

/** Las columnas del kanban: una por estado que se mueve a mano, y una para lo que tiene el Coordinador. */
export const COLUMNA_COORDINADOR = "COORDINADOR" as const;
export type ColumnaKanban = EstadoTarjetaTablero | typeof COLUMNA_COORDINADOR;
export const COLUMNAS_KANBAN: readonly ColumnaKanban[] = [
  "IDEA",
  "POR_APROBAR",
  "APROBADO",
  "EN_CURSO",
  "HECHO",
  "FALLIDO",
  COLUMNA_COORDINADOR,
];
export const NOMBRE_COLUMNA_COORDINADOR = "Con el Coordinador";

export function nombreDeColumnaKanban(columna: ColumnaKanban): string {
  return columna === COLUMNA_COORDINADOR ? NOMBRE_COLUMNA_COORDINADOR : NOMBRE_DEL_ESTADO[columna];
}

/** En qué columna del kanban va un estado (los de la fase 2 se juntan en "Con el Coordinador"). */
export function columnaKanbanDe(estado: EstadoTarjetaTablero): ColumnaKanban {
  return (ESTADOS_DE_LA_FASE_2 as readonly string[]).includes(estado) ? COLUMNA_COORDINADOR : estado;
}

/** Las filas del kanban por columna (las carpetas, sin estado, no van). */
export function filasPorColumnaKanban(filas: readonly FilaDeTabla[]): Map<ColumnaKanban, FilaDeTabla[]> {
  const columnas = new Map<ColumnaKanban, FilaDeTabla[]>(COLUMNAS_KANBAN.map((columna) => [columna, []]));
  for (const fila of filas) {
    if (!fila.estado) continue;
    columnas.get(columnaKanbanDe(fila.estado))?.push(fila);
  }
  return columnas;
}

/**
 * ¿Se puede soltar la fila en esa columna? null si sí; si no, el motivo de la regla (el mismo que da el
 * servidor). "Con el Coordinador" nunca recibe tarjetas: esos estados los pone solo el Coordinador.
 */
export function motivoParaSoltar(fila: FilaDeTabla, destino: ColumnaKanban): string | null {
  if (!fila.estado) return "Las carpetas (como Área) no tienen estado.";
  if (destino === COLUMNA_COORDINADOR) {
    return "Esa columna es del Coordinador: esos estados los pone solo él.";
  }
  return (
    puedeCambiarEstado(fila.estado, destino, fila.requiereAprobacion, fila.usaEstados, fila.conRepo) ??
    estadoPermitidoParaTipo(destino, fila.requiereAprobacion, fila.usaEstados)
  );
}

/**
 * Los estados que ofrece el menú de Estado de una fila (sin el actual): solo los que la regla deja.
 * Aprobar nunca sale acá: se hace con el botón de la tarjeta.
 */
export function estadosPermitidos(fila: FilaDeTabla): EstadoTarjetaTablero[] {
  if (!fila.estado) return [];
  const actual = fila.estado;
  return ESTADOS_TARJETA.filter(
    (estado) =>
      estado !== actual &&
      puedeCambiarEstado(actual, estado, fila.requiereAprobacion, fila.usaEstados, fila.conRepo) === null &&
      estadoPermitidoParaTipo(estado, fila.requiereAprobacion, fila.usaEstados) === null,
  );
}

/** Por qué una fila no deja cambiar el estado (null si tiene al menos un cambio permitido). */
export function motivoSinCambios(fila: FilaDeTabla): string | null {
  if (!fila.estado) return "Las carpetas (como Área) no tienen estado.";
  if (estadosPermitidos(fila).length) return null;
  // El motivo de la regla para el cambio más común (a FALLIDO), que explica el candado del Coordinador.
  return (
    puedeCambiarEstado(fila.estado, "FALLIDO", fila.requiereAprobacion, fila.usaEstados, fila.conRepo) ??
    "Esta tarjeta no tiene cambios de estado permitidos desde acá."
  );
}

/* ── El calendario ── */

/** Las filas con fecha por día ("AAAA-MM-DD") y las que no tienen fecha. */
export function filasPorDia(filas: readonly FilaDeTabla[]): { porDia: Map<string, FilaDeTabla[]>; sinFecha: FilaDeTabla[] } {
  const porDia = new Map<string, FilaDeTabla[]>();
  const sinFecha: FilaDeTabla[] = [];
  for (const fila of filas) {
    if (!fila.fecha) {
      sinFecha.push(fila);
      continue;
    }
    const lista = porDia.get(fila.fecha) ?? [];
    lista.push(fila);
    porDia.set(fila.fecha, lista);
  }
  return { porDia, sinFecha };
}
