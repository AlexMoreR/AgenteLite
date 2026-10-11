/**
 * SUPERVISOR ACCIONABLE: las reglas, en código puro (sin base, sin Next).
 *
 * Pedido de Alexander (11-10-2026): el Supervisor no es un generador de reportes. Detecta → actúa
 * con el responsable → verifica → resuelve abajo cuando puede → escala a Alexander SOLO las
 * excepciones. Hasta hoy, "1 chat caliente esperando a Ingrid" le llegaba a Alexander aunque la
 * acción era de Ingrid.
 *
 * Cada chat de una alerta de atención (caliente esperando, asignado sin respuesta, "ya pagué" sin
 * respuesta, señal sin dueña) es una ACCIÓN con responsable, plazo y estado:
 *
 *   DETECTADA ──aviso──► AVISADA ──plazo vencido──► SEGUNDO_AVISO ──vencido──► ESCALADA ──► ATENDIDA_POR_ALEXANDER
 *                          │                            │                         │
 *                          └──── la asesora escribe ────┴──► RESUELTA_ABAJO       └──► RESUELTA_TRAS_ESCALAR
 *                                                                                  (alguien escribió después)
 *   Y desde cualquier estado activo: YA_NO_APLICA (chat ganado/perdido o ya no está abierto).
 *
 * DETECTADA es instantáneo: en la misma vuelta se avisa al responsable. "Actuó" = un mensaje humano
 * en el chat (CRM o celular: rawPayload.source manual/instance) DESPUÉS del aviso.
 *
 * Alexander recibe algo solo si: (1) venció el plazo y la segunda oportunidad sin que nadie
 * actuara; (2) la misma asesora deja vencer varios plazos (patrón del día o de la semana); (3) es
 * un pago sin respuesta (sin segunda oportunidad); (4) no hay a quién avisar (sin asesora ni
 * supervisora). Los incidentes críticos del bot/embudo/sistema siguen yendo directo (enrutador de
 * avisos por gravedad) y aparecen en sus Prioridades.
 *
 * Interruptor `supervisor:accionable:<workspaceId>` (APAGADO por defecto = exactamente lo de hoy).
 * Pruebas: scripts/check-supervisor-accionable.mjs.
 */

import { ultimos4 } from "../../coach/reglas";
import { estadoDeEspera, enHorario, interesDelLead, type ChatAbierto } from "../../supervisor/dominio/detectores-atencion";
import { mensajePorSenales } from "../../seguimiento-inteligente/dominio/mensajes";
import { familiaDelTexto, nombreDeFamilia } from "../../seguimiento-inteligente/dominio/producto";
import { ORDEN_DE_SEVERIDAD, type Hallazgo, type Severidad } from "../../supervisor/dominio/tipos";

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/* ------------------------------------------------------------------------------------------------
   TIPOS
------------------------------------------------------------------------------------------------ */

export type TipoDeAccion = "pago" | "caliente" | "asignado" | "sin_duena";
export type TipoDeTarjeta = TipoDeAccion | "patron_dia" | "patron_semana";

export type EstadoDeAccion =
  | "AVISADA"
  | "SEGUNDO_AVISO"
  | "RESUELTA_ABAJO"
  | "ESCALADA"
  | "ATENDIDA_POR_ALEXANDER"
  | "RESUELTA_TRAS_ESCALAR"
  | "YA_NO_APLICA";

export const ESTADOS_ACTIVOS: EstadoDeAccion[] = ["AVISADA", "SEGUNDO_AVISO", "ESCALADA"];

export const ETIQUETA_DE_ESTADO: Record<EstadoDeAccion, string> = {
  AVISADA: "Avisada · en plazo",
  SEGUNDO_AVISO: "Plazo vencido · segundo aviso",
  RESUELTA_ABAJO: "Resuelta por la asesora",
  ESCALADA: "Escalada a Alexander",
  ATENDIDA_POR_ALEXANDER: "Atendida por Alexander",
  RESUELTA_TRAS_ESCALAR: "Resuelta después de escalar",
  YA_NO_APLICA: "Ya no aplica",
};

/**
 * Qué tan grave es lo que se pierde: ordena las prioridades y decide el canal de la escalada.
 *  - PAGO: dice que ya pagó / mandó comprobante.
 *  - COTIZACION: el lead tiene cotización o anticipo registrados en el embudo (venta con monto).
 *  - VENTA: caliente o con señal fuerte de compra, sin monto todavía.
 *  - SISTEMA: falla del bot / embudo / sistema.
 *  - PATRON: la misma asesora deja vencer plazos varias veces.
 *  - INTERES: lead con interés, todavía tibio.
 */
export type Riesgo = "PAGO" | "COTIZACION" | "VENTA" | "SISTEMA" | "PATRON" | "INTERES";
const ORDEN_DE_RIESGO: Record<Riesgo, number> = { PAGO: 6, COTIZACION: 5, SISTEMA: 4, VENTA: 3, PATRON: 2, INTERES: 1 };

/**
 * El canal de la escalada a Alexander:
 *  - CRITICO     → tarjeta + push + WhatsApp (solo plata en juego, en horario).
 *  - IMPORTANTE  → tarjeta + push (agrupado por vuelta).
 *  - OBSERVACION → solo la tarjeta en su pantalla (sin interrumpirlo); cuenta para el patrón.
 */
export type GravedadDeEscalada = "CRITICO" | "IMPORTANTE" | "OBSERVACION";

/** Una acción del Supervisor (se guarda en JSON: las fechas van como texto ISO). */
export type Accion = {
  /** = conversationId para las de un chat; "patron:dia:<asesora>:<fecha>" para los patrones. */
  id: string;
  tipo: TipoDeTarjeta;
  conversationId: string | null;
  /** Clave de la alerta del Supervisor de la que salió. */
  claveAlerta: string | null;
  responsableId: string | null;
  responsableNombre: string;
  /** El responsable es la supervisora (chat sin dueña). */
  responsableEsSupervisora: boolean;
  /** "Laura Gómez" o "•••• 4567". Nunca el teléfono completo. */
  cliente: string;
  telefono: string;
  /** Número corto del chat (/c/<numero>), si se sabe. */
  numero: number | null;
  frase: string | null;
  motivo: string;
  mensajeSugerido: string | null;
  riesgo: Riesgo;
  /** Desde cuándo espera el cliente (último mensaje o asignación). */
  esperandoDesde: string;
  plazoMin: number;
  estado: EstadoDeAccion;
  detectadaEn: string;
  avisadaEn: string | null;
  /** Hora estimada en la que vence el plazo (para mostrar). */
  venceEn: string | null;
  segundoAvisoEn: string | null;
  /** A quién se avisó la segunda vez además de la responsable (la supervisora). */
  segundoAvisoA: string | null;
  escaladaEn: string | null;
  gravedadEscalada: GravedadDeEscalada | null;
  motivoEscalada: string | null;
  resueltaEn: string | null;
  /** Quién respondió (la asesora del chat en ese momento). */
  resueltaPor: string | null;
  resueltaPorNombre: string | null;
  /** Minutos desde el aviso hasta el mensaje humano. */
  minutosHastaResolver: number | null;
  atendidaEn: string | null;
  atendidaPor: string | null;
  /** Se le venció el plazo sin actuar (cuenta para el patrón de repetición). */
  incumplida: boolean;
  /** Para los patrones: cuántos plazos vencidos. */
  conteo?: number;
  vistoEn: string;
};

/** Lo que queda de una acción cerrada (para medir y para el patrón semanal). */
export type AccionCerrada = {
  id: string;
  tipo: TipoDeTarjeta;
  responsableId: string | null;
  responsableNombre: string;
  estado: EstadoDeAccion;
  detectadaEn: string;
  avisadaEn: string | null;
  cerradaEn: string;
  minutosHastaResolver: number | null;
  incumplida: boolean;
  escalada: boolean;
};

export type EstadoAccionable = {
  acciones: Record<string, Accion>;
  historial: AccionCerrada[];
};

export function estadoVacio(): EstadoAccionable {
  return { acciones: {}, historial: [] };
}

/* ------------------------------------------------------------------------------------------------
   CONFIGURACIÓN (AppSetting `supervisor:accionable:<workspaceId>`, JSON)
------------------------------------------------------------------------------------------------ */

export type ConfigAccionable = {
  /** El interruptor. Apagado = todo igual que hoy. */
  activo: boolean;
  /** Plazo de la asesora, en minutos LABORALES (el de pago, en minutos de reloj). */
  plazos: Record<TipoDeAccion, number>;
  /** Segunda oportunidad corta (minutos laborales) con aviso también a la supervisora. 0 = sin ella. */
  segundaOportunidadMin: number;
  /** Plazos vencidos de la misma asesora en el día que ya son un patrón para Alexander. */
  repeticionDia: number;
  /** …y en 7 días. */
  repeticionSemana: number;
  /** Tarjetas visibles en "Prioridades de Alexander". */
  maxPrioridades: number;
  /** WhatsApp a la asesora por la línea INTERNA (además del push). */
  asesoraWhatsApp: boolean;
  /** La supervisora para los chats sin dueña y la segunda oportunidad. Vacío = la primera de Equipo. */
  supervisoraId: string | null;
};

export const CONFIG_ACCIONABLE_POR_DEFECTO: ConfigAccionable = {
  activo: false,
  plazos: { pago: 10, caliente: 15, asignado: 20, sin_duena: 15 },
  segundaOportunidadMin: 10,
  repeticionDia: 3,
  repeticionSemana: 10,
  maxPrioridades: 3,
  asesoraWhatsApp: true,
  supervisoraId: null,
};

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function entero(valor: unknown, porDefecto: number, minimo: number, maximo: number): number {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : Number.NaN;
  if (!Number.isFinite(numero)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, Math.round(numero)));
}

/** Lee el JSON guardado. Roto o vacío = apagado (lo de hoy). */
export function leerConfigAccionableDeTexto(crudoTexto: string | null | undefined): ConfigAccionable {
  let crudo: Record<string, unknown> = {};
  try {
    crudo = objeto(crudoTexto ? JSON.parse(crudoTexto) : null);
  } catch {
    crudo = {};
  }
  const d = CONFIG_ACCIONABLE_POR_DEFECTO;
  const plazos = objeto(crudo.plazos);
  const supervisora = typeof crudo.supervisoraId === "string" && crudo.supervisoraId.trim() ? crudo.supervisoraId.trim() : null;
  return {
    activo: crudo.activo === true || crudo.activo === "true",
    plazos: {
      pago: entero(plazos.pago, d.plazos.pago, 5, 120),
      caliente: entero(plazos.caliente, d.plazos.caliente, 5, 240),
      asignado: entero(plazos.asignado, d.plazos.asignado, 5, 240),
      sin_duena: entero(plazos.sin_duena, d.plazos.sin_duena, 5, 240),
    },
    segundaOportunidadMin: entero(crudo.segundaOportunidadMin, d.segundaOportunidadMin, 0, 120),
    repeticionDia: entero(crudo.repeticionDia, d.repeticionDia, 2, 50),
    repeticionSemana: entero(crudo.repeticionSemana, d.repeticionSemana, 3, 200),
    maxPrioridades: entero(crudo.maxPrioridades, d.maxPrioridades, 1, 3),
    asesoraWhatsApp: !(crudo.asesoraWhatsApp === false || crudo.asesoraWhatsApp === "false"),
    supervisoraId: supervisora,
  };
}

/* ------------------------------------------------------------------------------------------------
   QUÉ ALERTAS MANEJA (las demás siguen por el camino de hoy)
------------------------------------------------------------------------------------------------ */

export function tipoDeLaClave(clave: string): TipoDeAccion | null {
  if (clave.startsWith("ATENCION:pago-sin-respuesta:")) return "pago";
  if (clave === "ATENCION:caliente-esperando:sin-duena") return "sin_duena";
  if (clave.startsWith("ATENCION:caliente-esperando:")) return "caliente";
  if (clave.startsWith("ATENCION:asignado-sin-respuesta:")) return "asignado";
  if (clave === "ATENCION:senal-sin-duena") return "sin_duena";
  return null;
}

/** Con el interruptor encendido, estas alertas NO se avisan por el camino de hoy: las maneja el accionable. */
export function manejaElAccionable(clave: string): boolean {
  return tipoDeLaClave(clave) !== null;
}

/** Si un chat aparece en dos alertas, manda la más grave. */
const FUERZA_DEL_TIPO: Record<TipoDeAccion, number> = { pago: 4, caliente: 3, asignado: 2, sin_duena: 1 };

/* ------------------------------------------------------------------------------------------------
   1. DETECTADA: una candidata por chat
------------------------------------------------------------------------------------------------ */

export type Persona = { id: string; nombre: string };

export type Candidata = {
  tipo: TipoDeAccion;
  conversationId: string;
  claveAlerta: string;
  responsableId: string | null;
  responsableNombre: string;
  responsableEsSupervisora: boolean;
  cliente: string;
  telefono: string;
  frase: string | null;
  motivo: string;
  mensajeSugerido: string | null;
  riesgo: Riesgo;
  esperandoDesde: Date;
};

/** Datos extra del chat que no trae ChatAbierto (cotización / anticipo del embudo). */
export type ExtrasDelChat = { cotizacionEn?: Date | null; anticipoEn?: Date | null };

/** "•••• 4567" (vacío si no hay teléfono). */
export function telefonoTapado(telefono: string | null | undefined): string {
  const fin = ultimos4(telefono);
  return fin === "…" ? "" : `•••• ${fin.slice(1)}`;
}

function nombreVisible(nombre: string | null | undefined): string | null {
  const texto = (nombre ?? "").trim();
  if (!texto) return null;
  if (!/\p{L}/u.test(texto) && texto.replace(/\D/g, "").length >= 5) return null;
  return texto.slice(0, 40);
}

/** Cómo se nombra al cliente en un aviso: su nombre, o el teléfono tapado. Nunca el número completo. */
export function nombreDelCliente(chat: Pick<ChatAbierto, "nombreCliente" | "telefono">): string {
  return nombreVisible(chat.nombreCliente) ?? (telefonoTapado(chat.telefono) || "Cliente sin nombre");
}

function recortar(texto: string | null | undefined, largo = 100): string | null {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  return limpio.length > largo ? `${limpio.slice(0, largo - 1).trimEnd()}…` : limpio;
}

function primerNombre(nombre: string | null | undefined): string | null {
  const visible = nombreVisible(nombre);
  return visible ? visible.split(/\s+/)[0] : null;
}

function sugeridoDelHallazgo(h: Hallazgo, conversationId: string): string | null {
  const prefijo = `Mensaje sugerido para el chat ${conversationId}: `;
  const linea = (h.hechos ?? []).find((x) => x.startsWith(prefijo));
  return linea ? linea.slice(prefijo.length).trim() || null : null;
}

function mensajeSugerido(tipo: TipoDeAccion, chat: ChatAbierto, h: Hallazgo, ahora: Date): string {
  if (tipo === "pago") {
    const nombre = primerNombre(chat.nombreCliente);
    return `Hola${nombre ? ` ${nombre}` : ""}, ¡gracias! Ya vi tu mensaje del pago. Lo verifico ya mismo y te confirmo en unos minutos el siguiente paso. 🙌`;
  }
  const delDetector = sugeridoDelHallazgo(h, chat.conversationId);
  if (delDetector) return delDetector;
  const interes = interesDelLead(chat, ahora);
  const textos = [...(chat.textosDelCliente ?? []), ...chat.textosPendientes];
  const familia = textos.map((t) => familiaDelTexto(t)).find(Boolean) ?? null;
  return mensajePorSenales({ nombre: primerNombre(chat.nombreCliente), producto: nombreDeFamilia(familia), senales: interes.calificacion.senales });
}

function motivoDe(tipo: TipoDeAccion, chat: ChatAbierto, ahora: Date): { motivo: string; frase: string | null; desde: Date } {
  const espera = estadoDeEspera(chat, ahora);
  const desdeCliente = chat.ultimoClienteEn ?? ahora;
  switch (tipo) {
    case "pago":
      return { motivo: "Dice que ya pagó / mandó comprobante y nadie le ha respondido", frase: recortar(espera.frase ?? chat.textosPendientes.at(-1)), desde: desdeCliente };
    case "caliente":
      return { motivo: espera.caliente ? "Cliente caliente esperando respuesta" : "Señal fuerte de compra esperando respuesta", frase: recortar(espera.frase ?? chat.textosPendientes.at(-1)), desde: desdeCliente };
    case "asignado": {
      const interes = interesDelLead(chat, ahora);
      return { motivo: `Lead ${interes.nivel === "con interés" ? "con interés" : interes.nivel.toLowerCase()} asignado y nadie le ha escrito`, frase: recortar(interes.frase ?? chat.textosPendientes.at(-1)), desde: chat.asignadaEn ?? desdeCliente };
    }
    case "sin_duena":
    default:
      return { motivo: "Chat con señal de compra sin asesora asignada", frase: recortar(espera.frase ?? chat.textosPendientes.at(-1)), desde: desdeCliente };
  }
}

function riesgoDe(tipo: TipoDeAccion, chat: ChatAbierto, extras: ExtrasDelChat | undefined, ahora: Date): Riesgo {
  if (tipo === "pago") return "PAGO";
  if (extras?.anticipoEn || extras?.cotizacionEn) return "COTIZACION";
  if (tipo === "caliente") return "VENTA";
  if (tipo === "asignado" && interesDelLead(chat, ahora).caliente) return "VENTA";
  if (tipo === "sin_duena" && estadoDeEspera(chat, ahora).senalFuerte) return "VENTA";
  return "INTERES";
}

/**
 * Las candidatas de esta vuelta: un chat = una candidata (si sale en dos alertas, la más grave).
 * Responsable = la asesora del chat; sin dueña → la supervisora; sin supervisora → nadie (escala).
 */
export function candidatasDeLaVuelta(input: {
  hallazgos: Hallazgo[];
  chats: ChatAbierto[];
  ahora: Date;
  supervisora: Persona | null;
  extras?: Map<string, ExtrasDelChat>;
}): Candidata[] {
  const porId = new Map(input.chats.map((c) => [c.conversationId, c]));
  const salida = new Map<string, Candidata>();
  for (const h of input.hallazgos) {
    const tipo = tipoDeLaClave(h.clave);
    if (!tipo) continue;
    for (const id of h.evidencia.chats) {
      const chat = porId.get(id);
      if (!chat) continue;
      const previa = salida.get(id);
      if (previa && FUERZA_DEL_TIPO[previa.tipo] >= FUERZA_DEL_TIPO[tipo]) continue;
      const deLaAsesora = chat.asesoraId ? { id: chat.asesoraId, nombre: chat.asesoraNombre?.trim() || "la asesora" } : null;
      const responsable = deLaAsesora ?? input.supervisora;
      const { motivo, frase, desde } = motivoDe(tipo, chat, input.ahora);
      salida.set(id, {
        tipo,
        conversationId: id,
        claveAlerta: h.clave,
        responsableId: responsable?.id ?? null,
        responsableNombre: responsable?.nombre ?? "nadie (sin asesora ni supervisora)",
        responsableEsSupervisora: !deLaAsesora && Boolean(input.supervisora),
        cliente: nombreDelCliente(chat),
        telefono: telefonoTapado(chat.telefono),
        frase,
        motivo,
        mensajeSugerido: mensajeSugerido(tipo, chat, h, input.ahora),
        riesgo: riesgoDe(tipo, chat, input.extras?.get(id), input.ahora),
        esperandoDesde: desde,
      });
    }
  }
  return [...salida.values()];
}

/* ------------------------------------------------------------------------------------------------
   RELOJ (plazos en minutos laborales; el pago, en minutos de reloj)
------------------------------------------------------------------------------------------------ */

/**
 * ¿Ya pasaron `plazo` minutos (laborales; los de pago, de reloj) desde `desde`? Se cuenta minuto a
 * minuto: `minutosLaborales` del detector cuenta por bloques de 15 min y a las
 * 17:55 daba por vencido un plazo de 15 min a las 22:55.
 */
function vencioElPlazo(tipo: TipoDeTarjeta, desde: Date, hasta: Date, plazo: number): boolean {
  if (tipo === "pago") return hasta.getTime() - desde.getTime() >= plazo * MIN;
  return venceEn(tipo, desde, plazo).getTime() <= hasta.getTime();
}

/** Cuándo vence un plazo laboral (al minuto). Tope: 7 días. */
export function venceEn(tipo: TipoDeTarjeta, desde: Date, minutos: number): Date {
  if (tipo === "pago") return new Date(desde.getTime() + minutos * MIN);
  let t = desde.getTime();
  let contados = 0;
  for (let i = 0; i < 7 * 24 * 60 && contados < minutos; i += 1) {
    if (enHorario(new Date(t))) contados += 1;
    t += MIN;
  }
  return new Date(t);
}

/** Fecha de Bogotá (AAAA-MM-DD). */
export function fechaBogota(fecha: Date): string {
  return new Date(fecha.getTime() - 5 * HORA).toISOString().slice(0, 10);
}

/** "10:45" en Bogotá. */
export function horaBogota(fecha: Date | string | null | undefined): string {
  if (!fecha) return "—";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  return new Date(d.getTime() - 5 * HORA).toISOString().slice(11, 16);
}

/* ------------------------------------------------------------------------------------------------
   2. AVANZAR LA MÁQUINA DE ESTADOS (una vez por vuelta de 5 min)
------------------------------------------------------------------------------------------------ */

export type Evento =
  | { tipo: "avisar"; responsableId: string; accionIds: string[] }
  | { tipo: "segundo_aviso"; responsableId: string; supervisoraId: string | null; accionIds: string[] }
  | { tipo: "escalar"; accionId: string; gravedad: GravedadDeEscalada }
  | { tipo: "resuelta_abajo"; accionId: string }
  | { tipo: "resuelta_tras_escalar"; accionId: string };

export type Atendidas = Record<string, { en: string; por: string | null }>;

/**
 * El canal de una escalada. WhatsApp solo cuando hay plata en juego (pago o cotización/anticipo)
 * y en horario; de noche o domingo, push y la tarjeta queda arriba para la mañana. Un lead tibio
 * sin respuesta no interrumpe a Alexander: queda en su pantalla y cuenta para el patrón.
 */
export function gravedadDeEscalada(riesgo: Riesgo, ahora: Date, conResponsable = true): GravedadDeEscalada {
  if (riesgo === "PAGO" || riesgo === "COTIZACION") return enHorario(ahora) ? "CRITICO" : "IMPORTANTE";
  if (riesgo === "INTERES") return conResponsable ? "OBSERVACION" : "IMPORTANTE";
  return "IMPORTANTE";
}

function cerrada(a: Accion, en: Date): AccionCerrada {
  return {
    id: a.id,
    tipo: a.tipo,
    responsableId: a.responsableId,
    responsableNombre: a.responsableNombre,
    estado: a.estado,
    detectadaEn: a.detectadaEn,
    avisadaEn: a.avisadaEn,
    cerradaEn: (a.resueltaEn ?? a.atendidaEn ?? null) || en.toISOString(),
    minutosHastaResolver: a.minutosHastaResolver,
    incumplida: a.incumplida,
    escalada: Boolean(a.escaladaEn),
  };
}

function nuevaAccion(c: Candidata, ahora: Date, config: ConfigAccionable, numero: number | null): Accion {
  const plazo = config.plazos[c.tipo];
  const iso = ahora.toISOString();
  return {
    id: c.conversationId,
    tipo: c.tipo,
    conversationId: c.conversationId,
    claveAlerta: c.claveAlerta,
    responsableId: c.responsableId,
    responsableNombre: c.responsableNombre,
    responsableEsSupervisora: c.responsableEsSupervisora,
    cliente: c.cliente,
    telefono: c.telefono,
    numero,
    frase: c.frase,
    motivo: c.motivo,
    mensajeSugerido: c.mensajeSugerido,
    riesgo: c.riesgo,
    esperandoDesde: c.esperandoDesde.toISOString(),
    plazoMin: plazo,
    estado: "AVISADA",
    detectadaEn: iso,
    avisadaEn: iso,
    venceEn: venceEn(c.tipo, ahora, plazo).toISOString(),
    segundoAvisoEn: null,
    segundoAvisoA: null,
    escaladaEn: null,
    gravedadEscalada: null,
    motivoEscalada: null,
    resueltaEn: null,
    resueltaPor: null,
    resueltaPorNombre: null,
    minutosHastaResolver: null,
    atendidaEn: null,
    atendidaPor: null,
    incumplida: false,
    vistoEn: iso,
  };
}

function escalar(a: Accion, ahora: Date, motivo: string, eventos: Evento[]) {
  a.estado = "ESCALADA";
  a.escaladaEn = ahora.toISOString();
  a.gravedadEscalada = gravedadDeEscalada(a.riesgo, ahora, Boolean(a.responsableId));
  a.motivoEscalada = motivo;
  eventos.push({ tipo: "escalar", accionId: a.id, gravedad: a.gravedadEscalada });
}

/**
 * Una vuelta: verifica las acciones abiertas, crea las nuevas, vence plazos, escala lo que toca y
 * detecta patrones de repetición. No manda nada: devuelve los EVENTOS que el servicio ejecuta.
 */
export function avanzar(input: {
  estado: EstadoAccionable;
  candidatas: Candidata[];
  /** TODOS los chats abiertos de la vuelta (para verificar si alguien escribió). */
  chats: ChatAbierto[];
  atendidas: Atendidas;
  ahora: Date;
  config: ConfigAccionable;
  supervisora: Persona | null;
  /** Número corto de cada chat (/c/<numero>). */
  numeros?: Map<string, number>;
}): { estado: EstadoAccionable; eventos: Evento[] } {
  const { ahora, config } = input;
  const iso = ahora.toISOString();
  const acciones: Record<string, Accion> = Object.fromEntries(Object.entries(input.estado.acciones).map(([k, v]) => [k, { ...v }]));
  const historial = [...input.estado.historial];
  const eventos: Evento[] = [];
  const chats = new Map(input.chats.map((c) => [c.conversationId, c]));
  const avisos = new Map<string, string[]>();
  const segundos = new Map<string, string[]>();
  const anotarAviso = (mapa: Map<string, string[]>, responsable: string, id: string) => mapa.set(responsable, [...(mapa.get(responsable) ?? []), id]);

  // 1. Lo que Alexander marcó como atendido en la pantalla.
  for (const a of Object.values(acciones)) {
    const marca = input.atendidas[a.id];
    if (a.estado === "ESCALADA" && marca) {
      a.estado = "ATENDIDA_POR_ALEXANDER";
      a.atendidaEn = marca.en;
      a.atendidaPor = marca.por;
    }
  }

  // 2. Verificar las abiertas.
  for (const a of Object.values(acciones)) {
    if (!ESTADOS_ACTIVOS.includes(a.estado)) continue;
    if (a.tipo === "patron_dia" || a.tipo === "patron_semana") {
      // Un patrón es del día (o de la semana): a las 24 h deja de ser prioridad.
      if (ahora.getTime() - Date.parse(a.detectadaEn) >= DIA) a.estado = "YA_NO_APLICA";
      continue;
    }
    const chat = a.conversationId ? chats.get(a.conversationId) : undefined;
    const avisadaEn = a.avisadaEn ? new Date(a.avisadaEn) : new Date(a.detectadaEn);
    const humana = chat?.ultimaRespuestaHumanaEn ?? null;
    if (chat && humana && humana.getTime() > avisadaEn.getTime()) {
      a.resueltaEn = humana.toISOString();
      a.resueltaPor = chat.asesoraId ?? a.responsableId;
      a.resueltaPorNombre = chat.asesoraNombre?.trim() || a.responsableNombre;
      a.minutosHastaResolver = Math.max(0, Math.round((humana.getTime() - avisadaEn.getTime()) / MIN));
      if (a.estado === "ESCALADA") {
        a.estado = "RESUELTA_TRAS_ESCALAR";
        eventos.push({ tipo: "resuelta_tras_escalar", accionId: a.id });
      } else {
        a.estado = "RESUELTA_ABAJO";
        eventos.push({ tipo: "resuelta_abajo", accionId: a.id });
      }
      continue;
    }
    if (!chat || chat.etapa === "GANADO" || chat.etapa === "PERDIDO") {
      // Cerrado, ganado o perdido: ya no es tarea de nadie (no cuenta ni como resuelta ni como escalada).
      a.estado = "YA_NO_APLICA";
      continue;
    }
    if (a.estado === "ESCALADA") continue;
    // Se reasignó a otra asesora: se le avisa a ella y su plazo empieza de cero.
    if (chat.asesoraId && a.responsableId !== chat.asesoraId) {
      a.responsableId = chat.asesoraId;
      a.responsableNombre = chat.asesoraNombre?.trim() || "la asesora";
      a.responsableEsSupervisora = false;
      a.estado = "AVISADA";
      a.avisadaEn = iso;
      a.segundoAvisoEn = null;
      a.venceEn = venceEn(a.tipo, ahora, a.plazoMin).toISOString();
      anotarAviso(avisos, a.responsableId, a.id);
      continue;
    }
    if (a.estado === "AVISADA" && (a.venceEn ? Date.parse(a.venceEn) <= ahora.getTime() : vencioElPlazo(a.tipo, avisadaEn, ahora, a.plazoMin))) {
      a.incumplida = true;
      const conSegunda = config.segundaOportunidadMin > 0 && a.tipo !== "pago" && Boolean(a.responsableId);
      if (conSegunda) {
        a.estado = "SEGUNDO_AVISO";
        a.segundoAvisoEn = iso;
        const supervisora = input.supervisora && input.supervisora.id !== a.responsableId ? input.supervisora : null;
        a.segundoAvisoA = supervisora?.nombre ?? null;
        anotarAviso(segundos, a.responsableId as string, a.id);
      } else {
        escalar(a, ahora, a.tipo === "pago" ? `Hay un pago de por medio y ${a.responsableNombre} no respondió en ${a.plazoMin} min tras el aviso.` : `${a.responsableNombre} no respondió en el plazo de ${a.plazoMin} min tras el aviso.`, eventos);
      }
      continue;
    }
    if (a.estado === "SEGUNDO_AVISO" && a.segundoAvisoEn && vencioElPlazo(a.tipo, new Date(a.segundoAvisoEn), ahora, config.segundaOportunidadMin)) {
      escalar(
        a,
        ahora,
        `${a.responsableNombre} no respondió ni con el aviso (${horaBogota(a.avisadaEn)}) ni con el segundo aviso (${horaBogota(a.segundoAvisoEn)})${a.segundoAvisoA ? `, y ${a.segundoAvisoA} también fue avisada` : ""}.`,
        eventos,
      );
    }
  }

  // 3. Las candidatas nuevas (o más graves). Fuera del horario laboral no se abre nada nuevo (la
  //    asesora no está y el detector lo vuelve a ver a las 8:00), salvo un pago.
  const horario = enHorario(ahora);
  for (const c of input.candidatas) {
    const previa = acciones[c.conversationId];
    if (!horario && c.tipo !== "pago" && !(previa && ESTADOS_ACTIVOS.includes(previa.estado))) continue;
    const numero = input.numeros?.get(c.conversationId) ?? previa?.numero ?? null;
    if (previa && ESTADOS_ACTIVOS.includes(previa.estado)) {
      previa.vistoEn = iso;
      previa.frase = c.frase ?? previa.frase;
      const sube = previa.tipo in FUERZA_DEL_TIPO && FUERZA_DEL_TIPO[c.tipo] > FUERZA_DEL_TIPO[previa.tipo as TipoDeAccion];
      if (!sube) continue;
      // Empeoró (p. ej. ahora dice "ya pagué"): tipo, riesgo y plazo nuevos, y aviso nuevo.
      previa.tipo = c.tipo;
      previa.claveAlerta = c.claveAlerta;
      previa.motivo = c.motivo;
      previa.riesgo = c.riesgo;
      previa.mensajeSugerido = c.mensajeSugerido;
      previa.plazoMin = config.plazos[c.tipo];
      if (previa.estado === "ESCALADA") continue;
      previa.estado = "AVISADA";
      previa.avisadaEn = iso;
      previa.segundoAvisoEn = null;
      previa.venceEn = venceEn(c.tipo, ahora, previa.plazoMin).toISOString();
      if (previa.responsableId) anotarAviso(avisos, previa.responsableId, previa.id);
      continue;
    }
    if (previa) {
      // Ya terminó. Si el cliente no volvió a escribir desde que terminó, no es una acción nueva.
      const fin = Date.parse(previa.resueltaEn ?? previa.atendidaEn ?? previa.vistoEn);
      if (c.esperandoDesde.getTime() <= fin) continue;
      historial.push(cerrada(previa, ahora));
    }
    const nueva = nuevaAccion(c, ahora, config, numero);
    acciones[nueva.id] = nueva;
    if (!nueva.responsableId) {
      escalar(nueva, ahora, "No hay asesora ni supervisora a quién avisar.", eventos);
    } else {
      anotarAviso(avisos, nueva.responsableId, nueva.id);
    }
  }

  for (const [responsableId, accionIds] of avisos) eventos.push({ tipo: "avisar", responsableId, accionIds });
  for (const [responsableId, accionIds] of segundos) {
    const supervisora = input.supervisora && input.supervisora.id !== responsableId ? input.supervisora.id : null;
    eventos.push({ tipo: "segundo_aviso", responsableId, supervisoraId: supervisora, accionIds });
  }

  // 4. Repetición: la misma asesora deja vencer varios plazos → patrón para Alexander.
  const hoy = fechaBogota(ahora);
  const todas = [
    ...Object.values(acciones).map((a) => ({ id: a.id, tipo: a.tipo, responsableId: a.responsableId, responsableNombre: a.responsableNombre, detectadaEn: a.detectadaEn, incumplida: a.incumplida })),
    ...historial,
  ].filter((a) => a.incumplida && a.responsableId && a.tipo !== "patron_dia" && a.tipo !== "patron_semana");
  const porAsesora = new Map<string, typeof todas>();
  for (const a of todas) porAsesora.set(a.responsableId as string, [...(porAsesora.get(a.responsableId as string) ?? []), a]);
  for (const [responsableId, lista] of porAsesora) {
    const nombre = lista[0].responsableNombre;
    const delDia = new Set(lista.filter((a) => fechaBogota(new Date(a.detectadaEn)) === hoy).map((a) => a.id)).size;
    const deLaSemana = new Set(lista.filter((a) => ahora.getTime() - Date.parse(a.detectadaEn) < 7 * DIA).map((a) => a.id)).size;
    const patrones: Array<{ tipo: "patron_dia" | "patron_semana"; id: string; conteo: number; umbral: number }> = [];
    if (delDia >= config.repeticionDia) patrones.push({ tipo: "patron_dia", id: `patron:dia:${responsableId}:${hoy}`, conteo: delDia, umbral: config.repeticionDia });
    // La semana: una tarjeta cada 7 días como máximo.
    const semanaPrevia = Object.values(acciones).find((a) => a.tipo === "patron_semana" && a.responsableId === responsableId && ahora.getTime() - Date.parse(a.detectadaEn) < 7 * DIA)
      ?? historial.find((a) => a.tipo === "patron_semana" && a.responsableId === responsableId && ahora.getTime() - Date.parse(a.detectadaEn) < 7 * DIA);
    if (deLaSemana >= config.repeticionSemana && !semanaPrevia) patrones.push({ tipo: "patron_semana", id: `patron:semana:${responsableId}:${hoy}`, conteo: deLaSemana, umbral: config.repeticionSemana });
    for (const p of patrones) {
      if (acciones[p.id] || historial.some((h) => h.id === p.id)) continue;
      const periodo = p.tipo === "patron_dia" ? "hoy" : "en los últimos 7 días";
      const patron: Accion = {
        id: p.id,
        tipo: p.tipo,
        conversationId: null,
        claveAlerta: null,
        responsableId,
        responsableNombre: nombre,
        responsableEsSupervisora: false,
        cliente: `${p.conteo} chats con plazo vencido ${periodo}`,
        telefono: "",
        numero: null,
        frase: null,
        motivo: `${nombre} dejó vencer ${p.conteo} plazos ${periodo} (umbral ${p.umbral})`,
        mensajeSugerido: null,
        riesgo: "PATRON",
        esperandoDesde: iso,
        plazoMin: 0,
        estado: "AVISADA",
        detectadaEn: iso,
        avisadaEn: null,
        venceEn: null,
        segundoAvisoEn: null,
        segundoAvisoA: null,
        escaladaEn: null,
        gravedadEscalada: null,
        motivoEscalada: null,
        resueltaEn: null,
        resueltaPor: null,
        resueltaPorNombre: null,
        minutosHastaResolver: null,
        atendidaEn: null,
        atendidaPor: null,
        incumplida: false,
        conteo: p.conteo,
        vistoEn: iso,
      };
      acciones[p.id] = patron;
      // Un patrón no es urgente de minutos: push (riesgo PATRON), sin WhatsApp.
      escalar(patron, ahora, `Se repite: ${p.conteo} plazos vencidos ${periodo} (umbral ${p.umbral}). Ya no es un descuido: hay que hablar con ella.`, eventos);
    }
  }

  // 5. Limpieza: lo cerrado hace más de 24 h pasa al historial; el historial guarda 8 días.
  for (const a of Object.values(acciones)) {
    if (ESTADOS_ACTIVOS.includes(a.estado)) {
      continue;
    }
    const fin = Date.parse(a.resueltaEn ?? a.atendidaEn ?? a.vistoEn);
    if (ahora.getTime() - fin >= DIA) {
      historial.push(cerrada(a, ahora));
      delete acciones[a.id];
    }
  }
  const historialLimpio = historial.filter((h) => ahora.getTime() - Date.parse(h.cerradaEn) < 8 * DIA);
  return { estado: { acciones, historial: historialLimpio }, eventos };
}

/* ------------------------------------------------------------------------------------------------
   3. LO QUE LE LLEGA A LA ASESORA (WhatsApp corto + push)
------------------------------------------------------------------------------------------------ */

const ICONO_DEL_TIPO: Record<TipoDeTarjeta, string> = {
  pago: "💰",
  caliente: "🔥",
  asignado: "👋",
  sin_duena: "📥",
  patron_dia: "🔁",
  patron_semana: "🔁",
};

function minutosDesde(desde: string | Date, ahora: Date): number {
  return Math.max(0, Math.round((ahora.getTime() - new Date(desde).getTime()) / MIN));
}

export function duracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 48 * 60) return `${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min`;
  return `${Math.round(minutos / (24 * 60))} días`;
}

/**
 * El WhatsApp a la asesora: cliente exacto, motivo, cuánto espera, qué hacer (mensaje sugerido),
 * enlace y PLAZO. Varios chats de la misma vuelta van en un solo mensaje (máx. 5 detallados).
 */
export function textoParaLaAsesora(input: {
  acciones: Accion[];
  enlaces: Map<string, string>;
  ahora: Date;
  segundo?: boolean;
}): string {
  const { acciones, ahora } = input;
  const primero = acciones[0];
  const nombre = primerNombre(primero?.responsableNombre) ?? "";
  const encabezado = input.segundo
    ? `⏰ *Segundo aviso del Supervisor*${nombre ? ` · ${nombre}` : ""}\nSe venció el plazo y ${acciones.length === 1 ? "este cliente sigue" : "estos clientes siguen"} sin respuesta. Si no puedes, avísale a tu supervisora.`
    : `📋 *Supervisor · tarea para ti*${nombre ? ` · ${nombre}` : ""}`;
  const lineas = [encabezado, ""];
  acciones.slice(0, 5).forEach((a, i) => {
    const vence = input.segundo ? null : a.venceEn;
    lineas.push(`${acciones.length > 1 ? `${i + 1}) ` : ""}${ICONO_DEL_TIPO[a.tipo]} *${a.cliente}*${a.telefono && a.cliente !== a.telefono ? ` (${a.telefono})` : ""}`);
    lineas.push(`${a.motivo} · espera ${duracion(minutosDesde(a.esperandoDesde, ahora))}`);
    if (a.frase) lineas.push(`Dijo: «${a.frase}»`);
    if (a.mensajeSugerido) lineas.push(`Responde: "${a.mensajeSugerido.slice(0, 280)}"`);
    lineas.push(`⏱️ Plazo: ${vence ? `antes de las ${horaBogota(vence)}` : "YA"}`);
    const enlace = input.enlaces.get(a.id);
    if (enlace) lineas.push(enlace);
    lineas.push("");
  });
  if (acciones.length > 5) lineas.push(`…y ${acciones.length - 5} más en tu Mi día.`);
  return lineas.join("\n").trim();
}

export function pushParaLaAsesora(acciones: Accion[], segundo = false): { title: string; body: string } {
  const a = acciones[0];
  const title = (segundo ? "⏰ Segundo aviso: responde ya" : acciones.length > 1 ? `${acciones.length} clientes te esperan` : `${ICONO_DEL_TIPO[a.tipo]} ${a.cliente} te espera`).slice(0, 60);
  const plazo = segundo ? "Plazo vencido." : a.venceEn ? `Plazo: ${horaBogota(a.venceEn)}.` : "";
  const body = (acciones.length > 1 ? `${acciones.map((x) => x.cliente).slice(0, 4).join(", ")}. ${plazo}` : `${a.motivo}. ${plazo}${a.mensajeSugerido ? ` Sugerido: ${a.mensajeSugerido}` : ""}`).slice(0, 180);
  return { title, body };
}

/** El aviso a la supervisora en la segunda oportunidad. */
export function pushParaLaSupervisora(acciones: Accion[]): { title: string; body: string } {
  const a = acciones[0];
  return {
    title: `Apoyo: ${a.responsableNombre} no respondió`.slice(0, 60),
    body: `${acciones.length > 1 ? `${acciones.length} clientes` : a.cliente}: ${a.motivo}. Plazo vencido a las ${horaBogota(a.venceEn)}. Ayúdala o reasígnalo antes de que llegue a Alexander.`.slice(0, 180),
  };
}

/* ------------------------------------------------------------------------------------------------
   4. LO QUE LE LLEGA A ALEXANDER (tarjeta completa, push y WhatsApp corto)
------------------------------------------------------------------------------------------------ */

export type Tarjeta = {
  id: string;
  gravedad: GravedadDeEscalada;
  riesgoOrden: Riesgo;
  quePaso: string;
  cliente: string;
  responsable: string;
  /** "Aviso a Ingrid a las 10:12 · plazo vencido 10:27 · segundo aviso 10:27 (también a …)". */
  intentos: string;
  porQue: string;
  riesgo: string;
  solucion: string;
  accionDeAlexander: string;
  /** Ruta dentro del CRM (la pantalla la usa tal cual; el WhatsApp le pone el dominio). */
  enlace: string;
  /** /c/<numero> si se sabe (más corto para WhatsApp). */
  enlaceCorto: string | null;
  desde: string;
  conversationId: string | null;
};

export const DOMINIO = "https://app.aizenbot.com";

export function enlaceAlChat(conversationId: string): string {
  return `/cliente/chats?chatKey=${encodeURIComponent(`agent:${conversationId}`)}&assigned=all`;
}

const RIESGO_CON_COTIZACION = "Tiene cotización o anticipo registrado: es una venta con monto a punto de cerrarse o de perderse.";

const RIESGO_DEL_TIPO: Record<TipoDeTarjeta, string> = {
  pago: "Un cliente que ya pagó y no recibe respuesta pierde la confianza: puede pedir la devolución o reclamar en redes.",
  caliente: "Lead con intención de compra: pasada 1 h sin respuesta, la venta suele perderse.",
  asignado: "Lead interesado sin una persona en la primera hora: casi nunca compra.",
  sin_duena: "Nadie es dueño del chat: nadie lo va a contestar.",
  patron_dia: "Respuesta lenta repetida: se enfrían leads todos los días y baja el cierre.",
  patron_semana: "Respuesta lenta repetida en la semana: es un problema de carga o de compromiso, no un descuido.",
};

export function tarjetaDeAccion(a: Accion, ahora: Date): Tarjeta {
  const esPatron = a.tipo === "patron_dia" || a.tipo === "patron_semana";
  const espera = duracion(minutosDesde(a.esperandoDesde, ahora));
  const intentos = esPatron
    ? "Cada chat tuvo su aviso, su plazo y su segundo aviso; ninguno se resolvió a tiempo."
    : a.responsableId
      ? [
          `Aviso a ${a.responsableNombre} a las ${horaBogota(a.avisadaEn)}`,
          `plazo vencido ${horaBogota(a.venceEn)}`,
          a.segundoAvisoEn ? `segundo aviso ${horaBogota(a.segundoAvisoEn)}${a.segundoAvisoA ? ` (también a ${a.segundoAvisoA})` : ""}` : null,
          `escalado ${horaBogota(a.escaladaEn)}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : "No había a quién avisar (chat sin asesora y sin supervisora configurada).";
  let solucion: string;
  let accion: string;
  switch (a.tipo) {
    case "pago":
      solucion = `Confirmar el pago y responderle ya${a.mensajeSugerido ? `: "${a.mensajeSugerido}"` : "."}`;
      accion = `Llama a ${a.responsableNombre} para que confirme el pago ahora; si no contesta, verifica tú el pago y respóndele desde el chat.`;
      break;
    case "caliente":
    case "asignado":
      solucion = `Responderle ya${a.mensajeSugerido ? ` con: "${a.mensajeSugerido}"` : "."}`;
      accion = a.responsableId
        ? `Escríbele a ${a.responsableNombre} para que responda en 5 min o reasigna el chat a otra asesora desde la bandeja.`
        : "Asigna el chat a una asesora disponible desde la bandeja.";
      break;
    case "sin_duena":
      solucion = "Asignarlo a una asesora disponible y responderle.";
      accion = "Asigna el chat desde la bandeja (o pide a la supervisora que lo haga) y revisa por qué el reparto no lo tomó.";
      break;
    default:
      solucion = "Revisar la carga y la disponibilidad de la asesora; si está saturada, bajarle el reparto.";
      accion = `Habla hoy 5 min con ${a.responsableNombre}: qué le impidió responder y si hay que bajarle la carga del reparto.`;
  }
  const enlace = a.conversationId ? enlaceAlChat(a.conversationId) : "/cliente/crm/supervisor";
  return {
    id: a.id,
    gravedad: a.gravedadEscalada ?? "IMPORTANTE",
    riesgoOrden: a.riesgo,
    quePaso: esPatron ? a.motivo : `${a.motivo} hace ${espera}${a.frase ? ` («${a.frase}»)` : ""}.`,
    cliente: esPatron ? a.cliente : `${a.cliente}${a.telefono && a.telefono !== a.cliente ? ` (${a.telefono})` : ""}`,
    responsable: a.responsableId ? `${a.responsableNombre}${a.responsableEsSupervisora ? " (supervisora; el chat no tiene asesora)" : ""}` : "Nadie asignado",
    intentos,
    porQue: a.motivoEscalada ?? "Venció el plazo sin respuesta.",
    riesgo: a.riesgo === "COTIZACION" ? RIESGO_CON_COTIZACION : RIESGO_DEL_TIPO[a.tipo],
    solucion,
    accionDeAlexander: accion,
    enlace,
    enlaceCorto: a.numero ? `/c/${a.numero}` : null,
    desde: a.escaladaEn ?? a.detectadaEn,
    conversationId: a.conversationId,
  };
}

/** Lo mínimo de un incidente del Supervisor que hace falta para su tarjeta (bot / embudo / sistema). */
export type IncidenteParaTarjeta = {
  clave: string;
  familia: string;
  severidad: Severidad;
  titulo: string;
  primeraVezEn: Date;
  hallazgos: Hallazgo[];
};

/** Los incidentes críticos del bot / embudo / sistema van DIRECTO a Alexander: no hay asesora que los arregle. */
export function idDeIncidente(inc: Pick<IncidenteParaTarjeta, "clave" | "primeraVezEn">): string {
  return `inc:${inc.clave}:${inc.primeraVezEn.getTime()}`;
}

export function tarjetaDeIncidente(inc: IncidenteParaTarjeta): Tarjeta {
  const principal = [...inc.hallazgos].sort((a, b) => ORDEN_DE_SEVERIDAD[b.severidad] - ORDEN_DE_SEVERIDAD[a.severidad])[0];
  const leads = inc.hallazgos.reduce((max, h) => Math.max(max, h.leadsAfectados ?? 0), 0);
  return {
    id: idDeIncidente(inc),
    gravedad: inc.severidad === "CRITICO" ? "CRITICO" : "IMPORTANTE",
    riesgoOrden: "SISTEMA",
    quePaso: `${inc.titulo}${principal?.que ? `. ${principal.que}` : ""}`,
    cliente: leads ? `${leads} lead(s) afectados (ejemplos en la alerta)` : "Todos los leads de la línea / producto",
    responsable: inc.familia === "ATENCION" ? "Equipo" : "Bot / sistema (técnico)",
    intentos: "Ninguno: una asesora no puede arreglar el bot, el embudo ni el sistema.",
    porQue: principal?.tocaProduccion
      ? "La solución toca producción (libro, flujos o reparto): solo Alexander la autoriza."
      : "Falla crítica del bot, el embudo o el sistema: decide gerencia / técnico.",
    riesgo: principal?.impacto || "Leads mal atendidos mientras siga el problema.",
    solucion: principal?.recomendacion || "Revisar el incidente en el Supervisor.",
    accionDeAlexander: principal?.queCambiar && !/^Nada en el sistema/.test(principal.queCambiar)
      ? `Autoriza o descarta: ${principal.queCambiar}`
      : "Abre el incidente, decide si se autoriza el cambio recomendado y márcalo atendido.",
    enlace: "/cliente/crm/supervisor",
    enlaceCorto: null,
    desde: inc.primeraVezEn.toISOString(),
    conversationId: null,
  };
}

/** Prioridades de Alexander: máximo N, críticas primero, luego por riesgo y por antigüedad. */
const ORDEN_DE_GRAVEDAD: Record<GravedadDeEscalada, number> = { CRITICO: 3, IMPORTANTE: 2, OBSERVACION: 1 };

export const ETIQUETA_DE_GRAVEDAD: Record<GravedadDeEscalada, string> = { CRITICO: "CRÍTICO", IMPORTANTE: "IMPORTANTE", OBSERVACION: "PARA REVISAR" };

export function prioridadesDeAlexander(tarjetas: Tarjeta[], max = CONFIG_ACCIONABLE_POR_DEFECTO.maxPrioridades): { visibles: Tarjeta[]; resto: Tarjeta[] } {
  const orden = [...tarjetas].sort(
    (a, b) =>
      ORDEN_DE_GRAVEDAD[b.gravedad] - ORDEN_DE_GRAVEDAD[a.gravedad] ||
      ORDEN_DE_RIESGO[b.riesgoOrden] - ORDEN_DE_RIESGO[a.riesgoOrden] ||
      Date.parse(a.desde) - Date.parse(b.desde),
  );
  const tope = Math.max(1, Math.min(3, max));
  return { visibles: orden.slice(0, tope), resto: orden.slice(tope) };
}

/** El texto completo (pantalla / informe). */
export function textoDeLaTarjeta(t: Tarjeta): string {
  return [
    `Qué pasó: ${t.quePaso}`,
    `Cliente / venta: ${t.cliente}`,
    `Responsable: ${t.responsable}`,
    `Qué intentó el Supervisor: ${t.intentos}`,
    `Por qué te toca: ${t.porQue}`,
    `Riesgo: ${t.riesgo}`,
    `Solución recomendada: ${t.solucion}`,
    `Tu acción: ${t.accionDeAlexander}`,
    `Enlace: ${DOMINIO}${t.enlaceCorto ?? t.enlace}`,
  ].join("\n");
}

/** El WhatsApp corto para Alexander (solo CRÍTICO). */
export function textoWhatsAppDeLaTarjeta(t: Tarjeta): string {
  return [
    `🚨 *${ETIQUETA_DE_GRAVEDAD[t.gravedad]}* · Supervisor`,
    "",
    `📌 ${t.quePaso}`.slice(0, 220),
    `👤 ${t.cliente} · Resp.: ${t.responsable}`.slice(0, 160),
    `🔁 ${t.intentos}`.slice(0, 200),
    `❓ ${t.porQue}`.slice(0, 200),
    `✅ Tu acción: ${t.accionDeAlexander}`.slice(0, 220),
    "",
    `${DOMINIO}${t.enlaceCorto ?? t.enlace}`,
  ].join("\n");
}

export function textoPushDeLaTarjeta(t: Tarjeta): { title: string; body: string } {
  return {
    title: `${t.gravedad === "CRITICO" ? "CRÍTICO" : "Importante"} · ${t.cliente}`.slice(0, 60),
    body: `${t.quePaso} ${t.accionDeAlexander}`.slice(0, 180),
  };
}

/** Varias escaladas de la misma vuelta: UN push (no uno por chat). */
export function pushDeVariasTarjetas(tarjetas: Tarjeta[]): { title: string; body: string } {
  if (tarjetas.length === 1) return textoPushDeLaTarjeta(tarjetas[0]);
  const criticas = tarjetas.filter((t) => t.gravedad === "CRITICO").length;
  return {
    title: `Supervisor: ${tarjetas.length} cosas te necesitan${criticas ? ` (${criticas} críticas)` : ""}`.slice(0, 60),
    body: tarjetas
      .slice(0, 4)
      .map((t) => `${t.cliente} (${t.responsable})`)
      .join(" · ")
      .slice(0, 180),
  };
}

/* ------------------------------------------------------------------------------------------------
   5. MÉTRICAS DEL DÍA (pantalla)
------------------------------------------------------------------------------------------------ */

export type MetricasDelDia = {
  avisadas: number;
  resueltasAbajo: number;
  medianaMinutos: number | null;
  escaladas: number;
  resueltasTrasEscalar: number;
  porAsesora: Array<{ nombre: string; avisadas: number; resueltas: number; escaladas: number; incumplidas: number }>;
};

export function metricasDelDia(estado: EstadoAccionable, ahora: Date): MetricasDelDia {
  const hoy = fechaBogota(ahora);
  const filas = [
    ...Object.values(estado.acciones).map((a) => ({
      id: a.id,
      tipo: a.tipo,
      responsableNombre: a.responsableNombre,
      estado: a.estado,
      detectadaEn: a.detectadaEn,
      minutosHastaResolver: a.minutosHastaResolver,
      incumplida: a.incumplida,
      escalada: Boolean(a.escaladaEn),
    })),
    ...estado.historial,
  ].filter((a) => fechaBogota(new Date(a.detectadaEn)) === hoy && a.tipo !== "patron_dia" && a.tipo !== "patron_semana");
  const unicas = [...new Map(filas.map((f) => [`${f.id}:${f.detectadaEn}`, f])).values()];
  const resueltas = unicas.filter((f) => f.estado === "RESUELTA_ABAJO");
  const minutos = resueltas.map((f) => f.minutosHastaResolver ?? 0).sort((a, b) => a - b);
  const porNombre = new Map<string, { nombre: string; avisadas: number; resueltas: number; escaladas: number; incumplidas: number }>();
  for (const f of unicas) {
    const fila = porNombre.get(f.responsableNombre) ?? { nombre: f.responsableNombre, avisadas: 0, resueltas: 0, escaladas: 0, incumplidas: 0 };
    fila.avisadas += 1;
    if (f.estado === "RESUELTA_ABAJO") fila.resueltas += 1;
    if (f.escalada) fila.escaladas += 1;
    if (f.incumplida) fila.incumplidas += 1;
    porNombre.set(f.responsableNombre, fila);
  }
  return {
    avisadas: unicas.length,
    resueltasAbajo: resueltas.length,
    medianaMinutos: minutos.length ? minutos[Math.floor((minutos.length - 1) / 2)] : null,
    escaladas: unicas.filter((f) => f.escalada).length,
    resueltasTrasEscalar: unicas.filter((f) => f.estado === "RESUELTA_TRAS_ESCALAR").length,
    porAsesora: [...porNombre.values()].sort((a, b) => b.avisadas - a.avisadas),
  };
}
