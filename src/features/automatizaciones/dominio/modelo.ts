/**
 * AUTOMATIZACIONES (código puro): CONDICIONES + ACCIONES, como Chatwoot.
 *
 * Antes (14-sep-2026) una automatización era solo "toma ESTOS leads y dáselos a ESTA persona".
 * Alexander (13-10-2026) pidió armarlas en dos bloques:
 *
 *   CONDICIONES (todas se cumplen, Y): Etapa, Asignado, Etiquetas, Canal, Días sin responder,
 *   Días sin mensajes, Recuperación vencida, más "Solo chats abiertos" y "Cantidad máxima".
 *   ACCIONES (en orden): Asignar, Añadir / Quitar etiqueta, Resolver, Posponer, Abrir, Enviar
 *   flujo, Enviar texto, Añadir nota, Cambiar etapa.
 *
 * Se guardan en AppSetting como JSON (ver servicio.ts). Las guardadas con la forma vieja se pasan a
 * la nueva al leerlas (`limpiarAutomatizacion`): nadie tiene que volver a armarlas.
 *
 * Sin imports de Next ni de la base: lo usan el servicio, la pantalla y las pruebas
 * (scripts/check-automatizaciones.mjs).
 */

export const ETAPAS = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "GANADO", "PERDIDO"] as const;
export type Etapa = (typeof ETAPAS)[number];
export const ETAPAS_CERRADAS: readonly Etapa[] = ["GANADO", "PERDIDO"];
/** A dónde puede mover una automatización (Ganado pide cotización: solo a mano). */
export const ETAPAS_DESTINO: readonly Etapa[] = ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", "PERDIDO"];

/** Valor especial de "Asignado": el chat no tiene dueña. */
export const SIN_ASIGNAR = "sin_asignar";

/* ------------------------------------------------------------------------------------------------
   CONDICIONES
------------------------------------------------------------------------------------------------ */

export type Condicion =
  | { campo: "etapa"; operador: "es" | "no_es"; valores: Etapa[] }
  /** userIds y/o SIN_ASIGNAR. */
  | { campo: "asignado"; operador: "es" | "no_es"; valores: string[] }
  /** "tiene" = tiene alguna de estas; "no_tiene" = no tiene ninguna. */
  | { campo: "etiquetas"; operador: "tiene" | "no_tiene"; valores: string[] }
  | { campo: "canal"; operador: "es" | "no_es"; valores: string[] }
  /** El cliente no escribe hace al menos N días (nunca escribió = no cumple). */
  | { campo: "dias_sin_responder"; operador: "al_menos"; dias: number }
  /** Nadie escribió en el chat (ni el cliente ni nosotros) hace al menos N días. */
  | { campo: "dias_sin_mensajes"; operador: "al_menos"; dias: number }
  /** Tiene vencida la tarea de la Recuperación 72 h (la misma de la alarma de Recuperación). */
  | { campo: "recuperacion_vencida"; operador: "si" | "no" };

export type CampoDeCondicion = Condicion["campo"];

export const CAMPOS_DE_CONDICION: ReadonlyArray<{ campo: CampoDeCondicion; etiqueta: string }> = [
  { campo: "etapa", etiqueta: "Etapa" },
  { campo: "asignado", etiqueta: "Asignado" },
  { campo: "etiquetas", etiqueta: "Etiquetas" },
  { campo: "canal", etiqueta: "Canal" },
  { campo: "dias_sin_responder", etiqueta: "Días sin responder" },
  { campo: "dias_sin_mensajes", etiqueta: "Días sin mensajes" },
  { campo: "recuperacion_vencida", etiqueta: "Recuperación vencida" },
];

export const OPERADORES: Record<CampoDeCondicion, ReadonlyArray<{ valor: string; etiqueta: string }>> = {
  etapa: [
    { valor: "es", etiqueta: "es" },
    { valor: "no_es", etiqueta: "no es" },
  ],
  asignado: [
    { valor: "es", etiqueta: "es" },
    { valor: "no_es", etiqueta: "no es" },
  ],
  etiquetas: [
    { valor: "tiene", etiqueta: "tiene" },
    { valor: "no_tiene", etiqueta: "no tiene" },
  ],
  canal: [
    { valor: "es", etiqueta: "es" },
    { valor: "no_es", etiqueta: "no es" },
  ],
  dias_sin_responder: [{ valor: "al_menos", etiqueta: "al menos" }],
  dias_sin_mensajes: [{ valor: "al_menos", etiqueta: "al menos" }],
  recuperacion_vencida: [
    { valor: "si", etiqueta: "sí" },
    { valor: "no", etiqueta: "no" },
  ],
};

/** Una condición nueva del campo elegido (la fila recién añadida en el editor). */
export function condicionVacia(campo: CampoDeCondicion): Condicion {
  switch (campo) {
    case "etapa":
      return { campo, operador: "es", valores: [] };
    case "asignado":
      return { campo, operador: "es", valores: [] };
    case "etiquetas":
      return { campo, operador: "tiene", valores: [] };
    case "canal":
      return { campo, operador: "es", valores: [] };
    case "dias_sin_responder":
    case "dias_sin_mensajes":
      return { campo, operador: "al_menos", dias: 3 };
    case "recuperacion_vencida":
      return { campo, operador: "si" };
  }
}

/* ------------------------------------------------------------------------------------------------
   ACCIONES
------------------------------------------------------------------------------------------------ */

export type Accion =
  | { tipo: "asignar"; usuarioId: string }
  | { tipo: "anadir_etiqueta"; etiquetaId: string }
  | { tipo: "quitar_etiqueta"; etiquetaId: string }
  | { tipo: "resolver" }
  /** Saca el lead de Mi día hasta `hasta` (ISO) o por `dias` desde que corre. */
  | { tipo: "posponer"; dias: number | null; hasta: string | null }
  | { tipo: "abrir" }
  | { tipo: "enviar_flujo"; flujoId: string; flujoNombre: string }
  | { tipo: "enviar_texto"; texto: string }
  | { tipo: "nota"; texto: string }
  | { tipo: "cambiar_etapa"; etapa: Etapa; motivoPerdida: string | null };

export type TipoDeAccion = Accion["tipo"];

export const TIPOS_DE_ACCION: ReadonlyArray<{ tipo: TipoDeAccion; etiqueta: string }> = [
  { tipo: "asignar", etiqueta: "Asignar" },
  { tipo: "anadir_etiqueta", etiqueta: "Añadir etiqueta" },
  { tipo: "quitar_etiqueta", etiqueta: "Quitar etiqueta" },
  { tipo: "resolver", etiqueta: "Resolver conversación" },
  { tipo: "posponer", etiqueta: "Posponer" },
  { tipo: "abrir", etiqueta: "Abrir conversación" },
  { tipo: "enviar_flujo", etiqueta: "Enviar flujo" },
  { tipo: "enviar_texto", etiqueta: "Enviar texto" },
  { tipo: "nota", etiqueta: "Añadir nota" },
  { tipo: "cambiar_etapa", etiqueta: "Cambiar etapa" },
];

export function accionVacia(tipo: TipoDeAccion): Accion {
  switch (tipo) {
    case "asignar":
      return { tipo, usuarioId: "" };
    case "anadir_etiqueta":
    case "quitar_etiqueta":
      return { tipo, etiquetaId: "" };
    case "resolver":
    case "abrir":
      return { tipo };
    case "posponer":
      return { tipo, dias: 1, hasta: null };
    case "enviar_flujo":
      return { tipo, flujoId: "", flujoNombre: "" };
    case "enviar_texto":
    case "nota":
      return { tipo, texto: "" };
    case "cambiar_etapa":
      return { tipo, etapa: "CALIFICADO", motivoPerdida: null };
  }
}

/** Las que le escriben al cliente: salen por el motor de seguimientos (anti-bloqueo). */
export function esEnvio(accion: Accion): accion is Extract<Accion, { tipo: "enviar_flujo" | "enviar_texto" }> {
  return accion.tipo === "enviar_flujo" || accion.tipo === "enviar_texto";
}

export function tieneEnvios(acciones: ReadonlyArray<Accion>): boolean {
  return acciones.some(esEnvio);
}

/* ------------------------------------------------------------------------------------------------
   LA AUTOMATIZACIÓN
------------------------------------------------------------------------------------------------ */

/** Ritmo de los envíos: de a `tanda` leads cada `cadaMinutos` (además del espaciado del anti-bloqueo). */
export type RitmoDeEnvio = { tanda: number; cadaMinutos: number };
export const RITMO_POR_DEFECTO: RitmoDeEnvio = { tanda: 10, cadaMinutos: 15 };

export type Ejecucion = {
  fecha: string;
  por: string;
  origen: "manual" | "automatica";
  /** Leads a los que se les aplicaron las acciones. */
  leads: number;
  /** Envíos que quedaron agendados (salen por tandas). */
  envios: number;
  errores: number;
  /** Las primeras fallas, cortas, para la tarjeta. */
  detalle: string[];
};

export type Automatizacion = {
  id: string;
  nombre: string;
  condiciones: Condicion[];
  soloAbiertas: boolean;
  /** Máximo de leads por ejecución. null = todos (hasta MAXIMO_POR_EJECUCION). */
  cantidad: number | null;
  acciones: Accion[];
  /** Con el interruptor prendido, el reloj la corre cada 30 min (solo leads que no procesó). */
  automatica: boolean;
  ritmo: RitmoDeEnvio;
  /** Lo último primero, máximo HISTORIAL. */
  historial: Ejecucion[];
  /** Cuándo la corrió el reloj por última vez (ISO). */
  ultimaAutomaticaEn: string | null;
};

export type BorradorDeAutomatizacion = Omit<Automatizacion, "id" | "historial" | "ultimaAutomaticaEn"> & { id?: string };

/** Para que el conteo no tarde ni la ejecución escriba miles de filas de golpe. */
export const MAXIMO_POR_EJECUCION = 2000;
export const HISTORIAL = 10;
/** Cada cuánto corre una automática. */
export const MINUTOS_ENTRE_AUTOMATICAS = 30;

const LARGO_DEL_NOMBRE = 60;
const LARGO_DEL_TEXTO = 1000;

/* ------------------------------------------------------------------------------------------------
   LIMPIEZA Y MIGRACIÓN
------------------------------------------------------------------------------------------------ */

function enteroPositivo(valor: unknown): number | null {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" && valor.trim() ? Number(valor) : NaN;
  if (!Number.isFinite(numero)) return null;
  const entero = Math.floor(numero);
  return entero > 0 ? entero : null;
}

function texto(valor: unknown, largo = 200): string {
  return typeof valor === "string" ? valor.trim().slice(0, largo) : "";
}

function listaDeTextos(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return [...new Set(valor.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()))];
}

function esEtapa(valor: unknown): valor is Etapa {
  return typeof valor === "string" && (ETAPAS as readonly string[]).includes(valor);
}

function limpiarCondicion(valor: unknown): Condicion | null {
  if (!valor || typeof valor !== "object") return null;
  const c = valor as Record<string, unknown>;
  switch (c.campo) {
    case "etapa": {
      const valores = Array.isArray(c.valores) ? ETAPAS.filter((e) => (c.valores as unknown[]).includes(e)) : [];
      return valores.length ? { campo: "etapa", operador: c.operador === "no_es" ? "no_es" : "es", valores } : null;
    }
    case "asignado": {
      const valores = listaDeTextos(c.valores);
      return valores.length ? { campo: "asignado", operador: c.operador === "no_es" ? "no_es" : "es", valores } : null;
    }
    case "etiquetas": {
      const valores = listaDeTextos(c.valores);
      return valores.length ? { campo: "etiquetas", operador: c.operador === "no_tiene" ? "no_tiene" : "tiene", valores } : null;
    }
    case "canal": {
      const valores = listaDeTextos(c.valores);
      return valores.length ? { campo: "canal", operador: c.operador === "no_es" ? "no_es" : "es", valores } : null;
    }
    case "dias_sin_responder":
    case "dias_sin_mensajes": {
      const dias = enteroPositivo(c.dias);
      return dias ? { campo: c.campo, operador: "al_menos", dias: Math.min(dias, 365) } : null;
    }
    case "recuperacion_vencida":
      return { campo: "recuperacion_vencida", operador: c.operador === "no" ? "no" : "si" };
    default:
      return null;
  }
}

function limpiarAccion(valor: unknown): Accion | null {
  if (!valor || typeof valor !== "object") return null;
  const a = valor as Record<string, unknown>;
  switch (a.tipo) {
    case "asignar": {
      const usuarioId = texto(a.usuarioId);
      return usuarioId ? { tipo: "asignar", usuarioId } : null;
    }
    case "anadir_etiqueta":
    case "quitar_etiqueta": {
      const etiquetaId = texto(a.etiquetaId);
      return etiquetaId ? { tipo: a.tipo, etiquetaId } : null;
    }
    case "resolver":
    case "abrir":
      return { tipo: a.tipo };
    case "posponer": {
      const dias = enteroPositivo(a.dias);
      const hastaTexto = texto(a.hasta, 40);
      const hasta = hastaTexto && Number.isFinite(new Date(hastaTexto).getTime()) ? new Date(hastaTexto).toISOString() : null;
      if (!dias && !hasta) return null;
      return { tipo: "posponer", dias: hasta ? null : Math.min(dias ?? 1, 365), hasta };
    }
    case "enviar_flujo": {
      const flujoId = texto(a.flujoId);
      return flujoId ? { tipo: "enviar_flujo", flujoId, flujoNombre: texto(a.flujoNombre, 120) } : null;
    }
    case "enviar_texto":
    case "nota": {
      const contenido = texto(a.texto, LARGO_DEL_TEXTO);
      return contenido ? { tipo: a.tipo, texto: contenido } : null;
    }
    case "cambiar_etapa": {
      if (!esEtapa(a.etapa) || !ETAPAS_DESTINO.includes(a.etapa)) return null;
      const motivo = texto(a.motivoPerdida, 40);
      if (a.etapa === "PERDIDO" && !motivo) return null;
      return { tipo: "cambiar_etapa", etapa: a.etapa, motivoPerdida: a.etapa === "PERDIDO" ? motivo : null };
    }
    default:
      return null;
  }
}

function limpiarRitmo(valor: unknown): RitmoDeEnvio {
  const r = valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  return {
    tanda: Math.min(50, enteroPositivo(r.tanda) ?? RITMO_POR_DEFECTO.tanda),
    cadaMinutos: Math.min(240, Math.max(5, enteroPositivo(r.cadaMinutos) ?? RITMO_POR_DEFECTO.cadaMinutos)),
  };
}

/** ¿Viene con la forma de antes (14-sep-2026)? */
export function esFormaVieja(crudo: Record<string, unknown>): boolean {
  return !Array.isArray(crudo.condiciones) && !Array.isArray(crudo.acciones) && ("asignarA" in crudo || "dueno" in crudo || "etapas" in crudo);
}

/**
 * La forma vieja pasada a la nueva, sin perder nada de lo que hacía:
 *   dueno sin_asignar / de:X   → Asignado es [sin asignar] / [X]  ("cualquiera" = sin condición)
 *   etapas                     → Etapa es [...]
 *   canalId                    → Canal es [canal]
 *   diasSinMensajes            → Días sin mensajes al menos N
 *   asignarA                   → acción Asignar
 *   ultimaEjecucion            → primera fila del historial
 */
export function migrarFormaVieja(crudo: Record<string, unknown>): Record<string, unknown> {
  const condiciones: unknown[] = [];
  const dueno = typeof crudo.dueno === "string" ? crudo.dueno : "sin_asignar";
  if (dueno === "sin_asignar") condiciones.push({ campo: "asignado", operador: "es", valores: [SIN_ASIGNAR] });
  else if (dueno.startsWith("de:") && dueno.length > 3) condiciones.push({ campo: "asignado", operador: "es", valores: [dueno.slice(3)] });
  if (Array.isArray(crudo.etapas) && crudo.etapas.length) condiciones.push({ campo: "etapa", operador: "es", valores: crudo.etapas });
  if (typeof crudo.canalId === "string" && crudo.canalId.trim()) condiciones.push({ campo: "canal", operador: "es", valores: [crudo.canalId] });
  const dias = enteroPositivo(crudo.diasSinMensajes);
  if (dias) condiciones.push({ campo: "dias_sin_mensajes", operador: "al_menos", dias });

  const acciones: unknown[] = [];
  if (typeof crudo.asignarA === "string" && crudo.asignarA.trim()) acciones.push({ tipo: "asignar", usuarioId: crudo.asignarA });

  const ultima = crudo.ultimaEjecucion as Record<string, unknown> | null | undefined;
  const historial =
    ultima && typeof ultima.fecha === "string" && typeof ultima.asignados === "number"
      ? [{ fecha: ultima.fecha, por: String(ultima.por ?? ""), origen: "manual", leads: ultima.asignados, envios: 0, errores: 0, detalle: [] }]
      : [];

  return {
    id: crudo.id,
    nombre: crudo.nombre,
    condiciones,
    soloAbiertas: crudo.soloAbiertas,
    cantidad: crudo.cantidad,
    acciones,
    automatica: false,
    historial,
    ultimaAutomaticaEn: null,
  };
}

function limpiarHistorial(valor: unknown): Ejecucion[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .flatMap((item): Ejecucion[] => {
      if (!item || typeof item !== "object") return [];
      const e = item as Record<string, unknown>;
      if (typeof e.fecha !== "string") return [];
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
      return [
        {
          fecha: e.fecha,
          por: String(e.por ?? ""),
          origen: e.origen === "automatica" ? "automatica" : "manual",
          leads: n(e.leads),
          envios: n(e.envios),
          errores: n(e.errores),
          detalle: listaDeTextos(e.detalle).slice(0, 5),
        },
      ];
    })
    .slice(0, HISTORIAL);
}

/**
 * Deja una automatización en forma, venga de la base (nueva o vieja) o del formulario.
 *
 * Lo desconocido se descarta en vez de romper: un valor viejo o mal escrito no puede dejar la
 * pantalla sin abrir. Devuelve null solo si falta lo imprescindible (nombre y al menos una acción).
 * Las condiciones a medio llenar (sin valores) se ignoran.
 */
export function limpiarAutomatizacion(valor: unknown): Omit<Automatizacion, "id" | "historial" | "ultimaAutomaticaEn"> | null {
  if (!valor || typeof valor !== "object") return null;
  let crudo = valor as Record<string, unknown>;
  if (esFormaVieja(crudo)) crudo = migrarFormaVieja(crudo);
  const nombre = texto(crudo.nombre, LARGO_DEL_NOMBRE);
  const acciones = (Array.isArray(crudo.acciones) ? crudo.acciones : []).map(limpiarAccion).filter((a): a is Accion => a !== null).slice(0, 10);
  if (!nombre || acciones.length === 0) return null;
  const condiciones = (Array.isArray(crudo.condiciones) ? crudo.condiciones : [])
    .map(limpiarCondicion)
    .filter((c): c is Condicion => c !== null)
    .slice(0, 10);
  return {
    nombre,
    condiciones,
    soloAbiertas: crudo.soloAbiertas !== false,
    cantidad: enteroPositivo(crudo.cantidad),
    acciones,
    automatica: crudo.automatica === true,
    ritmo: limpiarRitmo(crudo.ritmo),
  };
}

/**
 * Lo que sirve para CONTAR de un borrador a medio armar (sin nombre o sin acciones también): las
 * condiciones completas y las acciones completas (Asignar y los envíos cambian a quién toma).
 */
export function criteriosDelBorrador(valor: unknown): Pick<Automatizacion, "condiciones" | "soloAbiertas" | "cantidad" | "acciones"> {
  const crudo = valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  return {
    condiciones: (Array.isArray(crudo.condiciones) ? crudo.condiciones : []).map(limpiarCondicion).filter((c): c is Condicion => c !== null),
    soloAbiertas: crudo.soloAbiertas !== false,
    cantidad: enteroPositivo(crudo.cantidad),
    acciones: (Array.isArray(crudo.acciones) ? crudo.acciones : []).map(limpiarAccion).filter((a): a is Accion => a !== null),
  };
}

/** Lo guardado (cualquier forma) a una automatización completa. null si no sirve. */
export function leerAutomatizacionGuardada(valor: unknown): Automatizacion | null {
  const limpia = limpiarAutomatizacion(valor);
  if (!limpia || !valor || typeof valor !== "object") return null;
  const crudo0 = valor as Record<string, unknown>;
  const crudo = esFormaVieja(crudo0) ? migrarFormaVieja(crudo0) : crudo0;
  const id = typeof crudo.id === "string" ? crudo.id : "";
  if (!id) return null;
  return {
    ...limpia,
    id,
    historial: limpiarHistorial(crudo.historial),
    ultimaAutomaticaEn: typeof crudo.ultimaAutomaticaEn === "string" ? crudo.ultimaAutomaticaEn : null,
  };
}

/**
 * Qué le falta a una automatización para poder guardarse (o null si está bien). Es el mensaje que
 * ve quien la arma: más útil que un "datos inválidos".
 */
export function problemaDelBorrador(borrador: BorradorDeAutomatizacion): string | null {
  if (!borrador.nombre.trim()) return "Ponle un nombre";
  for (const accion of borrador.acciones) {
    if (!limpiarAccion(accion)) {
      const etiqueta = TIPOS_DE_ACCION.find((t) => t.tipo === accion.tipo)?.etiqueta ?? accion.tipo;
      return `Completa la acción «${etiqueta}»`;
    }
  }
  if (borrador.acciones.length === 0) return "Añade al menos una acción";
  for (const condicion of borrador.condiciones) {
    if (!limpiarCondicion(condicion)) {
      const etiqueta = CAMPOS_DE_CONDICION.find((c) => c.campo === condicion.campo)?.etiqueta ?? condicion.campo;
      return `Completa la condición «${etiqueta}»`;
    }
  }
  if (tieneEnvios(borrador.acciones) && borrador.condiciones.length === 0) {
    return "Para enviar mensajes pon al menos una condición";
  }
  return null;
}

/** Nombre del seguimiento (Follow) con que salen sus envíos: así los clasifica el anti-bloqueo. */
export const PREFIJO_FOLLOW_AUTOMATIZACION = "Automatización:";

export function nombreDelEnvio(automatizacion: Pick<Automatizacion, "id" | "nombre">): string {
  return `${PREFIJO_FOLLOW_AUTOMATIZACION} ${automatizacion.nombre} #${automatizacion.id.slice(0, 6)}`;
}

/** Del nombre del Follow al id corto de su automatización (null si no es de una). */
export function idCortoDelEnvio(nombreDelFollow: string | null | undefined): string | null {
  const nombre = (nombreDelFollow ?? "").trim();
  if (!nombre.startsWith(PREFIJO_FOLLOW_AUTOMATIZACION)) return null;
  const m = /#([A-Za-z0-9-]{1,12})$/.exec(nombre);
  return m ? m[1] : null;
}

/** El mismo orden de las acciones, separado en lo que se hace ya y lo que se envía (en orden). */
export function separarAcciones(acciones: ReadonlyArray<Accion>): { inmediatas: Accion[]; envios: Array<Extract<Accion, { tipo: "enviar_flujo" | "enviar_texto" }>> } {
  const inmediatas: Accion[] = [];
  const envios: Array<Extract<Accion, { tipo: "enviar_flujo" | "enviar_texto" }>> = [];
  for (const accion of acciones) {
    if (esEnvio(accion)) envios.push(accion);
    else inmediatas.push(accion);
  }
  return { inmediatas, envios };
}

/** Le toca correr al reloj (interruptor prendido y ya pasaron 30 min desde la anterior). */
export function leTocaAlReloj(automatizacion: Pick<Automatizacion, "automatica" | "ultimaAutomaticaEn">, ahora: Date): boolean {
  if (!automatizacion.automatica) return false;
  if (!automatizacion.ultimaAutomaticaEn) return true;
  const ultima = new Date(automatizacion.ultimaAutomaticaEn).getTime();
  return !Number.isFinite(ultima) || ahora.getTime() - ultima >= (MINUTOS_ENTRE_AUTOMATICAS - 1) * 60_000;
}

/** Suma una ejecución al historial (lo último primero, máximo HISTORIAL). */
export function conEjecucion(historial: ReadonlyArray<Ejecucion>, ejecucion: Ejecucion): Ejecucion[] {
  return [ejecucion, ...historial].slice(0, HISTORIAL);
}
