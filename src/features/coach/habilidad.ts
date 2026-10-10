/**
 * LA HABILIDAD DEL DIA: que entrena cada asesora mañana, elegido por CODIGO con la evidencia de SUS
 * chats. La formula y sus pesos estan en politica.ts (`POLITICA_COACH.habilidad`, versionada).
 *
 * Puro: no toca la base ni la red. Lo usan el generador del coach (al armar el informe), la lectura
 * (informes viejos que no la traen) y las pruebas (`npm run test:coach`).
 *
 * La IA NO elige la habilidad: a lo sumo redacta "que hacer diferente" y el mensaje modelo de la
 * habilidad que ya eligio el codigo (`armarPromptDeHabilidad` / `redaccionValida`).
 */

import { POLITICA_COACH, type EjeDeRubrica, type PoliticaCoach } from "./politica";
import { limpiarDatosPersonales, mencionaContraentrega, type MensajeCoach, type TipoDeError } from "./reglas";
import type {
  ChatRef,
  ClaveDeHabilidad,
  ErrorDelCoach,
  EtapaDeVenta,
  HabilidadDelDia,
  PendienteDelCoach,
  ProblemaDelEquipo,
  PuntajesDelCoach,
  ResumenDeAsesoraGuardado,
} from "./tipos";

/* ------------------------------------------------------------------------------------------------
   Catalogo
------------------------------------------------------------------------------------------------ */

type Metrica = "sinRespuesta" | "demoras" | "cotizaciones" | "errores";

type DefinicionDeHabilidad = {
  clave: ClaveDeHabilidad;
  nombre: string;
  tipos: TipoDeError[];
  ejes: EjeDeRubrica[];
  metrica: { fuente: Metrica; nombre: string; sentido: "bajar" | "subir"; aCero: boolean };
  queHacer: string;
  ejemplo: string;
};

/** El orden es el desempate: primero lo que mas pierde ventas. */
export const HABILIDADES: DefinicionDeHabilidad[] = [
  {
    clave: "no_dejar_sin_respuesta",
    nombre: "No dejar clientes sin respuesta",
    tipos: ["sin_respuesta"],
    ejes: ["V"],
    metrica: { fuente: "sinRespuesta", nombre: "clientes sin respuesta al cierre", sentido: "bajar", aCero: true },
    queHacer:
      "Antes de cerrar el día, ningún chat tuyo puede quedar con el último mensaje del cliente sin contestar. Si no tienes el dato, responde igual y dile cuándo vuelves con él.",
    ejemplo:
      "¡Hola! Ya te ayudo 🙌 El combo de camilla queda en $989.000 y lo separas con el 50 % ($494.500); el resto al terminar, antes de despachar. ¿Me confirmas tu ciudad para decirte cómo te llega?",
  },
  {
    clave: "responder_a_tiempo",
    nombre: "Responder a tiempo",
    tipos: ["demora"],
    ejes: ["V"],
    metrica: { fuente: "demoras", nombre: "demoras de más de 15 min", sentido: "bajar", aCero: false },
    queHacer:
      "Contesta en menos de 15 minutos aunque sea con una línea que avance (precio, color o ciudad). Revisa la bandeja cada 10 minutos y atiende primero a quien lleva más tiempo esperando.",
    ejemplo:
      "¡Hola! Qué pena la espera 🙏 El combo de camilla queda en $989.000 y lo separas con $494.500 (50 %). ¿Para qué ciudad sería? Así te confirmo el envío.",
  },
  {
    clave: "mandar_cotizacion",
    nombre: "Mandar la cotización",
    tipos: ["sin_cotizacion", "promesa_sin_cumplir"],
    ejes: ["A"],
    metrica: { fuente: "cotizaciones", nombre: "chats con cotización enviada", sentido: "subir", aCero: false },
    queHacer:
      "Cuando el cliente ya dijo producto y ciudad, mándale la cotización en ese momento con el total y el anticipo. Si su ciudad se cotiza aparte, vuelve con la cifra el mismo día.",
    ejemplo:
      "Te comparto la cotización: combo de camilla $989.000. Lo separas con $494.500 y el resto al terminar, antes de despachar. ¿Te la dejo a tu nombre para apartarla?",
  },
  {
    clave: "cerrar_total_claro",
    nombre: "Cerrar con un total claro",
    tipos: ["sin_total_claro"],
    ejes: ["A", "C"],
    metrica: { fuente: "errores", nombre: "chats sin un total claro", sentido: "bajar", aCero: false },
    queHacer:
      "Da UN solo total en texto (producto más envío) y el anticipo del 50 %, y termina con una pregunta que avance: color, ciudad o datos.",
    ejemplo:
      "Tu total es $989.000 por el combo de camilla. Lo separas con $494.500 y el resto al terminar, antes de despachar. ¿En qué ciudad estás para confirmarte el envío según la tabla?",
  },
  {
    clave: "aplicar_envio_y_pago",
    nombre: "Aplicar la tabla de envío y el pago 50/50",
    tipos: ["contraentrega", "cobro_envio_gratis", "dato_errado"],
    ejes: ["C"],
    metrica: { fuente: "errores", nombre: "errores de envío o pago", sentido: "bajar", aCero: true },
    queHacer:
      "Antes de dar el envío revisa la tabla: sin costo solo con pago 50/50 en las ciudades de la lista, $100.000 en las lejanas y la Costa se cotiza. La contraentrega está suspendida: no la ofrezcas.",
    ejemplo:
      "Para tu ciudad el envío tiene un adicional de $100.000. La forma de pago es 50 % para fabricar y 50 % al terminar, antes de despachar. ¿Te parece si lo separamos?",
  },
  {
    clave: "no_descartar_antes",
    nombre: "No descartar antes de 72 h",
    tipos: ["descarte_prematuro"],
    ejes: ["S"],
    metrica: { fuente: "errores", nombre: "descartes antes de 72 h", sentido: "bajar", aCero: true },
    queHacer:
      "No pases a Descartado a quien escribió hace menos de 72 h: déjale seguimiento a 1 h, 24 h y 72 h antes de cerrarlo.",
    ejemplo:
      "¡Hola! ¿Pudiste revisar lo del combo? Si quieres te lo aparto con el 50 % ($494.500) y lo empezamos a fabricar esta semana.",
  },
];

const POR_CLAVE = new Map(HABILIDADES.map((h) => [h.clave, h]));
const HABILIDAD_DEL_TIPO = new Map<string, ClaveDeHabilidad>(HABILIDADES.flatMap((h) => h.tipos.map((t) => [t, h.clave] as const)));

export const NOMBRE_DEL_TIPO: Record<string, string> = {
  sin_respuesta: "Clientes sin respuesta",
  demora: "Demoras",
  descarte_prematuro: "Descartes antes de 72 h",
  promesa_sin_cumplir: "Promesas sin cumplir",
  cobro_envio_gratis: "Cobro de envío que era gratis",
  contraentrega: "Contraentrega ofrecida o sin aclarar",
  sin_cotizacion: "Sin cotización",
  sin_total_claro: "Sin total claro",
  dato_errado: "Dato errado",
  otro: "Otro",
};

const QUE_HACER_EQUIPO: Record<string, string> = {
  contraentrega:
    "Mismo mensaje para todas: la contraentrega está suspendida; se ofrece 50 % para fabricar y 50 % al terminar. Revisar que el bot y las plantillas no la ofrezcan.",
  demora: "Revisar el reparto y los turnos: todo el equipo respondió tarde parecido.",
  sin_respuesta: "Revisar el reparto y quién cubre los chats al cierre: a todas les quedaron clientes sin respuesta.",
  sin_cotizacion: "Revisar si falta la plantilla o la regla de envío de esas ciudades: a todas les pasó.",
  cobro_envio_gratis: "Repasar la tabla de envíos con todo el equipo.",
};

const MEDIDOS = new Set<string>(["demora", "sin_respuesta", "descarte_prematuro"]);

/** Etapa de venta de los errores que lee la IA (los de reloj la traen del chat). */
const ETAPA_DEL_TIPO: Partial<Record<string, EtapaDeVenta>> = {
  sin_total_claro: "antes_del_precio",
  sin_cotizacion: "despues_del_precio",
  contraentrega: "despues_del_precio",
  cobro_envio_gratis: "despues_del_precio",
  dato_errado: "despues_del_precio",
  promesa_sin_cumplir: "seguimiento",
  descarte_prematuro: "seguimiento",
};

export const NOMBRE_DE_ETAPA: Record<EtapaDeVenta, string> = {
  antes_del_precio: "antes de dar el precio",
  despues_del_precio: "después del precio (envío y pago)",
  despues_de_cotizar: "después de cotizar",
  seguimiento: "en el seguimiento",
};

/* ------------------------------------------------------------------------------------------------
   Contraentrega: lo que NO es error
------------------------------------------------------------------------------------------------ */

/** Los chats donde la contraentrega ya estaba prometida y se respeta (politica.ts). */
export function esContraentregaRespetada(ultimos4: string, politica: PoliticaCoach = POLITICA_COACH): boolean {
  const digitos = ultimos4.replace(/\D/g, "");
  return digitos.length === 4 && (politica.pago.contraentregasRespetadas as readonly string[]).includes(digitos);
}

const RE_NEGADA =
  /(no|ya no)\s+(la\s+)?(manejamos|tenemos|hacemos|trabajamos|ofrecemos|se\s+maneja|se\s+hace|hay|es\s+posible|aplica)[^.!?]{0,40}contra\s*-?\s*entrega|contra\s*-?\s*entrega[^.!?]{0,40}(suspendid|no\s+(est[aá]|se\s+maneja|aplica|la\s+manejamos|la\s+tenemos|disponible))/i;

/** ¿La asesora mencionó la contraentrega SOLO para decir que no se maneja? Entonces no la ofreció. */
export function contraentregaSoloNegada(mensajes: Pick<MensajeCoach, "autor" | "texto">[]): boolean {
  const menciones = mensajes.filter((m) => m.autor === "asesora" && mencionaContraentrega(m.texto));
  return menciones.length > 0 && menciones.every((m) => RE_NEGADA.test(m.texto));
}

/* ------------------------------------------------------------------------------------------------
   Puntaje
------------------------------------------------------------------------------------------------ */

function minutosDe(error: ErrorDelCoach): number | null {
  if (typeof error.minutos === "number") return error.minutos;
  const m = /(\d+)\s*min/.exec(error.detalle);
  return m ? Number(m[1]) : null;
}

export function puntajeDelError(error: ErrorDelCoach, politica: PoliticaCoach = POLITICA_COACH): number {
  const h = politica.habilidad;
  let base = h.peso[error.tipo] ?? 0;
  const minutos = minutosDe(error);
  if (error.tipo === "demora" && minutos !== null && minutos > h.demoraLargaMin) base += h.extraDemoraLarga;
  const temperatura = h.multiplicadorTemperatura[error.temperatura ?? "frio"] ?? 1;
  const confianza = MEDIDOS.has(error.tipo) ? h.confianza.medido : h.confianza.ia;
  return base * temperatura * confianza;
}

/** Etapa de venta de un error que lee la IA (los de reloj la traen medida del chat). */
export function etapaDelTipo(tipo: string): EtapaDeVenta | null {
  return ETAPA_DEL_TIPO[tipo] ?? null;
}

function etapaDelError(error: ErrorDelCoach): EtapaDeVenta | null {
  return error.etapa ?? etapaDelTipo(error.tipo);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------------------------------------
   Eleccion
------------------------------------------------------------------------------------------------ */

export type ParteParaHabilidad = {
  userId: string;
  nombre: string;
  errores: ErrorDelCoach[];
  puntajes: PuntajesDelCoach | null;
  pendientes: PendienteDelCoach[];
  metricas: ResumenDeAsesoraGuardado["metricas"] | null;
};

/** Los errores que cuentan: sin la contraentrega de los chats respetados, con la temperatura del chat. */
export function erroresQueCuentan(parte: ParteParaHabilidad, politica: PoliticaCoach = POLITICA_COACH): ErrorDelCoach[] {
  const temperaturaDelChat = new Map(parte.pendientes.map((p) => [p.ref, p.temperatura]));
  return parte.errores
    .filter((e) => !(e.tipo === "contraentrega" && esContraentregaRespetada(e.ultimos4, politica)))
    .map((e) => ({ ...e, temperatura: e.temperatura ?? temperaturaDelChat.get(e.ref) ?? null }));
}

function cambioDePoliticaDelDia(tipo: string, dia: string, politica: PoliticaCoach) {
  return politica.habilidad.cambiosDePolitica.find((c) => c.tipos.includes(tipo) && dia >= c.desde && dia <= c.hasta) ?? null;
}

/** Los tipos de error que son del equipo ese dia (ver politica.ts). */
export function problemasDelEquipo(
  partes: Array<{ nombre: string; errores: ErrorDelCoach[]; chats: number }>,
  dia: string,
  politica: PoliticaCoach = POLITICA_COACH,
): ProblemaDelEquipo[] {
  const activas = partes.filter((p) => p.chats > 0);
  const tipos = new Set(activas.flatMap((p) => p.errores.map((e) => e.tipo)));
  const salida: ProblemaDelEquipo[] = [];
  for (const tipo of tipos) {
    if (tipo === "otro") continue;
    const conteos = activas.map((p) => ({ nombre: p.nombre, casos: p.errores.filter((e) => e.tipo === tipo).length }));
    const conCasos = conteos.filter((c) => c.casos > 0);
    const cambio = cambioDePoliticaDelDia(tipo, dia, politica);
    const max = Math.max(...conteos.map((c) => c.casos));
    const min = Math.min(...conteos.map((c) => c.casos));
    const enTodasYParejo = activas.length >= 2 && min > 0 && max <= politica.habilidad.maxDispersionEquipo * min;
    if (!cambio && !enTodasYParejo) continue;
    salida.push({
      tipo: tipo as TipoDeError,
      nombre: NOMBRE_DEL_TIPO[tipo] ?? tipo,
      total: conCasos.reduce((n, c) => n + c.casos, 0),
      porAsesora: conCasos,
      porque: cambio
        ? `Cambio de política del día: ${cambio.texto}`
        : `Aparece en las ${activas.length} asesoras y parejo (de ${min} a ${max}): no es de una sola.`,
      queHacer: QUE_HACER_EQUIPO[tipo] ?? "Revisarlo con todo el equipo una sola vez.",
    });
  }
  return salida.sort((a, b) => b.total - a.total);
}

function metaDe(def: DefinicionDeHabilidad, hoy: number, erroresDeLaHabilidad: number, politica: PoliticaCoach) {
  if (def.metrica.sentido === "subir") return hoy + Math.max(1, Math.min(3, erroresDeLaHabilidad));
  if (def.metrica.aCero) return 0;
  return Math.floor(hoy * politica.habilidad.metaMitad);
}

function textoDeMetrica(def: DefinicionDeHabilidad, hoy: number, meta: number) {
  const signo = def.metrica.sentido === "subir" ? "≥" : meta === 0 ? "" : "≤";
  return `${def.metrica.nombre}: hoy ${hoy} → meta ${signo ? `${signo} ` : ""}${meta}`;
}

/** Texto de la evidencia: sin datos personales y sin el "12:00 a. m." de las esperas que venian de ayer. */
export function textoDeEvidencia(detalle: string): string {
  return limpiarDatosPersonales(detalle)
    .replace(/\(desde las 12:00 a\.\s?m\.\)/gi, "(venía esperando desde antes de abrir)")
    .replace(/desde las 12:00 a\.\s?m\./gi, "desde antes de abrir")
    .replace(/a las 12:00 a\.\s?m\./gi, "antes de abrir (venía de ayer)");
}

function refDe(e: ChatRef): ChatRef {
  return { ref: e.ref, numero: e.numero, ultimos4: e.ultimos4, nombre: e.nombre };
}

/** Elige la habilidad de UNA asesora. `tiposDelEquipo`: los que salen del impacto individual. */
export function elegirHabilidad(
  parte: ParteParaHabilidad,
  tiposDelEquipo: Set<string>,
  politica: PoliticaCoach = POLITICA_COACH,
): HabilidadDelDia | null {
  const h = politica.habilidad;
  const errores = erroresQueCuentan(parte, politica).filter((e) => HABILIDAD_DEL_TIPO.has(e.tipo) && (h.peso[e.tipo] ?? 0) > 0);
  if (!errores.length) return null;

  // Etapa critica: con los errores propios (sin los del equipo).
  const porEtapa = new Map<EtapaDeVenta, number>();
  for (const e of errores) {
    if (tiposDelEquipo.has(e.tipo)) continue;
    const etapa = etapaDelError(e);
    if (etapa) porEtapa.set(etapa, (porEtapa.get(etapa) ?? 0) + puntajeDelError(e, politica));
  }
  const etapaCritica = [...porEtapa].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const ejes = parte.puntajes?.ejes ?? {};
  const impactoDe = (def: DefinicionDeHabilidad, conEquipo: boolean) => {
    const suyos = errores.filter((e) => def.tipos.includes(e.tipo) && (conEquipo || !tiposDelEquipo.has(e.tipo)));
    if (!suyos.length) return { impacto: 0, suyos };
    const suma = suyos.reduce((n, e) => n + puntajeDelError(e, politica), 0);
    const valores = def.ejes.map((eje) => ejes[eje]).filter((v): v is number => typeof v === "number");
    const ejeMasBajo = valores.length ? Math.min(...valores) : null;
    const bonoEje = ejeMasBajo === null ? 0 : h.puntosPorPuntoDeEje * Math.max(0, h.ejeMinimo - ejeMasBajo);
    const enEtapa = etapaCritica
      ? suyos.filter((e) => etapaDelError(e) === etapaCritica).reduce((n, e) => n + puntajeDelError(e, politica), 0)
      : 0;
    return { impacto: suma + bonoEje + h.bonoEtapaCritica * enEtapa, suyos };
  };

  const ranking = HABILIDADES.map((def) => ({ def, ...impactoDe(def, false) }));
  const ordenado = [...ranking].sort((a, b) => b.impacto - a.impacto);
  let ganadora = ordenado[0]?.impacto > 0 ? ordenado[0] : null;
  let incluyeErrorDelEquipo = false;

  // Excepcion: un error del equipo que en ella es claramente el dominante.
  const mejorSinEquipo = ganadora?.impacto ?? 0;
  for (const def of HABILIDADES) {
    if (!def.tipos.some((t) => tiposDelEquipo.has(t))) continue;
    const conEquipo = impactoDe(def, true);
    if (conEquipo.impacto > 0 && conEquipo.impacto >= h.factorDominante * Math.max(mejorSinEquipo, 0.0001)) {
      if (!ganadora || conEquipo.impacto > ganadora.impacto) {
        ganadora = { def, ...conEquipo };
        incluyeErrorDelEquipo = true;
      }
    }
  }
  if (!ganadora) return null;

  const def = ganadora.def;
  const evidencia = [...ganadora.suyos]
    .sort((a, b) => puntajeDelError(b, politica) - puntajeDelError(a, politica) || (minutosDe(b) ?? 0) - (minutosDe(a) ?? 0))
    .filter((e, i, lista) => lista.findIndex((x) => x.ref === e.ref) === i)
    .slice(0, 3)
    .map((e) => ({ ...refDe(e), texto: textoDeEvidencia(e.detalle) }));

  const m = parte.metricas;
  const deLaHabilidad = ganadora.suyos.length;
  const hoy =
    def.metrica.fuente === "sinRespuesta"
      ? m?.sinRespuesta ?? deLaHabilidad
      : def.metrica.fuente === "demoras"
        ? m?.demoras ?? deLaHabilidad
        : def.metrica.fuente === "cotizaciones"
          ? m?.cotizaciones ?? 0
          : deLaHabilidad;
  const meta = metaDe(def, hoy, deLaHabilidad, politica);

  return {
    version: h.version,
    clave: def.clave,
    nombre: def.nombre,
    impacto: r1(ganadora.impacto),
    ranking: ranking.filter((r) => r.impacto > 0).map((r) => ({ clave: r.def.clave, impacto: r1(r.impacto) })).sort((a, b) => b.impacto - a.impacto),
    etapaCritica,
    incluyeErrorDelEquipo,
    evidencia,
    queHacerDiferente: def.queHacer,
    ejemplo: def.ejemplo,
    metrica: { nombre: def.metrica.nombre, hoy, meta, sentido: def.metrica.sentido, texto: textoDeMetrica(def, hoy, meta) },
    redactadoPor: "plantilla",
  };
}

/** Todo el informe: la habilidad de cada asesora y los problemas del equipo (una sola vez). */
export function elegirHabilidades(
  partes: ParteParaHabilidad[],
  dia: string,
  politica: PoliticaCoach = POLITICA_COACH,
): { porAsesora: Map<string, HabilidadDelDia | null>; problemasDelEquipo: ProblemaDelEquipo[] } {
  const limpias = partes.map((p) => ({
    nombre: p.nombre,
    errores: erroresQueCuentan(p, politica),
    chats: p.metricas?.chats ?? (p.errores.length ? 1 : 0),
  }));
  const problemas = problemasDelEquipo(limpias, dia, politica);
  const tipos = new Set<string>(problemas.map((p) => p.tipo));
  const porAsesora = new Map<string, HabilidadDelDia | null>();
  for (const parte of partes) porAsesora.set(parte.userId, elegirHabilidad(parte, tipos, politica));
  return { porAsesora, problemasDelEquipo: problemas };
}

/** Resumen corto para el campo viejo `unaCosaAMejorar` (pantallas y MCP que lo leen). */
export function unaCosaAMejorarDe(habilidad: HabilidadDelDia | null): string {
  return habilidad ? `${habilidad.nombre}. ${habilidad.queHacerDiferente} Meta: ${habilidad.metrica.texto}.` : "";
}

/* ------------------------------------------------------------------------------------------------
   Redaccion opcional con IA (solo (c) y (d), sobre la habilidad ya elegida)
------------------------------------------------------------------------------------------------ */

export function armarPromptDeHabilidad(input: {
  asesora: string;
  habilidad: HabilidadDelDia;
  /** Transcripciones (ya limpias) de los chats de la evidencia. */
  chats: Array<{ ref: string; transcripcion: string }>;
  politica?: PoliticaCoach;
}): { sistema: string; usuario: string } {
  const politica = input.politica ?? POLITICA_COACH;
  const sistema = [
    "Eres el coach de ventas de Magilus (muebles para peluquerías, spas y barberías, Cali, Colombia). La habilidad a entrenar YA está elegida: no la cambies ni propongas otra.",
    'Devuelve SOLO un JSON {"queHacerDiferente":"...","ejemplo":"..."}.',
    "queHacerDiferente: 1 o 2 frases, de tú, concretas para ESTA asesora según sus chats.",
    "ejemplo: el mensaje de WhatsApp que la asesora puede copiar y mandar (máximo 3 líneas, de tú, cercano, un solo total si hay precio, termina con una pregunta que avance). Sin nombres ni datos del cliente.",
    `Reglas que no se discuten: forma de pago ${politica.pago.unicaForma}. La contraentrega está suspendida: no la menciones. No prometas envío sin costo salvo diciendo que es con pago 50/50 y en ciudades de la lista. Combo de camilla $989.000, se separa con $494.500. No inventes otros precios.`,
    "Español de Colombia, frases cortas, tono que enseña y no castiga.",
  ].join("\n");
  const usuario = [
    `Asesora: ${input.asesora}.`,
    `Habilidad: ${input.habilidad.nombre}.`,
    `Meta de mañana: ${input.habilidad.metrica.texto}.`,
    `Evidencia: ${input.habilidad.evidencia.map((e) => `${e.ref}: ${e.texto}`).join(" | ")}`,
    "",
    ...input.chats.map((c) => `### Chat ${c.ref}\n${c.transcripcion}\n`),
  ].join("\n");
  return { sistema, usuario };
}

/** Lo que devuelve la IA solo se usa si respeta la politica; si no, queda la plantilla. */
export function redaccionValida(
  crudo: string | null | undefined,
  politica: PoliticaCoach = POLITICA_COACH,
): { queHacerDiferente: string; ejemplo: string } | null {
  if (!crudo) return null;
  let datos: Record<string, unknown>;
  try {
    datos = JSON.parse(crudo.replace(/```json/gi, "").replace(/```/g, "").trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
  const t = (v: unknown, max: number) => (typeof v === "string" ? limpiarDatosPersonales(v.replace(/\s+/g, " ").trim()) : "").slice(0, max);
  const queHacerDiferente = t(datos.queHacerDiferente, 300);
  const ejemplo = t(datos.ejemplo, 350);
  if (!queHacerDiferente || !ejemplo) return null;
  const todo = `${queHacerDiferente} ${ejemplo}`;
  if (!politica.pago.contraentregaPermitida && mencionaContraentrega(ejemplo)) return null;
  if (/gratis|sin costo/i.test(ejemplo) && !/50/.test(ejemplo)) return null;
  if (/contra\s*-?\s*entrega/i.test(todo) && !/suspendid|no la ofrezcas|no ofrezcas/i.test(todo)) return null;
  return { queHacerDiferente, ejemplo };
}

export function definicionDe(clave: ClaveDeHabilidad) {
  return POR_CLAVE.get(clave) ?? null;
}
