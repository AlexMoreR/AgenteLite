/**
 * ANTI-BLOQUEO DE LOS AUTOMÁTICOS: las reglas, en código puro (sin base, sin Next).
 *
 * Nace de la auditoría del 09-10-2026 (Ventas 1, 7 días): 403 seguimientos a 223 chats, 65 % a
 * clientes que solo mandaron el texto del anuncio, 89 fuera de 7–21 h, 108 con la asesora ya a
 * cargo, 25 a descartados, avisos internos por la misma línea y ~4 bloqueos de WhatsApp.
 *
 * Todo lo que está acá lo usan los servicios (servicio.ts), el motor de seguimientos, el reloj del
 * V3, las campañas, los avisos y las pruebas (scripts/check-anti-bloqueo.mjs). Cada medida tiene
 * su interruptor y TODOS vienen APAGADOS: hasta que Alex los prenda, nada cambia.
 *
 * Las medidas:
 *  1. Tope TOTAL por contacto (no por día).
 *  2. Horario de envío para todo automático, con reprogramación (no se descarta).
 *  3. Un solo dueño: chat pausado, asesora escribiendo o etapa cerrada → nada automático.
 *  4. Texto vigente: un seguimiento apagado o editado no sale con el texto viejo.
 *  5. Espaciado: espera aleatoria entre automáticos de una línea y tope por minuto.
 *  6. Avisos internos: por la línea del chat (hoy), por una línea interna o por push.
 */

/* ------------------------------------------------------------------------------------------------
   CONFIGURACIÓN
------------------------------------------------------------------------------------------------ */

export type ViaDeAvisos = "linea_del_chat" | "linea_interna" | "push";

export type ConfigAntiBloqueo = {
  /** 1. Tope total de automáticos por contacto. */
  topeTotal: {
    activo: boolean;
    /** A quien nunca respondió más allá del texto del anuncio: máximo esto, EN TOTAL. */
    sinRespuesta: number;
    /** A quien sí respondió: máximo esto por cada silencio (desde su último mensaje). */
    porSilencio: number;
  };
  /** 2. Horario de envío (hora de Bogotá). Lo de afuera se reprograma a la siguiente apertura. */
  horario: {
    activo: boolean;
    /** Hora de apertura, 0–23 (8 = 8:00 a. m.). */
    desdeHora: number;
    /** Hora de cierre, 1–24 (20 = 8:00 p. m.; a esa hora ya no sale nada). */
    hastaHora: number;
    /** Lo reprogramado sale entre la apertura y la apertura + esto (al azar), no todo junto. */
    desfaseMaxMinutos: number;
  };
  /** 3. Un solo dueño por chat. */
  unDueno: { activo: boolean };
  /** 4. Seguimiento apagado o con texto cambiado: no sale lo agendado con el texto viejo. */
  textoVigente: { activo: boolean };
  /** 5. Espaciado entre automáticos de una misma línea. */
  espaciado: {
    activo: boolean;
    minSegundos: number;
    maxSegundos: number;
    /** Máximo de envíos automáticos por línea en cualquier minuto. */
    porMinuto: number;
  };
  /** 6. Por dónde salen los avisos internos ("🔔 Necesita atención"). */
  avisos: {
    via: ViaDeAvisos;
    /** Línea interna (id de WhatsAppChannel) para `linea_interna`. Vacío = la de la config de avisos. */
    canalInternoId: string | null;
  };
};

export const CONFIG_POR_DEFECTO: ConfigAntiBloqueo = {
  topeTotal: { activo: false, sinRespuesta: 2, porSilencio: 2 },
  horario: { activo: false, desdeHora: 8, hastaHora: 20, desfaseMaxMinutos: 30 },
  unDueno: { activo: false },
  textoVigente: { activo: false },
  espaciado: { activo: false, minSegundos: 20, maxSegundos: 90, porMinuto: 3 },
  avisos: { via: "linea_del_chat", canalInternoId: null },
};

function entero(valor: unknown, porDefecto: number, minimo: number, maximo: number): number {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : Number.NaN;
  if (!Number.isFinite(numero)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, Math.round(numero)));
}

function bandera(valor: unknown, porDefecto: boolean): boolean {
  if (typeof valor === "boolean") return valor;
  if (valor === "true") return true;
  if (valor === "false") return false;
  return porDefecto;
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

/**
 * Lee la configuración guardada (JSON de AppSetting). Lo que falte o esté mal toma el valor por
 * defecto, que es "apagado": un JSON roto nunca prende nada.
 */
export function leerConfigAntiBloqueoDeTexto(texto: string | null | undefined): ConfigAntiBloqueo {
  let crudo: Record<string, unknown> = {};
  try {
    crudo = objeto(texto ? JSON.parse(texto) : null);
  } catch {
    crudo = {};
  }
  const d = CONFIG_POR_DEFECTO;
  const tope = objeto(crudo.topeTotal);
  const horario = objeto(crudo.horario);
  const espaciado = objeto(crudo.espaciado);
  const avisos = objeto(crudo.avisos);

  const desdeHora = entero(horario.desdeHora, d.horario.desdeHora, 0, 23);
  let hastaHora = entero(horario.hastaHora, d.horario.hastaHora, 1, 24);
  if (hastaHora <= desdeHora) hastaHora = Math.min(24, desdeHora + 1);

  const minSegundos = entero(espaciado.minSegundos, d.espaciado.minSegundos, 0, 3600);
  const maxSegundos = Math.max(minSegundos, entero(espaciado.maxSegundos, d.espaciado.maxSegundos, 0, 3600));

  const via = avisos.via === "linea_interna" || avisos.via === "push" ? avisos.via : "linea_del_chat";
  const canalInternoId =
    typeof avisos.canalInternoId === "string" && avisos.canalInternoId.trim() ? avisos.canalInternoId.trim() : null;

  return {
    topeTotal: {
      activo: bandera(tope.activo, d.topeTotal.activo),
      sinRespuesta: entero(tope.sinRespuesta, d.topeTotal.sinRespuesta, 0, 50),
      porSilencio: entero(tope.porSilencio, d.topeTotal.porSilencio, 0, 50),
    },
    horario: {
      activo: bandera(horario.activo, d.horario.activo),
      desdeHora,
      hastaHora,
      desfaseMaxMinutos: entero(horario.desfaseMaxMinutos, d.horario.desfaseMaxMinutos, 0, 240),
    },
    unDueno: { activo: bandera(objeto(crudo.unDueno).activo, d.unDueno.activo) },
    textoVigente: { activo: bandera(objeto(crudo.textoVigente).activo, d.textoVigente.activo) },
    espaciado: {
      activo: bandera(espaciado.activo, d.espaciado.activo),
      minSegundos,
      maxSegundos,
      porMinuto: entero(espaciado.porMinuto, d.espaciado.porMinuto, 1, 60),
    },
    avisos: { via, canalInternoId },
  };
}

/* ------------------------------------------------------------------------------------------------
   MOTIVOS
------------------------------------------------------------------------------------------------ */

/** Por qué no salió (o no salió todavía) un automático. Es lo que se mide antes/después. */
export type MotivoAntiBloqueo =
  | "fuera_de_horario"
  | "tope_sin_respuesta"
  | "tope_por_silencio"
  | "chat_pausado"
  | "asesora_escribio"
  | "etapa_cerrada"
  | "seguimiento_apagado"
  | "texto_cambiado"
  | "espaciado";

/** Los que solo CORREN el envío (se reprograma); el resto lo cancela. */
export const MOTIVOS_QUE_REPROGRAMAN: readonly MotivoAntiBloqueo[] = ["fuera_de_horario", "espaciado"];

/* ------------------------------------------------------------------------------------------------
   2. HORARIO (hora de Bogotá: UTC−5 fijo, Colombia no cambia la hora)
------------------------------------------------------------------------------------------------ */

const DESFASE_BOGOTA_MS = -5 * 3_600_000;
const DIA_MS = 86_400_000;

/** Medianoche de Bogotá (en UTC) del día de esa fecha. */
function medianocheBogota(fecha: Date): number {
  const local = fecha.getTime() + DESFASE_BOGOTA_MS;
  return local - (((local % DIA_MS) + DIA_MS) % DIA_MS) - DESFASE_BOGOTA_MS;
}

/** Minutos desde la medianoche de Bogotá. */
export function minutoDelDiaEnBogota(fecha: Date): number {
  return Math.floor((fecha.getTime() - medianocheBogota(fecha)) / 60_000);
}

type Horario = Pick<ConfigAntiBloqueo["horario"], "desdeHora" | "hastaHora">;

export function dentroDelHorario(fecha: Date, horario: Horario): boolean {
  const minuto = minutoDelDiaEnBogota(fecha);
  return minuto >= horario.desdeHora * 60 && minuto < horario.hastaHora * 60;
}

/** La apertura de HOY (Bogotá) de esa fecha. */
export function aperturaDelDia(fecha: Date, horario: Horario): Date {
  return new Date(medianocheBogota(fecha) + horario.desdeHora * 3_600_000);
}

/** La próxima apertura después de `fecha` (hoy si todavía no abrió, si no mañana). */
export function siguienteApertura(fecha: Date, horario: Horario): Date {
  const hoy = aperturaDelDia(fecha, horario);
  return fecha.getTime() < hoy.getTime() ? hoy : new Date(hoy.getTime() + DIA_MS);
}

/**
 * A dónde se corre un automático que cayó fuera del horario: la siguiente apertura más un desfase
 * al azar, para que lo acumulado de la noche no salga todo a las 8:00 en punto.
 */
export function reprogramarFueraDeHorario(
  fecha: Date,
  horario: Pick<ConfigAntiBloqueo["horario"], "desdeHora" | "hastaHora" | "desfaseMaxMinutos">,
  azar: () => number = Math.random,
): Date {
  const apertura = siguienteApertura(fecha, horario);
  const desfase = Math.floor(Math.max(0, Math.min(0.999999, azar())) * horario.desfaseMaxMinutos * 60_000);
  return new Date(apertura.getTime() + desfase);
}

/** Un número fijo en [0, max] a partir de un texto: el mismo chat siempre cae en el mismo minuto. */
export function desfaseFijo(semilla: string, maxMinutos: number): number {
  if (maxMinutos <= 0) return 0;
  let hash = 2166136261;
  for (let i = 0; i < semilla.length; i += 1) {
    hash ^= semilla.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % (maxMinutos + 1);
}

/**
 * Para el reloj del V3, que no agenda nada: ¿este silencio ya puede recibir su recordatorio?
 *
 * Fuera del horario, no. Dentro, si el silencio empezó ANTES de la apertura de hoy (se quedó
 * esperando la noche), sale recién a la apertura + un desfase fijo por chat: así se reparte en
 * la primera media hora en vez de salir todo a las 8:00.
 *
 * Devuelve null si puede salir ya, o la fecha desde la que puede.
 */
export function esperaDeHorarioV3(input: {
  ahora: Date;
  silencioDesde: Date;
  horario: ConfigAntiBloqueo["horario"];
  semilla: string;
}): Date | null {
  const { ahora, silencioDesde, horario } = input;
  if (!dentroDelHorario(ahora, horario)) {
    return reprogramarFueraDeHorario(ahora, horario, () => desfaseFijo(input.semilla, 1000) / 1001);
  }
  const apertura = aperturaDelDia(ahora, horario);
  if (silencioDesde.getTime() >= apertura.getTime()) {
    return null;
  }
  const desde = new Date(apertura.getTime() + desfaseFijo(input.semilla, horario.desfaseMaxMinutos) * 60_000);
  return ahora.getTime() >= desde.getTime() ? null : desde;
}

/**
 * Desde cuándo mira hacia atrás el reloj del V3 (hoy: 3 horas). Con horario, la noche no cuenta:
 * a las 8:30 mira hasta las 17:30 de ayer (2,5 h de ayer + 0,5 h de hoy), para que el que se calló
 * a las 19:30 reciba su recordatorio a la mañana en vez de perderlo.
 */
export function inicioDeVentanaHabil(ahora: Date, horas: number, horario: ConfigAntiBloqueo["horario"] | null): Date {
  const ventanaMs = horas * 3_600_000;
  const simple = new Date(ahora.getTime() - ventanaMs);
  if (!horario) return simple;
  const apertura = aperturaDelDia(ahora, horario);
  const desdeApertura = ahora.getTime() - apertura.getTime();
  if (desdeApertura < 0 || desdeApertura >= ventanaMs) return simple;
  const cierreDeAyer = apertura.getTime() - DIA_MS + (horario.hastaHora - horario.desdeHora) * 3_600_000;
  return new Date(cierreDeAyer - (ventanaMs - desdeApertura));
}

/* ------------------------------------------------------------------------------------------------
   1. TOPE TOTAL
------------------------------------------------------------------------------------------------ */

/** Mensajes nuestros a menos de esto uno del otro son UN envío (igual que el freno). */
export const MISMO_ENVIO_MS = 60_000;

/** Lo que el cliente escribe en los primeros 2 minutos cuenta como "el texto del anuncio". */
export const VENTANA_DEL_ANUNCIO_MS = 2 * 60_000;

export type HistorialParaTope = {
  /** El primer mensaje del cliente en la charla (null: nunca escribió). */
  primerEntrante: Date | null;
  ultimoEntrante: Date | null;
  /** Mensajes del cliente después de los 2 primeros minutos (0 = solo mandó el anuncio). */
  entrantesDespuesDelAnuncio: number;
  /** Fechas de los automáticos que salieron en la charla (seguimientos, campañas, reactivación). */
  automaticos: Date[];
};

/** Cuántos ENVÍOS hay en esas fechas, juntando los mensajes que salieron en el mismo minuto. */
export function contarEnvios(fechas: Date[]): number {
  const ordenadas = [...fechas].sort((a, b) => a.getTime() - b.getTime());
  let envios = 0;
  let anterior: number | null = null;
  for (const fecha of ordenadas) {
    if (anterior === null || fecha.getTime() - anterior > MISMO_ENVIO_MS) {
      envios += 1;
    }
    anterior = fecha.getTime();
  }
  return envios;
}

export function soloMandoElAnuncio(historial: HistorialParaTope): boolean {
  return historial.primerEntrante === null || historial.entrantesDespuesDelAnuncio === 0;
}

/**
 * ¿Ya se llegó al tope?
 *  - Nunca respondió más allá del anuncio: `sinRespuesta` automáticos EN TOTAL, sin reinicio diario.
 *  - Respondió: `porSilencio` desde su último mensaje (sin reinicio diario: el silencio es uno solo).
 */
export function decidirTope(
  historial: HistorialParaTope,
  tope: Pick<ConfigAntiBloqueo["topeTotal"], "sinRespuesta" | "porSilencio">,
): "tope_sin_respuesta" | "tope_por_silencio" | null {
  if (soloMandoElAnuncio(historial)) {
    return contarEnvios(historial.automaticos) >= tope.sinRespuesta ? "tope_sin_respuesta" : null;
  }
  const desde = historial.ultimoEntrante?.getTime() ?? 0;
  const delSilencio = historial.automaticos.filter((fecha) => fecha.getTime() > desde);
  return contarEnvios(delSilencio) >= tope.porSilencio ? "tope_por_silencio" : null;
}

/* ------------------------------------------------------------------------------------------------
   3. UN SOLO DUEÑO
------------------------------------------------------------------------------------------------ */

/** Desde el celular, lo del primer minuto de un chat nuevo es el automático de la línea, no una persona. */
export const PRIMER_MINUTO_MS = 60_000;

export const ETAPAS_CERRADAS = ["PERDIDO", "GANADO"] as const;

export type EstadoDelDueno = {
  automationPaused: boolean;
  crmStage: string | null;
  inicioDeLaCharla: Date | null;
  /** Mensajes de una persona (CRM = "manual", celular = "instance") desde el último del cliente. */
  mensajesHumanos: Array<{ createdAt: Date; origen: string | null }>;
};

export function esMensajeHumano(
  mensaje: { createdAt: Date; origen: string | null },
  inicioDeLaCharla: Date | null,
): boolean {
  if (mensaje.origen === "manual") return true;
  if (mensaje.origen !== "instance") return false;
  if (!inicioDeLaCharla) return true;
  return mensaje.createdAt.getTime() - inicioDeLaCharla.getTime() >= PRIMER_MINUTO_MS;
}

export function decidirDueno(estado: EstadoDelDueno): "chat_pausado" | "etapa_cerrada" | "asesora_escribio" | null {
  if (estado.crmStage && (ETAPAS_CERRADAS as readonly string[]).includes(estado.crmStage)) {
    return "etapa_cerrada";
  }
  if (estado.automationPaused) {
    return "chat_pausado";
  }
  if (estado.mensajesHumanos.some((mensaje) => esMensajeHumano(mensaje, estado.inicioDeLaCharla))) {
    return "asesora_escribio";
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
   4. TEXTO VIGENTE
------------------------------------------------------------------------------------------------ */

/** Qué clase de Follow es: decide qué medidas le tocan. */
export type ClaseDeFollow = "automatico" | "campana" | "reactivacion" | "humano";

export const NOMBRE_FOLLOW_REACTIVACION = "Mensaje de reactivación";

/**
 * - campana: lo arma una campaña ("Campaña: …"). Horario y espaciado, no dueño ni tope (la campaña
 *   la decidió una persona y tiene su propio freno).
 * - reactivacion: el mensaje de reactivación corrido por el horario.
 * - automatico: nace de una regla, de la etapa del embudo ("Etapa …") o de la escalera del agente
 *   ("Sin responder …"). Le tocan todas las medidas.
 * - humano: lo agendó una asesora (desde el chat o el módulo). Horario y espaciado; no se cancela
 *   por dueño, porque el dueño es ella.
 */
export function clasificarFollow(follow: { name: string | null; followRuleId: string | null }): ClaseDeFollow {
  const nombre = (follow.name ?? "").trim();
  if (nombre.startsWith("Campaña:")) return "campana";
  if (nombre === NOMBRE_FOLLOW_REACTIVACION) return "reactivacion";
  if (follow.followRuleId) return "automatico";
  if (/^(Etapa |Sin responder)/.test(nombre)) return "automatico";
  return "humano";
}

export type AccionComparable = {
  messageType?: string | null;
  content?: string | null;
  mediaUrl?: string | null;
  flowId?: string | null;
};

function normalizarTexto(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\s+/g, " ").trim();
}

/** La "firma" de una acción: lo que el cliente recibiría. Dos firmas iguales = mismo mensaje. */
export function firmaDeAccion(accion: AccionComparable): string {
  const flujo = (accion.flowId ?? "").trim();
  if (flujo) return `flujo:${flujo}`;
  const media = (accion.mediaUrl ?? "").trim();
  const texto = normalizarTexto(accion.content);
  return media ? `media:${(accion.messageType ?? "").toUpperCase()}:${media}|${texto}` : `texto:${texto}`;
}

/** Las firmas de un Follow o de una regla, en orden. */
export function firmasDe(acciones: AccionComparable[]): string[] {
  return acciones.map(firmaDeAccion);
}

/**
 * Compara lo agendado con lo vigente.
 *  - `vigente` null: la definición ya no existe o está apagada → "seguimiento_apagado".
 *  - Con regla (lista ordenada): tiene que ser exactamente lo mismo → si no, "texto_cambiado".
 *  - Sin regla (embudo / escalera): cada firma agendada tiene que estar entre las vigentes.
 */
export function decidirTextoVigente(input: {
  agendado: string[];
  vigente: { tipo: "regla"; firmas: string[] } | { tipo: "conjunto"; firmas: Set<string> } | null;
}): "seguimiento_apagado" | "texto_cambiado" | null {
  if (!input.vigente) return "seguimiento_apagado";
  if (input.vigente.tipo === "regla") {
    const iguales =
      input.vigente.firmas.length === input.agendado.length &&
      input.vigente.firmas.every((firma, i) => firma === input.agendado[i]);
    return iguales ? null : "texto_cambiado";
  }
  if (input.vigente.firmas.size === 0) return "seguimiento_apagado";
  const conjunto = input.vigente.firmas;
  return input.agendado.every((firma) => conjunto.has(firma)) ? null : "texto_cambiado";
}

/* ------------------------------------------------------------------------------------------------
   5. ESPACIADO
------------------------------------------------------------------------------------------------ */

/** Cuánto esperar después de un envío automático en la línea (al azar entre min y max). */
export function siguienteEsperaMs(
  espaciado: Pick<ConfigAntiBloqueo["espaciado"], "minSegundos" | "maxSegundos">,
  azar: () => number = Math.random,
): number {
  const rango = Math.max(0, espaciado.maxSegundos - espaciado.minSegundos);
  return Math.round((espaciado.minSegundos + Math.max(0, Math.min(1, azar())) * rango) * 1000);
}

/**
 * ¿Puede salir ahora un automático por esta línea?
 *  - `proximoPermitido`: lo que dejó marcado el envío anterior (ahora + espera al azar).
 *  - `enviosUltimoMinuto`: automáticos que salieron por la línea en los últimos 60 s.
 * Si no, devuelve desde cuándo puede.
 */
export function decidirEspaciado(input: {
  ahora: Date;
  proximoPermitido: Date | null;
  enviosUltimoMinuto: number;
  /** El más viejo de los del último minuto: cuando sale de la ventana, se libera un cupo. */
  masViejoDelMinuto: Date | null;
  porMinuto: number;
}): { enviar: true } | { enviar: false; desde: Date } {
  const { ahora } = input;
  if (input.proximoPermitido && input.proximoPermitido.getTime() > ahora.getTime()) {
    return { enviar: false, desde: input.proximoPermitido };
  }
  if (input.enviosUltimoMinuto >= input.porMinuto) {
    const libre = input.masViejoDelMinuto ? input.masViejoDelMinuto.getTime() + 60_000 : ahora.getTime() + 60_000;
    return { enviar: false, desde: new Date(Math.max(libre, ahora.getTime() + 1_000)) };
  }
  return { enviar: true };
}

/* ------------------------------------------------------------------------------------------------
   6. AVISOS INTERNOS
------------------------------------------------------------------------------------------------ */

/**
 * Por dónde sale el aviso "🔔 Necesita atención".
 *  - linea_del_chat (hoy): la línea del chat y, si no puede, la de la configuración de avisos.
 *  - linea_interna: SOLO la línea interna (la elegida acá o, si no hay, la de la config de avisos).
 *    Nunca la de ventas del chat, salvo que esa sea justamente la interna.
 *  - push: no sale ningún WhatsApp; notificación del CRM a cada persona.
 */
export function decidirViaDeAvisos(input: {
  avisos: ConfigAntiBloqueo["avisos"];
  canalDelChat: string | null;
  canalDeLaConfig: string | null;
}): { tipo: "whatsapp"; canales: string[] } | { tipo: "push" } {
  if (input.avisos.via === "push") return { tipo: "push" };
  if (input.avisos.via === "linea_interna") {
    const interna = input.avisos.canalInternoId ?? input.canalDeLaConfig;
    return { tipo: "whatsapp", canales: interna ? [interna] : [] };
  }
  return {
    tipo: "whatsapp",
    canales: [input.canalDelChat, input.canalDeLaConfig].filter((id): id is string => Boolean(id)),
  };
}
