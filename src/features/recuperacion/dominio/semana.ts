/**
 * RECUPERACIÓN DE LEADS · pantalla "Semana" (diseño aprobado por Alex el 13-10-2026, Main.dc.html).
 * Código puro: recibe los leads de la semana con sus mensajes de seguimiento y sus entrantes, y arma
 * los números. La lectura de la base está en servicios/semana.ts.
 *
 * Definiciones:
 *  - Llegaron: chats de las líneas de ventas cuyo PRIMER mensaje del cliente cae en la semana.
 *  - Recibieron seguimiento: tienen algún mensaje automático de seguimiento (`source` "follow" o
 *    "agente-v3-seguimiento").
 *  - Recuperados: el cliente escribió dentro de las 72 h siguientes a un seguimiento.
 *  - Siguen callados más de 72 h: recibieron seguimiento, no se recuperaron y su último mensaje es
 *    de hace más de 72 h.
 *  - Compraron: contacto en Ganado (y cuántos de ellos se recuperaron).
 *  - Por tipo de seguimiento: cuántos se mandaron y cuántos contestó el cliente en 24 h, antes del
 *    siguiente seguimiento. Los mensajes del mismo tipo a menos de 2 min son UN envío (un
 *    seguimiento con foto y texto sale en dos mensajes).
 */

const MIN = 60_000;
const HORA = 60 * MIN;

export const VENTANA_RECUPERADO_MS = 72 * HORA;
export const VENTANA_RESPUESTA_MS = 24 * HORA;
export const MISMO_ENVIO_MS = 2 * MIN;
/** Por debajo de esto el tipo de seguimiento sale en rojo. */
export const TASA_BAJA = 5;

export type ClaseDeSeguimiento = "bot" | "dia_siguiente" | "inteligente" | "tras_asesora" | "campana" | "otro";

export const NOMBRE_DE_CLASE: Record<ClaseDeSeguimiento, string> = {
  bot: "Recordatorio del bot (15 min / 1 h)",
  dia_siguiente: "Día siguiente",
  inteligente: "Mensaje útil (inteligente)",
  tras_asesora: "Después de la asesora",
  campana: "Campaña",
  otro: "Otro",
};

/**
 * Qué seguimiento es, por el origen del mensaje y el nombre del Follow que lo mandó. Los nombres
 * los ponen: "Tras asesora: …" (dominio/tras-asesora.ts), "Etapa <paso> · N" / "Etapa <paso> · día
 * siguiente" (crm/services/stage-follow-up.ts, dominio/dia-siguiente.ts), "Inteligente: …"
 * (servicios/convivencia.ts) y "Campaña: …" (campanas/services/campaigns.ts).
 */
export function claseDeSeguimiento(origen: string | null | undefined, nombreDelFollow: string | null | undefined): ClaseDeSeguimiento | null {
  if (origen === "agente-v3-seguimiento") return "bot";
  if (origen !== "follow") return null;
  const nombre = (nombreDelFollow ?? "").trim().toLowerCase();
  if (nombre.startsWith("tras asesora")) return "tras_asesora";
  if (nombre.startsWith("etapa")) return "dia_siguiente";
  if (nombre.startsWith("inteligente")) return "inteligente";
  if (nombre.startsWith("campa")) return "campana";
  return "otro";
}

export type EventoDelLead = { tipo: "IN"; en: Date } | { tipo: "SEG"; clase: ClaseDeSeguimiento; en: Date };

/** Lo que muestra la lista "Leads" de cada chat (no entra en los números). */
export type FichaDelLead = {
  nombre: string | null;
  telefono4: string | null;
  linea: string | null;
  asesora: string | null;
  producto: string | null;
  etapa: string | null;
  /** El último mensaje del cliente, recortado. */
  ultimoTexto: string | null;
};

export type LeadDeRecuperacion = {
  conversationId: string;
  ficha?: FichaDelLead;
  ganado: boolean;
  /** El último mensaje del cliente (de toda la charla, no solo de la ventana leída). */
  ultimoClienteEn: Date | null;
  /** Entrantes y seguimientos de la ventana leída (en cualquier orden). */
  eventos: EventoDelLead[];
};

export type EnvioDeSeguimiento = { clase: ClaseDeSeguimiento; en: Date; contesto: boolean };

/** Los envíos de seguimiento del lead (agrupados) y si el cliente contestó cada uno. */
export function enviosDelLead(eventos: ReadonlyArray<EventoDelLead>): EnvioDeSeguimiento[] {
  const ordenados = [...eventos].sort((a, b) => a.en.getTime() - b.en.getTime());
  const entrantes = ordenados.filter((e) => e.tipo === "IN").map((e) => e.en.getTime());
  const envios: Array<{ clase: ClaseDeSeguimiento; en: Date; ultimo: number }> = [];
  for (const evento of ordenados) {
    if (evento.tipo !== "SEG") continue;
    const previo = envios.at(-1);
    if (previo && previo.clase === evento.clase && evento.en.getTime() - previo.ultimo <= MISMO_ENVIO_MS) {
      previo.ultimo = evento.en.getTime();
      continue;
    }
    envios.push({ clase: evento.clase, en: evento.en, ultimo: evento.en.getTime() });
  }
  return envios.map((envio, i) => {
    const desde = envio.en.getTime();
    const siguiente = envios[i + 1]?.en.getTime() ?? Number.POSITIVE_INFINITY;
    const hasta = Math.min(desde + VENTANA_RESPUESTA_MS, siguiente);
    return { clase: envio.clase, en: envio.en, contesto: entrantes.some((t) => t > desde && t <= hasta) };
  });
}

/** ¿El cliente escribió dentro de las 72 h siguientes a algún seguimiento? */
export function fueRecuperado(eventos: ReadonlyArray<EventoDelLead>): boolean {
  const seguimientos = eventos.filter((e) => e.tipo === "SEG").map((e) => e.en.getTime());
  if (!seguimientos.length) return false;
  return eventos.some((e) => e.tipo === "IN" && seguimientos.some((s) => e.en.getTime() > s && e.en.getTime() <= s + VENTANA_RECUPERADO_MS));
}

export type TipoDeSeguimiento = {
  clase: ClaseDeSeguimiento;
  nombre: string;
  enviados: number;
  contestaron: number;
  /** % entero, null sin envíos. */
  pct: number | null;
  baja: boolean;
};

export type SemanaDeRecuperacion = {
  llegaron: number;
  conSeguimiento: number;
  recuperados: number;
  calladosMas72: number;
  compraron: number;
  compraronRecuperados: number;
  /** recuperados / conSeguimiento, % entero (null sin base). */
  pctRecuperados: number | null;
  tipos: TipoDeSeguimiento[];
};

export function porcentaje(parte: number, base: number): number | null {
  return base > 0 ? Math.round((parte / base) * 100) : null;
}

export type EstadoDelLead = { recibio: boolean; recuperado: boolean; callado72: boolean };

/** Dónde cae el lead en "¿Qué pasó con los leads?". Lo usan los números y las listas. */
export function estadoDelLead(lead: LeadDeRecuperacion, ahora: Date): EstadoDelLead {
  const recibio = lead.eventos.some((e) => e.tipo === "SEG");
  const recuperado = recibio && fueRecuperado(lead.eventos);
  const callado = !lead.ultimoClienteEn || ahora.getTime() - lead.ultimoClienteEn.getTime() > VENTANA_RECUPERADO_MS;
  return { recibio, recuperado, callado72: recibio && !recuperado && callado };
}

export function resumirSemana(leads: ReadonlyArray<LeadDeRecuperacion>, ahora: Date): SemanaDeRecuperacion {
  let conSeguimiento = 0;
  let recuperados = 0;
  let calladosMas72 = 0;
  let compraron = 0;
  let compraronRecuperados = 0;
  const porClase = new Map<ClaseDeSeguimiento, { enviados: number; contestaron: number }>();
  for (const lead of leads) {
    const { recibio, recuperado, callado72 } = estadoDelLead(lead, ahora);
    if (recibio) conSeguimiento += 1;
    if (recuperado) recuperados += 1;
    if (callado72) calladosMas72 += 1;
    if (lead.ganado) {
      compraron += 1;
      if (recuperado) compraronRecuperados += 1;
    }
    for (const envio of enviosDelLead(lead.eventos)) {
      const fila = porClase.get(envio.clase) ?? { enviados: 0, contestaron: 0 };
      fila.enviados += 1;
      if (envio.contesto) fila.contestaron += 1;
      porClase.set(envio.clase, fila);
    }
  }
  const tipos = [...porClase.entries()]
    .map(([clase, fila]): TipoDeSeguimiento => {
      const pct = porcentaje(fila.contestaron, fila.enviados);
      return { clase, nombre: NOMBRE_DE_CLASE[clase], ...fila, pct, baja: pct !== null && pct < TASA_BAJA };
    })
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.enviados - a.enviados);
  return {
    llegaron: leads.length,
    conSeguimiento,
    recuperados,
    calladosMas72,
    compraron,
    compraronRecuperados,
    pctRecuperados: porcentaje(recuperados, conSeguimiento),
    tipos,
  };
}

/* ------------------------------------------------------------------------------------------------
   ALARMA DE HOY (tareas vencidas de las asesoras)
------------------------------------------------------------------------------------------------ */

export type TareasPorAsesora = { asesora: string; tareas: number };

export type AlarmaDeHoy = {
  vencidas: number;
  llamadas72h: number;
  tope: number;
  /** La asesora con más tareas y cuántos días de trabajo tiene con el tope (null si nadie tiene). */
  peor: { asesora: string; tareas: number; dias: number } | null;
};

/** Días de trabajo para sacar `tareas` con `tope` por día (0 = sin tope → 1 día). */
export function diasDeTrabajo(tareas: number, tope: number): number {
  if (tareas <= 0) return 0;
  if (tope <= 0) return 1;
  return Math.ceil(tareas / tope);
}

export function armarAlarma(input: { vencidas: number; llamadas72h: number; porAsesora: ReadonlyArray<TareasPorAsesora>; tope: number }): AlarmaDeHoy | null {
  if (input.vencidas <= 0) return null;
  const mayor = [...input.porAsesora].sort((a, b) => b.tareas - a.tareas)[0] ?? null;
  return {
    vencidas: input.vencidas,
    llamadas72h: input.llamadas72h,
    tope: input.tope,
    peor: mayor && mayor.tareas > 0 ? { ...mayor, dias: diasDeTrabajo(mayor.tareas, input.tope) } : null,
  };
}

export function plural(n: number, uno: string, varios: string): string {
  return `${n.toLocaleString("es-CO")} ${n === 1 ? uno : varios}`;
}

/** "146 son llamadas de 72 h. Con el tope de 15 por asesora al día, Ingrid tiene trabajo para 7 días." */
export function textoDeAlarma(alarma: AlarmaDeHoy): { titulo: string; detalle: string } {
  const titulo = `${plural(alarma.vencidas, "tarea vencida", "tareas vencidas")} sin hacer`;
  const partes: string[] = [];
  if (alarma.llamadas72h > 0) {
    partes.push(alarma.llamadas72h === 1 ? "1 es llamada de 72 h." : `${alarma.llamadas72h.toLocaleString("es-CO")} son llamadas de 72 h.`);
  }
  if (alarma.peor) {
    const dias = plural(alarma.peor.dias, "día", "días");
    partes.push(
      alarma.tope > 0
        ? `Con el tope de ${alarma.tope} por asesora al día, ${alarma.peor.asesora} tiene trabajo para ${dias}.`
        : `${alarma.peor.asesora} tiene ${plural(alarma.peor.tareas, "tarea", "tareas")}.`,
    );
  }
  return { titulo, detalle: partes.join(" ") };
}

/* ------------------------------------------------------------------------------------------------
   FRENTE A LA SEMANA ANTERIOR
------------------------------------------------------------------------------------------------ */

export type Comparacion = { nombre: string; actual: string; antes: string; tono: "sube" | "baja" | "igual" | "nada" };

function tono(actual: number | null, antes: number | null): Comparacion["tono"] {
  if (actual === null || antes === null) return "nada";
  if (actual > antes) return "sube";
  if (actual < antes) return "baja";
  return "igual";
}

export function textoPct(valor: number | null): string {
  return valor === null ? "—" : `${valor} %`;
}

export function compararSemanas(actual: SemanaDeRecuperacion, anterior: SemanaDeRecuperacion | null): Comparacion[] {
  return [
    {
      nombre: "% recuperados",
      actual: textoPct(actual.pctRecuperados),
      antes: anterior ? textoPct(anterior.pctRecuperados) : "—",
      tono: tono(actual.pctRecuperados, anterior?.pctRecuperados ?? null),
    },
    {
      nombre: "Ventas de recuperados",
      actual: String(actual.compraronRecuperados),
      antes: anterior ? String(anterior.compraronRecuperados) : "—",
      tono: tono(actual.compraronRecuperados, anterior ? anterior.compraronRecuperados : null),
    },
  ];
}
