/**
 * AVISOS POR GRAVEDAD: las reglas, en código puro (sin base, sin Next).
 *
 * Decisión de Alexander (10-10-2026): su WhatsApp queda para lo realmente crítico. Cada aviso (del
 * bot "🔔 Necesita atención" y de las alertas del Supervisor) se clasifica en una de cuatro
 * gravedades y cada gravedad tiene su canal:
 *
 *  - OPERATIVO   → solo a la asesora correspondiente (su aviso propio + Mi Día). Alexander no.
 *  - IMPORTANTE  → push del CRM a Alexander (sin WhatsApp).
 *  - CRITICO     → push + WhatsApp a Alexander, por la línea INTERNA (nunca la de ventas del
 *                  cliente), máximo 1 WhatsApp por incidente y enfriamiento de 60 min.
 *  - OBSERVACION → sin mensajes: va al resumen (pantalla del Supervisor y Cierre del día).
 *
 * Todo detrás del interruptor `avisos:gravedad:<workspaceId>` (APAGADO por defecto = lo de hoy).
 * Las pruebas están en scripts/check-avisos-gravedad.mjs.
 */

import { detectarSenales } from "../../embudo/dominio/senales";
import { enHorario, type ChatAbierto } from "../../supervisor/dominio/detectores-atencion";
import { motivoDeExclusion } from "../../supervisor/dominio/exclusiones";
import type { Hallazgo, Severidad } from "../../supervisor/dominio/tipos";

const MIN = 60_000;

export type Gravedad = "OPERATIVO" | "IMPORTANTE" | "CRITICO" | "OBSERVACION";

export const ORDEN_DE_GRAVEDAD: Record<Gravedad, number> = { OBSERVACION: 0, OPERATIVO: 1, IMPORTANTE: 2, CRITICO: 3 };

export const ETIQUETA_DE_GRAVEDAD: Record<Gravedad, string> = {
  OPERATIVO: "Operativo",
  IMPORTANTE: "Importante",
  CRITICO: "Crítico",
  OBSERVACION: "Observación",
};

/** Por dónde sale un aviso. */
export type Canal =
  | "asesora_whatsapp"
  | "asesora_push"
  | "alexander_push"
  | "alexander_whatsapp"
  | "resumen";

/* ------------------------------------------------------------------------------------------------
   CONFIGURACIÓN (AppSetting `avisos:gravedad:<workspaceId>`, JSON)
------------------------------------------------------------------------------------------------ */

export type ConfigGravedad = {
  /** El interruptor. Apagado = todo igual que hoy. */
  activo: boolean;
  /** Quién es "Alexander" para el push. Vacío = OWNER/ADMIN activos (lo mismo que hoy el Supervisor). */
  alexanderUserIds: string[];
  whatsapp: {
    /** WhatsApp de los CRÍTICOS. Si se apaga, los críticos quedan solo en push. */
    activo: boolean;
    /**
     * Número de Alexander (solo dígitos). Vacío = el destino ADMINISTRADOR (soloDe = null) de la
     * configuración de avisos (Mi empresa → Equipo). Tiene que estar en esa lista: así el webhook
     * lo reconoce como del equipo y el agente no le contesta.
     */
    numero: string | null;
    /** Línea interna. Vacía = `avisos.canalInternoId` del anti-bloqueo o, si no, la de la config de avisos. */
    canalId: string | null;
  };
  /** No repetir un WhatsApp (ni un push) del mismo incidente antes de esto, salvo que empeore. */
  enfriamientoMin: number;
  /** "Ya pagué" / comprobante sin respuesta humana: crítico desde estos minutos. */
  pagoSinRespuestaMin: number;
  /** Señal de compra sin asesora: importante desde estos minutos. */
  senalSinDuenaMin: number;
  /** Lead interesado asignado sin respuesta humana: crítico pasado esto (minutos laborales). */
  asignadoCriticoMin: number;
};

export const CONFIG_GRAVEDAD_POR_DEFECTO: ConfigGravedad = {
  activo: false,
  alexanderUserIds: [],
  whatsapp: { activo: true, numero: null, canalId: null },
  enfriamientoMin: 60,
  pagoSinRespuestaMin: 30,
  senalSinDuenaMin: 30,
  asignadoCriticoMin: 120,
};

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

function entero(valor: unknown, porDefecto: number, minimo: number, maximo: number): number {
  const numero = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor) : Number.NaN;
  if (!Number.isFinite(numero)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, Math.round(numero)));
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Lee el JSON guardado. Roto o vacío = apagado (lo de hoy). */
export function leerConfigGravedadDeTexto(crudoTexto: string | null | undefined): ConfigGravedad {
  let crudo: Record<string, unknown> = {};
  try {
    crudo = objeto(crudoTexto ? JSON.parse(crudoTexto) : null);
  } catch {
    crudo = {};
  }
  const d = CONFIG_GRAVEDAD_POR_DEFECTO;
  const wa = objeto(crudo.whatsapp);
  const numero = texto(wa.numero)?.replace(/\D/g, "") ?? null;
  return {
    activo: crudo.activo === true || crudo.activo === "true",
    alexanderUserIds: Array.isArray(crudo.alexanderUserIds)
      ? crudo.alexanderUserIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [],
    whatsapp: {
      activo: wa.activo === false || wa.activo === "false" ? false : d.whatsapp.activo,
      numero: numero && numero.length >= 10 ? numero : null,
      canalId: texto(wa.canalId),
    },
    enfriamientoMin: entero(crudo.enfriamientoMin, d.enfriamientoMin, 5, 24 * 60),
    pagoSinRespuestaMin: entero(crudo.pagoSinRespuestaMin, d.pagoSinRespuestaMin, 5, 24 * 60),
    senalSinDuenaMin: entero(crudo.senalSinDuenaMin, d.senalSinDuenaMin, 5, 24 * 60),
    asignadoCriticoMin: entero(crudo.asignadoCriticoMin, d.asignadoCriticoMin, 30, 24 * 60),
  };
}

/* ------------------------------------------------------------------------------------------------
   CANALES DE CADA GRAVEDAD
------------------------------------------------------------------------------------------------ */

/** A dónde va cada gravedad (sin contar el enfriamiento). */
export function canalesDe(gravedad: Gravedad, opciones: { whatsappActivo: boolean; asesoraTieneWhatsApp?: boolean }): Canal[] {
  switch (gravedad) {
    case "OPERATIVO":
      return [opciones.asesoraTieneWhatsApp ? "asesora_whatsapp" : "asesora_push"];
    case "IMPORTANTE":
      return ["alexander_push"];
    case "CRITICO":
      return opciones.whatsappActivo ? ["alexander_push", "alexander_whatsapp"] : ["alexander_push"];
    case "OBSERVACION":
    default:
      return ["resumen"];
  }
}

/* ------------------------------------------------------------------------------------------------
   1. EL AVISO DEL BOT ("🔔 Necesita atención")
------------------------------------------------------------------------------------------------ */

export type DestinoBot = { numero: string; soloDe: string | null; userId?: string };

/**
 * El aviso del bot es trabajo OPERATIVO de la asesora del chat. Si después del reparto el chat
 * sigue sin dueña (nadie disponible), es IMPORTANTE: push a Alexander, sin WhatsApp.
 *
 * Con el interruptor encendido, el administrador ya NO recibe por WhatsApp los "Necesita atención"
 * de chats ajenos: si el chat escala (más de 1 h caliente, más de 2 h asignado sin respuesta, "ya
 * pagué" sin respuesta) lo levanta el Supervisor como CRÍTICO.
 */
export function rutaDelAvisoDelBot(input: {
  duenoDelChat: string | null;
  destinos: DestinoBot[];
}): { gravedad: Gravedad; destinosWhatsApp: DestinoBot[]; pushAsesora: string | null; pushAlexander: boolean } {
  if (!input.duenoDelChat) {
    return { gravedad: "IMPORTANTE", destinosWhatsApp: [], pushAsesora: null, pushAlexander: true };
  }
  const suyos = input.destinos.filter((destino) => destino.soloDe !== null && destino.soloDe === input.duenoDelChat);
  return {
    gravedad: "OPERATIVO",
    destinosWhatsApp: suyos,
    // La asesora sin número cargado igual se entera: push del CRM.
    pushAsesora: suyos.length ? null : input.duenoDelChat,
    pushAlexander: false,
  };
}

/* ------------------------------------------------------------------------------------------------
   2. LAS ALERTAS DEL SUPERVISOR
------------------------------------------------------------------------------------------------ */

export type IncidenteParaClasificar = {
  clave: string;
  familia: string;
  severidad: Severidad;
  desde: Date;
  hallazgos: Hallazgo[];
};

const SATURADA_DESDE = 4;

function minutosMaximoDe(inc: IncidenteParaClasificar): number | null {
  for (const h of inc.hallazgos) {
    const valor = h.valores?.minutosMaximo;
    if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  }
  return null;
}

function leadsDe(inc: IncidenteParaClasificar): number {
  return inc.hallazgos.reduce((total, h) => Math.max(total, h.leadsAfectados ?? 0), 0);
}

/** La asesora del incidente de atención (si es de una asesora). */
export function asesoraDelIncidente(inc: IncidenteParaClasificar): string | null {
  return inc.hallazgos.find((h) => h.asesoraId)?.asesoraId ?? null;
}

export function clasificarIncidente(
  inc: IncidenteParaClasificar,
  ahora: Date,
  config: Pick<ConfigGravedad, "senalSinDuenaMin" | "asignadoCriticoMin"> = CONFIG_GRAVEDAD_POR_DEFECTO,
): { gravedad: Gravedad; motivo: string } {
  const horario = enHorario(ahora);
  const critico = inc.severidad === "CRITICO";

  if (inc.familia === "ATENCION") {
    // "Ya pagué" / comprobante sin respuesta humana en 30 min.
    if (inc.clave.startsWith("ATENCION:pago-sin-respuesta")) {
      return horario
        ? { gravedad: "CRITICO", motivo: "Cliente dice que ya pagó / mandó comprobante y nadie le responde" }
        : { gravedad: "IMPORTANTE", motivo: "Pago sin respuesta fuera del horario laboral" };
    }
    if (inc.clave.startsWith("ATENCION:caliente-esperando:")) {
      const sinDuena = inc.clave.endsWith(":sin-duena");
      if (critico && horario) return { gravedad: "CRITICO", motivo: "Caliente más de 1 h sin respuesta humana" };
      if (critico) return { gravedad: "IMPORTANTE", motivo: "Caliente más de 1 h sin respuesta, fuera del horario" };
      if (sinDuena) return { gravedad: "IMPORTANTE", motivo: "Chat caliente sin asesora asignada" };
      if (leadsDe(inc) >= SATURADA_DESDE) return { gravedad: "IMPORTANTE", motivo: "Asesora saturada" };
      return { gravedad: "OPERATIVO", motivo: "Caliente esperando 15–60 min" };
    }
    if (inc.clave.startsWith("ATENCION:asignado-sin-respuesta:")) {
      const minutos = minutosMaximoDe(inc) ?? 0;
      const pasado = minutos > config.asignadoCriticoMin || critico;
      if (pasado && horario) return { gravedad: "CRITICO", motivo: "Lead interesado asignado más de 2 h sin respuesta humana" };
      if (pasado) return { gravedad: "IMPORTANTE", motivo: "Asignado más de 2 h sin respuesta, fuera del horario" };
      return { gravedad: "OPERATIVO", motivo: "Lead interesado asignado sin respuesta humana (< 2 h)" };
    }
    if (inc.clave.startsWith("ATENCION:senal-sin-duena")) {
      const minutos = (ahora.getTime() - inc.desde.getTime()) / MIN;
      return minutos >= config.senalSinDuenaMin
        ? { gravedad: "IMPORTANTE", motivo: "Señal de compra sin asesora asignada > 30 min" }
        : { gravedad: "OBSERVACION", motivo: "Señal de compra sin asesora (todavía < 30 min)" };
    }
    if (inc.clave.startsWith("ATENCION:tareas-sin-duena")) {
      return inc.severidad === "OBSERVACION"
        ? { gravedad: "OBSERVACION", motivo: "Tareas sin dueña" }
        : { gravedad: "IMPORTANTE", motivo: "Nadie disponible para las tareas" };
    }
    if (inc.clave.startsWith("ATENCION:oportunidades-a-retomar")) {
      return { gravedad: "OBSERVACION", motivo: "Oportunidades a retomar (van al Plan del día)" };
    }
    // Cualquier otra de atención: de una asesora = operativo; sin asesora = según su severidad.
    if (asesoraDelIncidente(inc)) {
      return critico && horario ? { gravedad: "CRITICO", motivo: "Atención crítica" } : { gravedad: "OPERATIVO", motivo: "Atención de la asesora" };
    }
    return critico ? { gravedad: horario ? "CRITICO" : "IMPORTANTE", motivo: "Atención crítica" } : inc.severidad === "IMPORTANTE" ? { gravedad: "IMPORTANTE", motivo: "Atención" } : { gravedad: "OBSERVACION", motivo: "Atención" };
  }

  // Bot, embudo y cambios del libro: la severidad del Supervisor manda.
  if (critico) return { gravedad: "CRITICO", motivo: "Incidente crítico del bot o del embudo" };
  if (inc.severidad === "IMPORTANTE") return { gravedad: "IMPORTANTE", motivo: "Incidente importante del bot o del embudo" };
  return { gravedad: "OBSERVACION", motivo: "Observación del bot o del embudo" };
}

/* ------------------------------------------------------------------------------------------------
   3. ENFRIAMIENTO
------------------------------------------------------------------------------------------------ */

/** Lo que el enrutador recuerda de cada incidente (AppSetting `avisos:gravedad:estado:<ws>`). */
export type MarcaDeIncidente = {
  gravedad: Gravedad;
  /** Último push (a la asesora o a Alexander). */
  pushEn: string | null;
  pushLeads: number;
  /** Último WhatsApp a Alexander. */
  waEn: string | null;
  waLeads: number;
  /** Cuándo se vio por última vez (para limpiar). */
  vistoEn: string;
};

/**
 * ¿Sale el push? La primera vez sí; si sube de gravedad, sí; si no, solo pasado el enfriamiento Y
 * si empeoró (más leads afectados), o si el Supervisor lo pide como recordatorio de un CRÍTICO.
 */
export function decidirPush(input: {
  marca: MarcaDeIncidente | null;
  gravedad: Gravedad;
  leads: number;
  ahora: Date;
  enfriamientoMin: number;
  recordatorio?: boolean;
}): boolean {
  const { marca } = input;
  if (!marca || !marca.pushEn) return true;
  if (ORDEN_DE_GRAVEDAD[input.gravedad] > ORDEN_DE_GRAVEDAD[marca.gravedad]) return true;
  const pasado = input.ahora.getTime() - Date.parse(marca.pushEn) >= input.enfriamientoMin * MIN;
  if (!pasado) return false;
  return input.leads > marca.pushLeads || Boolean(input.recordatorio);
}

/**
 * ¿Sale el WhatsApp de un CRÍTICO? Máximo uno por incidente. Otro solo si EMPEORÓ (más leads
 * afectados que en el último WhatsApp) y ya pasó el enfriamiento (60 min).
 */
export function decidirWhatsApp(input: {
  marca: MarcaDeIncidente | null;
  leads: number;
  ahora: Date;
  enfriamientoMin: number;
}): boolean {
  const { marca } = input;
  if (!marca || !marca.waEn) return true;
  const pasado = input.ahora.getTime() - Date.parse(marca.waEn) >= input.enfriamientoMin * MIN;
  return pasado && input.leads > marca.waLeads;
}

export function leadsDelIncidente(inc: IncidenteParaClasificar): number {
  return Math.max(1, leadsDe(inc));
}

/* ------------------------------------------------------------------------------------------------
   4. "YA PAGUÉ" / COMPROBANTE SIN RESPUESTA (detector nuevo; solo corre con el interruptor)
------------------------------------------------------------------------------------------------ */

export function detectarPagoSinRespuesta(chats: ChatAbierto[], ahora: Date, esperaMin = CONFIG_GRAVEDAD_POR_DEFECTO.pagoSinRespuestaMin): Hallazgo[] {
  type Fila = { chat: ChatAbierto; minutos: number; frase: string };
  const filas: Fila[] = [];
  for (const chat of chats) {
    if (!chat.ultimoClienteEn) continue;
    // Con el turno calculado (lib/turno-del-chat.ts) manda el turno; un "ya pagué" es intención
    // fuerte, así que sigue siendo turno de Magilus hasta que una persona responda.
    const esperando = chat.turno
      ? chat.turno.de === "MAGILUS"
      : !chat.ultimaRespuestaHumanaEn || chat.ultimoClienteEn.getTime() > chat.ultimaRespuestaHumanaEn.getTime();
    if (!esperando) continue;
    const motivo = motivoDeExclusion({ ...chat, textos: [...(chat.textosDelCliente ?? []), ...chat.textosPendientes] }, ahora);
    if (motivo !== null && motivo !== "ya_respondio") continue;
    const senal = chat.textosPendientes.flatMap((t) => detectarSenales(t)).find((s) => s.tipo === "comprobante");
    if (!senal) continue;
    const minutos = Math.floor((ahora.getTime() - chat.ultimoClienteEn.getTime()) / MIN);
    if (minutos < esperaMin || minutos > 24 * 60) continue;
    filas.push({ chat, minutos, frase: senal.fragmento });
  }
  const porAsesora = new Map<string, Fila[]>();
  for (const f of filas) {
    const clave = f.chat.asesoraId ?? "sin-duena";
    porAsesora.set(clave, [...(porAsesora.get(clave) ?? []), f]);
  }
  const salida: Hallazgo[] = [];
  for (const [asesora, lista] of porAsesora) {
    const orden = [...lista].sort((a, b) => b.minutos - a.minutos);
    const peor = orden[0];
    const nombre = peor.chat.asesoraNombre ?? (asesora === "sin-duena" ? "nadie (sin dueña)" : asesora);
    salida.push({
      clave: `ATENCION:pago-sin-respuesta:${asesora}`,
      familia: "ATENCION",
      severidad: "CRITICO",
      titulo: `${lista.length} cliente(s) dicen que ya pagaron y nadie les responde (${nombre})`,
      que: `El más antiguo lleva ${peor.minutos} min sin respuesta humana ("${peor.frase}").`,
      desde: peor.chat.ultimoClienteEn as Date,
      producto: null,
      asesoraId: asesora === "sin-duena" ? null : asesora,
      leadsAfectados: lista.length,
      evidencia: { chats: orden.slice(0, 10).map((f) => f.chat.conversationId), reglas: [], versiones: [] },
      metrica: "Minutos sin respuesta humana después de un pago o comprobante",
      esperado: `< ${esperaMin} min`,
      observado: orden.slice(0, 5).map((f) => `${f.minutos} min`).join(", "),
      hechos: orden.slice(0, 5).map((f) => `Chat ${f.chat.conversationId}: ${f.minutos} min, dijo "${f.frase}".`),
      hipotesis: [],
      causaPosible: "Nadie vio el mensaje del pago.",
      impacto: "Un cliente que ya pagó y no recibe respuesta pierde la confianza; puede pedir la devolución.",
      recomendacion: `Que ${nombre} confirme el pago y le responda ya.`,
      queCambiar: "Nada en el sistema: es atención del equipo.",
      riesgo: "Ninguno: es un aviso.",
      comoMedir: "Todo pago o comprobante con respuesta humana en menos de 30 min.",
      tocaProduccion: false,
      valores: { minutosMaximo: peor.minutos },
    });
  }
  return salida;
}

/* ------------------------------------------------------------------------------------------------
   5. RESUMEN DEL DÍA (pantalla del Supervisor y bloque para el Cierre del día)
------------------------------------------------------------------------------------------------ */

export type ResumenDelDia = {
  fecha: string;
  /** Incidentes / chats únicos por gravedad (no cuenta repeticiones de la misma vuelta). */
  vistos: Record<string, Gravedad>;
  /** Envíos que salieron, por canal. */
  envios: Record<Canal, number>;
  /** Ejemplos sin teléfonos, del más nuevo al más viejo (máx. 30). */
  ejemplos: Array<{ en: string; gravedad: Gravedad; titulo: string }>;
};

export function resumenVacio(fecha: string): ResumenDelDia {
  return {
    fecha,
    vistos: {},
    envios: { asesora_whatsapp: 0, asesora_push: 0, alexander_push: 0, alexander_whatsapp: 0, resumen: 0 },
    ejemplos: [],
  };
}

/** Fecha de Bogotá (AAAA-MM-DD). */
export function fechaBogota(fecha: Date): string {
  return new Date(fecha.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export function anotar(
  resumen: ResumenDelDia,
  evento: { clave: string; gravedad: Gravedad; titulo: string; canales: Canal[]; en: Date },
): ResumenDelDia {
  const previa = resumen.vistos[evento.clave];
  const vistos = {
    ...resumen.vistos,
    [evento.clave]: previa && ORDEN_DE_GRAVEDAD[previa] >= ORDEN_DE_GRAVEDAD[evento.gravedad] ? previa : evento.gravedad,
  };
  const envios = { ...resumen.envios };
  for (const canal of evento.canales) envios[canal] = (envios[canal] ?? 0) + 1;
  const nuevoEjemplo = !previa || previa !== vistos[evento.clave];
  const ejemplos = nuevoEjemplo
    ? [{ en: evento.en.toISOString(), gravedad: vistos[evento.clave], titulo: evento.titulo.slice(0, 160) }, ...resumen.ejemplos].slice(0, 30)
    : resumen.ejemplos;
  return { ...resumen, vistos, envios, ejemplos };
}

export function conteoPorGravedad(resumen: ResumenDelDia): Record<Gravedad, number> {
  const conteo: Record<Gravedad, number> = { OPERATIVO: 0, IMPORTANTE: 0, CRITICO: 0, OBSERVACION: 0 };
  for (const gravedad of Object.values(resumen.vistos)) conteo[gravedad] += 1;
  return conteo;
}

/** El bloque de texto para pegar en el Cierre del día. */
export function bloqueDelCierreDelDia(resumen: ResumenDelDia): string {
  const c = conteoPorGravedad(resumen);
  const e = resumen.envios;
  const lineas = [
    `Avisos del día (${resumen.fecha})`,
    `- Críticos: ${c.CRITICO} (WhatsApp a Alexander: ${e.alexander_whatsapp})`,
    `- Importantes: ${c.IMPORTANTE} (push a Alexander: ${e.alexander_push})`,
    `- Operativos de las asesoras: ${c.OPERATIVO} (WhatsApp a la asesora: ${e.asesora_whatsapp}, push a la asesora: ${e.asesora_push})`,
    `- Observaciones (sin mensaje): ${c.OBSERVACION}`,
  ];
  const destacados = resumen.ejemplos.filter((x) => x.gravedad === "CRITICO" || x.gravedad === "IMPORTANTE" || x.gravedad === "OBSERVACION").slice(0, 8);
  if (destacados.length) {
    lineas.push("", "Para revisar:");
    for (const x of destacados) lineas.push(`- [${ETIQUETA_DE_GRAVEDAD[x.gravedad]}] ${x.titulo}`);
  }
  return lineas.join("\n");
}
