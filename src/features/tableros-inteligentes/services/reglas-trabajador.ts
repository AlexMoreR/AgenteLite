/*
  REGLAS DEL TRABAJADOR Y DE LAS APROBACIONES del Tablero IA (fase 2, 20-oct-2026, spec aprobada por
  Alexander).

  Funciones puras, sin base ni Next (pruebas: npm run test:tableros). Las usan el servicio
  (tableros.ts y trabajador.ts), el MCP y la pantalla.

  El flujo de una tarjeta con repo (solo tipos con aprobación):
    POR_APROBAR --(aprobar tarea)--> APROBADO --(el trabajador la toma)--> PLANEANDO --> PLAN_LISTO
    --(aprobar plan)--> PLAN_APROBADO --(la toma)--> EN_CURSO --> SUBIENDO --(la toma enseguida)--> HECHO.
    Si algo falla: ERROR con motivo.   Desde ERROR el dueño reintenta: vuelve a APROBADO (planear de nuevo)
    o a PLAN_APROBADO (construir de nuevo con el plan).

  Subir solo (21-oct-2026, decisión de Alexander: Planear -> Aprobar plan -> Hacer): EN_CURSO pasa
  directo a SUBIENDO pendiente si todo pasó, el trabajador dice que sube solo (su interruptor
  `subirSolo` del repo) y la tarjeta no tiene zona protegida (destinoDelResultado). Si toca chats,
  agentes, el libro V3 o Meta Ads (o el interruptor está apagado), queda POR_REVISAR con la zona
  marcada y espera el sí final del dueño (momento 'subir'), como antes. Si el despliegue falla después
  de subir, el trabajador hace revert del commit en main y la deja ERROR.

  Lo que no se negocia:
  1. Las transiciones del trabajador (PLANEANDO, PLAN_LISTO, EN_CURSO, POR_REVISAR, SUBIENDO, HECHO,
     ERROR) solo las hace el trabajador, con su clave (API /api/trabajador/tablero). Nadie las pone
     moviendo el estado.
  2. Aprobar es su propia acción con tres momentos: 'tarea', 'plan' y 'subir'. Cada aprobación deja en
     el historial quién (nombre y userId), el momento, por dónde ('pantalla' o 'voz') y el texto de
     confirmación.
  3. Por el MCP (via 'voz') se aprueba solo si la persona lo dijo explícitamente: el texto tiene que
     decir "sí" y "apruebo". Una tarjeta con zona protegida (Meta Ads, bot de ventas, libro V3, chats) se
     aprueba SOLO en la pantalla, y solo el dueño.
  4. El sí final ('subir') lo da solo el DUEÑO del negocio (SI_FINAL_SOLO_DUENO), y solo si el
     trabajador dijo que todo pasó (resultado.paso = true). Hoy solo hace falta para las tarjetas con
     zona protegida (chats, agentes, libro V3, Meta Ads), las de un repo con `subirSolo` apagado y las
     que ya estaban POR_REVISAR.
  5. Un aprobador (AprobadorTablero) con alcance DESARROLLO aprueba la tarea y el plan solo de
     tarjetas con repo de desarrollo (gestion, aizencrm); con alcance TODO, cualquiera.
  6. La zona protegida se puede PONER desde el MCP (y la pone el trabajador si el cambio toca una de
     esas rutas), pero quitarla lo hace solo el dueño en la pantalla.
  7. Por el MCP, una tarjeta PLAN_LISTO o ERROR se borra solo si el dueño lo pidió por voz: texto con
     "sí" y "borrar" (textoDeConfirmacionParaBorrar) y la cuenta de la clave es la dueña. Las que tiene
     el trabajador en la mano y las de zona protegida no se borran (puedeBorrarTarjeta en reglas.ts).
*/

import { type EstadoTarjetaTablero, type OrigenCambio, type Veredicto, claveDeNombre } from "./reglas";

/* ───────────────────────────────────────────────────────────────────── repos ── */

/** Los repositorios en que trabaja el trabajador (lista fija: sumar uno es cambiar el código). */
export const REPOS_DEL_TRABAJADOR = ["gestion", "aizencrm"] as const;
export type RepoDelTrabajador = (typeof REPOS_DEL_TRABAJADOR)[number];

export const NOMBRE_DEL_REPO: Record<RepoDelTrabajador, string> = {
  gestion: "Gestión",
  aizencrm: "AizenCRM",
};

/** Los repos "de desarrollo": los que puede aprobar un aprobador con alcance DESARROLLO. */
export const REPOS_DE_DESARROLLO: readonly RepoDelTrabajador[] = ["gestion", "aizencrm"];

export function esRepo(valor: unknown): valor is RepoDelTrabajador {
  return typeof valor === "string" && (REPOS_DEL_TRABAJADOR as readonly string[]).includes(valor);
}

/** repo como lo mandan: clave de la lista, "" / null para quitarlo, undefined si no vino. */
export function repoDeEntrada(valor: unknown): RepoDelTrabajador | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || (typeof valor === "string" && valor.trim() === "")) return null;
  const limpio = typeof valor === "string" ? claveDeNombre(valor) : valor;
  if (!esRepo(limpio)) {
    throw new Error(`Ese repo no existe. Van: ${REPOS_DEL_TRABAJADOR.join(", ")}.`);
  }
  return limpio;
}

/* ───────────────────────────────────────────────────────────────────── zonas protegidas ── */

/** CHATS (21-oct-2026): envío y recepción de WhatsApp, Evolution API, webhooks y la bandeja de las asesoras. */
export const ZONAS_PROTEGIDAS = ["META_ADS", "BOT_VENTAS", "LIBRO_V3", "CHATS"] as const;
export type ZonaProtegida = (typeof ZONAS_PROTEGIDAS)[number];

export const NOMBRE_DE_LA_ZONA: Record<ZonaProtegida, string> = {
  META_ADS: "Meta Ads",
  BOT_VENTAS: "Bot de ventas",
  LIBRO_V3: "Libro V3",
  CHATS: "Chats",
};

export function esZona(valor: unknown): valor is ZonaProtegida {
  return typeof valor === "string" && (ZONAS_PROTEGIDAS as readonly string[]).includes(valor);
}

/** Lista de zonas (sin repetir, en el orden de la lista fija), [] para ninguna, undefined si no vino. */
export function zonasDeEntrada(valor: unknown): ZonaProtegida[] | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return [];
  const lista = Array.isArray(valor) ? valor : [valor];
  const pedidas = new Set<string>();
  for (const zona of lista) {
    const limpia = typeof zona === "string" ? zona.trim().toUpperCase() : zona;
    if (limpia === "") continue;
    if (!esZona(limpia)) throw new Error(`Esa zona protegida no existe. Van: ${ZONAS_PROTEGIDAS.join(", ")}.`);
    pedidas.add(limpia);
  }
  return ZONAS_PROTEGIDAS.filter((zona) => pedidas.has(zona));
}

/** Une dos listas de zonas (para el trabajador y el MCP, que solo pueden agregar). */
export function unirZonas(a: readonly string[], b: readonly string[]): ZonaProtegida[] {
  const todas = new Set([...a, ...b]);
  return ZONAS_PROTEGIDAS.filter((zona) => todas.has(zona));
}

/**
 * ¿Se puede pasar de `antes` a `despues`? Agregar siempre se puede; quitar, solo el dueño en la pantalla.
 */
export function puedeCambiarZonas(
  origen: OrigenCambio,
  antes: readonly string[],
  despues: readonly string[],
  esDueno: boolean,
): Veredicto {
  const quitadas = antes.filter((zona) => !despues.includes(zona));
  if (!quitadas.length) return null;
  if (origen !== "PANTALLA" || !esDueno) {
    return `La zona protegida (${quitadas.join(", ")}) la quita solo el dueño en la pantalla. Se puede agregar, no quitar.`;
  }
  return null;
}

/* ───────────────────────────────────────────────────────────────────── tiempos y candado ── */

export type EtapaDelTrabajador = "planear" | "construir" | "subir";

/**
 * Tope de cada etapa (minutos). Pasado el tope, la tarjeta pasa a ERROR ("se pasó del tiempo"). Subir
 * tiene 45: el CI de AizenCRM tarda hasta 20, la versión hasta 8, y tiene que alcanzar para deshacer.
 */
export const MINUTOS_POR_ETAPA: Record<EtapaDelTrabajador, number> = { planear: 20, construir: 90, subir: 45 };

/**
 * Sin latido, el candado vence a los 5 minutos (así un trabajador que se apagó se nota pronto). Cada
 * latido lo corre otros 5 minutos, nunca más allá del tope de la etapa.
 */
export const MINUTOS_DE_GRACIA_DEL_LATIDO = 5;

/** Qué etapa empieza cuando el trabajador toma una tarjeta en ese estado, y a qué estado pasa. */
export const AL_TOMAR: Partial<Record<EstadoTarjetaTablero, { etapa: EtapaDelTrabajador; a: EstadoTarjetaTablero }>> = {
  APROBADO: { etapa: "planear", a: "PLANEANDO" },
  PLAN_APROBADO: { etapa: "construir", a: "EN_CURSO" },
  // SUBIENDO "pendiente" (sin trabajoVenceEn) = el dueño dio el sí final (o el trabajador la construyó y
  // sube sola) y nadie la tomó todavía. /tomar la elige antes que cualquier otra.
  SUBIENDO: { etapa: "subir", a: "SUBIENDO" },
};

export const ETAPA_DEL_ESTADO: Partial<Record<EstadoTarjetaTablero, EtapaDelTrabajador>> = {
  PLANEANDO: "planear",
  EN_CURSO: "construir",
  SUBIENDO: "subir",
};

const MINUTO = 60_000;

/** El vencimiento del candado: ahora + gracia, sin pasar del tope de la etapa contado desde que la tomó. */
export function vencimientoDelCandado(etapa: EtapaDelTrabajador, iniciadoEn: Date, ahora: Date): Date {
  const tope = iniciadoEn.getTime() + MINUTOS_POR_ETAPA[etapa] * MINUTO;
  return new Date(Math.min(ahora.getTime() + MINUTOS_DE_GRACIA_DEL_LATIDO * MINUTO, tope));
}

export const MOTIVO_VENCIDA = "Se pasó del tiempo: el trabajador dejó de dar señales (sin latido) o la etapa superó su tope.";

/* ───────────────────────────────────────────────────────────────────── transiciones del trabajador ── */

/**
 * Lo que manda el trabajador a /tomar (22-oct-2026): `maxParalelo` = cuántas puede tener a la vez (1 si
 * no viene: un trabajador viejo sigue de a una) y `excluir` = ids que no quiere ahora (chocan con lo que
 * ya tiene corriendo).
 */
/** Cuántas tarjetas a la vez puede tener el trabajador (lo manda él; tope duro 5). */
export const MAXIMO_EN_PARALELO = 5;

export type PedidoDeTomar = { maxParalelo?: unknown; excluir?: unknown };

export function opcionesDeTomar(pedido: PedidoDeTomar) {
  const numero = Math.floor(Number(pedido.maxParalelo));
  const maxParalelo = Number.isFinite(numero) && numero >= 1 ? Math.min(numero, MAXIMO_EN_PARALELO) : 1;
  const excluir = Array.isArray(pedido.excluir)
    ? pedido.excluir.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64).slice(0, 200)
    : [];
  return { maxParalelo, excluir };
}


export type AccionDelTrabajador = "latido" | "plan" | "resultado" | "subida" | "error" | "soltar";
export const ACCIONES_DEL_TRABAJADOR: readonly AccionDelTrabajador[] = ["latido", "plan", "resultado", "subida", "error", "soltar"];

/**
 * Desde qué estados puede llamar el trabajador cada acción, y a cuál pasa (null = no cambia). El
 * "resultado" pasa a POR_REVISAR, o a SUBIENDO pendiente si sube sola (destinoDelResultado).
 */
export const TRANSICIONES_DEL_TRABAJADOR: Record<
  AccionDelTrabajador,
  { desde: readonly EstadoTarjetaTablero[]; a: EstadoTarjetaTablero | null }
> = {
  latido: { desde: ["PLANEANDO", "EN_CURSO", "SUBIENDO"], a: null },
  plan: { desde: ["PLANEANDO"], a: "PLAN_LISTO" },
  resultado: { desde: ["EN_CURSO"], a: "POR_REVISAR" },
  subida: { desde: ["SUBIENDO"], a: "HECHO" },
  error: { desde: ["PLANEANDO", "EN_CURSO", "SUBIENDO"], a: "ERROR" },
  // Soltar (22-oct-2026): la tarjeta vuelve a esperar su turno sin ERROR y sin gastar el intento, porque
  // Claude llegó a su límite de uso o porque choca con otra que ya corre (misma zona o módulo, o la cola
  // de subida). PLANEANDO -> APROBADO, EN_CURSO -> PLAN_APROBADO, SUBIENDO -> SUBIENDO pendiente (a =
  // null: depende de dónde estaba). Una SUBIENDO se suelta solo antes de empezar, nunca después del push.
  soltar: { desde: ["PLANEANDO", "EN_CURSO", "SUBIENDO"], a: null },
};

/** ¿Puede el trabajador hacer `accion` con una tarjeta en `estado`? */
export function puedeElTrabajador(accion: AccionDelTrabajador, estado: EstadoTarjetaTablero): Veredicto {
  const regla = TRANSICIONES_DEL_TRABAJADOR[accion];
  if (!regla) return "Esa acción del trabajador no existe.";
  if (!regla.desde.includes(estado)) {
    return `La tarjeta está ${estado}: "${accion}" solo vale desde ${regla.desde.join(" o ")}.`;
  }
  return null;
}

/**
 * A qué estado pasa la tarjeta con el /resultado: SUBIENDO (pendiente: el trabajador la sube enseguida)
 * solo si todo pasó, el trabajador dice que sube solo y la tarjeta no tiene zona protegida (ni la que
 * ya tenía ni la que marcó el trabajador). Si no, POR_REVISAR: espera el sí final del dueño.
 */
export function destinoDelResultado(datos: {
  paso: boolean;
  subeSolo: boolean;
  zonaProtegida: readonly string[];
}): "SUBIENDO" | "POR_REVISAR" {
  return datos.paso && datos.subeSolo && datos.zonaProtegida.length === 0 ? "SUBIENDO" : "POR_REVISAR";
}

/* ───────────────────────────────────────────────────────────────────── aprobaciones ── */

export const MOMENTOS_DE_APROBACION = ["tarea", "plan", "subir"] as const;
export type MomentoDeAprobacion = (typeof MOMENTOS_DE_APROBACION)[number];

export const NOMBRE_DEL_MOMENTO: Record<MomentoDeAprobacion, string> = {
  tarea: "la tarea",
  plan: "el plan",
  subir: "subir a producción",
};

export type ViaDeAprobacion = "pantalla" | "voz";

/**
 * El sí final (subir a producción) lo da SOLO el dueño del negocio. Si algún día se quiere que un
 * aprobador con `puedeSubir` también pueda, se cambia esto a false (y nada más).
 */
export const SI_FINAL_SOLO_DUENO = true;

export function esMomento(valor: unknown): valor is MomentoDeAprobacion {
  return typeof valor === "string" && (MOMENTOS_DE_APROBACION as readonly string[]).includes(valor);
}

/** Texto en minúsculas, sin tildes y con espacios simples, para comparar lo que dijo la persona. */
function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿El texto de confirmación dice de verdad "sí, apruebo"? Al menos 8 caracteres, con la palabra "sí"
 * (o "si") y la palabra "apruebo", sin importar tildes ni mayúsculas. "No apruebo" no vale.
 */
export function textoDeConfirmacionValido(texto: unknown): Veredicto {
  const COMO = 'Tiene que ser lo que dijo la persona, por ejemplo: "sí, apruebo".';
  if (typeof texto !== "string" || texto.trim().length < 8) {
    return `Falta el texto de confirmación (mínimo 8 caracteres). ${COMO}`;
  }
  const limpio = normalizar(texto);
  if (!/(^|[^a-z])si([^a-z]|$)/.test(limpio) || !/(^|[^a-z])apruebo([^a-z]|$)/.test(limpio)) {
    return `El texto de confirmación tiene que decir "sí" y "apruebo". ${COMO}`;
  }
  if (/(^|[^a-z])no (lo )?apruebo([^a-z]|$)/.test(limpio)) {
    return 'El texto dice "no apruebo": no se aprueba.';
  }
  return null;
}

/**
 * ¿El texto de confirmación dice de verdad "sí, bórrala"? Al menos 8 caracteres, con la palabra "sí"
 * (o "si") y una palabra de borrar ("borra", "bórrala", "bórralo", "elimínala"...), sin importar
 * tildes ni mayúsculas. "No la borres" no vale. Lo usa borrar_tarjeta (borrado por voz).
 */
export function textoDeConfirmacionParaBorrar(texto: unknown): Veredicto {
  const COMO = 'Tiene que ser lo que dijo la persona, por ejemplo: "sí, bórrala".';
  if (typeof texto !== "string" || texto.trim().length < 8) {
    return `Falta el texto de confirmación (mínimo 8 caracteres). ${COMO}`;
  }
  const limpio = normalizar(texto);
  if (!/(^|[^a-z])si([^a-z]|$)/.test(limpio) || !/(^|[^a-z])(borr|elimin)[a-z]*/.test(limpio)) {
    return `El texto de confirmación tiene que decir "sí" y "borrar" (bórrala, elimínala). ${COMO}`;
  }
  if (/(^|[^a-z])no (la |lo )?(borr|elimin)/.test(limpio)) {
    return 'El texto dice "no la borres": no se borra.';
  }
  return null;
}

/** Lo que se sabe de la cuenta que aprueba para decidir si es la dueña del negocio. */
export type CuentaQueAprueba = {
  nombre: string;
  correo: string | null;
  /** User.role: ADMIN (de la plataforma), EMPLEADO o CLIENTE. */
  tipoCuenta: string | null;
  /** Es miembro activo de este negocio. */
  miembroActivo: boolean;
  /** Su rol en el negocio (WorkspaceMember.role), si es miembro activo. */
  rolEnNegocio: string | null;
  /** Es la cuenta dueña registrada de este negocio (Workspace.ownerId). */
  esDuenaRegistrada: boolean;
  /** La dueña registrada del negocio, para decirla en el error. */
  duena: { nombre: string; correo: string | null } | null;
};

/**
 * ¿Esta cuenta es la dueña del negocio para el Tablero IA? Tiene que ser miembro activo y, además:
 *  - la cuenta dueña registrada de ESE negocio (Workspace.ownerId), sea CLIENTE o ADMIN de la
 *    plataforma (Alexander usa una cuenta ADMIN para su negocio); o
 *  - una cuenta CLIENTE con rol OWNER en el negocio (la regla de siempre).
 * Ser ADMIN de la plataforma por sí solo no da poder de dueño: un ADMIN que no es la dueña registrada
 * de este negocio no lo es. Solo para el Tablero IA: client-workspace-access.ts no cambia.
 */
export function esDuenoDelNegocio(cuenta: CuentaQueAprueba): boolean {
  if (!cuenta.miembroActivo) return false;
  if (cuenta.esDuenaRegistrada && (cuenta.tipoCuenta === "CLIENTE" || cuenta.tipoCuenta === "ADMIN")) return true;
  return cuenta.tipoCuenta === "CLIENTE" && cuenta.rolEnNegocio === "OWNER";
}

/**
 * Por qué esta cuenta no cuenta como dueña del negocio, con su nombre y correo, y qué hacer. null si
 * es la dueña. Por voz, la cuenta es la de la clave de Claude: la que la creó.
 */
export function motivoNoEsDueno(cuenta: CuentaQueAprueba, via: ViaDeAprobacion): string | null {
  if (esDuenoDelNegocio(cuenta)) return null;
  const quien = `${cuenta.nombre}${cuenta.correo ? ` (${cuenta.correo})` : ""}`;
  const duena = cuenta.duena
    ? `la dueña es ${cuenta.duena.nombre}${cuenta.duena.correo ? `, ${cuenta.duena.correo}` : ""}`
    : "el negocio no tiene cuenta dueña registrada";
  let motivo: string;
  if (!cuenta.miembroActivo) {
    motivo = cuenta.esDuenaRegistrada
      ? "está registrada como dueña, pero no es miembro activo de este negocio"
      : `no es miembro activo de este negocio (${duena})`;
  } else if (cuenta.tipoCuenta === "ADMIN") {
    motivo = `es ADMIN de la plataforma, pero no es la cuenta dueña de este negocio (${duena})`;
  } else if (cuenta.tipoCuenta === "CLIENTE") {
    motivo = `es CLIENTE, pero no es dueña de este negocio (${duena})`;
  } else {
    motivo = `es una cuenta ${cuenta.tipoCuenta ?? "sin tipo"}, no la dueña de este negocio (${duena})`;
  }
  if (via === "voz") {
    const queHacer =
      !cuenta.miembroActivo && cuenta.esDuenaRegistrada
        ? "Hay que volver a activarla como miembro del negocio."
        : "Crea la clave de Claude entrando con la cuenta dueña y cámbiala en Claude.";
    return `La conexión llegó con la cuenta ${quien}: ${motivo}. ${queHacer}`;
  }
  return `Entraste con la cuenta ${quien}: ${motivo}.`;
}

export type PersonaQueAprueba = {
  /** Dueña del negocio (esDuenoDelNegocio). Aprueba todo implícitamente y es la única con el sí final. */
  esDueno: boolean;
  /** ADMIN de la plataforma: como en la fase 1, aprueba la tarea y el plan en la pantalla. */
  esAdminPlataforma: boolean;
  /** Su fila en AprobadorTablero, si la tiene. */
  aprobador: { alcance: string; puedeSubir: boolean } | null;
  /** La cuenta, para decir en el error con quién llegó y por qué no es la dueña. */
  cuenta?: CuentaQueAprueba;
};

/** " " + el motivo de por qué no es la dueña, si se sabe la cuenta; "" si no. */
function conLaCuenta(persona: PersonaQueAprueba, via: ViaDeAprobacion) {
  const motivo = persona.cuenta ? motivoNoEsDueno(persona.cuenta, via) : null;
  return motivo ? ` ${motivo}` : "";
}

export type PedidoDeAprobacion = {
  momento: unknown;
  via: ViaDeAprobacion;
  origen: OrigenCambio;
  estado: EstadoTarjetaTablero;
  requiereAprobacion: boolean;
  usaEstados: boolean;
  repo: string | null;
  zonaProtegida: readonly string[];
  tienePlan: boolean;
  /** resultado.paso del trabajador (solo cuenta true). */
  resultadoPaso: boolean;
  textoConfirmacion?: unknown;
  persona: PersonaQueAprueba;
};

/** ¿Esta persona puede aprobar este momento de esta tarjeta? (sin mirar el estado) */
export function personaPuedeAprobarMomento(
  persona: PersonaQueAprueba,
  momento: MomentoDeAprobacion,
  via: ViaDeAprobacion,
  repo: string | null,
  zonaProtegida: readonly string[],
): Veredicto {
  if (momento === "subir") {
    const puede = persona.esDueno || (!SI_FINAL_SOLO_DUENO && Boolean(persona.aprobador?.puedeSubir));
    return puede ? null : `El sí final (subir a producción) lo da solo el dueño del negocio.${conLaCuenta(persona, via)}`;
  }
  if (zonaProtegida.length && !persona.esDueno) {
    return `Esta tarjeta toca una zona protegida: la aprueba solo el dueño, en la pantalla.${conLaCuenta(persona, via)}`;
  }
  if (persona.esDueno) return null;
  if (via === "pantalla" && persona.esAdminPlataforma) return null;
  const alcance = persona.aprobador?.alcance;
  if (alcance === "TODO") return null;
  if (alcance === "DESARROLLO") {
    return repo && (REPOS_DE_DESARROLLO as readonly string[]).includes(repo)
      ? null
      : "Tu alcance es DESARROLLO: apruebas solo tarjetas con repo gestion o aizencrm.";
  }
  return `No puedes aprobar en este tablero: aprueba el dueño del negocio o un aprobador que él agregue.${conLaCuenta(persona, via)}`;
}

/**
 * ¿A qué estado pasa la tarjeta al aprobar ese momento desde ese estado? Error si no corresponde.
 *  - tarea: POR_APROBAR -> APROBADO; desde ERROR (reintentar) -> APROBADO, y el trabajador planea de nuevo.
 *  - plan:  PLAN_LISTO -> PLAN_APROBADO; desde ERROR (reintentar con el mismo plan) -> PLAN_APROBADO.
 *  - subir: POR_REVISAR con resultado.paso = true -> SUBIENDO (pendiente: lo toma el trabajador).
 */
export function destinoDeLaAprobacion(
  momento: MomentoDeAprobacion,
  estado: EstadoTarjetaTablero,
  datos: { repo: string | null; tienePlan: boolean; resultadoPaso: boolean },
): { a: EstadoTarjetaTablero } | { error: string } {
  if (momento === "tarea") {
    if (estado === "POR_APROBAR") return { a: "APROBADO" };
    if (estado === "ERROR") return { a: "APROBADO" };
    if (estado === "APROBADO") return { error: "La tarea ya está aprobada." };
    return { error: `La tarea se aprueba cuando está POR_APROBAR (o se reintenta desde ERROR). Está ${estado}.` };
  }
  if (!datos.repo) {
    return { error: "Esta tarjeta no tiene repo: no la ejecuta el trabajador, así que no tiene plan ni subida. Se aprueba la tarea." };
  }
  if (momento === "plan") {
    if (estado !== "PLAN_LISTO" && estado !== "ERROR") {
      return { error: `El plan se aprueba cuando está PLAN_LISTO (o se reintenta desde ERROR). Está ${estado}.` };
    }
    if (!datos.tienePlan) return { error: "La tarjeta no tiene plan todavía: no hay plan que aprobar." };
    return { a: "PLAN_APROBADO" };
  }
  if (estado !== "POR_REVISAR") {
    return { error: `Subir a producción se aprueba cuando está POR_REVISAR. Está ${estado}.` };
  }
  if (!datos.resultadoPaso) {
    return { error: "El trabajador no dijo que todo pasó (resultado.paso no es sí): no se sube. Revisa el resultado." };
  }
  return { a: "SUBIENDO" };
}

/** La regla completa de una aprobación (la pantalla y aprobar_tarjeta del MCP). */
export function puedeAprobarMomento(pedido: PedidoDeAprobacion): { a: EstadoTarjetaTablero; momento: MomentoDeAprobacion } | { error: string } {
  if (!esMomento(pedido.momento)) {
    return { error: `Momento desconocido. Van: ${MOMENTOS_DE_APROBACION.join(", ")}.` };
  }
  const momento = pedido.momento;
  if (!pedido.requiereAprobacion || !pedido.usaEstados) {
    return { error: "Ese tipo de tarjeta no pide aprobación: no hay nada que aprobar." };
  }
  if (pedido.origen === "TRABAJADOR") {
    return { error: "El trabajador nunca aprueba." };
  }
  if ((pedido.origen === "MCP") !== (pedido.via === "voz")) {
    return { error: "Por el MCP se aprueba solo con la confirmación de la persona (via voz); en la pantalla, con el botón." };
  }
  if (pedido.via === "voz") {
    if (pedido.zonaProtegida.length) {
      return {
        error: `Esta tarjeta toca una zona protegida (${pedido.zonaProtegida.join(", ")}): se aprueba solo en la pantalla.`,
      };
    }
    const texto = textoDeConfirmacionValido(pedido.textoConfirmacion);
    if (texto) return { error: texto };
  }
  const quien = personaPuedeAprobarMomento(pedido.persona, momento, pedido.via, pedido.repo, pedido.zonaProtegida);
  if (quien) return { error: quien };
  const destino = destinoDeLaAprobacion(momento, pedido.estado, {
    repo: pedido.repo,
    tienePlan: pedido.tienePlan,
    resultadoPaso: pedido.resultadoPaso,
  });
  if ("error" in destino) return destino;
  return { a: destino.a, momento };
}

/** Lo que queda en `HistorialTarjeta.despues` de una aprobación. */
export type RegistroDeAprobacion = {
  estado: EstadoTarjetaTablero;
  momento: MomentoDeAprobacion;
  via: ViaDeAprobacion;
  quienNombre: string;
  userId: string;
  textoConfirmacion: string | null;
  /** "aprobado por voz" o "aprobado en pantalla". */
  como: string;
};

export function registroDeAprobacion(datos: Omit<RegistroDeAprobacion, "como">): RegistroDeAprobacion {
  return { ...datos, como: datos.via === "voz" ? "aprobado por voz" : "aprobado en pantalla" };
}

/* ───────────────────────────────────────────────────────────────────── el resultado ── */

export type ResultadoDelTrabajador = {
  resumen: string;
  pruebas: string;
  paso: boolean;
  rama: string | null;
  linkRama: string | null;
  commit: string | null;
  migracion: string | null;
  /** El trabajador la quiere subir sola (su `subirSolo` está prendido). El CRM decide (destinoDelResultado). */
  subeSolo: boolean;
  /** El commit de main sobre el que construyó: si main no cambió, al subir no vuelve a compilar. */
  base: string | null;
};

const textoCorto = (valor: unknown, maximo: number) => (typeof valor === "string" ? valor.trim().slice(0, maximo) : "");
const textoONull = (valor: unknown, maximo: number) => textoCorto(valor, maximo) || null;

/** Lo que manda el trabajador en /resultado, limpio. Un link que no sea https no se guarda. */
export function resultadoDeEntrada(valor: unknown): ResultadoDelTrabajador {
  const datos = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
  const resumen = textoCorto(datos.resumen, 8000);
  if (!resumen) throw new Error("Falta el resumen del resultado.");
  const link = textoONull(datos.linkRama, 500);
  return {
    resumen,
    pruebas: textoCorto(datos.pruebas, 8000),
    paso: datos.paso === true,
    rama: textoONull(datos.rama, 200),
    linkRama: link && /^https:\/\//.test(link) ? link : null,
    commit: textoONull(datos.commit, 80),
    migracion: textoONull(datos.migracion, 300),
    subeSolo: datos.subeSolo === true,
    base: textoONull(datos.base, 80),
  };
}

/** Un link https (el del commit en GitHub), o null. */
export function linkDeEntrada(valor: unknown): string | null {
  const link = textoONull(valor, 500);
  return link && /^https:\/\//.test(link) ? link : null;
}

/** El plan como lo manda el trabajador: texto con saltos, no vacío, máximo 20.000 caracteres. */
export function planDeEntrada(valor: unknown): string {
  const plan = typeof valor === "string" ? valor.replace(/\r\n/g, "\n").trim().slice(0, 20_000) : "";
  if (!plan) throw new Error("Falta el plan.");
  return plan;
}

export type ReversionDelTrabajador = {
  /** El commit que se subió y no arrancó. */
  commit: string | null;
  /** El commit del revert en main (null si no se pudo deshacer). */
  revert: string | null;
  /** true = se deshizo; false = no se pudo (URGENTE: revisar a mano). */
  ok: boolean;
};

/** La reversión que manda el trabajador en /error cuando el despliegue falló después de subir, o null. */
export function reversionDeEntrada(valor: unknown): ReversionDelTrabajador | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const datos = valor as Record<string, unknown>;
  return { commit: textoONull(datos.commit, 80), revert: textoONull(datos.revert, 80), ok: datos.ok === true };
}

/** El motivo de un error del trabajador. */
export function motivoDeEntrada(valor: unknown): string {
  const motivo = typeof valor === "string" ? valor.trim().slice(0, 4000) : "";
  return motivo || "El trabajador no dijo el motivo.";
}
