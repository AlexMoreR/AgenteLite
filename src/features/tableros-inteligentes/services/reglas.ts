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

  Fase 2 (sin implementar): el trabajador que ejecuta lo APROBADO usa origen TRABAJADOR y estas
  mismas transiciones (APROBADO -> EN_CURSO -> HECHO | FALLIDO). Aprobar por WhatsApp respondiendo
  "sí" pasará por `puedeAprobar` con su propio origen.
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

export const ACCIONES = ["crear", "editar", "estado", "conectar", "aprobar", "deshacer"] as const;
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

/**
 * ¿Se puede mover la tarjeta de `de` a `a` con un cambio de estado común (no una aprobación)?
 */
export function puedeCambiarEstado(de: EstadoTarjetaTablero, a: EstadoTarjetaTablero): Veredicto {
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
export function puedeAprobar(origen: OrigenCambio, estado: EstadoTarjetaTablero): Veredicto {
  if (origen === "MCP") {
    return "Claude no puede aprobar. Aprobar lo hace solo el dueño en la pantalla.";
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

/** Qué toca un cambio: los campos de la tarjeta o una conexión puntual. */
function loQueToca(cambio: Pick<CambioParaDeshacer, "accion" | "despues" | "antes">): string {
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
      (cambio.accion === "crear" || loQueToca(otro) === toca),
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
