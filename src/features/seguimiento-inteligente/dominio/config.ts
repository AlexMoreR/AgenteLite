/**
 * CONFIGURACIÓN DEL SEGUIMIENTO INTELIGENTE (código puro).
 *
 * Vive en UNA fila de AppSetting: `seguimiento-inteligente:config:<workspaceId>` (JSON). Sin la
 * fila, o con el JSON roto, TODO queda APAGADO y el CRM se comporta igual que antes.
 *
 * Interruptores (todos apagados por defecto):
 *  - calificacion.activo: calcula temperatura FRÍO/TIBIO/CALIENTE con motivo y producto ("en sombra").
 *  - motor.modo: "apagado" | "sombra" (solo registra lo que HARÍA) | "activo" (ejecuta).
 *  - cadencia.descarte: "apagado" | "sombra" | "activo" (descartar tras los toques sin respuesta).
 *  - exterior.activo: atender una vez y excluir a los teléfonos de fuera de Colombia.
 */

import { RECURSOS_POR_DEFECTO, type Recurso } from "./producto";

export type ModoDelMotor = "apagado" | "sombra" | "activo";

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
};

export const TEXTO_EXTERIOR_POR_DEFECTO =
  "¡Hola! 😊 Gracias por escribirnos. Por ahora solo vendemos y enviamos dentro de *Colombia*. Si estás en Colombia, cuéntame en qué ciudad y con gusto te ayudo 🙌";

export const CONFIG_POR_DEFECTO: ConfigSeguimientoInteligente = {
  calificacion: { activo: false, caidaPorDia: 1, precioConProductoEsTibio: true },
  motor: {
    modo: "apagado",
    minutosParaMensajeUtil: 60,
    horasMaximasMensajeUtil: 48,
    maxMensajesUtiles: 1,
    desdeHora: 8,
    hastaHora: 20,
    diasDeSeguimiento: 10,
    minutosTareaA: 15,
    minutosTareaB: 30,
  },
  cadencia: { dias: [3, 4, 7], descarte: "apagado", horasDeGracia: 24, maxAutomaticos: 2 },
  cotizacion: { horas: [24, 72], diasVigente: 30 },
  tareas: { maxPorAsesoraDia: 15 },
  fechaFutura: { diasAntes: 7 },
  convivencia: { reemplazarGenericosEnFrios: true, reglasV3: [], followsDeEtapa: true },
  exterior: { activo: false, texto: TEXTO_EXTERIOR_POR_DEFECTO },
  recursos: RECURSOS_POR_DEFECTO,
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
      minutosParaMensajeUtil: numero(mot.minutosParaMensajeUtil, d.motor.minutosParaMensajeUtil, 5, 7 * 24 * 60),
      horasMaximasMensajeUtil: numero(mot.horasMaximasMensajeUtil, d.motor.horasMaximasMensajeUtil, 1, 30 * 24),
      maxMensajesUtiles: Math.round(numero(mot.maxMensajesUtiles, d.motor.maxMensajesUtiles, 0, 3)),
      desdeHora,
      hastaHora,
      diasDeSeguimiento: numero(mot.diasDeSeguimiento, d.motor.diasDeSeguimiento, 1, 60),
      minutosTareaA: numero(mot.minutosTareaA, d.motor.minutosTareaA, 1, 24 * 60),
      minutosTareaB: numero(mot.minutosTareaB, d.motor.minutosTareaB, 1, 24 * 60),
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
    tareas: { maxPorAsesoraDia: Math.round(numero(objeto(crudo.tareas).maxPorAsesoraDia, d.tareas.maxPorAsesoraDia, 0, 500)) },
    fechaFutura: { diasAntes: numero(fut.diasAntes, d.fechaFutura.diasAntes, 0, 60) },
    convivencia: {
      reemplazarGenericosEnFrios: bandera(con.reemplazarGenericosEnFrios, d.convivencia.reemplazarGenericosEnFrios),
      reglasV3: Array.isArray(con.reglasV3) ? con.reglasV3.filter((x): x is string => typeof x === "string") : d.convivencia.reglasV3,
      followsDeEtapa: bandera(con.followsDeEtapa, d.convivencia.followsDeEtapa),
    },
    exterior: { activo: bandera(ext.activo, d.exterior.activo), texto: textoExterior },
    recursos: recursos(crudo.recursos),
  };
}

/** ¿Hay algo prendido? (para salir rápido en el reloj y en el webhook). */
export function algoPrendido(config: ConfigSeguimientoInteligente): boolean {
  return config.calificacion.activo || config.motor.modo !== "apagado" || config.exterior.activo || config.cadencia.descarte !== "apagado";
}
