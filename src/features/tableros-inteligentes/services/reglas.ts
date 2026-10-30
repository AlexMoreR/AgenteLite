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
     estado (en la base queda IDEA, que nunca se muestra), no se aprueban, el Coordinador nunca las
     toma, cambiar_estado_tarjeta las rechaza y no cuentan en filtros, contadores ni "Te toca a ti".
     Un tipo sin estados tampoco pide aprobación.
  6. TARJETA MADRE: una tarjeta cuelga de otra del mismo tablero solo si el tipo de la madre está
     entre las madres permitidas del tipo de la hija, y nunca en ciclo.
  7. BORRAR es suave (borradoEn) y se deshace con sus flechas. Claude no borra lo APROBADO ni lo
     EN_CURSO.

  8. FASE 2 (20-oct-2026): EL TRABAJADOR. Las tarjetas de un tipo con aprobación y con `repo` las
     ejecuta el Coordinador (un PC aparte): APROBADO -> PLANEANDO -> PLAN_LISTO -> (aprobar plan)
     PLAN_APROBADO -> EN_CURSO -> POR_REVISAR -> (sí final del dueño) SUBIENDO -> HECHO, o ERROR con
     motivo. Esas transiciones solo las hace el Coordinador con su clave (services/trabajador.ts);
     cambiar_estado_tarjeta del MCP no pone ninguno de esos estados, ni APROBADO ni PLAN_APROBADO.
     Aprobar (la tarea, el plan, el sí final) es SIEMPRE su propia acción, con sus reglas en
     reglas-trabajador.ts: desde la pantalla, o por el MCP con aprobar_tarjeta y la confirmación
     explícita de la persona ("sí, apruebo"). Las tarjetas SIN repo siguen como en la fase 1
     (APROBADO -> EN_CURSO -> HECHO | FALLIDO a mano).

  9. HECHO A MANO (22-oct-2026): una tarjeta con repo en ERROR, FALLIDO o POR_REVISAR cuyo cambio se
     terminó por fuera del Coordinador (por ejemplo, lo subió Claude Code a mano) la marca HECHO el
     dueño, con una nota obligatoria y el commit opcional (puedeMarcarHechoAMano, reglas-trabajador.ts).
     Es una regla aparte: puedeCambiarEstado NO cambia y sigue negando el HECHO en tarjetas con repo.
*/

export const ESTADOS_TARJETA = [
  "IDEA",
  "POR_APROBAR",
  "APROBADO",
  "EN_CURSO",
  "HECHO",
  "FALLIDO",
  "PLANEANDO",
  "PLAN_LISTO",
  "PLAN_APROBADO",
  "POR_REVISAR",
  "SUBIENDO",
  "ERROR",
] as const;
export type EstadoTarjetaTablero = (typeof ESTADOS_TARJETA)[number];

/** Los que agregó la fase 2: solo existen en tarjetas que ejecuta el Coordinador. */
export const ESTADOS_DE_LA_FASE_2 = ["PLANEANDO", "PLAN_LISTO", "PLAN_APROBADO", "POR_REVISAR", "SUBIENDO", "ERROR"] as const;

/** Los que el Coordinador tiene "en las manos" (con candado): nadie más los toca mientras tanto. */
export const ESTADOS_TRABAJANDO = ["PLANEANDO", "EN_CURSO", "SUBIENDO"] as const;

const esDeLaFase2 = (estado: EstadoTarjetaTablero) => (ESTADOS_DE_LA_FASE_2 as readonly string[]).includes(estado);

/**
 * Los que Claude puede poner con cambiar_estado_tarjeta: IDEA, POR_APROBAR, EN_CURSO, HECHO y FALLIDO.
 * Nunca APROBADO ni ninguno de la fase 2 (esos los pone la aprobación o el Coordinador).
 */
export const ESTADOS_SIN_APROBAR = ESTADOS_TARJETA.filter(
  (estado): estado is "IDEA" | "POR_APROBAR" | "EN_CURSO" | "HECHO" | "FALLIDO" =>
    estado !== "APROBADO" && !esDeLaFase2(estado),
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
  PLANEANDO: "Planeando",
  PLAN_LISTO: "Plan listo",
  PLAN_APROBADO: "Plan aprobado",
  POR_REVISAR: "Por revisar",
  SUBIENDO: "Subiendo",
  ERROR: "Error",
};

/** Código corto de la tarjeta para mostrar: 123 -> "T-123" (sin número, vacío). */
export function codigoDeTarjeta(numero: number | null | undefined): string {
  if (typeof numero !== "number" || !Number.isFinite(numero)) return "";
  return `T-${Math.trunc(numero)}`;
}

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
  if (!requiereAprobacion && (estado === "POR_APROBAR" || estado === "APROBADO" || esDeLaFase2(estado))) {
    return "Ese tipo de tarjeta no pide aprobación: no pasa por POR_APROBAR ni APROBADO (ni por el Coordinador). Van IDEA, EN_CURSO, HECHO o FALLIDO.";
  }
  return null;
}

/** Lo que se dice cuando alguien que no es el Coordinador quiere poner un estado del Coordinador. */
export const SOLO_EL_TRABAJADOR =
  "Ese estado lo pone solo el Coordinador (PLANEANDO, PLAN_LISTO, EN_CURSO, POR_REVISAR, SUBIENDO, HECHO, ERROR en tarjetas con repo). Aprobar la tarea o el plan es aprobar_tarjeta.";

/** ¿El Coordinador tiene la tarjeta en las manos (PLANEANDO, EN_CURSO o SUBIENDO)? */
export function estaTrabajando(estado: EstadoTarjetaTablero) {
  return (ESTADOS_TRABAJANDO as readonly string[]).includes(estado);
}

/**
 * Los estados de una tarjeta con repo desde los que el dueño la puede marcar HECHO a mano (cuando el
 * cambio se terminó por fuera del Coordinador). Es una regla aparte (puedeMarcarHechoAMano en
 * reglas-trabajador.ts): puedeCambiarEstado sigue negando el HECHO en tarjetas con repo.
 */
export const ESTADOS_QUE_SE_MARCAN_HECHO_A_MANO = ["ERROR", "FALLIDO", "POR_REVISAR"] as const;

export function sePuedeMarcarHechoAMano(estado: EstadoTarjetaTablero) {
  return (ESTADOS_QUE_SE_MARCAN_HECHO_A_MANO as readonly string[]).includes(estado);
}

/** Cómo pedir el HECHO de una tarjeta con repo, para decirlo cuando se niega. */
export const COMO_MARCAR_HECHO_A_MANO =
  'Si el cambio ya se terminó por fuera del trabajador, el dueño la marca "hecha a mano" desde ERROR, FALLIDO o POR_REVISAR: en la pantalla con el botón "Marcar hecho a mano", o con cambiar_estado_tarjeta (estado HECHO) con texto_confirmacion (lo que dijo el dueño, por ejemplo "sí, márcala hecha") y una nota de qué se hizo.';

/**
 * ¿Se puede mover la tarjeta de `de` a `a` con un cambio de estado común (no una aprobación)?
 * `requiereAprobacion` es el de su tipo (por defecto sí, como antes de que hubiera tipos).
 */
export function puedeCambiarEstado(
  de: EstadoTarjetaTablero,
  a: EstadoTarjetaTablero,
  requiereAprobacion = true,
  usaEstados = true,
  /** true si la tarjeta tiene repo (la ejecuta el Coordinador). */
  conRepo = false,
): Veredicto {
  if (!usaEstados) return SIN_ESTADOS;
  if (esDeLaFase2(a)) return SOLO_EL_TRABAJADOR;
  if (!requiereAprobacion) {
    if (de === a) return `La tarjeta ya está en ${a}.`;
    return estadoPermitidoParaTipo(a, false);
  }
  if (a === "APROBADO") {
    return "Aprobar es su propia acción: el dueño en la pantalla, o aprobar_tarjeta con la confirmación explícita de la persona. Moviendo el estado, lo más que se puede es dejarla POR_APROBAR.";
  }
  // EN_CURSO de una tarjeta sin repo es el de la fase 1 (a mano): ese sí se mueve.
  if (estaTrabajando(de) && (conRepo || de !== "EN_CURSO")) {
    return `El Coordinador tiene esta tarjeta en este momento (${de}): no se le cambia el estado hasta que termine o falle.`;
  }
  if (de === a) {
    return `La tarjeta ya está en ${a}.`;
  }
  if (conRepo && (a === "EN_CURSO" || a === "HECHO")) {
    return `Las tarjetas con repo las ejecuta el trabajador: ${a} lo pone él. ${SOLO_EL_TRABAJADOR}${a === "HECHO" && sePuedeMarcarHechoAMano(de) ? ` ${COMO_MARCAR_HECHO_A_MANO}` : ""}`;
  }
  if (a === "EN_CURSO" && de !== "APROBADO") {
    return "Solo se pone EN_CURSO una tarjeta APROBADA. Primero hay que dejarla POR_APROBAR y que el dueño la apruebe.";
  }
  if (a === "HECHO" && de !== "APROBADO" && de !== "EN_CURSO") {
    return "Solo se marca HECHO algo que estaba APROBADO o EN_CURSO. Primero hay que dejarla POR_APROBAR y que el dueño la apruebe.";
  }
  // FALLIDO = se abandona: de algo aprobado (también de lo que dejó el trabajador: plan listo, por revisar, error).
  if (a === "FALLIDO" && de !== "APROBADO" && de !== "EN_CURSO" && !esDeLaFase2(de)) {
    return "Solo se marca FALLIDO algo que estaba APROBADO, EN_CURSO o en manos del Coordinador. Primero hay que dejarla POR_APROBAR y que el dueño la apruebe.";
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
  // Por el MCP se aprueba solo con aprobar_tarjeta y la confirmación de la persona (puedeAprobarMomento
  // en reglas-trabajador.ts); esta regla es la de la pantalla.
  if (origen === "MCP") {
    return "Claude no aprueba por su cuenta. Solo con aprobar_tarjeta, cuando la persona lo dijo explícitamente.";
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

/**
 * Los estados que vienen de una aprobación (la tarea, el plan o el sí final) o del Coordinador. Deshacer
 * nunca deja ni quita uno de estos, y editar algo en uno de ellos le hace perder la aprobación.
 */
export const ESTADOS_CON_APROBACION = ["APROBADO", ...ESTADOS_DE_LA_FASE_2] as const;

export function tieneAprobacion(estado: EstadoTarjetaTablero) {
  return (ESTADOS_CON_APROBACION as readonly string[]).includes(estado);
}

/**
 * El estado con que queda una tarjeta después de editarle algo. Si Claude edita algo aprobado (o que
 * dejó el trabajador: plan listo, por revisar, error), vuelve a POR_APROBAR: el dueño aprobó ese
 * texto, no otro.
 */
export function estadoTrasEditar(origen: OrigenCambio, estado: EstadoTarjetaTablero): EstadoTarjetaTablero {
  return origen !== "PANTALLA" && tieneAprobacion(estado) && !estaTrabajando(estado) ? "POR_APROBAR" : estado;
}

/** ¿Se puede editar? No mientras el Coordinador la tiene (PLANEANDO, EN_CURSO con repo, SUBIENDO). */
export function puedeEditarTarjeta(estado: EstadoTarjetaTablero, conRepo: boolean): Veredicto {
  if (estaTrabajando(estado) && (conRepo || estado !== "EN_CURSO")) {
    return `El Coordinador tiene esta tarjeta en este momento (${estado}): no se edita hasta que termine o falle.`;
  }
  return null;
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
  if (cambio.accion === "aprobar") {
    return "Esa es una aprobación (de la pantalla o confirmada por la persona): no se deshace. Si hace falta, se edita la tarjeta y vuelve a POR_APROBAR.";
  }
  if (cambio.origen === "PANTALLA") {
    return "Ese cambio lo hizo el dueño en la pantalla (por ejemplo, una aprobación): no se deshace desde acá.";
  }
  if (cambio.origen === "TRABAJADOR") {
    return "Ese cambio lo hizo el Coordinador (su plan, su resultado o un error): no se deshace desde acá.";
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

  // "APROBADA" acá es cualquier estado que vino de una aprobación o del Coordinador (ESTADOS_CON_APROBACION).
  if (cambio.accion === "crear") {
    if (tieneAprobacion(estadoActual)) {
      return `La tarjeta está ${estadoActual} (aprobada): no se borra deshaciendo.`;
    }
    return null;
  }
  if (cambio.accion === "borrar") {
    // Vuelve con el estado que tenía. Claude no borra lo aprobado, salvo PLAN_LISTO o ERROR por voz
    // del dueño: esas vuelven tal cual (con su plan o su error).
    if (tieneAprobacion(estadoActual) && !(seBorraPorVoz(estadoActual) && esBorradoPorVoz(cambio))) {
      return "Esa tarjeta estaba APROBADA: deshacer no devuelve una aprobación. Pídele al dueño que la revise.";
    }
    return null;
  }

  // Lo que quedaría en estado al restaurar el "antes".
  const estadoRestaurado = estadoEn(cambio.antes);
  if (estadoRestaurado && estadoRestaurado !== estadoActual) {
    if (tieneAprobacion(estadoRestaurado)) {
      return `Deshacer eso dejaría la tarjeta ${estadoRestaurado} (aprobada), y aprobar es su propia acción. Si hace falta el texto anterior, se edita de nuevo y queda POR_APROBAR.`;
    }
    if (tieneAprobacion(estadoActual)) {
      return `La tarjeta está ${estadoActual} (aprobada): deshacer no le quita la aprobación.`;
    }
  }
  return null;
}

/** El nombre de un tablero: lo que cabe en la barra superior del celular. */
export const MAX_NOMBRE_TABLERO = 60;

/**
 * Qué tiene de malo el nombre de un tablero (vacío, muy largo o el de otro tablero del negocio, sin
 * mirar mayúsculas), o null si sirve. `salvo` es el tablero que se renombra. Lo usan el servicio y la
 * pantalla, así que dicen lo mismo.
 */
export function problemaDelNombreDeTablero(
  nombre: unknown,
  existentes: { id: string; nombre: string }[],
  salvo?: string | null,
): string | null {
  const limpio = typeof nombre === "string" ? nombre.trim() : "";
  if (!limpio) return "Hace falta el nombre del tablero.";
  if (limpio.length > MAX_NOMBRE_TABLERO) {
    return `El nombre del tablero puede tener hasta ${MAX_NOMBRE_TABLERO} letras (tiene ${limpio.length}).`;
  }
  const igual = existentes.find((tablero) => tablero.id !== salvo && tablero.nombre.toLowerCase() === limpio.toLowerCase());
  return igual ? `Ya existe un tablero "${igual.nombre}". Elige otro nombre.` : null;
}

/** Una persona que puede ser dueña de un tablero: un miembro activo del negocio. */
export type MiembroDelNegocio = { userId: string; nombre: string; email: string };

/**
 * El miembro que se pidió como dueño de un tablero: por su id, su email o su nombre (sin tildes ni
 * mayúsculas; si no hay uno igual, el único cuyo nombre lo contiene: "Emanuel" -> "Emanuel Diaz").
 * Devuelve el miembro o el error para decirle a la persona.
 */
export function elegirMiembro(
  miembros: MiembroDelNegocio[],
  pedido: unknown,
  rol: "dueño" | "responsable" = "dueño",
): { miembro: MiembroDelNegocio } | { error: string } {
  const texto = typeof pedido === "string" ? pedido.trim() : "";
  if (!texto) return { error: `Falta el ${rol}: el nombre o el email de una persona del negocio.` };
  const clave = claveDeNombre(texto);
  const iguales = miembros.filter(
    (miembro) =>
      miembro.userId === texto || miembro.email.toLowerCase() === texto.toLowerCase() || claveDeNombre(miembro.nombre) === clave,
  );
  const candidatos = iguales.length ? iguales : miembros.filter((miembro) => claveDeNombre(miembro.nombre).includes(clave));
  if (candidatos.length === 1) return { miembro: candidatos[0] };
  if (!candidatos.length) {
    return {
      error: `"${texto}" no es una persona activa de este negocio. Pueden ser ${rol === "dueño" ? "dueños" : "responsables"}: ${
        miembros.map((miembro) => miembro.nombre).join(", ") || "nadie"
      }.`,
    };
  }
  return {
    error: `Hay más de una persona así: ${candidatos.map((miembro) => `${miembro.nombre} (${miembro.email})`).join(", ")}. Usa el email.`,
  };
}

/**
 * ¿Esta persona puede asignar el responsable de una tarjeta de este tablero? Quien puede editar el
 * tablero: el dueño del negocio o un ADMIN (`soloDe` null: ven todos) o la dueña de ese tablero.
 * Quien es solo la responsable de una tarjeta de un tablero ajeno no asigna: solo la ve.
 */
export function puedeAsignarResponsable(soloDe: string | null, duenoDelTablero: string | null): boolean {
  return soloDe === null || (duenoDelTablero !== null && soloDe === duenoDelTablero);
}

/** ¿El cambio toca únicamente al responsable? Asignar no reinicia la aprobación ni el estado. */
export function soloCambiaResponsable(campos: readonly string[]): boolean {
  return campos.length > 0 && campos.every((campo) => campo === "responsableId");
}

/** La inicial en mayúscula del nombre ("Emanuel" -> "E") para el circulito de la tarjeta; "?" si no hay nombre. */
export function inicialDeLaPersona(nombre: string | null | undefined): string {
  const letra = (nombre ?? "").trim().charAt(0);
  return letra ? letra.toUpperCase() : "?";
}

/** El color del tipo si es un hex válido (#rgb o #rrggbb); null si falta o no sirve (la tarjeta queda gris). */
export function colorDeTipoValido(color: string | null | undefined): string | null {
  const limpio = (color ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(limpio) ? limpio : null;
}

/** Fondo suave de la tarjeta: el color del tipo mezclado con el fondo de la pantalla (parejo en claro y oscuro). */
export function fondoSuaveDeTipo(color: string, porcentaje = 16): string {
  return `color-mix(in srgb, ${color} ${porcentaje}%, var(--background))`;
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

/**
 * Lo que dejó el Coordinador sin tenerla en la mano (plan listo o error): Claude las borra solo si el
 * dueño lo pidió por voz. Al deshacer ese borrado vuelven con el mismo estado.
 */
export const ESTADOS_QUE_SE_BORRAN_POR_VOZ = ["PLAN_LISTO", "ERROR"] as const;

export function seBorraPorVoz(estado: EstadoTarjetaTablero) {
  return (ESTADOS_QUE_SE_BORRAN_POR_VOZ as readonly string[]).includes(estado);
}

/** Lo que dijo la persona al pedir el borrado por voz, ya revisado (reglas-trabajador.ts). */
export type ConfirmacionDeBorrado = {
  /** textoDeConfirmacionParaBorrar: null si dijo "sí, bórrala". */
  problemaDelTexto: Veredicto;
  /** motivoNoEsDueno (vía voz): null si la conexión es la del dueño del negocio. */
  problemaDeLaCuenta: Veredicto;
};

/**
 * ¿Se puede borrar la tarjeta? La pantalla borra todo. Claude (MCP):
 *  - nunca una con zona protegida (esas, solo en la pantalla);
 *  - PLAN_LISTO o ERROR, solo con la confirmación por voz del dueño ("sí, bórrala");
 *  - nunca lo que tiene el Coordinador en la mano (PLANEANDO, EN_CURSO, SUBIENDO) ni lo que está por
 *    tomar o espera el sí final (APROBADO, PLAN_APROBADO, POR_REVISAR);
 *  - lo demás sí. Si vino un texto de confirmación, tiene que decir "sí, bórrala".
 */
export function puedeBorrarTarjeta(
  origen: OrigenCambio,
  estado: EstadoTarjetaTablero,
  zonaProtegida: readonly string[] = [],
  confirmacion?: ConfirmacionDeBorrado,
): Veredicto {
  if (origen === "PANTALLA") return null;
  if (zonaProtegida.length) {
    return `La tarjeta toca una zona protegida (${zonaProtegida.join(", ")}): Claude no la borra. Se borra solo en la pantalla.`;
  }
  if (estado === "PLANEANDO" || estado === "EN_CURSO" || estado === "SUBIENDO") {
    return `La tarjeta está ${estado}: el Coordinador la tiene en la mano. Claude no la borra.`;
  }
  if (confirmacion?.problemaDelTexto) return confirmacion.problemaDelTexto;
  if (seBorraPorVoz(estado)) {
    if (!confirmacion) {
      return `La tarjeta está ${estado}: Claude la borra solo si el dueño lo pidió. Léele el título, espera que diga "sí, bórrala" y manda eso en texto_confirmacion.`;
    }
    if (confirmacion.problemaDeLaCuenta) {
      return `La tarjeta está ${estado}: por voz la borra solo el dueño del negocio. ${confirmacion.problemaDeLaCuenta}`;
    }
    return null;
  }
  if (tieneAprobacion(estado)) {
    return `La tarjeta está ${estado}: Claude no la borra. Pídele al dueño que decida qué hacer con ella.`;
  }
  return null;
}

/** ¿Este borrado fue por voz (borrar_tarjeta con texto_confirmacion)? Lo dice su `despues` en el historial. */
export function esBorradoPorVoz(cambio: Pick<CambioParaDeshacer, "accion" | "despues">) {
  const despues = cambio.despues as { via?: unknown } | null;
  return cambio.accion === "borrar" && despues?.via === "voz";
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
