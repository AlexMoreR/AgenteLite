/**
 * AGENTES DE ÁREA (molde reutilizable; hoy solo existe el de Ventas).
 *
 * Un agente por área corre en aizen1 (Claude Code), mira su número y reparte el trabajo a subagentes.
 * El CRM NO piensa: guarda el resumen, muestra y entrega los WhatsApp internos que el agente pide.
 *
 * Aquí viven las reglas puras (sin base ni red), que prueba scripts/check-agentes-de-area.mjs:
 *  - el interruptor (apagado por defecto);
 *  - quién puede recibir un mensaje (SOLO la lista del equipo, nunca un cliente);
 *  - la clave única del día (un mensaje por persona y por día);
 *  - la fecha de Colombia y el chequeo de lo que manda el agente.
 */

export const AREA_VENTAS = "ventas";
export const AREAS = [AREA_VENTAS] as const;

export type TipoDeEnvio = "ALEXANDER" | "ASESORA";
export type EstadoDeEnvio = "ENVIANDO" | "ENVIADO" | "BLOQUEADO" | "FALLO";

/** Un WhatsApp de la línea Admin no pasa de esto (WhatsApp acepta más, pero un aviso largo no se lee). */
export const MAX_TEXTO_ENVIO = 3500;

/** Una clave del área solo puede ser una de las que existen: así `area` nunca viene "libre" del agente. */
export function areaValida(area: unknown): area is (typeof AREAS)[number] {
  return typeof area === "string" && (AREAS as readonly string[]).includes(area);
}

/* ------------------------------------------------------------------------------------------------
   FECHAS (Colombia no tiene horario de verano: el desfase es fijo)
------------------------------------------------------------------------------------------------ */

const BOGOTA_OFFSET_MS = 5 * 3_600_000;

export function fechaBogota(fecha: Date): string {
  return new Date(fecha.getTime() - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);
}

/** "AAAA-MM-DD" -> si existe de verdad (no el 31 de febrero). */
export function fechaValida(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!partes) return false;
  const [anio, mes, dia] = partes.slice(1).map(Number);
  const exacta = new Date(Date.UTC(anio, mes - 1, dia));
  return exacta.getUTCFullYear() === anio && exacta.getUTCMonth() === mes - 1 && exacta.getUTCDate() === dia;
}

/** Inicio (UTC) del día de Colombia `fecha`; `dias` lo corre hacia adelante (1 = el inicio del día siguiente). */
export function inicioDelDiaBogota(fecha: string, dias = 0): Date {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + dias) + BOGOTA_OFFSET_MS);
}

export function diaAnterior(fecha: string): string {
  return fechaBogota(inicioDelDiaBogota(fecha, -1));
}

/* ------------------------------------------------------------------------------------------------
   EL INTERRUPTOR: AppSetting `agente-area:<area>:<workspaceId>` = {"activo": true}
   Sin fila, o con algo ilegible, está APAGADO: no sale ningún mensaje.
------------------------------------------------------------------------------------------------ */

export const claveDelInterruptor = (area: string, workspaceId: string) => `agente-area:${area}:${workspaceId}`;

export function leerInterruptor(texto: string | null | undefined): boolean {
  if (!texto) return false;
  try {
    const valor = JSON.parse(texto) as { activo?: unknown };
    return valor?.activo === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
   QUIÉN PUEDE RECIBIR UN MENSAJE
------------------------------------------------------------------------------------------------ */

export function soloDigitos(valor: unknown): string {
  return typeof valor === "string" ? valor.replace(/\D/g, "") : "";
}

export type DestinoDelEquipo = { numero?: string; soloDe?: string | null; userId?: string };

/** Los números de la lista del equipo ("Mi empresa → Equipo"), solo dígitos y sin repetir. */
export function numerosDelEquipo(destinos: DestinoDelEquipo[]): Set<string> {
  return new Set(destinos.map((d) => soloDigitos(d.numero)).filter((n) => n.length >= 10));
}

/**
 * Alexander es el destino de avisos sin `soloDe` (el administrador). Cualquier otro número de la lista
 * es una asesora.
 */
export function tipoDeDestino(numero: string, destinos: DestinoDelEquipo[]): TipoDeEnvio {
  const administrador = destinos.find((d) => d.soloDe === null || d.soloDe === undefined);
  return administrador && soloDigitos(administrador.numero) === numero ? "ALEXANDER" : "ASESORA";
}

export type DecisionDeEnvio = { permitido: true; numero: string } | { permitido: false; numero: string; motivo: string };

export const MOTIVO_APAGADO = "interruptor apagado: no se mandó";
export const MOTIVO_NO_ES_DEL_EQUIPO = "ese número no es del equipo";
export const MOTIVO_YA_ENVIADO = "ya se le mandó hoy";
export const MOTIVO_SIN_LINEA = "no hay línea interna (Admin) configurada";

/**
 * Las reglas del servidor para un mensaje, en orden. NINGUNA depende de lo que diga el agente:
 *  1. el número tiene que ser de la lista del equipo (un cliente jamás lo es);
 *  2. el interruptor tiene que estar prendido;
 *  3. el texto no puede ir vacío ni pasarse.
 * (Que ya se haya mandado hoy lo decide la base con la clave única; ver `claveDelDia`.)
 */
export function decidirEnvio(input: { numero: unknown; texto: unknown; activo: boolean; equipo: Set<string> }): DecisionDeEnvio {
  const numero = soloDigitos(input.numero);
  if (numero.length < 10 || !input.equipo.has(numero)) return { permitido: false, numero, motivo: MOTIVO_NO_ES_DEL_EQUIPO };
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  if (!texto) return { permitido: false, numero, motivo: "el mensaje está vacío" };
  if (texto.length > MAX_TEXTO_ENVIO) return { permitido: false, numero, motivo: `el mensaje pasa de ${MAX_TEXTO_ENVIO} caracteres` };
  if (!input.activo) return { permitido: false, numero, motivo: MOTIVO_APAGADO };
  return { permitido: true, numero };
}

/** Única por negocio + área + día + número: es lo que garantiza "un solo mensaje por persona y por día". */
export function claveDelDia(workspaceId: string, area: string, fecha: string, numero: string): string {
  return `${workspaceId}:${area}:${fecha}:${numero}`;
}

/* ------------------------------------------------------------------------------------------------
   LO QUE MANDA EL AGENTE AL GUARDAR EL RESUMEN
------------------------------------------------------------------------------------------------ */

export type SugeridoDelAgente = {
  asesoraId: string | null;
  asesora: string;
  conversacionId: string;
  telefono: string | null;
  cliente: string | null;
};

export type ResumenDelAgente = {
  fecha: string;
  salioTarde: boolean;
  notaTarde: string | null;
  numeros: unknown;
  meta: unknown;
  subagentes: Record<string, unknown>;
  sugeridos: SugeridoDelAgente[];
  textoAlexander: string | null;
};

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const textoONulo = (v: unknown, max = 4000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Revisa y limpia lo que mandó el agente. Lanza un Error en español si algo no sirve. */
export function leerResumenDelAgente(args: Record<string, unknown>, hoy: string): ResumenDelAgente {
  const fecha = args.fecha === undefined || args.fecha === "" ? hoy : args.fecha;
  if (!fechaValida(fecha)) throw new Error("La fecha va como AAAA-MM-DD, por ejemplo 2026-10-22.");
  if (args.subagentes !== undefined && !esObjeto(args.subagentes)) {
    throw new Error("'subagentes' tiene que ser un objeto con lo que entregó cada subagente: { cerrador: ..., cobrador: ... }.");
  }
  if (args.sugeridos !== undefined && !Array.isArray(args.sugeridos)) throw new Error("'sugeridos' tiene que ser una lista.");
  const sugeridos: SugeridoDelAgente[] = [];
  for (const crudo of (args.sugeridos as unknown[] | undefined) ?? []) {
    if (!esObjeto(crudo)) continue;
    const conversacionId = textoONulo(crudo.conversacionId ?? crudo.conversacion_id, 100);
    if (!conversacionId) continue;
    sugeridos.push({
      asesoraId: textoONulo(crudo.asesoraId ?? crudo.asesora_id, 100),
      asesora: textoONulo(crudo.asesora, 120) ?? "sin asesora",
      conversacionId,
      telefono: soloDigitos(crudo.telefono) || null,
      cliente: textoONulo(crudo.cliente, 160),
    });
  }
  return {
    fecha,
    salioTarde: args.salio_tarde === true,
    notaTarde: textoONulo(args.nota_tarde, 300),
    numeros: args.numeros ?? null,
    meta: args.meta ?? null,
    subagentes: (args.subagentes as Record<string, unknown> | undefined) ?? {},
    sugeridos,
    textoAlexander: textoONulo(args.texto_alexander, MAX_TEXTO_ENVIO),
  };
}

/** Antepone el aviso de tarde al mensaje de Alexander (el lanzador usa esta misma frase). */
export function textoConAvisoDeTarde(texto: string, salioTarde: boolean, nota: string | null): string {
  if (!salioTarde) return texto;
  return `Salió tarde${nota ? ` (${nota})` : ""}.\n\n${texto}`;
}

/* ------------------------------------------------------------------------------------------------
   MEDIR LOS SUGERIDOS (al día siguiente): ¿le escribieron? ¿respondió? ¿compró?
------------------------------------------------------------------------------------------------ */

export type MensajeMinimo = { direction: "INBOUND" | "OUTBOUND"; humano: boolean; en: Date };

export type ResultadoDeSugerido = { leEscribieron: boolean; respondio: boolean; compro: boolean };

/**
 * `mensajes` son los del chat desde que se sugirió. "Le escribieron" = un mensaje saliente de una
 * persona (asesora desde el CRM o el celular), NO del bot. "Respondió" = un mensaje del cliente DESPUÉS de
 * ese. "Compró" = el contacto quedó en Ganado desde la fecha de la sugerencia.
 */
export function medirSugerido(mensajes: MensajeMinimo[], compro: boolean): ResultadoDeSugerido {
  const ordenados = [...mensajes].sort((a, b) => a.en.getTime() - b.en.getTime());
  const primero = ordenados.find((m) => m.direction === "OUTBOUND" && m.humano);
  const respondio = !!primero && ordenados.some((m) => m.direction === "INBOUND" && m.en.getTime() > primero.en.getTime());
  return { leEscribieron: !!primero, respondio, compro };
}

/** Mediana en minutos del tiempo que tardó una persona en contestar al cliente (null si no hay datos). */
export function tiemposDeRespuesta(mensajes: MensajeMinimo[]): number[] {
  const ordenados = [...mensajes].sort((a, b) => a.en.getTime() - b.en.getTime());
  const tiempos: number[] = [];
  let esperaDesde: Date | null = null;
  for (const m of ordenados) {
    if (m.direction === "INBOUND") {
      if (!esperaDesde) esperaDesde = m.en;
    } else if (m.humano && esperaDesde) {
      tiempos.push(Math.max(0, Math.round((m.en.getTime() - esperaDesde.getTime()) / 60_000)));
      esperaDesde = null;
    }
  }
  return tiempos;
}

export function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[mitad] : Math.round((orden[mitad - 1] + orden[mitad]) / 2);
}
