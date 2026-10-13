/**
 * CONFIGURACIÓN DEL SEGUIMIENTO INTELIGENTE (código puro).
 *
 * Vive en UNA fila de AppSetting: `seguimiento-inteligente:config:<workspaceId>` (JSON). Sin la
 * fila, o con el JSON roto, TODO queda APAGADO y el CRM se comporta igual que antes.
 *
 * Interruptores (todos apagados por defecto):
 *  - calificacion.activo: calcula temperatura FRÍO/TIBIO/CALIENTE con motivo y producto ("en sombra").
 *  - motor.modo: "apagado" | "sombra" (solo registra lo que HARÍA) | "activo" (ejecuta).
 *  - motor.excepcionesActivas (solo con motor.modo = "sombra"; Alexander 13-10-2026): con
 *    ["formulario", "cotizacion"] el motor ACTÚA solo en el pedido de datos sin respuesta y en la
 *    cotización sin respuesta (tareas en Mi día, prioridad, tope y reparto). Todo lo demás sigue en
 *    sombra y NUNCA frena, reemplaza ni suprime los automáticos. Vacío = la sombra de siempre.
 *  - cadencia.descarte: "apagado" | "sombra" | "activo" (descartar tras los toques sin respuesta).
 *  - exterior.activo: atender una vez y excluir a los teléfonos de fuera de Colombia.
 *  - formulario.activo (PRENDIDO por defecto, solo actúa con el motor en sombra/activo): tareas a
 *    las 2 h / 24 h / 72 h cuando la asesora pidió los datos y el cliente no responde.
 *  - trasAsesora.modo: "apagado" | "sombra" | "activo" (automáticos de 1 h y día siguiente después
 *    de que escribe la asesora, con la IA pausada; Alexander 12-10-2026).
 *  - recuperacion72h.modo: "apagado" | "sombra" | "activo" (último intento humano a las 72 h).
 */

import { RECURSOS_POR_DEFECTO, type Recurso } from "./producto";

export type ModoDelMotor = "apagado" | "sombra" | "activo";

/** Lo que el motor puede ejecutar estando en sombra (`motor.excepcionesActivas`). */
export type ExcepcionDelMotor = "formulario" | "cotizacion";
export const EXCEPCIONES_DEL_MOTOR: ExcepcionDelMotor[] = ["formulario", "cotizacion"];

/** Los motivos de decisión (dominio/motor.ts) que pertenecen a cada excepción. */
export const MOTIVOS_DE_EXCEPCION: Record<ExcepcionDelMotor, string[]> = {
  formulario: ["formulario_sin_respuesta", "formulario_esperando_escalon"],
  cotizacion: ["cotizacion_sin_respuesta", "cotizacion_esperando_escalon"],
};

export type ConfigSeguimientoInteligente = {
  calificacion: {
    activo: boolean;
    /** Puntos que se restan por cada 24 h de silencio del cliente. */
    caidaPorDia: number;
    /** "¿Cuánto vale la camilla X?" con el producto identificado cuenta como pregunta concreta (Tibio). */
    precioConProductoEsTibio: boolean;
  };
  motor: {
    modo: ModoDelMotor;
    /**
     * SOLO EXCEPCIONES (Alexander, 13-10-2026: "prender el inteligente solo para formulario y
     * cotización"). Con `modo: "sombra"`, las decisiones de estas reglas se EJECUTAN como en activo
     * (tarea en Mi día, prioridad, tope y reparto) y el resto sigue en sombra. Con "activo" o
     * "apagado" no cambia nada. Vacío (por defecto) = la sombra de siempre.
     */
    excepcionesActivas: ExcepcionDelMotor[];
    /** Minutos de silencio (después de que LEYÓ) antes del mensaje útil a un Frío. */
    minutosParaMensajeUtil: number;
    /** Pasado esto desde nuestro último mensaje, ya no se le manda el mensaje útil. */
    horasMaximasMensajeUtil: number;
    /** Mensajes útiles automáticos por lead ANTES de que escriba una asesora. */
    maxMensajesUtiles: number;
    /** Franja de los automáticos (hora de Bogotá). */
    desdeHora: number;
    hastaHora: number;
    /** Hasta cuántos días después del último mensaje del cliente se sigue mirando un lead. */
    diasDeSeguimiento: number;
    /** Plazo de la tarea cuando el cliente está esperando: A (caliente) y B (tibio), en minutos. */
    minutosTareaA: number;
    minutosTareaB: number;
    /**
     * Si es true, "no leyó nuestro último mensaje" = no insistir y los toques de la cadencia se
     * saltan. APAGADO desde el 11-10-2026 (Alexander). No se lee de este JSON: lo pone
     * servicios/config.ts desde el interruptor `noLeido.activo` del anti-bloqueo (uno solo para todo).
     */
    respetarNoLeido: boolean;
  };
  /** Después de que la asesora escribió y el cliente no responde. */
  cadencia: {
    /** Días (desde el primer mensaje de la asesora sin respuesta) de cada toque. Alexander: [3, 4, 7]. */
    dias: number[];
    /** Descartar (PERDIDO "Sin respuesta") tras el último toque sin respuesta. */
    descarte: ModoDelMotor;
    /** Horas de gracia después del último toque antes de descartar. */
    horasDeGracia: number;
    /** Automáticos por silencio (igual que el tope del anti-bloqueo): pasado esto, el toque de un Frío es tarea. */
    maxAutomaticos: number;
  };
  cotizacion: {
    /** Horas después de la cotización para la tarea humana. */
    horas: number[];
    /** Una cotización cuenta como "abierta" (no se descarta) durante estos días. */
    diasVigente: number;
  };
  /**
   * La asesora pidió los datos (formulario para cotizar / separar) y el cliente no responde
   * (Alexander, 11-10-2026): tareas a las 2 h, 24 h y 72 h en horario laboral; después sigue la
   * lógica de siempre. PRENDIDO por defecto; con `activo: false` todo queda exactamente como antes.
   */
  formulario: {
    activo: boolean;
    /** Horas después del pedido de datos para cada tarea. */
    horas: number[];
    /** Horario laboral (Bogotá) para correr la tarea que cae fuera: el mismo del Supervisor. */
    desdeHora: number;
    hastaHora: number;
    /** Días hábiles (0 = domingo … 6 = sábado). */
    dias: number[];
  };
  /** Tope de tareas por asesora (Alexander, 10-10-2026: máximo 15 al día). */
  tareas: {
    /** Máximo de tareas nuevas por asesora en un día (Bogotá). 0 = sin tope. */
    maxPorAsesoraDia: number;
  };
  fechaFutura: {
    /** Días antes de la fecha dicha para la tarea de retomar. */
    diasAntes: number;
  };
  /** Cómo conviven los seguimientos genéricos de hoy con el motor ACTIVO. */
  convivencia: {
    /** Para los Fríos que maneja el motor, los genéricos se reemplazan por el mensaje útil. */
    reemplazarGenericosEnFrios: boolean;
    /** Reglas "sin respuesta" del V3 que se reemplazan. Vacío = todas. */
    reglasV3: string[];
    /** Reemplazar también los seguimientos de etapa del embudo ("Etapa …") del motor Follow. */
    followsDeEtapa: boolean;
  };
  exterior: {
    activo: boolean;
    texto: string;
  };
  /** Recursos de mensaje útil por familia (se mezclan con los de por defecto). */
  recursos: Record<string, Recurso>;
  /**
   * TURNO DE LA CONVERSACIÓN (lib/turno-de-la-conversacion.ts). No se lee de este JSON: lo pone
   * servicios/config.ts desde `turno:config:<ws>`. Apagado = todo como antes.
   *  - activo: si el bot ya respondió (sin pedir asesora, sin señal fuerte) y esperamos al cliente,
   *    un TIBIO o FRÍO no es tarea ni frena / reemplaza los automáticos (V3 / Follow) ni el descarte.
   *  - cadenciaSinTarea: los toques de los días 3/4/7 a un TIBIO o FRÍO que la asesora ya atendió
   *    tampoco son tarea (se dan por hechos: siguen los automáticos y el descarte).
   */
  turno: { activo: boolean; cadenciaSinTarea: boolean };
  /**
   * AUTOMÁTICOS DESPUÉS DE LA ASESORA (Alexander, 12-10-2026: "sí siguen"). Con el chat pausado
   * porque escribió una persona y el cliente callado, salen los toques de `horas` (1 h y al día
   * siguiente) como seguimiento automático (pasan por el anti-bloqueo y el freno de siempre). La IA
   * sigue pausada: no le contesta al cliente. "apagado" = exactamente como antes (no sale nada).
   */
  trasAsesora: {
    modo: ModoDelMotor;
    /** Horas desde el último mensaje de la persona para cada toque. */
    horas: number[];
    /** Un toque vencido hace más de esto ya no sale (sale el siguiente, o nada). */
    horasDeGracia: number;
    /** Texto de cada toque (en el orden de `horas`). {nombre} = "¡Hola, Ana!" o "¡Hola!". */
    textos: string[];
    /**
     * Máximo de toques agendados por día (Bogotá) en el negocio. 0 = sin tope. Freno de seguridad:
     * el 5-oct las asesoras escribieron a 190 chats en un día y al otro saldrían ~360 automáticos.
     */
    maxPorDia: number;
  };
  /**
   * RECUPERACIÓN 72 HORAS (propuesta del 12-10-2026): a las 72 h sin respuesta, último intento
   * humano (llamada → audio → 24 h) antes de "Descartado — Sin respuesta". Independiente de
   * `motor.modo` (como `cadencia.descarte`).
   */
  recuperacion72h: {
    modo: ModoDelMotor;
    horas: number;
    horasTrasAudio: number;
    /** Solo los que escribieron algo más que el texto del anuncio. */
    soloConversaron: boolean;
    /** Sin llamada registrada el audio no cuenta (decisión pendiente: por defecto se exige). */
    exigirLlamada: boolean;
    /** No entran los que llevan más de esto callados (al prender no se barre todo el historial). */
    diasMaximos: number;
    /** Horario laboral (Bogotá): las tareas aparecen y los descartes se hacen solo dentro. */
    desdeHora: number;
    hastaHora: number;
    dias: number[];
    /** Quién aprueba el descarte de intención fuerte. null = la supervisora del Supervisor accionable. */
    aprobadorId: string | null;
  };
};

export const TEXTO_EXTERIOR_POR_DEFECTO =
  "¡Hola! 😊 Gracias por escribirnos. Por ahora solo vendemos y enviamos dentro de *Colombia*. Si estás en Colombia, cuéntame en qué ciudad y con gusto te ayudo 🙌";

export const CONFIG_POR_DEFECTO: ConfigSeguimientoInteligente = {
  calificacion: { activo: false, caidaPorDia: 1, precioConProductoEsTibio: true },
  motor: {
    modo: "apagado",
    excepcionesActivas: [],
    minutosParaMensajeUtil: 60,
    horasMaximasMensajeUtil: 48,
    maxMensajesUtiles: 1,
    desdeHora: 8,
    hastaHora: 20,
    diasDeSeguimiento: 10,
    minutosTareaA: 15,
    minutosTareaB: 30,
    respetarNoLeido: false,
  },
  // maxAutomaticos sigue al tope del anti-bloqueo (Alexander, 12-10-2026: de 2 a 3).
  cadencia: { dias: [3, 4, 7], descarte: "apagado", horasDeGracia: 24, maxAutomaticos: 3 },
  cotizacion: { horas: [24, 72], diasVigente: 30 },
  formulario: { activo: true, horas: [2, 24, 72], desdeHora: 8, hastaHora: 18, dias: [1, 2, 3, 4, 5, 6] },
  tareas: { maxPorAsesoraDia: 15 },
  fechaFutura: { diasAntes: 7 },
  convivencia: { reemplazarGenericosEnFrios: true, reglasV3: [], followsDeEtapa: true },
  exterior: { activo: false, texto: TEXTO_EXTERIOR_POR_DEFECTO },
  recursos: RECURSOS_POR_DEFECTO,
  turno: { activo: false, cadenciaSinTarea: true },
  trasAsesora: {
    modo: "apagado",
    horas: [1, 24],
    horasDeGracia: 6,
    maxPorDia: 80,
    textos: [
      "{nombre} ¿Pudiste ver lo que te envié? 😊 Si te queda alguna duda, aquí estoy para ayudarte.",
      "{nombre} Te escribo para saber si pudiste revisar la información 😊 ¿Te ayudo con el envío a tu ciudad o con la forma de pago?",
    ],
  },
  recuperacion72h: {
    modo: "apagado",
    horas: 72,
    horasTrasAudio: 24,
    soloConversaron: true,
    exigirLlamada: true,
    diasMaximos: 7,
    desdeHora: 8,
    hastaHora: 18,
    dias: [1, 2, 3, 4, 5, 6],
    aprobadorId: null,
  },
};

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function bandera(valor: unknown, porDefecto: boolean): boolean {
  if (typeof valor === "boolean") return valor;
  if (valor === "true") return true;
  if (valor === "false") return false;
  return porDefecto;
}

function numero(valor: unknown, porDefecto: number, minimo: number, maximo: number): number {
  const n = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : Number.NaN;
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, n));
}

function modo(valor: unknown): ModoDelMotor {
  return valor === "sombra" || valor === "activo" ? valor : "apagado";
}

function listaDeNumeros(valor: unknown, porDefecto: number[], maximo: number): number[] {
  if (!Array.isArray(valor)) return porDefecto;
  const lista = valor.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0 && x <= maximo);
  return lista.length ? [...new Set(lista)].sort((a, b) => a - b) : porDefecto;
}

function recursos(valor: unknown): Record<string, Recurso> {
  const salida: Record<string, Recurso> = { ...RECURSOS_POR_DEFECTO };
  for (const [clave, crudo] of Object.entries(objeto(valor))) {
    const r = objeto(crudo);
    if (crudo === null || r.tipo === "ninguno") {
      delete salida[clave];
    } else if (r.tipo === "flujo" && typeof r.flujoId === "string") {
      salida[clave] = {
        tipo: "flujo",
        flujoId: r.flujoId,
        titulo: typeof r.titulo === "string" ? r.titulo : "Catálogo",
        textoSiYaLoVio: typeof r.textoSiYaLoVio === "string" ? r.textoSiYaLoVio : "¿Cuál te gustó más? 😊",
      };
    } else if (r.tipo === "media" && typeof r.mediaUrl === "string" && typeof r.texto === "string") {
      salida[clave] = {
        tipo: "media",
        mediaTipo: r.mediaTipo === "IMAGE" ? "IMAGE" : "VIDEO",
        mediaUrl: r.mediaUrl,
        texto: r.texto,
        textoSiYaLoVio: typeof r.textoSiYaLoVio === "string" ? r.textoSiYaLoVio : r.texto,
      };
    } else if (r.tipo === "texto" && typeof r.texto === "string") {
      salida[clave] = { tipo: "texto", texto: r.texto };
    }
  }
  return salida;
}

/** Lee la configuración guardada. Lo que falte o esté mal toma el valor por defecto (apagado). */
export function leerConfigDeTexto(texto: string | null | undefined): ConfigSeguimientoInteligente {
  let crudo: Record<string, unknown> = {};
  try {
    crudo = objeto(texto ? JSON.parse(texto) : null);
  } catch {
    crudo = {};
  }
  const d = CONFIG_POR_DEFECTO;
  const cal = objeto(crudo.calificacion);
  const mot = objeto(crudo.motor);
  const cad = objeto(crudo.cadencia);
  const cot = objeto(crudo.cotizacion);
  const fut = objeto(crudo.fechaFutura);
  const con = objeto(crudo.convivencia);
  const ext = objeto(crudo.exterior);
  const frm = objeto(crudo.formulario);
  const tra = objeto(crudo.trasAsesora);
  const rec = objeto(crudo.recuperacion72h);
  const recDesde = numero(rec.desdeHora, d.recuperacion72h.desdeHora, 0, 23);
  let recHasta = numero(rec.hastaHora, d.recuperacion72h.hastaHora, 1, 24);
  if (recHasta <= recDesde) recHasta = Math.min(24, recDesde + 1);
  const recDias = Array.isArray(rec.dias)
    ? [...new Set(rec.dias.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort((a, b) => a - b)
    : d.recuperacion72h.dias;
  const traHoras = listaDeNumeros(tra.horas, d.trasAsesora.horas, 7 * 24);
  const traTextos = Array.isArray(tra.textos) ? tra.textos.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  const frmDesde = numero(frm.desdeHora, d.formulario.desdeHora, 0, 23);
  let frmHasta = numero(frm.hastaHora, d.formulario.hastaHora, 1, 24);
  if (frmHasta <= frmDesde) frmHasta = Math.min(24, frmDesde + 1);
  const frmDias = Array.isArray(frm.dias)
    ? [...new Set(frm.dias.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort((a, b) => a - b)
    : d.formulario.dias;
  const desdeHora = numero(mot.desdeHora, d.motor.desdeHora, 0, 23);
  let hastaHora = numero(mot.hastaHora, d.motor.hastaHora, 1, 24);
  if (hastaHora <= desdeHora) hastaHora = Math.min(24, desdeHora + 1);
  const textoExterior = typeof ext.texto === "string" && ext.texto.trim() ? ext.texto.trim() : d.exterior.texto;
  return {
    calificacion: {
      activo: bandera(cal.activo, d.calificacion.activo),
      caidaPorDia: numero(cal.caidaPorDia, d.calificacion.caidaPorDia, 0, 10),
      precioConProductoEsTibio: bandera(cal.precioConProductoEsTibio, d.calificacion.precioConProductoEsTibio),
    },
    motor: {
      modo: modo(mot.modo),
      excepcionesActivas: Array.isArray(mot.excepcionesActivas)
        ? EXCEPCIONES_DEL_MOTOR.filter((e) => (mot.excepcionesActivas as unknown[]).includes(e))
        : d.motor.excepcionesActivas,
      minutosParaMensajeUtil: numero(mot.minutosParaMensajeUtil, d.motor.minutosParaMensajeUtil, 5, 7 * 24 * 60),
      horasMaximasMensajeUtil: numero(mot.horasMaximasMensajeUtil, d.motor.horasMaximasMensajeUtil, 1, 30 * 24),
      maxMensajesUtiles: Math.round(numero(mot.maxMensajesUtiles, d.motor.maxMensajesUtiles, 0, 3)),
      desdeHora,
      hastaHora,
      diasDeSeguimiento: numero(mot.diasDeSeguimiento, d.motor.diasDeSeguimiento, 1, 60),
      minutosTareaA: numero(mot.minutosTareaA, d.motor.minutosTareaA, 1, 24 * 60),
      minutosTareaB: numero(mot.minutosTareaB, d.motor.minutosTareaB, 1, 24 * 60),
      respetarNoLeido: d.motor.respetarNoLeido,
    },
    cadencia: {
      dias: listaDeNumeros(cad.dias, d.cadencia.dias, 60),
      descarte: modo(cad.descarte),
      horasDeGracia: numero(cad.horasDeGracia, d.cadencia.horasDeGracia, 0, 30 * 24),
      maxAutomaticos: Math.round(numero(cad.maxAutomaticos, d.cadencia.maxAutomaticos, 0, 10)),
    },
    cotizacion: {
      horas: listaDeNumeros(cot.horas, d.cotizacion.horas, 30 * 24),
      diasVigente: numero(cot.diasVigente, d.cotizacion.diasVigente, 1, 365),
    },
    formulario: {
      activo: bandera(frm.activo, d.formulario.activo),
      horas: listaDeNumeros(frm.horas, d.formulario.horas, 30 * 24),
      desdeHora: frmDesde,
      hastaHora: frmHasta,
      dias: frmDias.length ? frmDias : d.formulario.dias,
    },
    tareas: { maxPorAsesoraDia: Math.round(numero(objeto(crudo.tareas).maxPorAsesoraDia, d.tareas.maxPorAsesoraDia, 0, 500)) },
    fechaFutura: { diasAntes: numero(fut.diasAntes, d.fechaFutura.diasAntes, 0, 60) },
    convivencia: {
      reemplazarGenericosEnFrios: bandera(con.reemplazarGenericosEnFrios, d.convivencia.reemplazarGenericosEnFrios),
      reglasV3: Array.isArray(con.reglasV3) ? con.reglasV3.filter((x): x is string => typeof x === "string") : d.convivencia.reglasV3,
      followsDeEtapa: bandera(con.followsDeEtapa, d.convivencia.followsDeEtapa),
    },
    exterior: { activo: bandera(ext.activo, d.exterior.activo), texto: textoExterior },
    recursos: recursos(crudo.recursos),
    turno: { ...d.turno },
    trasAsesora: {
      modo: modo(tra.modo),
      horas: traHoras,
      horasDeGracia: numero(tra.horasDeGracia, d.trasAsesora.horasDeGracia, 0, 7 * 24),
      maxPorDia: Math.round(numero(tra.maxPorDia, d.trasAsesora.maxPorDia, 0, 5000)),
      // Un texto por toque: lo que falte se completa con los de por defecto (o el último).
      textos: traHoras.map((_, i) => traTextos[i] ?? d.trasAsesora.textos[i] ?? d.trasAsesora.textos[d.trasAsesora.textos.length - 1]),
    },
    recuperacion72h: {
      modo: modo(rec.modo),
      horas: numero(rec.horas, d.recuperacion72h.horas, 1, 30 * 24),
      horasTrasAudio: numero(rec.horasTrasAudio, d.recuperacion72h.horasTrasAudio, 1, 30 * 24),
      soloConversaron: bandera(rec.soloConversaron, d.recuperacion72h.soloConversaron),
      exigirLlamada: bandera(rec.exigirLlamada, d.recuperacion72h.exigirLlamada),
      diasMaximos: numero(rec.diasMaximos, d.recuperacion72h.diasMaximos, 1, 60),
      desdeHora: recDesde,
      hastaHora: recHasta,
      dias: recDias.length ? recDias : d.recuperacion72h.dias,
      aprobadorId: typeof rec.aprobadorId === "string" && rec.aprobadorId.trim() ? rec.aprobadorId.trim() : null,
    },
  };
}

/** Las excepciones que de verdad actúan: solo con el motor en sombra (en activo ya actúa todo). */
export function excepcionesQueActuan(config: ConfigSeguimientoInteligente): ExcepcionDelMotor[] {
  return config.motor.modo === "sombra" ? (config.motor.excepcionesActivas ?? []) : [];
}

/** ¿Este motivo de decisión es de una excepción que actúa (formulario / cotización)? */
export function esExcepcionQueActua(motivo: string | null | undefined, config: ConfigSeguimientoInteligente): boolean {
  if (!motivo) return false;
  return excepcionesQueActuan(config).some((e) => MOTIVOS_DE_EXCEPCION[e].includes(motivo));
}

/** ¿Hay algo prendido? (para salir rápido en el reloj y en el webhook). */
export function algoPrendido(config: ConfigSeguimientoInteligente): boolean {
  return (
    config.calificacion.activo ||
    config.motor.modo !== "apagado" ||
    config.exterior.activo ||
    config.cadencia.descarte !== "apagado" ||
    (config.trasAsesora?.modo ?? "apagado") !== "apagado" ||
    (config.recuperacion72h?.modo ?? "apagado") !== "apagado"
  );
}
