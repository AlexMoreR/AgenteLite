/*
  REGLAS DEL TABLERO IA (tableros inteligentes; fase 1, 19-oct-2026).

  Funciones puras, sin base ni Next, para poder probarlas (scripts/check-tableros-reglas.mjs). El
  servicio (tableros.ts) las llama antes de escribir; el MCP y la pantalla pasan por el servicio.

  Lo que no se negocia:
  1. Nadie pone APROBADO moviendo el estado. Aprobar es su propia acción, solo desde POR_APROBAR y
     nunca desde el MCP: lo hace el dueño (o el ADMIN de la plataforma) en la pantalla.
  2. Lo que no está aprobado no se ejecuta: EN_CURSO solo sale de APROBADO, y HECHO/FALLIDO solo de
     APROBADO o EN_CURSO. Si no, pasar de IDEA a EN_CURSO sería aprobar por la puerta de atrás.
  3. Si Claude edita una tarjeta APROBADA, vuelve a POR_APROBAR: el dueño aprobó ese texto, no otro.
  4. Deshacer nunca deja ni quita un APROBADO, nunca toca un cambio hecho en la pantalla y se niega
     si después hubo otro cambio sobre lo mismo (como deshacer_cambio del resto del MCP).

  5. TIPOS DE TARJETA (Área, Idea, Tarea... configurables por tablero). Solo las de un tipo que
     `requiereAprobacion` pasan por POR_APROBAR y APROBADO; las otras van IDEA / EN_CURSO / HECHO /
     FALLIDO libremente (no hay aprobación que saltarse). Cambiar el tipo de una tarjeta la deja
     POR_APROBAR (si el tipo nuevo pide aprobación) o IDEA (si no): pierde la aprobación que tuviera.
     Claude puede crear y editar tipos, pero NO quitarles la aprobación (eso solo el dueño en la
     pantalla), y nadie se la quita a un tipo con tarjetas APROBADAS o EN_CURSO.
  5b. TIPOS SIN ESTADOS (`usaEstados` = false, como Área): son carpetas. Sus tarjetas no tienen
     estado (en la base queda IDEA, que nunca se muestra), no se aprueban, el trabajador nunca las
     toma, cambiar_estado_tarjeta las rechaza y no cuentan en filtros, contadores ni "Te toca a ti".
     Un tipo sin estados tampoco pide aprobación.
  6. TARJETA MADRE: una tarjeta cuelga de otra del mismo tablero solo si el tipo de la madre está
     entre las madres permitidas del tipo de la hija, y nunca en ciclo.
  7. BORRAR es suave (borradoEn) y se deshace con sus flechas. Claude no borra lo APROBADO ni lo
     EN_CURSO.

  Fase 2 (sin implementar): el trabajador que ejecuta lo APROBADO usa origen TRABAJADOR y estas
  mismas transiciones (APROBADO -> EN_CURSO -> HECHO | FALLIDO), solo con tarjetas de un tipo que
  requiere aprobación. Aprobar por WhatsApp respondiendo "sí" pasará por `puedeAprobar` con su
  propio origen.
*/

export const ESTADOS_TARJETA = ["IDEA", "POR_APROBAR", "APROBADO", "EN_CURSO", "HECHO", "FALLIDO"] as const;
export type EstadoTarjetaTablero = (typeof ESTADOS_TARJETA)[number];

/** Los que Claude puede poner con cambiar_estado_tarjeta (todos menos APROBADO). */
export const ESTADOS_SIN_APROBAR = ESTADOS_TARJETA.filter(
  (estado): estado is Exclude<EstadoTarjetaTablero, "APROBADO"> => estado !== "APROBADO",
);

/** Con los que Claude puede crear una tarjeta. */
export const ESTADOS_AL_CREAR = ["IDEA", "POR_APROBAR"] as const;

export const ORIGENES = ["MCP", "PANTALLA", "TRABAJADOR"] as const;
export type OrigenCambio = (typeof ORIGENES)[number];

export const ACCIONES = ["crear", "editar", "estado", "conectar", "aprobar", "borrar", "deshacer"] as const;
export type AccionCambio = (typeof ACCIONES)[number];

export const NOMBRE_DEL_ESTADO: Record<EstadoTarjetaTablero, string> = {
  IDEA: "Idea",
  POR_APROBAR: "Por aprobar",
  APROBADO: "Aprobado",
  EN_CURSO: "En curso",
  HECHO: "Hecho",
  FALLIDO: "Fallido",
};

export function esEstado(valor: unknown): valor is EstadoTarjetaTablero {
  return typeof valor === "string" && (ESTADOS_TARJETA as readonly string[]).includes(valor);
}

/** Resultado de una regla: null si se puede, o el porqué en palabras para quien lo pidió. */
export type Veredicto = string | null;

/** Los estados que puede tener una tarjeta de un tipo que NO pide aprobación. */
export const ESTADOS_SIN_APROBACION = ["IDEA", "EN_CURSO", "HECHO", "FALLIDO"] as const;

/** Lo que se dice cuando se le quiere poner estado a una tarjeta de un tipo sin estados. */
export const SIN_ESTADOS = "Las tarjetas de ese tipo (como Área) son carpetas: no tienen estado ni se aprueban.";

/** ¿Puede una tarjeta de un tipo con (o sin) aprobación, con (o sin) estados, estar en `estado`? */
export function estadoPermitidoParaTipo(
  estado: EstadoTarjetaTablero,
  requiereAprobacion: boolean,
  usaEstados = true,
): Veredicto {
  if (!usaEstados) return estado === "IDEA" ? null : SIN_ESTADOS;
  if (!requiereAprobacion && (estado === "POR_APROBAR" || estado === "APROBADO")) {
    return "Ese tipo de tarjeta no pide aprobación: no pasa por POR_APROBAR ni APROBADO. Van IDEA, EN_CURSO, HECHO o FALLIDO.";
  }
  return null;
}

/**
 * ¿Se puede mover la tarjeta de `de` a `a` con un cambio de estado común (no una aprobación)?
 * `requiereAprobacion` es el de su tipo (por defecto sí, como antes de que hubiera tipos).
 */
export function puedeCambiarEstado(
  de: EstadoTarjetaTablero,
  a: EstadoTarjetaTablero,
  requiereAprobacion = true,
  usaEstados = true,
): Veredicto {
  if (!usaEstados) return SIN_ESTADOS;
  if (!requiereAprobacion) {
    if (de === a) return `La tarjeta ya está en ${a}.`;
    return estadoPermitidoParaTipo(a, false);
  }
  if (a === "APROBADO") {
    return "Aprobar lo hace solo el dueño, con el botón Aprobar de la pantalla. Lo más que se puede es dejarla POR_APROBAR.";
  }
  if (de === a) {
    return `La tarjeta ya está en ${a}.`;
  }
  if (a === "EN_CURSO" && de !== "APROBADO") {
    return "Solo se pone EN_CURSO una tarjeta APROBADA. Primero hay que dejarla POR_APROBAR y que el dueño la apruebe.";
  }
  if ((a === "HECHO" || a === "FALLIDO") && de !== "APROBADO" && de !== "EN_CURSO") {
    return `Solo se marca ${a} algo que estaba APROBADO o EN_CURSO. Primero hay que dejarla POR_APROBAR y que el dueño la apruebe.`;
  }
  return null;
}

/**
 * ¿Se puede aprobar? Solo desde POR_APROBAR y nunca desde el MCP. Quién es el dueño lo comprueba
 * quien llama (la server action de la pantalla), porque depende de la sesión.
 */
export function puedeAprobar(
  origen: OrigenCambio,
  estado: EstadoTarjetaTablero,
  requiereAprobacion = true,
  usaEstados = true,
): Veredicto {
  if (origen === "MCP") {
    return "Claude no puede aprobar. Aprobar lo hace solo el dueño en la pantalla.";
  }
  if (!requiereAprobacion || !usaEstados) {
    return "Ese tipo de tarjeta no pide aprobación: no hay nada que aprobar.";
  }
  if (estado === "APROBADO") {
    return "La tarjeta ya está aprobada.";
  }
  if (estado !== "POR_APROBAR") {
    return "Solo se aprueba una tarjeta que está POR_APROBAR.";
  }
  return null;
}

/** El estado con que queda una tarjeta después de editarle algo. */
export function estadoTrasEditar(origen: OrigenCambio, estado: EstadoTarjetaTablero): EstadoTarjetaTablero {
  return origen !== "PANTALLA" && estado === "APROBADO" ? "POR_APROBAR" : estado;
}

/** El estado con que queda una tarjeta al cambiarle el tipo: pierde la aprobación que tuviera. */
export function estadoTrasCambiarTipo(requiereAprobacionNuevo: boolean, usaEstadosNuevo = true): EstadoTarjetaTablero {
  return requiereAprobacionNuevo && usaEstadosNuevo ? "POR_APROBAR" : "IDEA";
}

/**
 * El estado con que nace una tarjeta: IDEA por defecto; POR_APROBAR solo si su tipo pide aprobación.
 * Un tipo sin estados siempre nace IDEA (interno): pedirle otro estado es un error claro.
 */
export function estadoAlCrear(estado: unknown, requiereAprobacion: boolean, usaEstados = true): EstadoTarjetaTablero {
  const pedido = estado === undefined || estado === null || estado === "" ? "IDEA" : estado;
  if (!usaEstados) {
    if (pedido !== "IDEA") throw new Error(SIN_ESTADOS);
    return "IDEA";
  }
  if (!(ESTADOS_AL_CREAR as readonly unknown[]).includes(pedido)) {
    throw new Error("Una tarjeta nueva queda IDEA o POR_APROBAR. Aprobar lo hace solo el dueño en la pantalla.");
  }
  const veredicto = estadoPermitidoParaTipo(pedido as EstadoTarjetaTablero, requiereAprobacion);
  if (veredicto) throw new Error(veredicto);
  return pedido as EstadoTarjetaTablero;
}

/** Lo mínimo de una fila del historial que hace falta para decidir si se deshace. */
export type CambioParaDeshacer = {
  id: string;
  accion: string;
  origen: string;
  creadoEn: Date;
  deshechoEn: Date | null;
  antes: unknown;
  despues: unknown;
};

/** Qué toca un cambio: los campos de la tarjeta, una conexión puntual o todo (crear / borrar). */
function loQueToca(cambio: Pick<CambioParaDeshacer, "accion" | "despues" | "antes">): string {
  if (cambio.accion === "crear" || cambio.accion === "borrar") return "todo";
  if (cambio.accion === "conectar") {
    const datos = (cambio.despues ?? cambio.antes) as { conexionId?: unknown } | null;
    return `conexion:${typeof datos?.conexionId === "string" ? datos.conexionId : "?"}`;
  }
  return "campos";
}

function estadoEn(valor: unknown): EstadoTarjetaTablero | null {
  if (!valor || typeof valor !== "object") return null;
  const estado = (valor as { estado?: unknown }).estado;
  return esEstado(estado) ? estado : null;
}

/**
 * ¿Se puede deshacer `cambio`? `posteriores` son los cambios de la MISMA tarjeta hechos después
 * (con o sin deshacer: acá se filtran). `estadoActual` es el de la tarjeta hoy.
 */
export function puedeDeshacer(
  cambio: CambioParaDeshacer,
  posteriores: CambioParaDeshacer[],
  estadoActual: EstadoTarjetaTablero,
): Veredicto {
  if (cambio.deshechoEn) {
    return "Ese cambio ya se deshizo.";
  }
  if (cambio.accion === "deshacer") {
    return "Un deshacer no se deshace. Si hace falta, se vuelve a hacer el cambio.";
  }
  if (cambio.accion === "aprobar" || cambio.origen === "PANTALLA") {
    return "Ese cambio lo hizo el dueño en la pantalla (por ejemplo, una aprobación): no se deshace desde acá.";
  }

  const toca = loQueToca(cambio);
  const pisado = posteriores.some(
    (otro) =>
      otro.id !== cambio.id &&
      otro.creadoEn.getTime() >= cambio.creadoEn.getTime() &&
      !otro.deshechoEn &&
      otro.accion !== "deshacer" &&
      (toca === "todo" || loQueToca(otro) === "todo" || loQueToca(otro) === toca),
  );
  if (pisado) {
    return "Después hubo otro cambio sobre lo mismo. Hay que deshacer primero el más nuevo (ver ver_historial_tarjeta).";
  }

  if (cambio.accion === "crear") {
    if (estadoActual === "APROBADO") {
      return "La tarjeta está APROBADA: no se borra deshaciendo.";
    }
    return null;
  }
  if (cambio.accion === "borrar") {
    // Vuelve con el estado que tenía, que nunca es APROBADO (Claude no borra lo aprobado).
    if (estadoActual === "APROBADO") {
      return "Esa tarjeta estaba APROBADA: deshacer no devuelve una aprobación. Pídele al dueño que la revise.";
    }
    return null;
  }

  // Lo que quedaría en estado al restaurar el "antes".
  const estadoRestaurado = estadoEn(cambio.antes);
  if (estadoRestaurado && estadoRestaurado !== estadoActual) {
    if (estadoRestaurado === "APROBADO") {
      return "Deshacer eso dejaría la tarjeta APROBADA, y aprobar lo hace solo el dueño. Si hace falta el texto anterior, se edita de nuevo y queda POR_APROBAR.";
    }
    if (estadoActual === "APROBADO") {
      return "La tarjeta está APROBADA: deshacer no le quita la aprobación.";
    }
  }
  return null;
}

/** Texto limpio, o undefined si no vino (o vino vacío cuando no se permite). */
export function textoLimpio(valor: unknown, maximo: number): string | undefined {
  if (typeof valor !== "string") return undefined;
  const limpio = valor.trim();
  return limpio ? limpio.slice(0, maximo) : undefined;
}

/**
 * Una fecha como la manda Claude: "AAAA-MM-DD" (se guarda a mediodía de Colombia para que no
 * cambie de día al mostrarla) o un ISO completo. "" o null la borran. Undefined = no vino.
 */
export function fechaDeEntrada(valor: unknown): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === "") return null;
  if (typeof valor !== "string") {
    throw new Error("La fecha va como texto AAAA-MM-DD.");
  }
  const texto = valor.trim();
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(texto) ? new Date(`${texto}T12:00:00-05:00`) : new Date(texto);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`No entendí la fecha "${texto}". Va como AAAA-MM-DD.`);
  }
  return fecha;
}

/**
 * ¿Esta persona puede apretar Aprobar? El dueño del negocio o el ADMIN de la plataforma (lo mismo
 * que deja pasar `requireClientWorkspaceAccess(..., { ownerOnly: true })`). Una asesora o una
 * administradora del negocio, no.
 */
export function personaPuedeAprobar(acceso: { isOwner: boolean; role: string }): boolean {
  return acceso.isOwner || acceso.role === "ADMIN";
}

/* ───────────────────────────────────────────────────────────────────── tipos de tarjeta ── */

/** Los íconos que puede tener un tipo (la pantalla los dibuja con lucide; ver IconoDeTipo.tsx). */
export const ICONOS_DE_TIPO = [
  "capas",
  "bombillo",
  "chulo",
  "bandera",
  "objetivo",
  "estrella",
  "cohete",
  "persona",
  "dinero",
  "herramienta",
  "megafono",
  "carpeta",
  "documento",
  "calendario",
  "alerta",
  "corazon",
] as const;
export type IconoDeTipo = (typeof ICONOS_DE_TIPO)[number];

export function esIconoDeTipo(valor: unknown): valor is IconoDeTipo {
  return typeof valor === "string" && (ICONOS_DE_TIPO as readonly string[]).includes(valor);
}

/**
 * Los 3 tipos con que nace cada tablero (los mismos que dejó la migración en los que ya había). Área
 * es una carpeta (sin estados) y puede ir dentro de otra Área ("Magilus > Ventas").
 */
export const TIPOS_POR_DEFECTO: readonly {
  nombre: string;
  color: string;
  icono: IconoDeTipo;
  requiereAprobacion: boolean;
  usaEstados: boolean;
  orden: number;
  padres: readonly string[];
}[] = [
  { nombre: "Área", color: "#6366f1", icono: "capas", requiereAprobacion: false, usaEstados: false, orden: 0, padres: ["Área"] },
  { nombre: "Idea", color: "#eab308", icono: "bombillo", requiereAprobacion: false, usaEstados: true, orden: 1, padres: ["Área"] },
  { nombre: "Tarea", color: "#0ea5e9", icono: "chulo", requiereAprobacion: true, usaEstados: true, orden: 2, padres: ["Idea"] },
];

/** Color "#rrggbb" en minúsculas, o undefined si no vino. Basura = error. */
export function colorDeEntrada(valor: unknown): string | undefined {
  if (valor === undefined || valor === null || valor === "") return undefined;
  if (typeof valor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(valor.trim())) {
    throw new Error('El color va en hex, por ejemplo "#0ea5e9".');
  }
  return valor.trim().toLowerCase();
}

/** Ícono de la lista, null para quitarlo ("" o null), undefined si no vino. */
export function iconoDeEntrada(valor: unknown): IconoDeTipo | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === "") return null;
  const limpio = typeof valor === "string" ? valor.trim().toLowerCase() : valor;
  if (!esIconoDeTipo(limpio)) {
    throw new Error(`Ese ícono no existe. Van: ${ICONOS_DE_TIPO.join(", ")}.`);
  }
  return limpio;
}

/**
 * ¿Se puede cambiar `requiereAprobacion` de un tipo? Prenderla siempre se puede. Apagarla: nunca desde
 * el MCP (solo el dueño en la pantalla), y nunca si hay tarjetas del tipo APROBADAS o EN_CURSO.
 */
export function puedeCambiarAprobacionDelTipo(
  origen: OrigenCambio,
  antes: boolean,
  despues: boolean,
  aprobadasOEnCurso: number,
): Veredicto {
  if (antes === despues || despues) return null;
  if (origen !== "PANTALLA") {
    return "Claude no puede quitarle la aprobación a un tipo: eso lo decide el dueño en la pantalla (panel Tipos).";
  }
  if (aprobadasOEnCurso > 0) {
    return `Hay ${aprobadasOEnCurso} tarjeta(s) de este tipo APROBADAS o EN_CURSO: mientras estén así, el tipo sigue pidiendo aprobación.`;
  }
  return null;
}

/**
 * ¿Se puede cambiar `usaEstados` de un tipo? Prenderlo siempre (sus tarjetas arrancan IDEA). Apagarlo
 * borra los estados de sus tarjetas: desde el MCP solo si todas están IDEA (no se pierde nada); en la
 * pantalla, nunca con tarjetas APROBADAS o EN_CURSO. Un tipo sin estados no puede pedir aprobación.
 */
export function puedeCambiarEstadosDelTipo(
  origen: OrigenCambio,
  antes: boolean,
  despues: boolean,
  conEstado: { aprobadasOEnCurso: number; noIdea: number },
  requiereAprobacionFinal: boolean,
): Veredicto {
  if (!despues && requiereAprobacionFinal) {
    return "Un tipo sin estados no puede pedir aprobación: primero hay que quitarle la aprobación.";
  }
  if (antes === despues || despues) return null;
  if (conEstado.aprobadasOEnCurso > 0) {
    return `Hay ${conEstado.aprobadasOEnCurso} tarjeta(s) de este tipo APROBADAS o EN_CURSO: el tipo no puede quedar sin estados.`;
  }
  if (origen !== "PANTALLA" && conEstado.noIdea > 0) {
    return `Hay ${conEstado.noIdea} tarjeta(s) de este tipo con estado: quitarle los estados lo decide el dueño en la pantalla.`;
  }
  return null;
}

/** Borrar un tipo: solo en la pantalla y solo si ninguna tarjeta lo usa (ni una borrada que se puede deshacer). */
export function puedeBorrarTipo(origen: OrigenCambio, tarjetasQueLoUsan: number): Veredicto {
  if (origen !== "PANTALLA") return "Los tipos se borran solo en la pantalla.";
  if (tarjetasQueLoUsan > 0) {
    return `Lo usan ${tarjetasQueLoUsan} tarjeta(s) (contando las borradas que se pueden deshacer). Primero cámbiales el tipo.`;
  }
  return null;
}

/* ───────────────────────────────────────────────────────────────────── tarjeta madre ── */

/** tipoId de la hija -> tipoIds que pueden ser su madre. */
export type MadresPermitidas = ReadonlyMap<string, ReadonlySet<string>>;

export type TarjetaParaJerarquia = { id: string; tipoId: string; tableroId: string };

/**
 * ¿Puede `hija` colgar de `madre`? Mismo tablero, el tipo de la madre entre los permitidos del tipo
 * de la hija, y sin ciclos. `madreDe` es el padreId de cada tarjeta del tablero (sin las borradas).
 * `nombreDelTipo` es solo para los mensajes.
 */
export function puedeColgar(
  hija: TarjetaParaJerarquia,
  madre: TarjetaParaJerarquia,
  permitidas: MadresPermitidas,
  madreDe: ReadonlyMap<string, string | null>,
  nombreDelTipo: ReadonlyMap<string, string> = new Map(),
): Veredicto {
  if (hija.id === madre.id) return "Una tarjeta no puede ser madre de sí misma.";
  // (El tipo sí puede ser madre de sí mismo, si está permitido: Área dentro de Área.)
  if (hija.tableroId !== madre.tableroId) return "La tarjeta madre tiene que ser del mismo tablero.";
  if (!permitidas.get(hija.tipoId)?.has(madre.tipoId)) {
    const tipoHija = nombreDelTipo.get(hija.tipoId) ?? "ese tipo";
    const tipoMadre = nombreDelTipo.get(madre.tipoId) ?? "ese otro tipo";
    const validas = [...(permitidas.get(hija.tipoId) ?? [])].map((id) => nombreDelTipo.get(id) ?? id);
    return `Una tarjeta de tipo ${tipoHija} no puede colgar de una de tipo ${tipoMadre}. ${
      validas.length ? `Puede colgar de: ${validas.join(", ")}.` : "Ese tipo no admite madre (ver listar_tipos)."
    }`;
  }
  // Subiendo desde la madre no se puede llegar a la hija.
  const vistas = new Set<string>();
  let actual: string | null = madre.id;
  while (actual) {
    if (actual === hija.id) return "Eso haría un ciclo: la madre ya cuelga (directa o indirectamente) de esa tarjeta.";
    if (vistas.has(actual)) break;
    vistas.add(actual);
    actual = madreDe.get(actual) ?? null;
  }
  return null;
}

/** Al cambiar el tipo de una tarjeta, ¿alguna de sus hijas quedaría colgando de un tipo no permitido? */
export function hijasQueQuedanMal(
  tipoNuevoId: string,
  hijas: { id: string; tipoId: string; titulo: string }[],
  permitidas: MadresPermitidas,
): Veredicto {
  const malas = hijas.filter((hija) => !permitidas.get(hija.tipoId)?.has(tipoNuevoId));
  if (!malas.length) return null;
  const nombres = malas
    .slice(0, 5)
    .map((hija) => `"${hija.titulo}"`)
    .join(", ");
  return `No se puede: ${malas.length} hija(s) (${nombres}${malas.length > 5 ? "..." : ""}) no pueden colgar de una tarjeta de ese tipo. Primero muévelas o cámbiales el tipo.`;
}

/* ───────────────────────────────────────────────────────────────────── borrar y links ── */

/** ¿Se puede borrar la tarjeta? Claude no borra lo APROBADO ni lo EN_CURSO. */
export function puedeBorrarTarjeta(origen: OrigenCambio, estado: EstadoTarjetaTablero): Veredicto {
  if (origen !== "PANTALLA" && (estado === "APROBADO" || estado === "EN_CURSO")) {
    return `La tarjeta está ${estado}: Claude no la borra. Pídele al dueño que decida qué hacer con ella.`;
  }
  return null;
}

/** Un link http(s), null para quitarlo ("" o null), undefined si no vino. */
export function linkDeEntrada(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || (typeof valor === "string" && valor.trim() === "")) return null;
  if (typeof valor !== "string") throw new Error("El link va como texto: https://...");
  const texto = valor.trim();
  if (texto.length > 2000) throw new Error("El link es demasiado largo (máximo 2000 caracteres).");
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new Error(`"${texto.slice(0, 80)}" no es un link. Va completo: https://...`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Solo se aceptan links http:// o https://.");
  }
  return texto;
}

/** Lo que dice el botón del link: el texto que se le puso o, si no, el dominio. */
export function textoDelLink(link: string, linkTexto: string | null): string {
  if (linkTexto && linkTexto.trim()) return linkTexto.trim();
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

/* ───────────────────────────────────────────────────────────────────── elegir un tipo ── */

/** Para comparar nombres de tipo sin mayúsculas ni tildes ("area" = "Área"). */
export function claveDeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export type TipoParaElegir = { id: string; nombre: string; requiereAprobacion: boolean; orden: number };

/**
 * El tipo que pidió Claude (por id o por nombre). Sin tipo: "Idea"; si no hay un tipo llamado Idea,
 * el primero sin aprobación por orden; si tampoco, error claro.
 */
export function elegirTipo<T extends TipoParaElegir>(tipos: readonly T[], pedido: unknown): T {
  const ordenados = [...tipos].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
  const texto = typeof pedido === "string" ? pedido.trim() : "";
  if (pedido !== undefined && pedido !== null && typeof pedido !== "string") {
    throw new Error("El tipo va como texto: su nombre o su id (ver listar_tipos).");
  }
  if (!texto) {
    const idea = ordenados.find((tipo) => claveDeNombre(tipo.nombre) === "idea");
    const sinAprobacion = idea ?? ordenados.find((tipo) => !tipo.requiereAprobacion);
    if (!sinAprobacion) {
      throw new Error(
        `Este tablero no tiene un tipo "Idea" ni otro sin aprobación. Di el tipo de la tarjeta: ${ordenados
          .map((tipo) => tipo.nombre)
          .join(", ")}.`,
      );
    }
    return sinAprobacion;
  }
  const porId = ordenados.find((tipo) => tipo.id === texto);
  if (porId) return porId;
  const clave = claveDeNombre(texto);
  const porNombre = ordenados.find((tipo) => claveDeNombre(tipo.nombre) === clave);
  if (porNombre) return porNombre;
  throw new Error(
    `No existe el tipo "${texto}" en este tablero. Van: ${ordenados.map((tipo) => tipo.nombre).join(", ")} (ver listar_tipos).`,
  );
}
