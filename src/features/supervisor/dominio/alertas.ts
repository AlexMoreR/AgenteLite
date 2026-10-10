/**
 * ALERTAS = INCIDENTES (código puro).
 *
 * Un problema es UNA alerta que se actualiza, no un aviso por vuelta. Los hallazgos de cada vuelta
 * se agrupan en incidentes:
 *
 * - Todo lo del bot y del embudo de un producto que empezó cerca de un cambio del libro (desde 1 h
 *   antes hasta 48 h después) va al incidente de ESE cambio: "libro v181 / combo-camilla".
 * - Lo demás se agrupa por su clave (mismo detector, mismo producto, misma asesora).
 *
 * Deduplicación y enfriamiento: se avisa (push) cuando el incidente es nuevo, cuando sube de
 * severidad o, si sigue CRÍTICO, como recordatorio cada 12 h. Un incidente que deja de verse se
 * cierra solo ("se normalizó") cuando pasa su tiempo de cierre.
 */

import { ESPERANDO_AUTORIZACION, ETIQUETA_DE_SEVERIDAD, ORDEN_DE_SEVERIDAD, severidadMayor, type CambioDelLibro, type Familia, type Hallazgo, type Severidad } from "./tipos";

const MIN = 60_000;
const HORA = 60 * MIN;

export type EstadoDeIncidente = "ABIERTA" | "RESUELTA";

export type Incidente = {
  clave: string;
  familia: Familia;
  severidad: Severidad;
  titulo: string;
  producto: string | null;
  primeraVezEn: Date;
  ultimaVezEn: Date;
  /** Desde cuándo pasa (el `desde` más antiguo de sus hallazgos). */
  desde: Date;
  vecesVista: number;
  estado: EstadoDeIncidente;
  resueltaEn: Date | null;
  notificadaEn: Date | null;
  severidadNotificada: Severidad | null;
  hallazgos: Hallazgo[];
};

export type OpcionesDeAlertas = {
  /** Recordatorio de un CRÍTICO que sigue abierto. */
  recordatorioCriticoMin: number;
  /** Cuánto tiempo sin verse para cerrarlo, por familia. */
  cerrarTrasMin: Record<Familia, number>;
  /** Severidad mínima para avisar por push. */
  avisarDesde: Severidad;
};

export const OPCIONES_POR_DEFECTO: OpcionesDeAlertas = {
  recordatorioCriticoMin: 12 * 60,
  cerrarTrasMin: { BOT: 3 * 60, EMBUDO: 3 * 60, CAMBIO: 72 * 60, ATENCION: 15 },
  avisarDesde: "IMPORTANTE",
};

/** A qué incidente pertenece un hallazgo. */
export function claveDeIncidente(h: Hallazgo, cambios: CambioDelLibro[]): string {
  if (h.familia === "ATENCION") return h.clave;
  if (h.familia === "CAMBIO" && h.evidencia.versiones.length) return `INC:libro-v${h.evidencia.versiones[0]}:${h.producto ?? "todos"}`;
  const t = h.desde.getTime();
  const cambio = cambios
    .filter((c) => t >= c.en.getTime() - HORA && t <= c.en.getTime() + 48 * HORA)
    .sort((a, b) => b.en.getTime() - a.en.getTime())[0];
  return cambio ? `INC:libro-v${cambio.version}:${h.producto ?? "todos"}` : h.clave;
}

function tituloDelIncidente(clave: string, hallazgos: Hallazgo[]): string {
  const m = clave.match(/^INC:libro-v(\d+):(.+)$/);
  const principal = [...hallazgos].sort((a, b) => ORDEN_DE_SEVERIDAD[b.severidad] - ORDEN_DE_SEVERIDAD[a.severidad])[0];
  if (m && hallazgos.length > 1) return `Después del cambio del libro V3 a la versión ${m[1]} (${m[2]}): ${principal.titulo.toLowerCase()} y ${hallazgos.length - 1} problema(s) más`;
  if (m) return `Libro V3 v${m[1]} (${m[2]}): ${principal.titulo}`;
  return principal.titulo;
}

/**
 * Escalamiento por combinación: un cambio de regla del primer mensaje JUNTO con ráfagas, precio
 * antes de identificar o caída de respuesta es CRÍTICO aunque cada pieza sola sea IMPORTANTE.
 */
function severidadDelIncidente(hallazgos: Hallazgo[]): Severidad {
  let s: Severidad = "OBSERVACION";
  for (const h of hallazgos) s = severidadMayor(s, h.severidad);
  const claves = hallazgos.map((h) => h.clave);
  const cambioDeRegla = claves.some((c) => c.startsWith("BOT:regla-primer-mensaje"));
  const comportamiento = claves.some((c) => c.startsWith("BOT:rafaga_inicial") || c.startsWith("BOT:precio_o_fotos"));
  const caida =
    claves.some((c) => c.startsWith("EMBUDO:respondio_2h:")) ||
    hallazgos.some((h) => h.clave.startsWith("CAMBIO:post-cambio") && h.severidad !== "OBSERVACION");
  if (cambioDeRegla && (comportamiento || caida)) s = "CRITICO";
  return s;
}

export function consolidar(input: {
  abiertos: Incidente[];
  hallazgos: Hallazgo[];
  ahora: Date;
  cambios: CambioDelLibro[];
  /** Familias que se evaluaron en esta vuelta: solo esas se pueden cerrar por "no se vio". */
  familiasEvaluadas: Familia[];
  opciones?: OpcionesDeAlertas;
}): { incidentes: Incidente[]; avisar: Array<{ incidente: Incidente; motivo: "nuevo" | "sube" | "recordatorio" }> } {
  const op = input.opciones ?? OPCIONES_POR_DEFECTO;
  const porClave = new Map<string, Hallazgo[]>();
  /*
    Pertenencia "pegajosa": si un hallazgo ya está en un incidente ABIERTO, sigue ahí. Sin esto,
    un problema que sigue igual después de otro cambio del libro (que no lo causó) saltaba al
    incidente del cambio nuevo y se avisaba como si fuera otro problema.
  */
  const dondeEsta = new Map<string, string>();
  for (const inc of input.abiertos) {
    if (inc.estado !== "ABIERTA") continue;
    for (const h of inc.hallazgos) dondeEsta.set(h.clave, inc.clave);
  }
  for (const h of input.hallazgos) {
    const clave = dondeEsta.get(h.clave) ?? claveDeIncidente(h, input.cambios);
    porClave.set(clave, [...(porClave.get(clave) ?? []), h]);
  }

  const resultado = new Map<string, Incidente>();
  for (const inc of input.abiertos) resultado.set(inc.clave, { ...inc, hallazgos: [...inc.hallazgos] });
  const avisar: Array<{ incidente: Incidente; motivo: "nuevo" | "sube" | "recordatorio" }> = [];

  for (const [clave, nuevos] of porClave) {
    const previo = resultado.get(clave);
    // Los hallazgos de la vuelta reemplazan a los de la misma clave (se actualizan, no se apilan).
    const mezcla = new Map<string, Hallazgo>();
    for (const h of previo?.estado === "ABIERTA" ? previo.hallazgos : []) mezcla.set(h.clave, h);
    for (const h of nuevos) mezcla.set(h.clave, h);
    const hallazgos = [...mezcla.values()];
    const severidad = severidadDelIncidente(hallazgos);
    const desde = hallazgos.map((h) => h.desde).sort((a, b) => a.getTime() - b.getTime())[0];
    const abierto = previo && previo.estado === "ABIERTA";
    const inc: Incidente = {
      clave,
      familia: hallazgos.some((h) => h.familia === "BOT") ? "BOT" : hallazgos[0].familia,
      severidad,
      titulo: tituloDelIncidente(clave, hallazgos),
      producto: hallazgos[0].producto,
      primeraVezEn: abierto ? previo.primeraVezEn : input.ahora,
      ultimaVezEn: input.ahora,
      desde: abierto && previo.desde < desde ? previo.desde : desde,
      vecesVista: abierto ? previo.vecesVista + 1 : 1,
      estado: "ABIERTA",
      resueltaEn: null,
      notificadaEn: abierto ? previo.notificadaEn : null,
      severidadNotificada: abierto ? previo.severidadNotificada : null,
      hallazgos,
    };
    // Lo del embudo que NO está atado a un cambio del bot solo se avisa si es CRÍTICO; si no, va a
    // la pantalla y al informe del día (la simulación mostró que así se evitan avisos de "domingo").
    const umbral: Severidad = clave.startsWith("EMBUDO:") ? "CRITICO" : op.avisarDesde;
    const alcanza = ORDEN_DE_SEVERIDAD[severidad] >= ORDEN_DE_SEVERIDAD[umbral];
    let motivo: "nuevo" | "sube" | "recordatorio" | null = null;
    if (alcanza && !inc.notificadaEn) motivo = "nuevo";
    else if (alcanza && inc.severidadNotificada && ORDEN_DE_SEVERIDAD[severidad] > ORDEN_DE_SEVERIDAD[inc.severidadNotificada]) motivo = "sube";
    else if (severidad === "CRITICO" && inc.notificadaEn && input.ahora.getTime() - inc.notificadaEn.getTime() >= op.recordatorioCriticoMin * MIN) motivo = "recordatorio";
    if (motivo) {
      inc.notificadaEn = input.ahora;
      inc.severidadNotificada = severidad;
      avisar.push({ incidente: inc, motivo });
    }
    resultado.set(clave, inc);
  }

  // Cierre automático de lo que dejó de verse (solo familias evaluadas en esta vuelta).
  for (const inc of resultado.values()) {
    if (inc.estado !== "ABIERTA" || porClave.has(inc.clave)) continue;
    const familias = new Set(inc.hallazgos.map((h) => h.familia));
    if (![...familias].some((f) => input.familiasEvaluadas.includes(f))) continue;
    const espera = Math.max(...[...familias].map((f) => op.cerrarTrasMin[f]));
    if (input.ahora.getTime() - inc.ultimaVezEn.getTime() >= espera * MIN) {
      inc.estado = "RESUELTA";
      inc.resueltaEn = input.ahora;
    }
  }

  return { incidentes: [...resultado.values()], avisar };
}

function hora(fecha: Date): string {
  const b = new Date(fecha.getTime() - 5 * HORA);
  return `${b.toISOString().slice(0, 10)} ${b.toISOString().slice(11, 16)}`;
}

function minutos(desde: Date, hasta: Date): string {
  const m = Math.round((hasta.getTime() - desde.getTime()) / MIN);
  return m < 120 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}

/** El texto completo de la alerta, como lo lee Alexander (pantalla del Supervisor / informe). */
export function textoDeLaAlerta(inc: Incidente, ahora: Date = inc.ultimaVezEn): string {
  const lineas: string[] = [];
  lineas.push(`[${ETIQUETA_DE_SEVERIDAD[inc.severidad]}] ${inc.titulo}`);
  lineas.push(`Desde: ${hora(inc.desde)} (Bogotá) · detectado ${hora(inc.primeraVezEn)} · hace ${minutos(inc.desde, ahora)} · visto ${inc.vecesVista} vez/veces · estado ${inc.estado}`);
  const orden = [...inc.hallazgos].sort((a, b) => ORDEN_DE_SEVERIDAD[b.severidad] - ORDEN_DE_SEVERIDAD[a.severidad]);
  orden.forEach((h, i) => {
    lineas.push("");
    lineas.push(`${i + 1}. ${h.titulo} [${ETIQUETA_DE_SEVERIDAD[h.severidad]}]`);
    lineas.push(`   Qué ocurrió: ${h.que}`);
    lineas.push(`   Desde: ${hora(h.desde)} · leads afectados: ${h.leadsAfectados}`);
    if (h.metrica) lineas.push(`   Métrica: ${h.metrica} · esperado ${h.esperado} · observado ${h.observado}`);
    if (h.hechos.length) lineas.push(`   HECHOS:\n${h.hechos.map((x) => `   - ${x}`).join("\n")}`);
    if (h.hipotesis.length) lineas.push(`   HIPÓTESIS (sin comprobar):\n${h.hipotesis.map((x) => `   - ${x}`).join("\n")}`);
    if (h.causaPosible) lineas.push(`   Posible causa: ${h.causaPosible}`);
    if (h.impacto) lineas.push(`   Impacto comercial: ${h.impacto}`);
    const ev = [
      h.evidencia.chats.length ? `chats ${h.evidencia.chats.slice(0, 5).join(", ")}` : "",
      h.evidencia.reglas.length ? `reglas ${[...new Set(h.evidencia.reglas)].map((r) => `"${r.slice(0, 60)}"`).join(", ")}` : "",
      h.evidencia.versiones.length ? `versión del libro ${h.evidencia.versiones.join(", ")}` : "",
    ].filter(Boolean);
    if (ev.length) lineas.push(`   Evidencia: ${ev.join(" · ")}`);
    if (h.recomendacion) lineas.push(`   Recomendación: ${h.recomendacion}`);
    if (h.queCambiar) lineas.push(`   Qué habría que cambiar: ${h.queCambiar}`);
    if (h.riesgo) lineas.push(`   Riesgo del cambio: ${h.riesgo}`);
    if (h.comoMedir) lineas.push(`   Cómo medir si funcionó: ${h.comoMedir}`);
  });
  if (inc.hallazgos.some((h) => h.tocaProduccion)) {
    lineas.push("");
    lineas.push(ESPERANDO_AUTORIZACION);
  }
  return lineas.join("\n");
}

/** Lo corto, para la notificación push (título ≤ 60, cuerpo ≤ 180). */
export function textoDelAviso(inc: Incidente, motivo: "nuevo" | "sube" | "recordatorio"): { title: string; body: string } {
  const prefijo = motivo === "recordatorio" ? "Sigue: " : motivo === "sube" ? "Empeoró: " : "";
  const principal = [...inc.hallazgos].sort((a, b) => ORDEN_DE_SEVERIDAD[b.severidad] - ORDEN_DE_SEVERIDAD[a.severidad])[0];
  const title = `${ETIQUETA_DE_SEVERIDAD[inc.severidad]} · Supervisor`.slice(0, 60);
  const body = `${prefijo}${principal.que}`.slice(0, 180);
  return { title, body };
}
