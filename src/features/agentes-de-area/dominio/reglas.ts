/**
 * AGENTES DE ÁREA: las reglas, en código puro (sin base, sin Next).
 *
 * Es un molde: un agente por área (hoy solo "ventas") que piensa en el PC aizen1 y reparte el trabajo
 * a subagentes. El CRM no piensa: guarda el resumen, muestra la pantalla y entrega los WhatsApp
 * INTERNOS. Las pruebas están en scripts/check-agentes-de-area.mjs.
 */

export const AREAS = ["ventas"] as const;
export type Area = (typeof AREAS)[number];

export const ETIQUETA_DE_AREA: Record<Area, string> = { ventas: "Agente de Ventas" };

export function esArea(valor: unknown): valor is Area {
  return typeof valor === "string" && (AREAS as readonly string[]).includes(valor);
}

/** Interruptor: AppSetting `agente-area:<area>:<workspaceId>` = {"activo": true}. Sin fila = apagado. */
export const claveInterruptorDelAgente = (area: Area, workspaceId: string) => `agente-area:${area}:${workspaceId}`;

export function interpretarInterruptor(valor: string | null | undefined): boolean {
  if (!valor) return false;
  const limpio = valor.trim().toLowerCase();
  if (limpio === "true" || limpio === "1" || limpio === "si" || limpio === "sí") return true;
  try {
    const leido = JSON.parse(valor) as { activo?: unknown } | boolean;
    if (typeof leido === "boolean") return leido;
    return Boolean(leido && typeof leido === "object" && leido.activo === true);
  } catch {
    return false;
  }
}

export type TipoDeEnvio = "ALEXANDER" | "ASESORA";
export type EstadoDeEnvio = "PENDIENTE" | "ENVIADO" | "BLOQUEADO" | "FALLIDO";

export const MAX_TEXTO_DEL_MENSAJE = 4000;

export const MOTIVO_NO_ES_DEL_EQUIPO = "ese número no es del equipo";
export const MOTIVO_INTERRUPTOR_APAGADO = "interruptor apagado: no se mandó";
export const MOTIVO_YA_SE_MANDO = "ya se le mandó hoy";
export const MOTIVO_SIN_LINEA = "sin línea interna (Admin) para mandar";

/** Solo dígitos; "+57 300 111 2233" → "573001112233". */
export function soloDigitos(valor: unknown): string {
  return typeof valor === "string" ? valor.replace(/\D/g, "") : "";
}

/** Un número celular colombiano de 10 dígitos que empieza en 3 se compara con el prefijo 57. */
export function numeroCanonico(valor: unknown): string {
  const digitos = soloDigitos(valor);
  if (digitos.length === 10 && digitos.startsWith("3")) return `57${digitos}`;
  return digitos;
}

export function esTipoDeEnvio(valor: unknown): valor is TipoDeEnvio {
  return valor === "ALEXANDER" || valor === "ASESORA";
}

export type PedidoDeEnvio = { tipo: TipoDeEnvio; numero: string; texto: string; destinatario: string | null };

/** Valida lo que manda el agente. Devuelve el pedido limpio o el error legible. */
export function leerPedidoDeEnvio(args: Record<string, unknown>): { ok: true; pedido: PedidoDeEnvio } | { ok: false; error: string } {
  const tipo = typeof args.tipo === "string" ? args.tipo.trim().toUpperCase() : "";
  if (!esTipoDeEnvio(tipo)) return { ok: false, error: 'El tipo tiene que ser "alexander" o "asesora".' };
  const numero = numeroCanonico(args.numero);
  if (numero.length < 10) return { ok: false, error: "Falta el número de WhatsApp (con indicativo, solo dígitos)." };
  const texto = typeof args.texto === "string" ? args.texto.trim() : "";
  if (!texto) return { ok: false, error: "Falta el texto del mensaje." };
  if (texto.length > MAX_TEXTO_DEL_MENSAJE) return { ok: false, error: `El mensaje pasa de ${MAX_TEXTO_DEL_MENSAJE} caracteres: hay que acortarlo.` };
  const destinatario = typeof args.destinatario === "string" && args.destinatario.trim() ? args.destinatario.trim().slice(0, 120) : null;
  return { ok: true, pedido: { tipo, numero, texto, destinatario } };
}

/** ¿Este número está en la lista del equipo (Mi empresa → Equipo)? Compara por número canónico. */
export function estaEnElEquipo(numero: string, equipo: Iterable<string>): boolean {
  const buscado = numeroCanonico(numero);
  if (!buscado) return false;
  for (const candidato of equipo) {
    if (numeroCanonico(candidato) === buscado) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------------------------------
   RESUMEN DEL DÍA
------------------------------------------------------------------------------------------------ */

export const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function fechaValida(valor: unknown): valor is string {
  if (typeof valor !== "string" || !FECHA_ISO.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

/** El día de hoy en Colombia (sin horario de verano: desfase fijo de 5 h). */
export function hoyEnBogota(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export function diaAnterior(fecha: string): string {
  const base = new Date(`${fecha}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}

/** Un cliente sugerido a una asesora (para medirlo al día siguiente). */
export type Sugerido = { asesora: string; conversacionId: string | null; numero: string | null; cliente: string | null };

export type ResumenAGuardar = {
  fecha: string;
  esPrueba: boolean;
  salioTarde: boolean;
  notaDeRetraso: string | null;
  numeros: unknown;
  meta: unknown;
  subagentes: Record<string, unknown>;
  sugeridos: Sugerido[];
  mensajes: Array<{ tipo: TipoDeEnvio; numero: string; destinatario: string | null; texto: string }>;
  resumen: string | null;
};

const esObjeto = (valor: unknown): valor is Record<string, unknown> => Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);

const textoCorto = (valor: unknown, max: number): string | null =>
  typeof valor === "string" && valor.trim() ? valor.trim().slice(0, max) : null;

/** Valida y limpia lo que manda el agente al guardar el resumen. Lanza un error legible si no sirve. */
export function leerResumenAGuardar(args: Record<string, unknown>, hoy: string): ResumenAGuardar {
  const fecha = args.fecha === undefined || args.fecha === null || args.fecha === "" ? hoy : args.fecha;
  if (!fechaValida(fecha)) throw new Error("La fecha tiene que ir como AAAA-MM-DD.");
  const subagentes: Record<string, unknown> = {};
  if (args.subagentes !== undefined && args.subagentes !== null) {
    if (!esObjeto(args.subagentes)) throw new Error('"subagentes" tiene que ser un objeto: una clave por subagente (cerrador, cobrador, analista-de-perdidos).');
    for (const [nombre, entrega] of Object.entries(args.subagentes)) subagentes[nombre.slice(0, 60)] = entrega;
  }
  const sugeridos: Sugerido[] = [];
  if (Array.isArray(args.sugeridos)) {
    for (const crudo of args.sugeridos.slice(0, 200)) {
      if (!esObjeto(crudo)) continue;
      const asesora = textoCorto(crudo.asesora, 120);
      if (!asesora) continue;
      sugeridos.push({
        asesora,
        conversacionId: textoCorto(crudo.conversacionId, 64),
        numero: soloDigitos(crudo.numero) || null,
        cliente: textoCorto(crudo.cliente, 120),
      });
    }
  }
  const mensajes: ResumenAGuardar["mensajes"] = [];
  if (Array.isArray(args.mensajes)) {
    for (const crudo of args.mensajes.slice(0, 50)) {
      if (!esObjeto(crudo)) continue;
      const leido = leerPedidoDeEnvio(crudo);
      if (leido.ok) mensajes.push(leido.pedido);
    }
  }
  return {
    fecha,
    esPrueba: args.es_prueba === true,
    salioTarde: args.salio_tarde === true,
    notaDeRetraso: textoCorto(args.nota_de_retraso, 300),
    numeros: args.numeros ?? null,
    meta: args.meta ?? null,
    subagentes,
    sugeridos,
    mensajes,
    resumen: textoCorto(args.resumen, 20_000),
  };
}

/* ------------------------------------------------------------------------------------------------
   MEDIR LOS SUGERIDOS DE AYER
------------------------------------------------------------------------------------------------ */

export type ActividadDelSugerido = {
  /** La asesora (o alguien del equipo) le escribió después de la hora de corte. */
  leEscribieron: boolean;
  /** El cliente mandó un mensaje después de eso. */
  respondio: boolean;
  /** El cliente quedó en etapa GANADO. */
  compro: boolean;
};

export type MedidaDeLosSugeridos = {
  sugeridos: number;
  leEscribieron: number;
  respondieron: number;
  compraron: number;
};

export function medirSugeridos(actividades: ActividadDelSugerido[]): MedidaDeLosSugeridos {
  return {
    sugeridos: actividades.length,
    leEscribieron: actividades.filter((a) => a.leEscribieron).length,
    respondieron: actividades.filter((a) => a.leEscribieron && a.respondio).length,
    compraron: actividades.filter((a) => a.compro).length,
  };
}

/** Tasa de cierre en porcentaje con un decimal; null si no hay chats. */
export function tasaDeCierre(ventas: number, chats: number): number | null {
  if (!Number.isFinite(ventas) || !Number.isFinite(chats) || chats <= 0) return null;
  return Math.round((ventas / chats) * 1000) / 10;
}
