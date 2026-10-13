/**
 * RECUPERACIÓN 72 HORAS (código puro). Propuesta del 12-10-2026 con las decisiones de Alexander.
 *
 * A las 72 h sin respuesta (contadas desde nuestro PRIMER mensaje sin contestar después del último
 * del cliente) no se descarta: una asesora hace el último intento humano.
 *
 *   llamar     tarea "Último intento · Llamar" (prioridad A con intención fuerte, B si no)
 *   audio      la llamada quedó "no contestó": "Enviar audio corto" con guion sugerido
 *   espera     audio enviado (mensaje AUDIO de una persona después de la llamada): 24 h de reloj
 *   descartar  sin respuesta en esas 24 h → "Descartado — Sin respuesta" (solo en horario laboral)
 *   llamar_2   intención fuerte: segunda llamada en otra franja (mañana ↔ tarde), prioridad A
 *   aprobacion intención fuerte: nunca se descarta sola; queda para que la apruebe la supervisora
 *
 * Si el cliente escribe o contesta una llamada, sale solo (no hay silencio o hay llamada contestada).
 * Candado: sin llamada registrada y audio NO hay descarte.
 *
 * Es la misma función para el reloj (sombra y activo), las pruebas y la simulación.
 */

import { esMensajeHumano } from "../../../lib/anti-bloqueo/reglas";
import { mandoSusDatos } from "../../../lib/turno-de-la-conversacion";
import type { ConfigSeguimientoInteligente } from "./config";
import { dentroDelHorarioLaboral, esPedidoDeDatos, siguienteHoraLaboral, type Horario } from "./formulario";
import type { MensajeCrudo } from "./motor";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

export const MOTIVO_RECUPERACION = "recuperacion_72h";

/** Lo que el cliente escribe en los primeros 2 minutos es el texto del anuncio (igual que el anti-bloqueo). */
const VENTANA_DEL_ANUNCIO_MS = 2 * MIN;

export type FaseRecuperacion = "llamar" | "audio" | "espera" | "llamar_2" | "aprobacion" | "descartar";

export type LlamadaDelLead = { en: Date; resultado: string };

/** Resultados de CallAttempt que NO son una conversación con el cliente. */
export const LLAMADA_NO_CONTESTADA = "no_contesto";

/** ¿La llamada conectó? Todo lo que no sea "no contestó" (incluido "por registrar": hablaron). */
export function llamadaContestada(resultado: string): boolean {
  return resultado !== LLAMADA_NO_CONTESTADA;
}

/** Señales del embudo que cuentan como intención FUERTE (las del informe; color es media). */
export const SENALES_FUERTES = ["separar", "anticipo_pago", "acepta_precio", "pide_cotizacion", "direccion_fecha", "comprobante", "decision_proxima"];

export type IntencionFuerte = { fuerte: boolean; motivo: string | null };

/**
 * Intención fuerte (basta una): señal fuerte del cliente, Caliente / NEGOCIACIÓN, cotización
 * enviada o anticipo, el cliente mandó datos después de que se los pidieron, o llegó al paso CIERRE.
 */
export function intencionFuerte(input: {
  senales: Array<{ tipo: string; grupo?: string }>;
  temperaturaBase: string | null;
  etapaCrm: string | null;
  cotizacionEn: Date | null;
  anticipoEn?: Date | null;
  pasoMaximo?: string | null;
  mensajes: MensajeCrudo[];
  inicio: Date | null;
}): IntencionFuerte {
  const senal = input.senales.find((s) => SENALES_FUERTES.includes(s.tipo));
  if (senal) return { fuerte: true, motivo: `señal: ${senal.tipo.replace(/_/g, " ")}` };
  if (input.temperaturaBase === "CALIENTE") return { fuerte: true, motivo: "caliente" };
  if (input.etapaCrm === "NEGOCIACION") return { fuerte: true, motivo: "etapa caliente" };
  if (input.cotizacionEn) return { fuerte: true, motivo: "cotización enviada" };
  if (input.anticipoEn) return { fuerte: true, motivo: "anticipo" };
  if (input.pasoMaximo === "CIERRE") return { fuerte: true, motivo: "llegó al cierre" };
  const pedido = input.mensajes.find(
    (m) => m.direccion === "OUT" && esMensajeHumano({ createdAt: m.en, origen: m.origen }, input.inicio) && esPedidoDeDatos(m.texto),
  );
  if (pedido && input.mensajes.some((m) => m.direccion === "IN" && m.en.getTime() > pedido.en.getTime() && mandoSusDatos(m.texto))) {
    return { fuerte: true, motivo: "mandó sus datos" };
  }
  return { fuerte: false, motivo: null };
}

/* ------------------------------------------------------------------------------------------------
   MENSAJES (los copia / graba la asesora; el sistema no le escribe al cliente)
------------------------------------------------------------------------------------------------ */

function primerNombre(nombre: string | null): string | null {
  const limpio = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return limpio && /^[\p{L}]{2,20}$/u.test(limpio) ? `${limpio[0].toUpperCase()}${limpio.slice(1).toLowerCase()}` : null;
}

/** Lo último que preguntó o dijo el cliente, corto, para el guion ("me quedé con tu pregunta…"). */
export function ultimaFraseDelCliente(mensajes: MensajeCrudo[]): string | null {
  const delCliente = mensajes.filter((m) => m.direccion === "IN" && (m.texto ?? "").trim().length >= 6);
  const conPregunta = [...delCliente].reverse().find((m) => (m.texto ?? "").includes("?"));
  const elegido = conPregunta ?? delCliente.at(-1) ?? null;
  if (!elegido) return null;
  const texto = (elegido.texto ?? "").replace(/\s+/g, " ").trim();
  return texto.length > 70 ? `${texto.slice(0, 67).trim()}…` : texto;
}

/** Guion del audio de 20–30 s (se dice, no se escribe: sin emojis ni negritas). */
export function guionDeAudio(input: { nombre: string | null; producto: string | null; frase: string | null }): string {
  const nombre = primerNombre(input.nombre);
  const producto = input.producto ? `el ${input.producto}` : "lo que estabas mirando";
  const frase = input.frase ? ` Me quedé con lo último que me dijiste: «${input.frase}».` : "";
  return (
    `Hola${nombre ? ` ${nombre}` : ""}, te habla [tu nombre], de Magilus. Te acabo de llamar por ${producto}.${frase} ` +
    "Quería saber si todavía lo necesitas: te ayudo con el precio, el envío a tu ciudad y la forma de pago, y te lo dejo listo. " +
    "Respóndeme por aquí cuando lo veas. ¡Que estés muy bien!"
  );
}

/** Intención fuerte, segundo intento: un mensaje escrito con la cifra concreta (precio + envío + anticipo). */
export function mensajeConCifra(input: { nombre: string | null; producto: string | null; total: string | null }): string {
  const nombre = primerNombre(input.nombre);
  const producto = input.producto ? `tu *${input.producto}*` : "tu pedido";
  return (
    `¡Hola${nombre ? `, ${nombre}` : ""}! Te dejo todo claro para que decidas 😊 ${producto} en *${input.total ?? "[precio]"}* + envío a tu ciudad *[valor según la tabla de envíos]*. ` +
    "Lo separas con el *50 %* y el otro *50 %* cuando esté terminado, después de enviarte fotos y video. ¿Te lo dejo separado?"
  );
}

/* ------------------------------------------------------------------------------------------------
   LA REGLA
------------------------------------------------------------------------------------------------ */

export type EstadoDeRecuperacion = {
  fase: FaseRecuperacion;
  prioridad: "A" | "B";
  /** Nuestro primer mensaje sin contestar (empieza el silencio). */
  silencioDesde: Date;
  /** silencioDesde + 72 h. */
  entradaEn: Date;
  llamadaEn: Date | null;
  segundaLlamadaEn: Date | null;
  audioEn: Date | null;
  /** audio + 24 h. */
  plazoEn: Date | null;
  /** Para cuándo es la tarea de la fase (en horario laboral). */
  venceTarea: Date | null;
  revisarEn: Date;
  fuerte: boolean;
  motivoFuerte: string | null;
  mensajeSugerido: string | null;
};

export type ResultadoDeRecuperacion =
  | { tipo: "fuera"; motivo: string; despertarEn: Date | null }
  | { tipo: "recuperado"; motivo: "llamada_contestada"; silencioDesde: Date; entradaEn: Date }
  | { tipo: "dentro"; estado: EstadoDeRecuperacion };

export type EntradaDeRecuperacion = {
  mensajes: MensajeCrudo[];
  llamadas: LlamadaDelLead[];
  inicio: Date | null;
  /** false si el historial visible está recortado (charla larga: conversó seguro). */
  historialCompleto: boolean;
  etapaCrm: string | null;
  exterior: boolean;
  noInteresa: boolean;
  /** Dormido por una fecha futura de compra (todavía no llega su tarea). */
  dormido: boolean;
  cotizacionVigente: boolean;
  intencion: IntencionFuerte;
  nombre: string | null;
  producto: string | null;
  cotizacionTotal: string | null;
  /** Entradas (ISO, a minuto) que se cerraron a mano: deshecho el descarte o "no descartar". */
  cerradasAMano?: string[];
  config: ConfigSeguimientoInteligente["recuperacion72h"];
  ahora: Date;
};

function horarioDe(config: ConfigSeguimientoInteligente["recuperacion72h"]): Horario {
  return { desde: config.desdeHora, hasta: config.hastaHora, dias: config.dias };
}

/** Bogotá = UTC−5 fijo. */
function horaBogota(fecha: Date): number {
  const b = new Date(fecha.getTime() - 5 * HORA);
  return b.getUTCHours();
}

/**
 * La segunda llamada va en la OTRA franja: si la primera fue de mañana (antes de las 12), a las
 * 14:00; si fue de tarde, a las 9:00. El primer turno así que caiga desde `desde`, en día hábil.
 */
export function otraFranja(primera: Date, desde: Date, h: Horario): Date {
  const objetivo = horaBogota(primera) < 12 ? 14 : 9;
  const b = new Date(desde.getTime() - 5 * HORA);
  for (let d = 0; d < 9; d += 1) {
    const dia = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + d, objetivo, 0, 0));
    const real = new Date(dia.getTime() + 5 * HORA);
    if (real.getTime() >= desde.getTime() && h.dias.includes(dia.getUTCDay()) && objetivo >= h.desde && objetivo < h.hasta) return real;
  }
  return siguienteHoraLaboral(desde, h);
}

/** ¿Escribió algo más que el texto del anuncio? */
export function conversoElCliente(mensajes: MensajeCrudo[], historialCompleto: boolean): boolean {
  const entrantes = mensajes.filter((m) => m.direccion === "IN" && m.tipo !== "SYSTEM");
  if (!entrantes.length) return false;
  if (!historialCompleto && entrantes.length >= 2) return true;
  const primero = entrantes[0].en.getTime();
  return entrantes.some((m) => m.en.getTime() > primero + VENTANA_DEL_ANUNCIO_MS);
}

export function evaluarRecuperacion(e: EntradaDeRecuperacion): ResultadoDeRecuperacion {
  const { config, ahora } = e;
  const fuera = (motivo: string, despertarEn: Date | null = null): ResultadoDeRecuperacion => ({ tipo: "fuera", motivo, despertarEn });
  if (config.modo === "apagado") return fuera("apagado");
  if (e.etapaCrm === "GANADO" || e.etapaCrm === "PERDIDO") return fuera("etapa_cerrada");
  if (e.exterior) return fuera("exterior");

  const mensajes = e.mensajes.filter((m) => m.tipo !== "SYSTEM" && m.en.getTime() <= ahora.getTime());
  const ultimoCliente = [...mensajes].reverse().find((m) => m.direccion === "IN") ?? null;
  if (!ultimoCliente) return fuera("nunca_escribio");
  const silencio = mensajes.find((m) => m.direccion === "OUT" && m.en.getTime() > ultimoCliente.en.getTime()) ?? null;
  if (!silencio) return fuera("cliente_esperando");
  const silencioDesde = silencio.en;
  const entradaEn = new Date(silencioDesde.getTime() + config.horas * HORA);
  if (ahora.getTime() < entradaEn.getTime()) return fuera("antes_de_las_72h", entradaEn);
  if (e.cerradasAMano?.includes(entradaEn.toISOString().slice(0, 16))) return fuera("cerrada_a_mano");
  if (config.soloConversaron && !conversoElCliente(mensajes, e.historialCompleto)) return fuera("solo_mando_el_anuncio");
  if (e.noInteresa) return fuera("no_le_interesa");
  if (e.dormido) return fuera("fecha_futura");
  if (e.cotizacionVigente) return fuera("cotizacion_vigente");

  const horario = horarioDe(config);
  const llamadas = e.llamadas.filter((l) => l.en.getTime() >= entradaEn.getTime() && l.en.getTime() <= ahora.getTime()).sort((a, b) => a.en.getTime() - b.en.getTime());
  if (llamadas.some((l) => llamadaContestada(l.resultado))) return { tipo: "recuperado", motivo: "llamada_contestada", silencioDesde, entradaEn };
  // Al prender no se barre el historial: sin ningún intento y callado hace más de `diasMaximos`, no entra.
  if (!llamadas.length && ahora.getTime() - entradaEn.getTime() > config.diasMaximos * DIA) return fuera("fuera_de_la_ventana");

  const prioridad: "A" | "B" = e.intencion.fuerte ? "A" : "B";
  const frase = ultimaFraseDelCliente(mensajes);
  const guion = guionDeAudio({ nombre: e.nombre, producto: e.producto, frase });
  const estado = (fase: FaseRecuperacion, extra: Partial<EstadoDeRecuperacion>): ResultadoDeRecuperacion => ({
    tipo: "dentro",
    estado: {
      fase,
      prioridad,
      silencioDesde,
      entradaEn,
      llamadaEn: null,
      segundaLlamadaEn: null,
      audioEn: null,
      plazoEn: null,
      venceTarea: null,
      revisarEn: new Date(ahora.getTime() + 15 * MIN),
      fuerte: e.intencion.fuerte,
      motivoFuerte: e.intencion.motivo,
      mensajeSugerido: null,
      ...extra,
    },
  });

  const primera = llamadas[0] ?? null;
  // El audio: un AUDIO de una persona (CRM o celular) después de la llamada (o desde las 72 h si no se exige).
  const desdeAudio = primera?.en ?? (config.exigirLlamada ? null : entradaEn);
  const audio = desdeAudio
    ? mensajes.find(
        (m) =>
          m.direccion === "OUT" &&
          m.tipo === "AUDIO" &&
          esMensajeHumano({ createdAt: m.en, origen: m.origen }, e.inicio) &&
          m.en.getTime() >= desdeAudio.getTime(),
      ) ?? null
    : null;

  if (!audio) {
    if (!primera) {
      const vence = siguienteHoraLaboral(entradaEn, horario);
      return estado("llamar", { venceTarea: vence, mensajeSugerido: guion, revisarEn: vence.getTime() > ahora.getTime() ? vence : new Date(ahora.getTime() + 15 * MIN) });
    }
    return estado("audio", { llamadaEn: primera.en, venceTarea: siguienteHoraLaboral(primera.en, horario), mensajeSugerido: guion });
  }

  const plazoEn = new Date(audio.en.getTime() + config.horasTrasAudio * HORA);
  const base = { llamadaEn: primera?.en ?? null, audioEn: audio.en, plazoEn };
  if (ahora.getTime() < plazoEn.getTime()) return estado("espera", { ...base, revisarEn: plazoEn });

  if (!e.intencion.fuerte) {
    // Candado: sin llamada registrada no hay descarte (aunque no se exija la llamada para el audio).
    if (!primera) return estado("espera", { ...base, revisarEn: new Date(ahora.getTime() + 6 * HORA) });
    // El descarte solo en horario laboral, para que la asesora lo vea.
    if (!dentroDelHorarioLaboral(ahora, horario)) return estado("espera", { ...base, revisarEn: siguienteHoraLaboral(ahora, horario) });
    return estado("descartar", { ...base, revisarEn: new Date(ahora.getTime() + DIA) });
  }

  // Intención fuerte: nunca se descarta sola. Segunda llamada en otra franja y, después, aprobación.
  const segunda = llamadas.find((l) => l.en.getTime() >= plazoEn.getTime()) ?? null;
  const mensaje = mensajeConCifra({ nombre: e.nombre, producto: e.producto, total: e.cotizacionTotal });
  if (!segunda) {
    const vence = otraFranja(primera?.en ?? audio.en, plazoEn, horario);
    return estado("llamar_2", { ...base, venceTarea: vence, mensajeSugerido: mensaje, revisarEn: vence.getTime() > ahora.getTime() ? vence : new Date(ahora.getTime() + 15 * MIN) });
  }
  return estado("aprobacion", { ...base, segundaLlamadaEn: segunda.en, mensajeSugerido: mensaje, revisarEn: new Date(ahora.getTime() + 6 * HORA) });
}

/** ¿Este mensaje del cliente cortó un silencio de 72 h o más? (para medir "recuperados" en sombra). */
export function cortoUnSilencioLargo(mensajes: MensajeCrudo[], horas: number): boolean {
  const ordenados = mensajes.filter((m) => m.tipo !== "SYSTEM");
  const ultimo = ordenados.at(-1);
  if (!ultimo || ultimo.direccion !== "IN") return false;
  // La tanda del cliente y nuestro primer mensaje del silencio anterior.
  let i = ordenados.length - 1;
  while (i >= 0 && ordenados[i].direccion === "IN") i -= 1;
  if (i < 0) return false;
  let j = i;
  while (j - 1 >= 0 && ordenados[j - 1].direccion === "OUT") j -= 1;
  const primeraDelSilencio = ordenados[j];
  const respuesta = ordenados[i + 1];
  return respuesta.en.getTime() - primeraDelSilencio.en.getTime() >= horas * HORA;
}

/* ------------------------------------------------------------------------------------------------
   CIERRE POR UNA AUTOMATIZACIÓN (13-10-2026)
------------------------------------------------------------------------------------------------ */

/** Fase del evento RECUPERACION_72H cuando la tarea la atendió una automatización (no vuelve a abrir esa entrada). */
export const FASE_ATENDIDA_POR_AUTOMATIZACION = "automatizacion";

/**
 * Una automatización le ENVIÓ algo (flujo / texto) a un lead con la tarea de la Recuperación 72 h:
 * la tarea queda hecha y sale de las listas de llamadas (Mi día, tope, alarma de Recuperación).
 *
 * Devuelve los dos eventos a registrar, o null si el lead no tiene esa tarea pendiente:
 *  - RECUPERACION_72H fase "automatizacion" (con la entrada): `recuperacionesCerradasAMano` la lee y
 *    el motor ya no vuelve a abrir ESA recuperación ("cerrada_a_mano");
 *  - SIGUIENTE_ACCION "esperar" (toque "automatizacion"): la foto del lead deja de ser tarea al
 *    instante, sin esperar al reloj. Conserva el motivo para que el motor, en su próxima vuelta,
 *    registre su decisión nueva (`salioDeRecuperacion`).
 * Si el cliente contesta después, su mensaje abre un silencio nuevo: el flujo normal sigue solo.
 */
export function eventosDeCierrePorAutomatizacion(input: {
  conversationId: string;
  accion: string | null;
  accionDatos: Record<string, unknown> | null;
  automatizacion: string;
  ahora: Date;
}): Array<{ tipo: "RECUPERACION_72H" | "SIGUIENTE_ACCION"; claveUnica?: string; datos: Record<string, unknown> }> | null {
  const datos = input.accionDatos ?? {};
  if (input.accion !== "tarea_asesora" || datos.motivo !== MOTIVO_RECUPERACION) return null;
  const rec = (datos.recuperacion && typeof datos.recuperacion === "object" ? datos.recuperacion : {}) as Record<string, unknown>;
  const entrada = typeof rec.entradaEn === "string" ? rec.entradaEn.slice(0, 16) : input.ahora.toISOString().slice(0, 16);
  const modo = typeof datos.modo === "string" ? datos.modo : "activo";
  return [
    {
      tipo: "RECUPERACION_72H",
      claveUnica: `REC:${modo}:${input.conversationId}:${entrada}:${FASE_ATENDIDA_POR_AUTOMATIZACION}`,
      datos: { ...rec, modo, fase: FASE_ATENDIDA_POR_AUTOMATIZACION, desdeFase: datos.toque ?? null, automatizacion: input.automatizacion },
    },
    {
      tipo: "SIGUIENTE_ACCION",
      datos: {
        ...datos,
        accion: "esperar",
        toque: FASE_ATENDIDA_POR_AUTOMATIZACION,
        prioridad: null,
        vence: null,
        clave: `automatizacion:${entrada}`,
        detalle: `Atendida por la automatización «${input.automatizacion}»`,
        atendidaEn: input.ahora.toISOString(),
      },
    },
  ];
}
