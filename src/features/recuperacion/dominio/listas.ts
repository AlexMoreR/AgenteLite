/**
 * RECUPERACIÓN · vista "Leads": la lista de los chats detrás de cada número de la pantalla "Semana".
 * Código puro. Las definiciones son las MISMAS de dominio/semana.ts (estadoDelLead, enviosDelLead):
 * la lista de un grupo tiene exactamente los leads que cuenta su número (lo prueba
 * scripts/check-recuperacion.mjs).
 *
 * URL: /cliente/crm/recuperacion?vista=leads&grupo=<grupo>&semana=<lunes>[&asesora=…][&ver=400]
 */

import { MOTIVO_RECUPERACION_72H } from "@/features/seguimiento-inteligente/dominio/reactivacion";

import { GRUPOS_EN_SEGUIMIENTO, NOMBRE_EN_SEGUIMIENTO, type GrupoEnSeguimiento } from "./en-seguimiento";
import {
  NOMBRE_DE_CLASE,
  enviosDelLead,
  estadoDelLead,
  VENTANA_RECUPERADO_MS,
  type ClaseDeSeguimiento,
  type LeadDeRecuperacion,
} from "./semana";

const HORA = 3_600_000;

export const GRUPOS_DE_LEADS = ["llegaron", "seguimiento", "recuperados", "callados72", "compraron", "compraron_recuperados"] as const;
export const GRUPOS_DE_TAREAS = ["vencidas", "llamadas72"] as const;
export const CLASES: ClaseDeSeguimiento[] = ["bot", "dia_siguiente", "inteligente", "tras_asesora", "campana", "otro"];

export type GrupoDeLeads = (typeof GRUPOS_DE_LEADS)[number] | `tipo:${ClaseDeSeguimiento}`;
export type GrupoDeTareas = (typeof GRUPOS_DE_TAREAS)[number];
/** Tareas y "en seguimiento" son de HOY: no dependen de la semana. */
export type Grupo = GrupoDeLeads | GrupoDeTareas | GrupoEnSeguimiento;

export const NOMBRE_DE_GRUPO: Record<(typeof GRUPOS_DE_LEADS)[number] | GrupoDeTareas, string> = {
  llegaron: "Llegaron",
  seguimiento: "Llegaron y recibieron seguimiento",
  recuperados: "Recuperados",
  callados72: "Callados más de 72 h",
  compraron: "Compraron",
  compraron_recuperados: "Ventas de recuperados",
  vencidas: "Tareas vencidas",
  llamadas72: "Llamadas 72 h",
};

/** Corto, para "Contestó al … en 2 h". */
const CLASE_CORTA: Record<ClaseDeSeguimiento, string> = {
  bot: "recordatorio del bot",
  dia_siguiente: "seguimiento del día siguiente",
  inteligente: "mensaje útil",
  tras_asesora: "seguimiento después de la asesora",
  campana: "mensaje de campaña",
  otro: "seguimiento",
};

export function nombreDeGrupo(grupo: Grupo): string {
  if (grupo.startsWith("tipo:")) return NOMBRE_DE_CLASE[grupo.slice(5) as ClaseDeSeguimiento];
  if (esGrupoEnSeguimiento(grupo)) return NOMBRE_EN_SEGUIMIENTO[grupo];
  return NOMBRE_DE_GRUPO[grupo as keyof typeof NOMBRE_DE_GRUPO];
}

/** Lo que llega en ?grupo= (cualquier otra cosa → "llegaron"). */
export function grupoPedido(valor: string | null | undefined): Grupo {
  const v = (valor ?? "").trim();
  const fijos: readonly string[] = [...GRUPOS_DE_LEADS, ...GRUPOS_DE_TAREAS, ...GRUPOS_EN_SEGUIMIENTO];
  if (fijos.includes(v)) return v as Grupo;
  if (v.startsWith("tipo:") && (CLASES as string[]).includes(v.slice(5))) return v as Grupo;
  return "llegaron";
}

export function esGrupoDeTareas(grupo: Grupo): grupo is GrupoDeTareas {
  return (GRUPOS_DE_TAREAS as readonly string[]).includes(grupo);
}

export function esGrupoEnSeguimiento(grupo: Grupo): grupo is GrupoEnSeguimiento {
  return (GRUPOS_EN_SEGUIMIENTO as readonly string[]).includes(grupo);
}

/** Cuántos se muestran: de 200 en 200 ("Ver más"), hasta 2000. */
export const PAGINA = 200;
export function cuantosVer(valor: string | null | undefined): number {
  const n = Number.parseInt(valor ?? "", 10);
  if (!Number.isFinite(n) || n <= PAGINA) return PAGINA;
  return Math.min(Math.ceil(n / PAGINA) * PAGINA, 10 * PAGINA);
}

export type ParamsDeRecuperacion = { semana: string; vista?: "leads"; grupo?: Grupo; asesora?: string | null; ver?: number };

/** El enlace de la página. La semana por defecto no se escribe (igual que la pantalla "Semana"). */
export function hrefDeRecuperacion(p: ParamsDeRecuperacion, semanaPorDefecto: string): string {
  const q = new URLSearchParams();
  if (p.vista === "leads") {
    q.set("vista", "leads");
    q.set("grupo", p.grupo ?? "llegaron");
  }
  if (p.semana !== semanaPorDefecto) q.set("semana", p.semana);
  if (p.vista === "leads" && p.asesora) q.set("asesora", p.asesora);
  if (p.vista === "leads" && p.ver && p.ver > PAGINA) q.set("ver", String(p.ver));
  const texto = q.toString();
  return texto ? `/cliente/crm/recuperacion?${texto}` : "/cliente/crm/recuperacion";
}

/* ------------------------------------------------------------------------------------------------
   LEADS DE CADA GRUPO
------------------------------------------------------------------------------------------------ */

export type LeadDeLaLista = { lead: LeadDeRecuperacion; razon: string; ultimoClienteEn: Date | null };

function horas(ms: number): string {
  const h = ms / HORA;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} días`;
}

function sinRespuesta(n: number): string {
  return n === 1 ? "1 seguimiento sin respuesta" : `${n} seguimientos sin respuesta`;
}

/** El seguimiento que lo recuperó y en cuánto contestó (el primero que contestó en 72 h). */
function comoSeRecupero(lead: LeadDeRecuperacion): string | null {
  const ordenados = [...lead.eventos].sort((a, b) => a.en.getTime() - b.en.getTime());
  let ultimoSeg: { clase: ClaseDeSeguimiento; en: number } | null = null;
  const segs: Array<{ clase: ClaseDeSeguimiento; en: number }> = [];
  for (const e of ordenados) {
    if (e.tipo === "SEG") {
      ultimoSeg = { clase: e.clase, en: e.en.getTime() };
      segs.push(ultimoSeg);
      continue;
    }
    const t = e.en.getTime();
    const dentro = segs.some((s) => t > s.en && t <= s.en + VENTANA_RECUPERADO_MS);
    if (dentro && ultimoSeg) return `Contestó al ${CLASE_CORTA[ultimoSeg.clase]} en ${horas(t - ultimoSeg.en)}`;
  }
  return null;
}

/** Por qué está en el grupo, en una línea. */
export function razonDelLead(lead: LeadDeRecuperacion, grupo: GrupoDeLeads, ahora: Date): string {
  if (grupo.startsWith("tipo:")) {
    const clase = grupo.slice(5) as ClaseDeSeguimiento;
    const envios = enviosDelLead(lead.eventos).filter((e) => e.clase === clase);
    const contestados = envios.filter((e) => e.contesto).length;
    if (contestados === 0) return envios.length === 1 ? "No contestó en 24 h" : `${envios.length} envíos, no contestó ninguno en 24 h`;
    return envios.length === 1 ? "Contestó en menos de 24 h" : `Contestó ${contestados} de ${envios.length} envíos en 24 h`;
  }
  const estado = estadoDelLead(lead, ahora);
  const envios = enviosDelLead(lead.eventos);
  const base = estado.recuperado
    ? (comoSeRecupero(lead) ?? "Contestó tras un seguimiento")
    : estado.recibio
      ? `${sinRespuesta(envios.length)}${
          estado.callado72 && lead.ultimoClienteEn ? ` · callado hace ${horas(ahora.getTime() - lead.ultimoClienteEn.getTime())}` : ""
        }`
      : "Sin seguimiento automático";
  if (grupo === "compraron" || grupo === "compraron_recuperados") return `Compró · ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  return base;
}

/** ¿El lead entra en el grupo? Mismas reglas que resumirSemana. */
export function estaEnElGrupo(lead: LeadDeRecuperacion, grupo: GrupoDeLeads, ahora: Date): boolean {
  if (grupo === "llegaron") return true;
  if (grupo === "compraron") return lead.ganado;
  if (grupo.startsWith("tipo:")) {
    const clase = grupo.slice(5);
    return lead.eventos.some((e) => e.tipo === "SEG" && e.clase === clase);
  }
  const estado = estadoDelLead(lead, ahora);
  if (grupo === "seguimiento") return estado.recibio;
  if (grupo === "recuperados") return estado.recuperado;
  if (grupo === "callados72") return estado.callado72;
  return lead.ganado && estado.recuperado; // compraron_recuperados
}

/**
 * Los leads del grupo, con su razón. Orden: el cliente que escribió más reciente primero; en
 * "callados" el que lleva más tiempo callado primero; en un tipo, los que contestaron primero.
 */
export function leadsDelGrupo(leads: ReadonlyArray<LeadDeRecuperacion>, grupo: GrupoDeLeads, ahora: Date): LeadDeLaLista[] {
  const lista = leads
    .filter((lead) => estaEnElGrupo(lead, grupo, ahora))
    .map((lead): LeadDeLaLista => ({ lead, razon: razonDelLead(lead, grupo, ahora), ultimoClienteEn: lead.ultimoClienteEn }));
  const t = (x: LeadDeLaLista) => x.ultimoClienteEn?.getTime() ?? 0;
  if (grupo === "callados72") return lista.sort((a, b) => t(a) - t(b));
  if (grupo.startsWith("tipo:")) {
    const clase = grupo.slice(5);
    const contesto = (x: LeadDeLaLista) => (enviosDelLead(x.lead.eventos).some((e) => e.clase === clase && e.contesto) ? 1 : 0);
    return lista.sort((a, b) => contesto(b) - contesto(a) || t(b) - t(a));
  }
  return lista.sort((a, b) => t(b) - t(a));
}

/** Cuántos envíos de ese tipo y cuántos contestaron, sumando los leads de la lista (= fila del tipo). */
export function enviosDelTipo(leads: ReadonlyArray<LeadDeRecuperacion>, clase: ClaseDeSeguimiento): { enviados: number; contestaron: number } {
  let enviados = 0;
  let contestaron = 0;
  for (const lead of leads) {
    for (const envio of enviosDelLead(lead.eventos)) {
      if (envio.clase !== clase) continue;
      enviados += 1;
      if (envio.contesto) contestaron += 1;
    }
  }
  return { enviados, contestaron };
}

/* ------------------------------------------------------------------------------------------------
   TAREAS VENCIDAS (mismo filtro que la alarma: servicios/alarma.ts)
------------------------------------------------------------------------------------------------ */

export type TareaVencida = {
  conversationId: string;
  asesora: string | null;
  motivo: string | null;
  vence: Date | null;
  nombre: string | null;
  telefono4: string | null;
  linea: string | null;
  etapa: string | null;
  producto: string | null;
  ultimoClienteEn: Date | null;
  ultimoTexto: string | null;
};

/** "Llamadas 72 h" = las de motivo recuperacion_72h (lo mismo que cuenta la alarma). */
export function tareasDelGrupo<T extends Pick<TareaVencida, "motivo">>(tareas: ReadonlyArray<T>, grupo: GrupoDeTareas): T[] {
  return grupo === "llamadas72" ? tareas.filter((t) => t.motivo === MOTIVO_RECUPERACION_72H) : [...tareas];
}

/** "Vencida hace 2 días", "Vence en 5 h", "Sin fecha". */
export function textoDeVencimiento(vence: Date | null, ahora: Date): string {
  if (!vence) return "Sin fecha";
  const diferencia = ahora.getTime() - vence.getTime();
  return diferencia >= 0 ? `Vencida hace ${horas(diferencia)}` : `Vence en ${horas(-diferencia)}`;
}

export type AsesoraConTareas = { asesora: string; tareas: number };

/** Cuántas tiene cada asesora (la que más, primero). "Sin asesora" al final. */
export function tareasPorAsesora(tareas: ReadonlyArray<Pick<TareaVencida, "asesora">>): AsesoraConTareas[] {
  const mapa = new Map<string, number>();
  for (const t of tareas) {
    const nombre = t.asesora ?? "Sin asesora";
    mapa.set(nombre, (mapa.get(nombre) ?? 0) + 1);
  }
  return [...mapa.entries()]
    .map(([asesora, n]) => ({ asesora, tareas: n }))
    .sort((a, b) => (a.asesora === "Sin asesora" ? 1 : 0) - (b.asesora === "Sin asesora" ? 1 : 0) || b.tareas - a.tareas || a.asesora.localeCompare(b.asesora));
}

/** Las tareas de la asesora pedida (o todas), agrupadas por asesora y la más vencida primero. */
export function ordenarTareas(tareas: ReadonlyArray<TareaVencida>, asesora: string | null): TareaVencida[] {
  const orden = new Map(tareasPorAsesora(tareas).map((a, i) => [a.asesora, i]));
  return tareas
    .filter((t) => !asesora || (t.asesora ?? "Sin asesora") === asesora)
    .sort(
      (a, b) =>
        (orden.get(a.asesora ?? "Sin asesora") ?? 0) - (orden.get(b.asesora ?? "Sin asesora") ?? 0) ||
        (a.vence?.getTime() ?? 0) - (b.vence?.getTime() ?? 0),
    );
}

/* ------------------------------------------------------------------------------------------------
   TEXTOS
------------------------------------------------------------------------------------------------ */

/** Qué es la lista, en una línea. */
export function explicacionDeGrupo(grupo: Grupo): string {
  if (grupo.startsWith("tipo:")) return "Leads de la semana que recibieron este seguimiento. Primero los que contestaron en 24 h.";
  switch (grupo) {
    case "llegaron":
      return "Leads nuevos de las líneas de ventas esta semana.";
    case "seguimiento":
      return "Se callaron y recibieron al menos un seguimiento automático.";
    case "recuperados":
      return "Contestaron en menos de 72 h tras un seguimiento.";
    case "callados72":
      return "Recibieron seguimiento, no contestaron y llevan más de 72 h callados. Primero los que llevan más tiempo.";
    case "compraron":
      return "Leads de la semana marcados Ganado en el CRM.";
    case "compraron_recuperados":
      return "Compraron y se habían recuperado con un seguimiento.";
    case "en_seguimiento":
    case "en_seguimiento_1":
    case "en_seguimiento_2":
    case "en_seguimiento_3":
      return "Ahora: recibieron un seguimiento automático en las últimas 72 h y no han contestado. Es de hoy: no cambia con la semana.";
    case "vencidas":
      return "Tareas de las asesoras vencidas o que vencen en 24 h, sin hacer. Es de hoy: no cambia con la semana.";
    default:
      return "Llamadas de Recuperación 72 h pendientes (cliente callado 7 días o menos). Es de hoy: no cambia con la semana.";
  }
}

const ETAPAS: Record<string, string> = {
  NUEVO: "Nuevo",
  CALIFICADO: "Calificado",
  PROPUESTA: "Propuesta",
  NEGOCIACION: "Negociación",
  GANADO: "Ganado",
  PERDIDO: "Perdido",
};

export function nombreDeEtapa(etapa: string | null | undefined): string | null {
  return etapa ? (ETAPAS[etapa] ?? etapa) : null;
}

/** "hace 3 días", "hace 5 h", "hace 12 min". */
export function haceCuanto(fecha: Date | null, ahora: Date): string {
  if (!fecha) return "nunca";
  return `hace ${horas(Math.max(0, ahora.getTime() - fecha.getTime()))}`;
}
