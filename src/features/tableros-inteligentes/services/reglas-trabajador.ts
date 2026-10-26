/*
  REGLAS DEL TRABAJADOR Y DE LAS APROBACIONES del Tablero IA (fase 2, 20-oct-2026, spec aprobada por
  Alexander).

  Funciones puras, sin base ni Next (pruebas: npm run test:tableros). Las usan el servicio
  (tableros.ts y trabajador.ts), el MCP y la pantalla.

  El flujo de una tarjeta con repo (solo tipos con aprobación):
    POR_APROBAR --(aprobar tarea)--> APROBADO --(el Coordinador la toma)--> PLANEANDO --> PLAN_LISTO
    --(aprobar plan)--> PLAN_APROBADO --(la toma)--> EN_CURSO --> SUBIENDO --(la toma enseguida)--> HECHO.
    Si algo falla: ERROR con motivo.   Desde ERROR el dueño reintenta: vuelve a APROBADO (planear de nuevo)
    o a PLAN_APROBADO (construir de nuevo con el plan).

  Subir solo (21-oct-2026, decisión de Alexander: Planear -> Aprobar plan -> Hacer): EN_CURSO pasa
  directo a SUBIENDO pendiente si todo pasó, el Coordinador dice que sube solo (su interruptor
  `subirSolo` del repo) y la tarjeta no tiene zona protegida (destinoDelResultado). Si toca chats,
  agentes o chats (o el interruptor está apagado), queda POR_REVISAR con la zona marcada y espera el sí
  final del dueño (momento 'subir'), como antes. El bot de ventas, Meta Ads y el libro V3 ya NO piden ese
  sí (24-oct-2026, ZONAS_QUE_SUBEN_SOLAS): suben solos, con pruebas extra y vigilancia de 30 minutos. Si el despliegue falla después
  de subir, el Coordinador hace revert del commit en main y la deja ERROR.

  Lo que no se negocia:
  1. Las transiciones del Coordinador (PLANEANDO, PLAN_LISTO, EN_CURSO, POR_REVISAR, SUBIENDO, HECHO,
     ERROR) solo las hace el Coordinador, con su clave (API /api/trabajador/tablero). Nadie las pone
     moviendo el estado.
  2. Aprobar es su propia acción con tres momentos: 'tarea', 'plan' y 'subir'. Cada aprobación deja en
     el historial quién (nombre y userId), el momento, por dónde ('pantalla' o 'voz') y el texto de
     confirmación.
  3. Por el MCP (via 'voz') se aprueba solo si la persona lo dijo explícitamente: el texto tiene que
     decir "sí" y "apruebo". Una tarjeta con zona protegida de chats se aprueba SOLO en la pantalla, y solo
     el dueño; las de bot de ventas, Meta Ads y libro V3 también se aprueban por voz (ZONAS_QUE_SUBEN_SOLAS).
  4. El sí final ('subir') lo da solo el DUEÑO del negocio (SI_FINAL_SOLO_DUENO), y solo si el
     Coordinador dijo que todo pasó (resultado.paso = true). Hoy solo hace falta para las tarjetas con
     zona protegida de chats, las de un repo con `subirSolo` apagado y las
     que ya estaban POR_REVISAR.
  5. Un aprobador (AprobadorTablero) con alcance DESARROLLO aprueba la tarea y el plan solo de
     tarjetas con repo de desarrollo (gestion, aizencrm); con alcance TODO, cualquiera.
  6. La zona protegida se puede PONER desde el MCP (y la pone el Coordinador si el cambio toca una de
     esas rutas), pero quitarla lo hace solo el dueño en la pantalla.
  7. Por el MCP, una tarjeta PLAN_LISTO o ERROR se borra solo si el dueño lo pidió por voz: texto con
     "sí" y "borrar" (textoDeConfirmacionParaBorrar) y la cuenta de la clave es la dueña. Las que tiene
     el Coordinador en la mano y las de zona protegida no se borran (puedeBorrarTarjeta en reglas.ts).
  8. HECHO A MANO (22-oct-2026): cuando un cambio se termina por fuera del Coordinador, el dueño marca
     la tarjeta con repo HECHO desde ERROR, FALLIDO o POR_REVISAR (puedeMarcarHechoAMano): nota
     obligatoria, commit opcional, y por voz el texto "sí, márcala hecha" con la clave de la cuenta
     dueña. Nunca mientras el Coordinador la tiene. Queda en el historial (registroDeHechoAMano). La
     regla general no cambia: en el camino normal el HECHO lo pone solo el Coordinador.
*/

import {
  COMO_MARCAR_HECHO_A_MANO,
  type EstadoTarjetaTablero,
  type OrigenCambio,
  type Veredicto,
  claveDeNombre,
  estaTrabajando,
  sePuedeMarcarHechoAMano,
} from "./reglas";
import { type ModelosDelResultado, esLinkDeSesion, modelosDeEntrada } from "./modelos-del-coordinador";
import { archivosDeEntrada, migracionDestructivaDeEntrada } from "./reglas-riesgo";

/* ───────────────────────────────────────────────────────────────────── repos ── */

/** Los repositorios en que trabaja el Coordinador (lista fija: sumar uno es cambiar el código). */
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

/**
 * Zonas que suben solas (decisión del dueño, 24-oct-2026, por voz: "que sea igual que las otras"): si compiló y
 * pasó las pruebas, la tarjeta pasa a SUBIENDO sin el sí final. CHATS no está: sigue pidiendo el sí del dueño
 * hasta que su propia tarjeta (Coordinador de Sistemas autónomo) la agregue acá. Es la lista que lee todo lo
 * demás (destino del resultado, aprobación por voz, el Coordinador): se agrega una zona en un solo lugar.
 * META_ADS tiene una excepción: lo que gasta plata (presupuesto, prender, crear) sigue pidiendo el sí.
 */
export const ZONAS_QUE_SUBEN_SOLAS: readonly ZonaProtegida[] = ["BOT_VENTAS", "META_ADS", "LIBRO_V3"];

/** De estas zonas, las que TODAVÍA piden el sí final del dueño (las que no están en ZONAS_QUE_SUBEN_SOLAS). */
export function zonasQuePidenTuSi(zonas: readonly string[]): string[] {
  return zonas.filter((zona) => !(ZONAS_QUE_SUBEN_SOLAS as readonly string[]).includes(zona));
}

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

/** Une dos listas de zonas (para el Coordinador y el MCP, que solo pueden agregar). */
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
 * tiene 80: el CI de AizenCRM tarda hasta 20, la versión hasta 8, tiene que alcanzar para deshacer y, en las zonas
 * que suben solas, la vigilancia de 30 minutos va dentro de la misma etapa (24-oct-2026).
 */
export const MINUTOS_POR_ETAPA: Record<EtapaDelTrabajador, number> = { planear: 20, construir: 90, subir: 80 };

/** Dónde construye el Coordinador (25-oct-2026): en aizen1 o en la nube (`claude --cloud`). */
export type LugarDeConstruccion = "aizen1" | "nube";

/** Construir en la nube tiene 180 minutos (en aizen1 siguen siendo 90): la sesión tarda más y luego se verifica en aizen1. */
export const MINUTOS_PARA_CONSTRUIR_EN_LA_NUBE = 180;

/** El tope de una etapa en minutos. Solo construir cambia, y solo si el latido dijo que se construye en la nube. */
export function topeDeLaEtapa(etapa: EtapaDelTrabajador, lugar?: LugarDeConstruccion | null): number {
  return etapa === "construir" && lugar === "nube" ? MINUTOS_PARA_CONSTRUIR_EN_LA_NUBE : MINUTOS_POR_ETAPA[etapa];
}

/**
 * Sin latido, el candado vence a los 5 minutos (así un Coordinador que se apagó se nota pronto). Cada
 * latido lo corre otros 5 minutos, nunca más allá del tope de la etapa.
 */
export const MINUTOS_DE_GRACIA_DEL_LATIDO = 5;

/** Qué etapa empieza cuando el Coordinador toma una tarjeta en ese estado, y a qué estado pasa. */
export const AL_TOMAR: Partial<Record<EstadoTarjetaTablero, { etapa: EtapaDelTrabajador; a: EstadoTarjetaTablero }>> = {
  APROBADO: { etapa: "planear", a: "PLANEANDO" },
  PLAN_APROBADO: { etapa: "construir", a: "EN_CURSO" },
  // SUBIENDO "pendiente" (sin trabajoVenceEn) = el dueño dio el sí final (o el Coordinador la construyó y
  // sube sola) y nadie la tomó todavía. /tomar la elige antes que cualquier otra.
  SUBIENDO: { etapa: "subir", a: "SUBIENDO" },
};

export const ETAPA_DEL_ESTADO: Partial<Record<EstadoTarjetaTablero, EtapaDelTrabajador>> = {
  PLANEANDO: "planear",
  EN_CURSO: "construir",
  SUBIENDO: "subir",
};

const MINUTO = 60_000;

/**
 * El vencimiento del candado: ahora + gracia, sin pasar del tope de la etapa contado desde que la tomó.
 * `lugar` = "nube" solo importa al construir (180 min en vez de 90).
 */
export function vencimientoDelCandado(etapa: EtapaDelTrabajador, iniciadoEn: Date, ahora: Date, lugar?: LugarDeConstruccion | null): Date {
  const tope = iniciadoEn.getTime() + topeDeLaEtapa(etapa, lugar) * MINUTO;
  return new Date(Math.min(ahora.getTime() + MINUTOS_DE_GRACIA_DEL_LATIDO * MINUTO, tope));
}

// Tres líneas (qué falló, qué se probó, qué necesita del dueño), igual que el resumen de una escalada.
export const MOTIVO_VENCIDA = [
  "Se pasó del tiempo: el Coordinador dejó de dar señales (sin latido) o la etapa superó su tope.",
  "Se volvió a intentar sola y no avanzó.",
  "Necesita que la veas: pulsa Reintentar o, si es muy grande, pide partirla.",
].join("\n");

/* ───────────────────────────────────────────────────────────────────── transiciones del Coordinador ── */

/**
 * Lo que manda el Coordinador a /tomar (22-oct-2026): `maxParalelo` = cuántas puede tener a la vez (1 si
 * no viene: un Coordinador viejo sigue de a una) y `excluir` = ids que no quiere ahora (chocan con lo que
 * ya tiene corriendo).
 */
/**
 * Cuántas tarjetas a la vez puede tener el Coordinador (lo manda él; tope duro 12). Desde el 25-oct-2026 caben las
 * de aizen1 (máximo 2) más las que se construyen en la nube (tope de seguridad de 8 en el Coordinador).
 */
export const MAXIMO_EN_PARALELO = 12;

/** Un link de sesión de Claude en la nube: solo https://claude.ai/code/session_… (nada de otros sitios ni parámetros). */
export function linkDeSesionDeEntrada(valor: unknown): string | null {
  const link = textoONull(valor, 300);
  return esLinkDeSesion(link) ? link : null;
}

/** Lo que el latido de una tarjeta puede decir al construir: dónde (aizen1 o nube) y el link de la sesión de la nube. */
export function latidoDeEntrada(cuerpo: unknown): { lugar: LugarDeConstruccion | null; linkSesion: string | null } {
  const datos = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const lugar = datos.lugar === "nube" || datos.lugar === "aizen1" ? datos.lugar : null;
  // El link solo vale si la construcción es en la nube.
  return { lugar, linkSesion: lugar === "nube" ? linkDeSesionDeEntrada(datos.sesion) : null };
}

export type PedidoDeTomar = { maxParalelo?: unknown; excluir?: unknown };

export function opcionesDeTomar(pedido: PedidoDeTomar) {
  const numero = Math.floor(Number(pedido.maxParalelo));
  const maxParalelo = Number.isFinite(numero) && numero >= 1 ? Math.min(numero, MAXIMO_EN_PARALELO) : 1;
  const excluir = Array.isArray(pedido.excluir)
    ? pedido.excluir.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64).slice(0, 200)
    : [];
  return { maxParalelo, excluir };
}


export type AccionDelTrabajador = "latido" | "plan" | "resultado" | "subida" | "error" | "soltar" | "reparar" | "partir";
export const ACCIONES_DEL_TRABAJADOR: readonly AccionDelTrabajador[] = [
  "latido",
  "plan",
  "resultado",
  "subida",
  "error",
  "soltar",
  "reparar",
  "partir",
];

/**
 * Desde qué estados puede llamar el Coordinador cada acción, y a cuál pasa (null = no cambia). El
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
  // Reparar (24-oct-2026): algo falló y el Coordinador sabe la causa: la tarjeta vuelve a la fila SIN ERROR
  // (PLANEANDO -> APROBADO, EN_CURSO -> PLAN_APROBADO, SUBIENDO -> PLAN_APROBADO: una subida que falló antes
  // del push se arregla reconstruyendo) y cuenta una reparación (tope TOPE_DE_REPARACIONES). a = null: depende de dónde estaba.
  reparar: { desde: ["PLANEANDO", "EN_CURSO", "SUBIENDO"], a: null },
  // Partir: una tarjeta muy grande se divide en 2 a 4 partes en orden. Solo desde EN_CURSO (ya hay plan).
  // La madre se queda EN_CURSO sin candado (nadie la toma) hasta que todas sus hijas estén HECHO.
  partir: { desde: ["EN_CURSO"], a: null },
};

/** ¿Puede el Coordinador hacer `accion` con una tarjeta en `estado`? */
export function puedeElTrabajador(accion: AccionDelTrabajador, estado: EstadoTarjetaTablero): Veredicto {
  const regla = TRANSICIONES_DEL_TRABAJADOR[accion];
  if (!regla) return "Esa acción del Coordinador no existe.";
  if (!regla.desde.includes(estado)) {
    return `La tarjeta está ${estado}: "${accion}" solo vale desde ${regla.desde.join(" o ")}.`;
  }
  return null;
}

/**
 * A qué estado pasa la tarjeta con el /resultado: SUBIENDO (pendiente: el Coordinador la sube enseguida)
 * solo si todo pasó, el Coordinador dice que sube solo y la tarjeta no tiene una zona que pida el sí (ni la
 * que ya tenía ni la que marcó el Coordinador; BOT_VENTAS, META_ADS y LIBRO_V3 ya suben solas, ver
 * ZONAS_QUE_SUBEN_SOLAS). Si no, POR_REVISAR: espera el sí final del dueño.
 */
export function destinoDelResultado(datos: {
  paso: boolean;
  subeSolo: boolean;
  zonaProtegida: readonly string[];
}): "SUBIENDO" | "POR_REVISAR" {
  return datos.paso && datos.subeSolo && zonasQuePidenTuSi(datos.zonaProtegida).length === 0 ? "SUBIENDO" : "POR_REVISAR";
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

/**
 * ¿El texto de confirmación dice de verdad "sí, márcala hecha"? Al menos 8 caracteres, con la palabra
 * "sí" (o "si") y "hecha" o "hecho", sin importar tildes ni mayúsculas. "No la marques hecha" no vale.
 * Lo usa cambiar_estado_tarjeta para el HECHO a mano por voz.
 */
export function textoDeConfirmacionParaHecho(texto: unknown): Veredicto {
  const COMO = 'Tiene que ser lo que dijo la persona, por ejemplo: "sí, márcala hecha".';
  if (typeof texto !== "string" || texto.trim().length < 8) {
    return `Falta el texto de confirmación (mínimo 8 caracteres). ${COMO}`;
  }
  const limpio = normalizar(texto);
  if (!/(^|[^a-z])si([^a-z]|$)/.test(limpio) || !/(^|[^a-z])hech[ao]([^a-z]|$)/.test(limpio)) {
    return `El texto de confirmación tiene que decir "sí" y "hecha" (o "hecho"). ${COMO}`;
  }
  // Cualquier "no" o una pregunta (¿sí la marco hecha?) no es una orden del dueño.
  if (/(^|[^a-z])(no|nunca|tampoco)([^a-z]|$)/.test(limpio) || /[?¿]/.test(texto)) {
    return 'El texto tiene un "no" o es una pregunta: no es una orden clara de marcarla hecha.';
  }
  if (!/(^|[^a-z])(marc|pon|dej|cierr|pas|dal)[a-z]*/.test(limpio)) {
    return `El texto de confirmación tiene que decir "márcala" (o "ponla", "déjala") además de "sí" y "hecha". ${COMO}`;
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
  /** resultado.paso del Coordinador (solo cuenta true). */
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
 *  - tarea: POR_APROBAR -> APROBADO; desde ERROR (reintentar) -> APROBADO, y el Coordinador planea de nuevo.
 *  - plan:  PLAN_LISTO -> PLAN_APROBADO; desde ERROR (reintentar con el mismo plan) -> PLAN_APROBADO.
 *  - subir: POR_REVISAR con resultado.paso = true -> SUBIENDO (pendiente: lo toma el Coordinador).
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
    return { error: "Esta tarjeta no tiene repo: no la ejecuta el Coordinador, así que no tiene plan ni subida. Se aprueba la tarea." };
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
    return { error: "El Coordinador no dijo que todo pasó (resultado.paso no es sí): no se sube. Revisa el resultado." };
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
    return { error: "El Coordinador nunca aprueba." };
  }
  if ((pedido.origen === "MCP") !== (pedido.via === "voz")) {
    return { error: "Por el MCP se aprueba solo con la confirmación de la persona (via voz); en la pantalla, con el botón." };
  }
  if (pedido.via === "voz") {
    // Bot de ventas, Meta Ads y libro V3 también se aprueban por voz (24-oct-2026); chats sigue solo en pantalla.
    const soloPantalla = zonasQuePidenTuSi(pedido.zonaProtegida);
    if (soloPantalla.length) {
      return {
        error: `Esta tarjeta toca una zona protegida (${soloPantalla.join(", ")}): se aprueba solo en la pantalla.`,
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

/* ───────────────────────────────────────────────────────────────────── hecho a mano ── */

export const MAXIMO_NOTA_HECHO_A_MANO = 500;

/**
 * El commit de un HECHO a mano: el código del cambio (de 7 a 40 letras y números) o un link de GitHub.
 * null si no vino (es opcional); el texto limpio si está bien; { error } si está mal escrito.
 */
export function commitDeEntrada(valor: unknown): string | null | { error: string } {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== "string") return { error: "El commit tiene que ser texto: el código (7 a 40 letras y números) o un link de GitHub." };
  const limpio = valor.trim();
  if (!limpio) return null;
  if (/^[0-9a-f]{7,40}$/i.test(limpio)) return limpio;
  if (/^https:\/\/github\.com\/\S+$/i.test(limpio) && limpio.length <= 300) return limpio;
  return { error: "El commit está mal escrito: tiene que ser el código del cambio (7 a 40 letras y números, como abc1234) o un link de GitHub (https://github.com/...)." };
}

export type PedidoDeHechoAMano = {
  via: ViaDeAprobacion;
  origen: OrigenCambio;
  estado: EstadoTarjetaTablero;
  usaEstados: boolean;
  repo: string | null;
  textoConfirmacion?: unknown;
  nota: unknown;
  commit?: unknown;
  persona: PersonaQueAprueba;
};

/**
 * La regla de "marcar hecho a mano": una tarjeta CON repo en ERROR, FALLIDO o POR_REVISAR (nunca
 * mientras el Coordinador la tiene) la pasa a HECHO solo el dueño del negocio, con una nota obligatoria
 * (hasta 500 letras) y el commit opcional. Por voz (MCP), además, el texto "sí, márcala hecha". Devuelve
 * la nota y el commit ya limpios, o el error.
 */
export function puedeMarcarHechoAMano(
  pedido: PedidoDeHechoAMano,
): { nota: string; commit: string | null } | { error: string } {
  if (!pedido.usaEstados) return { error: "Las tarjetas de ese tipo (como Área) son carpetas: no tienen estado." };
  if (pedido.origen === "TRABAJADOR") return { error: "El Coordinador no marca hecho a mano." };
  if ((pedido.origen === "MCP") !== (pedido.via === "voz")) {
    return { error: "Por el MCP se marca solo con la confirmación del dueño (via voz); en la pantalla, con el botón." };
  }
  if (!pedido.repo) return { error: "Esta tarjeta no tiene repo: el HECHO a mano es solo para las que ejecuta el Coordinador." };
  if (estaTrabajando(pedido.estado)) {
    return { error: `El Coordinador tiene esta tarjeta en este momento (${pedido.estado}): no se marca hecha hasta que termine o falle.` };
  }
  if (!sePuedeMarcarHechoAMano(pedido.estado)) {
    return { error: `Solo se marca hecha a mano una tarjeta en ERROR, FALLIDO o POR_REVISAR. Está ${pedido.estado}.` };
  }
  if (pedido.via === "voz") {
    const texto = textoDeConfirmacionParaHecho(pedido.textoConfirmacion);
    if (texto) return { error: `${texto} ${COMO_MARCAR_HECHO_A_MANO}` };
  }
  if (!pedido.persona.esDueno) {
    return { error: `Marcar hecho a mano lo hace solo el dueño del negocio.${conLaCuenta(pedido.persona, pedido.via)}` };
  }
  const nota = typeof pedido.nota === "string" ? pedido.nota.trim() : "";
  if (!nota) return { error: "Falta la nota: escribe en pocas palabras qué se hizo por fuera." };
  if (nota.length > MAXIMO_NOTA_HECHO_A_MANO) {
    return { error: `La nota es muy larga (máximo ${MAXIMO_NOTA_HECHO_A_MANO} letras).` };
  }
  const commit = commitDeEntrada(pedido.commit);
  if (commit !== null && typeof commit === "object") return commit;
  return { nota, commit };
}

/** Lo que queda en `HistorialTarjeta.despues` de un HECHO a mano (la acción es "estado"). */
export type RegistroDeHechoAMano = {
  estado: "HECHO";
  hechoAMano: true;
  via: ViaDeAprobacion;
  quienNombre: string;
  userId: string;
  nota: string;
  commit: string | null;
  textoConfirmacion: string | null;
  /** "marcado hecho a mano por el dueño (nombre)". */
  como: string;
};

export function registroDeHechoAMano(datos: Omit<RegistroDeHechoAMano, "estado" | "hechoAMano" | "como">): RegistroDeHechoAMano {
  return { ...datos, estado: "HECHO", hechoAMano: true, como: `marcado hecho a mano por el dueño (${datos.quienNombre})` };
}

/** ¿Este cambio del historial es un HECHO a mano? Lo dice su `despues`. */
export function esHechoAMano(cambio: { accion: string; despues: unknown }) {
  const despues = cambio.despues as { hechoAMano?: unknown } | null;
  return cambio.accion === "estado" && despues?.hechoAMano === true;
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
  /** El Coordinador la quiere subir sola (su `subirSolo` está prendido). El CRM decide (destinoDelResultado). */
  subeSolo: boolean;
  /** El commit de main sobre el que construyó: si main no cambió, al subir no vuelve a compilar. */
  base: string | null;
  /** Qué motor hizo cada paso (23-oct-2026): { plan, construir, revisar } = "claude" | "codex". Solo si vino. */
  motor?: MotoresDelResultado;
  /** Qué modelo (Opus, Sonnet...) hizo cada paso. Lo elige el Coordinador con reglas fijas. Solo si vino. */
  modelo?: ModelosDelResultado;
  /** Los archivos que de verdad cambió (para la última revisión de riesgo). Solo si vino. */
  archivos?: string[];
  /** Lo destructivo que encontró en la migración nueva (DROP, UPDATE...). [] = nada. Solo si vino. */
  migracionDestructiva?: string[];
  /** Dónde se construyó (25-oct-2026): "aizen1" o "nube". Solo si vino (un Coordinador viejo no lo manda). */
  construidoEn?: LugarDeConstruccion;
  /** El link de la sesión de Claude en la nube (solo claude.ai/code/session_…). Solo si se construyó en la nube. */
  linkSesion?: string;
  /** Cuántos segundos dijo la nube que tardó (la línea "resultado:" de su commit). */
  segundosNube?: number;
  /** El link de la corrida del workflow de GitHub Actions que probó la rama (solo github.com). Solo si vino. */
  linkWorkflow?: string;
  /** Dónde se compiló y probó: "github-actions" (la corrida de arriba), "aizen1" o "nube". Solo si vino. */
  verificadoEn?: VerificadoEn;
  /**
   * Por qué NO sube sola aunque su zona suba sola (24-oct-2026): "gasto en Meta Ads", "falta la simulación V3",
   * "mensaje nuevo a clientes". Lo escribe el Coordinador; la tarjeta lo muestra como "espera tu sí (motivo)".
   */
  esperaPor?: string;
};

export type VerificadoEn = "github-actions" | "aizen1" | "nube";

export type MotoresDelResultado = Partial<Record<"plan" | "construir" | "revisar", "claude" | "codex">>;

/** Los motores que manda el Coordinador, limpios: solo pasos y motores conocidos. */
function motoresDeEntrada(valor: unknown): MotoresDelResultado | null {
  if (!valor || typeof valor !== "object") return null;
  const motores: MotoresDelResultado = {};
  for (const paso of ["plan", "construir", "revisar"] as const) {
    const motor = (valor as Record<string, unknown>)[paso];
    if (motor === "claude" || motor === "codex") motores[paso] = motor;
  }
  return Object.keys(motores).length ? motores : null;
}

const textoCorto = (valor: unknown, maximo: number) => (typeof valor === "string" ? valor.trim().slice(0, maximo) : "");
const textoONull = (valor: unknown, maximo: number) => textoCorto(valor, maximo) || null;

/** Lo que manda el Coordinador en /resultado, limpio. Un link que no sea https no se guarda. */
export function resultadoDeEntrada(valor: unknown): ResultadoDelTrabajador {
  const datos = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
  const resumen = textoCorto(datos.resumen, 8000);
  if (!resumen) throw new Error("Falta el resumen del resultado.");
  const link = textoONull(datos.linkRama, 500);
  const motor = motoresDeEntrada(datos.motor);
  const modelo = modelosDeEntrada(datos.modelo);
  const archivos = archivosDeEntrada(datos.archivos);
  const destructivo = migracionDestructivaDeEntrada(datos.migracionDestructiva);
  const construidoEn: LugarDeConstruccion | null = datos.construidoEn === "nube" || datos.construidoEn === "aizen1" ? datos.construidoEn : null;
  // El link solo se guarda si se construyó en la nube y es de claude.ai (nada de otros sitios).
  const linkSesion = construidoEn === "nube" ? linkDeSesionDeEntrada(datos.linkSesion) : null;
  const segundosNube = construidoEn === "nube" && typeof datos.segundosNube === "number" && Number.isFinite(datos.segundosNube) && datos.segundosNube >= 0 ? Math.round(datos.segundosNube) : null;
  // El link del workflow solo se guarda si es de github.com (nada de otros sitios).
  const enlaceWorkflow = textoONull(datos.linkWorkflow, 500);
  const linkWorkflow = enlaceWorkflow && /^https:\/\/github\.com\//.test(enlaceWorkflow) ? enlaceWorkflow : null;
  const esperaPor = textoONull(datos.esperaPor, 200);
  const verificadoEn: VerificadoEn | null = datos.verificadoEn === "github-actions" || datos.verificadoEn === "aizen1" || datos.verificadoEn === "nube" ? datos.verificadoEn : null;
  return {
    ...(construidoEn ? { construidoEn } : {}),
    ...(linkWorkflow ? { linkWorkflow } : {}),
    ...(verificadoEn ? { verificadoEn } : {}),
    ...(linkSesion ? { linkSesion } : {}),
    ...(segundosNube !== null ? { segundosNube } : {}),
    ...(motor ? { motor } : {}),
    ...(modelo ? { modelo } : {}),
    // Se guardan 100; la revisión de riesgo (trabajador.ts) mira la lista completa (hasta 300) del cuerpo.
    ...(archivos ? { archivos: archivos.slice(0, 100) } : {}),
    // Un `true` suelto (sin lista) se guarda como ["algo"]: no se pierde la señal de migración destructiva.
    ...(Array.isArray(destructivo) ? { migracionDestructiva: destructivo } : destructivo === true ? { migracionDestructiva: ["algo"] } : {}),
    resumen,
    pruebas: textoCorto(datos.pruebas, 8000),
    paso: datos.paso === true,
    rama: textoONull(datos.rama, 200),
    linkRama: link && /^https:\/\//.test(link) ? link : null,
    commit: textoONull(datos.commit, 80),
    migracion: textoONull(datos.migracion, 300),
    subeSolo: datos.subeSolo === true,
    base: textoONull(datos.base, 80),
    ...(esperaPor ? { esperaPor } : {}),
  };
}

/** Lo que vigiló el Coordinador 30 minutos después de subir una tarjeta de zona que sube sola. */
export type VigilanciaDeLaSubida = {
  zona: string;
  minutos: number;
  ok: boolean;
};

export function vigilanciaDeEntrada(valor: unknown): VigilanciaDeLaSubida | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const datos = valor as Record<string, unknown>;
  const zona = textoCorto(datos.zona, 80);
  if (!zona) return null;
  const minutos = typeof datos.minutos === "number" && Number.isFinite(datos.minutos) && datos.minutos >= 0 ? Math.round(datos.minutos) : 0;
  return { zona, minutos, ok: datos.ok === true };
}

/** La frase de la tarjeta cuando subió sola y se vigiló: "Subió sola (zona X) — vigilancia 30 min OK". */
export function fraseDeLaVigilancia(vigilancia: VigilanciaDeLaSubida): string {
  const zona = vigilancia.zona
    .split(",")
    .map((una) => una.trim())
    .map((una) => (esZona(una) ? NOMBRE_DE_LA_ZONA[una] : una))
    .join(", ");
  return `Subió sola (zona ${zona}) — vigilancia ${vigilancia.minutos} min OK`;
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

/** La reversión que manda el Coordinador en /error cuando el despliegue falló después de subir, o null. */
export function reversionDeEntrada(valor: unknown): ReversionDelTrabajador | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const datos = valor as Record<string, unknown>;
  return { commit: textoONull(datos.commit, 80), revert: textoONull(datos.revert, 80), ok: datos.ok === true };
}

/** El motivo de un error del Coordinador. */
export function motivoDeEntrada(valor: unknown): string {
  const motivo = typeof valor === "string" ? valor.trim().slice(0, 4000) : "";
  return motivo || "El Coordinador no dijo el motivo.";
}

/* ───────────────────────────────────────────────────────────────────── reparar, partir y esperar ── */

/*
  Cuando algo falla (24-oct-2026), el Coordinador diagnostica (categoría y causa en una línea), repara (no
  repite lo mismo), parte la tarjeta si es muy grande, espera si es el límite de Claude, y escala al dueño
  con un resumen de máximo 3 líneas después de TOPE_DE_REPARACIONES reparaciones. Cada paso deja una fila en
  IntentoTarjeta (el historial que se ve en la tarjeta). Las categorías y acciones son las mismas en el
  Coordinador (trabajador-tablero/lib/diagnostico.mjs).
*/

/** Cuántas reparaciones seguidas se le permiten a una tarjeta; la siguiente falla se escala al dueño. */
export const TOPE_DE_REPARACIONES = 3;
/** Cuántas esperas seguidas (sin contar como intento) aguanta antes de escalar. */
export const TOPE_DE_ESPERAS_SEGUIDAS = 5;
/** En cuántas partes se puede partir una tarjeta (de 2 a 4). */
export const MAXIMO_DE_PARTES = 4;
export const MINIMO_DE_PARTES = 2;

export const CATEGORIAS_DE_INTENTO = [
  "limite_claude",
  "pc_sobrecargado",
  "tiempo_agotado",
  "no_compila",
  "fallan_pruebas",
  "lint",
  "choca_con_main",
  "migracion",
  "no_cambio_nada",
  "carpeta_trabada",
  "tarea_muy_grande",
  "coordinador_cortado",
  "sesion_atascada",
  "otra",
] as const;
export type CategoriaDeIntento = (typeof CATEGORIAS_DE_INTENTO)[number];

export const ACCIONES_DE_INTENTO = ["reparar", "partir", "esperar", "escalar"] as const;
export type AccionDeIntento = (typeof ACCIONES_DE_INTENTO)[number];

/** Cómo se dice en la pantalla lo que se hizo en cada intento. */
export const NOMBRE_DE_LA_ACCION_DE_INTENTO: Record<AccionDeIntento, string> = {
  reparar: "Reparó",
  partir: "La partió",
  esperar: "Esperó",
  escalar: "Te la pasó",
};

export const MAXIMO_CAUSA_DEL_INTENTO = 200;
export const MAXIMO_ERROR_DEL_INTENTO = 6000;
export const MAXIMO_LINEAS_DEL_RESUMEN = 3;
const MAXIMO_LINEA_DEL_RESUMEN = 300;
const MAXIMO_TITULO_DE_LA_PARTE = 120;
const MAXIMO_DETALLE_DE_LA_PARTE = 4000;
const MAXIMO_TITULO_DE_LA_TARJETA = 200;

export function esCategoria(valor: unknown): valor is CategoriaDeIntento {
  return typeof valor === "string" && (CATEGORIAS_DE_INTENTO as readonly string[]).includes(valor);
}

/** La categoría que manda el Coordinador: null si no vino, "otra" si no es una de la lista. */
export function categoriaDeEntrada(valor: unknown): CategoriaDeIntento | null {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const limpia = valor.trim().toLowerCase();
  return esCategoria(limpia) ? limpia : "otra";
}

/** La causa en UNA línea (la primera con texto, espacios simples, máximo 200 letras). */
export function causaDeEntrada(valor: unknown, porDefecto = "El Coordinador no dijo la causa."): string {
  const lineas = typeof valor === "string" ? valor.split(/\r?\n/) : [];
  const primera = lineas.map((linea) => linea.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
  return primera.slice(0, MAXIMO_CAUSA_DEL_INTENTO) || porDefecto;
}

/** El error técnico de un intento, recortado a 6000 letras; null si no vino. */
export function errorDeIntentoDeEntrada(valor: unknown): string | null {
  const texto = typeof valor === "string" ? valor.trim().slice(0, MAXIMO_ERROR_DEL_INTENTO) : "";
  return texto || null;
}

/** El resumen que escribe el Coordinador al escalar: máximo 3 líneas con texto (cada una hasta 300 letras). */
export function resumenDeEscalada(valor: unknown): string {
  const lineas = (typeof valor === "string" ? valor.split(/\r?\n/) : [])
    .map((linea) => linea.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, MAXIMO_LINEAS_DEL_RESUMEN)
    .map((linea) => linea.slice(0, MAXIMO_LINEA_DEL_RESUMEN));
  return lineas.join("\n") || "El Coordinador no dijo el motivo.";
}

/** La estrategia que sugiere el Coordinador al reparar: solo se anota ("opus" | "partir"); null si no vino o no es una. */
export function estrategiaDeEntrada(valor: unknown): "opus" | "partir" | null {
  const limpia = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  return limpia === "opus" || limpia === "partir" ? limpia : null;
}

/** La causa con la estrategia anotada al final, sin pasar de 200 letras. */
export function causaConEstrategia(causa: string, estrategia: "opus" | "partir" | null): string {
  if (!estrategia) return causa;
  const cola = ` (estrategia: ${estrategia})`;
  return `${causa.slice(0, MAXIMO_CAUSA_DEL_INTENTO - cola.length)}${cola}`;
}

/** La etapa del intento: la que dice el Coordinador si es válida; si no, la que corresponde al estado de la tarjeta. */
export function etapaDeEntrada(valor: unknown, estado: EstadoTarjetaTablero): EtapaDelTrabajador {
  const limpia = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (limpia === "planear" || limpia === "construir" || limpia === "subir") return limpia;
  return ETAPA_DEL_ESTADO[estado] ?? "construir";
}

/** A qué estado de la fila vuelve una tarjeta que se repara (sin ERROR). */
export function estadoTrasReparar(estado: EstadoTarjetaTablero): EstadoTarjetaTablero {
  return estado === "PLANEANDO" ? "APROBADO" : "PLAN_APROBADO";
}

/** ¿Se puede reparar una vez más? Con TOPE_DE_REPARACIONES hechas, no: el Coordinador tiene que escalar (/error). */
export function puedeReparar(reparaciones: number): Veredicto {
  return reparaciones >= TOPE_DE_REPARACIONES
    ? `Ya lleva ${reparaciones} reparaciones (el tope es ${TOPE_DE_REPARACIONES}): escala con /error y un resumen para el dueño.`
    : null;
}

/** Las esperas seguidas: las filas que no cuentan como intento después de la última que sí cuenta (lista del más viejo al más nuevo). */
export function esperasSeguidas(intentos: readonly { cuentaComoIntento: boolean }[]): number {
  let esperas = 0;
  for (let i = intentos.length - 1; i >= 0 && !intentos[i].cuentaComoIntento; i -= 1) esperas += 1;
  return esperas;
}

export type ParteDeLaTarjeta = { titulo: string; detalle: string };

/** Las partes que manda el Coordinador en /partir: de 2 a 4, cada una con título y detalle. Lanza si no cumplen. */
export function partesDeEntrada(valor: unknown): ParteDeLaTarjeta[] {
  if (!Array.isArray(valor)) throw new Error(`Faltan las partes: manda de ${MINIMO_DE_PARTES} a ${MAXIMO_DE_PARTES}.`);
  if (valor.length < MINIMO_DE_PARTES || valor.length > MAXIMO_DE_PARTES) {
    throw new Error(`Se parte en ${MINIMO_DE_PARTES} a ${MAXIMO_DE_PARTES} partes (llegaron ${valor.length}).`);
  }
  return valor.map((cruda, indice) => {
    const parte = (cruda && typeof cruda === "object" ? cruda : {}) as Record<string, unknown>;
    const titulo = textoCorto(parte.titulo, MAXIMO_TITULO_DE_LA_PARTE).replace(/\s+/g, " ");
    const detalle = textoCorto(parte.detalle, MAXIMO_DETALLE_DE_LA_PARTE);
    if (!titulo) throw new Error(`A la parte ${indice + 1} le falta el título.`);
    if (!detalle) throw new Error(`A la parte ${indice + 1} le falta el detalle.`);
    return { titulo, detalle };
  });
}

/** "<título de la madre> — parte N: <título>", sin pasar de 200 letras (se recorta el de la madre). */
export function tituloDeLaParte(tituloMadre: string, numero: number, titulo: string): string {
  const cola = ` — parte ${numero}: ${titulo}`;
  if (cola.length >= MAXIMO_TITULO_DE_LA_TARJETA) return `Parte ${numero}: ${titulo}`.slice(0, MAXIMO_TITULO_DE_LA_TARJETA);
  return `${tituloMadre.slice(0, MAXIMO_TITULO_DE_LA_TARJETA - cola.length)}${cola}`;
}

/** El detalle de una parte: empieza con "Parte N de M de «<título de la madre>»." y sigue lo que toca hacer. */
export function detalleDeLaParte(tituloMadre: string, numero: number, total: number, detalle: string): string {
  return `Parte ${numero} de ${total} de «${tituloMadre}».\n\n${detalle}`;
}

export type PartidaDelResultado = { hijas: string[]; causa: string; cuando: string };

/** `resultado.partida` de una madre partida (o null si no está partida). */
export function partidaDelResultado(resultado: unknown): PartidaDelResultado | null {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) return null;
  const partida = (resultado as Record<string, unknown>).partida;
  if (!partida || typeof partida !== "object" || Array.isArray(partida)) return null;
  const datos = partida as Record<string, unknown>;
  const hijas = Array.isArray(datos.hijas) ? datos.hijas.filter((id): id is string => typeof id === "string") : [];
  if (!hijas.length) return null;
  return {
    hijas,
    causa: typeof datos.causa === "string" ? datos.causa : "",
    cuando: typeof datos.cuando === "string" ? datos.cuando : "",
  };
}

/** ¿Se puede partir? No si ya está partida ni si es una parte (esParte). */
export function puedePartir(datos: { yaPartida: boolean; esParte: boolean }): Veredicto {
  if (datos.yaPartida) return "La tarjeta ya está partida.";
  if (datos.esParte) return "Esta tarjeta ya es una parte de otra: no se parte más (repárala o escálala).";
  return null;
}

/**
 * ¿Poner `origenId -> destinoId` como dependencia crearía un ciclo? Sí si ya hay un camino de dependencias
 * de destino a origen (o si son la misma tarjeta): entonces ninguna de las dos se podría tomar nunca.
 * `dependencias` son las flechas que ya son dependencia (esDependencia = true).
 */
export function dependenciaHaceCiclo(
  dependencias: readonly { origenId: string; destinoId: string }[],
  origenId: string,
  destinoId: string,
): boolean {
  if (origenId === destinoId) return true;
  const visto = new Set<string>([destinoId]);
  const pendientes = [destinoId];
  while (pendientes.length) {
    const actual = pendientes.pop() as string;
    for (const flecha of dependencias) {
      if (flecha.origenId !== actual || visto.has(flecha.destinoId)) continue;
      if (flecha.destinoId === origenId) return true;
      visto.add(flecha.destinoId);
      pendientes.push(flecha.destinoId);
    }
  }
  return false;
}

/**
 * La madre pasa a HECHO cuando todas sus hijas están HECHO. `hijasVivas` = las hijas de la partida que no
 * están borradas, con su estado. Sin hijas vivas no se cierra sola.
 */
export function madreSeCierra(hijasVivas: readonly { estado: string }[]): boolean {
  return hijasVivas.length > 0 && hijasVivas.every((hija) => hija.estado === "HECHO");
}
