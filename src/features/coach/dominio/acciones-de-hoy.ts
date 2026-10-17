/**
 * ACCIONES DE HOY: convierte el informe del Coach (CoachInforme / CoachAsesora, lo que YA guardo
 * el generador) en una tarjeta de accion por asesora, con la evidencia debajo.
 *
 * NO cambia el analisis: la habilidad, la metrica y la meta son las que eligio el codigo del Coach
 * (habilidad.ts, `elegirHabilidad`). Aca solo se ordena, se explica y se presenta. Lo que no existe
 * en el informe se dice ("sin dato"), no se inventa.
 *
 * Puro: no toca la base ni la red. Lo usan la pagina del Coach (/cliente/equipo/coach) y las
 * pruebas (`npm run test:coach-acciones`). Solo imports relativos (las pruebas lo cargan sin Next).
 *
 * De donde sale cada campo de la tarjeta:
 *  - habilidad, situacion (metrica.hoy), meta (metrica.meta), queHacerHoy (queHacerDiferente),
 *    mensaje modelo (ejemplo), evidencia: `resumen.habilidad` de CoachAsesora.
 *  - porQue: `habilidad.ranking` + `etapaCritica` (el mismo calculo que la eligio).
 *  - accion: la regla fija de la habilidad (`HABILIDADES[].queHacer`) + practicar con la evidencia.
 *  - estado: lo marca una persona (AppSetting `coach:accion:<negocio>:<dia>:<asesora>`) y pasa a
 *    "cumplido" solo si el informe del dia siguiente trae la misma metrica dentro de la meta.
 *  - operativo (Supervisor): `resumenEquipo.fallasDelSistema`, `sinAsesora`, el motivo "sistema" y
 *    los errores / pendientes cuyo texto cae en las REGLAS_OPERATIVAS de abajo (documentadas).
 */

import { cierreDe, type CierreDeChat, type CierresPorNumero } from "./chats-cerrados";
import { NOMBRE_DE_ETAPA, NOMBRE_DEL_TIPO, definicionDe, erroresQueCuentan } from "../habilidad";
import { POLITICA_COACH } from "../politica";
import { limpiarDatosPersonales } from "../reglas";
import type {
  AciertoDelCoach,
  ChatRef,
  ErrorDelCoach,
  HabilidadDelDia,
  PendienteDelCoach,
  ProblemaDelEquipo,
  PuntajesDelCoach,
  ResumenDeAsesoraGuardado,
  ResumenDelEquipo,
} from "../tipos";

/* ------------------------------------------------------------------------------------------------
   Tipos
------------------------------------------------------------------------------------------------ */

/** Lo minimo del informe que se necesita (InformeDelCoach de leer-coach.ts lo cumple). */
export type ParteParaTarjeta = {
  userId: string;
  nombre: string;
  chats: number;
  puntaje: number | null;
  puntajes: PuntajesDelCoach | null;
  aciertos: AciertoDelCoach[];
  errores: ErrorDelCoach[];
  pendientes: PendienteDelCoach[];
  resumen: ResumenDeAsesoraGuardado | null;
  /** Chats de la parte que HOY ya estan cerrados (leer-coach.ts): etiqueta en evidencia y errores. */
  cierres?: CierresPorNumero;
};

export type InformeParaTarjetas = {
  dia: string;
  resumenEquipo: ResumenDelEquipo | null;
  asesoras: ParteParaTarjeta[];
};

export type EstadoDeAccion = "pendiente" | "en_progreso" | "cumplido";

/** Lo que se guarda en AppSetting cuando alguien marca la accion. */
export type EstadoGuardado = { estado: EstadoDeAccion; por?: string | null; en?: string | null };

export type EnlaceDeChat = {
  ref: string;
  /** "#3948 · •••• 0204": nunca el telefono completo. */
  etiqueta: string;
  /** /cliente/chats?chatKey=agent%3A<id>&assigned=all, o /c/<numero> si no se pudo traducir. */
  href: string | null;
  nombreCliente: string;
  /** El chat ya se resolvio, descarto o gano (despues del informe). Solo si esta cerrado. */
  cierre?: CierreDeChat;
};

export type Clasificacion = { operativo: boolean; regla: string | null; dudoso: boolean };

export type ErrorEnTarjeta = EnlaceDeChat & Clasificacion & { tipo: string; tipoNombre: string; texto: string };
export type PendienteEnTarjeta = EnlaceDeChat &
  Clasificacion & {
    temperatura: PendienteDelCoach["temperatura"];
    urgente: boolean;
    porque: string;
    siguienteMensaje: string;
    etapa: string;
  };

export type PasoDeLaCadena = { paso: "ocurrio" | "patron" | "habilidad" | "hacer" | "medida"; titulo: string; texto: string };

export type TarjetaDeAccion = {
  userId: string;
  nombre: string;
  habilidad: { clave: string; nombre: string } | null;
  /** Una linea: por que gano esta habilidad. */
  porQue: string;
  situacion: { valor: number; texto: string } | null;
  meta: { valor: number; texto: string; deDonde: string } | null;
  queHacerHoy: string | null;
  accion: string | null;
  mensajeModelo: string | null;
  cadena: PasoDeLaCadena[];
  estado: { valor: EstadoDeAccion; origen: "manual" | "automatico" | "sin_marcar"; detalle: string };
  medidaSiguiente: { dia: string; valor: number; cumple: boolean } | null;
  evidencia: Array<EnlaceDeChat & Clasificacion & { texto: string }>;
  /** Lo que el informe no trae: la tarjeta lo dice en vez de inventarlo. */
  faltantes: string[];
  explicacion: {
    impacto: number | null;
    ranking: Array<{ nombre: string; impacto: number }>;
    etapa: string | null;
    incluyeErrorDelEquipo: boolean;
    redactadoPor: "ia" | "plantilla" | null;
  };
  diagnostico: {
    chats: number;
    puntaje: number | null;
    ejes: PuntajesDelCoach["ejes"];
    metricas: ResumenDeAsesoraGuardado["metricas"] | null;
    loQueHizoBien: string;
  };
  aciertos: Array<EnlaceDeChat & { texto: string }>;
  /** TODOS los errores guardados, con su clasificacion (los operativos se muestran aparte). */
  errores: ErrorEnTarjeta[];
  pendientes: PendienteEnTarjeta[];
};

export type ItemOperativo = {
  origen: "falla_del_sistema" | "sin_asesora" | "motivo_sistema" | "error_reclasificado" | "pendiente_operativo";
  texto: string;
  asesora: string | null;
  regla: string;
  dudoso: boolean;
  chats: EnlaceDeChat[];
};

export type AccionesDeHoy = {
  dia: string;
  /** El dia en que se aplican las acciones (dia + 1). */
  diaDeAccion: string;
  tarjetas: TarjetaDeAccion[];
  operativo: ItemOperativo[];
  problemasDelEquipo: ProblemaDelEquipo[];
  /** Errores y pendientes que el Coach dejo en una asesora y aca salen al Supervisor. */
  reclasificados: Array<{ asesora: string; tipo: string; ref: string; texto: string; regla: string; dudoso: boolean }>;
};

export type OpcionesDeTarjetas = {
  /** numero corto del chat -> Conversation.id, para el enlace exacto de la bandeja. */
  conversacionPorNumero?: Record<number, string>;
  /** userId -> lo que marco una persona. */
  estados?: Record<string, EstadoGuardado | undefined>;
  /** El informe del dia siguiente, si ya existe: para el "cumplido" automatico. */
  siguiente?: InformeParaTarjetas | null;
};

/* ------------------------------------------------------------------------------------------------
   Utilidades
------------------------------------------------------------------------------------------------ */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-10-10" -> "10-oct". */
export function diaCorto(dia: string): string {
  const [, mes, d] = dia.split("-").map(Number);
  return mes && d ? `${d}-${MESES[mes - 1]}` : dia;
}

export function moverDia(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T12:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

const coma = (n: number) => n.toString().replace(".", ",");

/** "…0204" -> "•••• 0204". Nunca mas de 4 digitos. */
export function telefonoEnmascarado(ultimos4: string | null | undefined): string {
  const digitos = (ultimos4 ?? "").replace(/\D/g, "").slice(-4);
  return digitos.length === 4 ? `•••• ${digitos}` : "••••";
}

/** El enlace al chat exacto, con el formato que usa todo el CRM (ver /c/[numero]/page.tsx). */
export function hrefDeChat(numero: number | null | undefined, conversacionPorNumero: Record<number, string> = {}): string | null {
  if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero <= 0) return null;
  const id = conversacionPorNumero[numero];
  if (id) return `/cliente/chats?chatKey=${encodeURIComponent(`agent:${id}`)}&assigned=all`;
  // Sin traduccion (chat de la API oficial o no encontrado): el link corto redirige al mismo chat.
  return `/c/${numero}`;
}

export function enlaceDeChat(
  ref: Pick<ChatRef, "ref" | "numero" | "ultimos4" | "nombre">,
  mapa: Record<number, string> = {},
  cierres?: CierresPorNumero,
): EnlaceDeChat {
  const telefono = telefonoEnmascarado(ref.ultimos4);
  const cierre = cierreDe(ref.numero, cierres);
  return {
    ref: ref.ref,
    etiqueta: telefono === "••••" ? ref.ref : `${ref.ref} · ${telefono}`,
    href: hrefDeChat(ref.numero, mapa),
    nombreCliente: limpiarDatosPersonales(ref.nombre ?? "").trim(),
    ...(cierre ? { cierre } : {}),
  };
}

/** Los "#1234" que cita un texto (las fallas del sistema los traen asi: "#4011, #4015"). */
export function refsCitadas(texto: string | null | undefined): number[] {
  return [...new Set([...(texto ?? "").matchAll(/#(\d{1,7})\b/g)].map((m) => Number(m[1])))];
}

const limpio = (t: string | null | undefined) => limpiarDatosPersonales((t ?? "").replace(/\s+/g, " ").trim());

/* ------------------------------------------------------------------------------------------------
   Coach vs Supervisor: reglas para separar lo operativo
------------------------------------------------------------------------------------------------ */

/**
 * Lo que NO es habilidad de la asesora sino del sistema / la operacion. Se mira el texto que guardo
 * el Coach (detalle del error o "porque" del pendiente). Cambiar estas reglas cambia solo DONDE se
 * muestra un item, nunca la habilidad ni los conteos del Coach.
 */
export const REGLAS_OPERATIVAS: Array<{ id: string; patron: RegExp; explicacion: string }> = [
  {
    id: "bot",
    patron: /\b(el|del|al|un)\s+bot\b|\bbot\s+(no|respondi|dijo|envi|mand)|falla del sistema|error del sistema|el sistema no|plantilla autom|automatizaci[oó]n/i,
    explicacion: "Habla del bot, la automatización o una falla del sistema.",
  },
  {
    id: "regla_de_ciudad",
    patron: /(no hay|sin|falta(n)?( de)?|no tiene|no existe)\s+(una\s+)?reglas?\b/i,
    explicacion: "Falta una regla de envío o de ciudad en la configuración.",
  },
  {
    id: "ciudad_fuera_de_tabla",
    patron: /no est[aá] en la lista de cobro adicional ni (de )?env[ií]o gratis/i,
    explicacion: "La ciudad no está en ninguna lista de la tabla de envíos: la tabla está incompleta.",
  },
  {
    id: "asignacion",
    patron: /sin asesora|asignaci[oó]n|\breparto\b|nadie (lo|la) ten[ií]a asignad/i,
    explicacion: "Es de asignación o reparto de chats.",
  },
];

/** Tipos de error que pueden venir de una regla de envío mal configurada (para el cruce con las fallas). */
const TIPOS_DE_ENVIO = new Set(["cobro_envio_gratis", "sin_cotizacion", "dato_errado"]);
const RE_TEXTO_DE_ENVIO = /env[ií]o|ciudad|lista/i;
const RE_PENDIENTE_DE_ENVIO = /env[ií]o|regla|tarifa|monto adicional/i;
const RE_FALLA_DE_ENVIO = /regla|ciudad|env[ií]o/i;

export function clasificarTexto(texto: string): Clasificacion {
  for (const regla of REGLAS_OPERATIVAS) {
    if (regla.patron.test(texto)) return { operativo: true, regla: regla.explicacion, dudoso: false };
  }
  return { operativo: false, regla: null, dudoso: false };
}

/**
 * Un error o pendiente de una asesora. Ademas de las palabras clave, se cruza con las fallas del
 * sistema del mismo informe: si el Coach ya dijo que ese chat tiene una regla de envio/ciudad mal
 * configurada y el error es de envio, sale al Supervisor marcado "dudoso" (para que Alexander mire).
 */
export function clasificarItem(
  item: { tipo?: string | null; texto: string; numero: number | null },
  chatsConFallaDeEnvio: Set<number>,
): Clasificacion {
  const porTexto = clasificarTexto(item.texto);
  if (porTexto.operativo) return porTexto;
  // Error: de un tipo de envio y que hable de envio/ciudad/lista. Pendiente (sin tipo): que hable
  // de envio, regla o monto ("confirmar ciudad y color" es del cliente, no del sistema).
  const hablaDeEnvio = item.tipo
    ? TIPOS_DE_ENVIO.has(item.tipo) && RE_TEXTO_DE_ENVIO.test(item.texto)
    : RE_PENDIENTE_DE_ENVIO.test(item.texto);
  if (hablaDeEnvio && typeof item.numero === "number" && chatsConFallaDeEnvio.has(item.numero)) {
    return {
      operativo: true,
      regla: "El Coach también marcó este chat como falla del sistema (regla de envío o ciudad).",
      dudoso: true,
    };
  }
  return porTexto;
}

/* ------------------------------------------------------------------------------------------------
   Metrica del dia siguiente (para el "cumplido" automatico)
------------------------------------------------------------------------------------------------ */

/** La misma metrica de la habilidad, medida en otro informe. null = no se puede saber. */
export function medirMetrica(
  habilidad: HabilidadDelDia,
  parte: ParteParaTarjeta | undefined,
  tiposDelEquipo: Set<string>,
): number | null {
  const def = definicionDe(habilidad.clave);
  if (!def || !parte) return null;
  const m = parte.resumen?.metricas;
  if (def.metrica.fuente === "sinRespuesta") return m ? m.sinRespuesta : null;
  if (def.metrica.fuente === "demoras") return m ? m.demoras : null;
  if (def.metrica.fuente === "cotizaciones") return m ? m.cotizaciones : null;
  const errores = erroresQueCuentan({
    userId: parte.userId,
    nombre: parte.nombre,
    errores: parte.errores,
    puntajes: parte.puntajes,
    pendientes: parte.pendientes,
    metricas: m ?? null,
  });
  return errores.filter((e) => def.tipos.includes(e.tipo) && (habilidad.incluyeErrorDelEquipo || !tiposDelEquipo.has(e.tipo)))
    .length;
}

export function cumpleMeta(valor: number, metrica: HabilidadDelDia["metrica"]): boolean {
  return metrica.sentido === "subir" ? valor >= metrica.meta : valor <= metrica.meta;
}

/** "máximo 4", "0 (ninguno)", "mínimo 3". */
export function textoDeMeta(metrica: HabilidadDelDia["metrica"]): string {
  if (metrica.sentido === "subir") return `mínimo ${metrica.meta}`;
  return metrica.meta === 0 ? "0 (ninguno)" : `máximo ${metrica.meta}`;
}

function deDondeSaleLaMeta(habilidad: HabilidadDelDia): string {
  const def = definicionDe(habilidad.clave);
  if (!def) return "Meta guardada por el Coach.";
  if (def.metrica.sentido === "subir") return "Regla del Coach: lo de hoy más los casos que faltaron (entre 1 y 3).";
  if (def.metrica.aCero) return "Regla del Coach: este error tiene que ir a cero.";
  const mitad = POLITICA_COACH.habilidad.metaMitad;
  return `Regla del Coach: ${mitad === 0.5 ? "la mitad" : `${Math.round(mitad * 100)} %`} de los casos de hoy, redondeado hacia abajo.`;
}

/* ------------------------------------------------------------------------------------------------
   La tarjeta
------------------------------------------------------------------------------------------------ */

function porQueDe(h: HabilidadDelDia, casos: number, dia: string): string {
  const segunda = h.ranking.find((r) => r.clave !== h.clave);
  const nombreSegunda = segunda ? definicionDe(segunda.clave)?.nombre ?? segunda.clave : null;
  const comparacion = segunda && nombreSegunda ? `; le sigue «${nombreSegunda}» con ${coma(segunda.impacto)}` : "; fue el único error medido";
  return [
    `Fue lo que más ventas le puso en riesgo el ${diaCorto(dia)} (${casos} caso${casos === 1 ? "" : "s"}, impacto ${coma(h.impacto)}${comparacion}).`,
    h.etapaCritica ? `Se pierde ${NOMBRE_DE_ETAPA[h.etapaCritica]}.` : "",
    h.incluyeErrorDelEquipo ? "Incluye un error que también tuvo el equipo, pero en ella pesa mucho más." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** ¿El error es de los tipos de la habilidad? */
const esDeLaHabilidad = (def: ReturnType<typeof definicionDe>, tipo: string) => Boolean(def && (def.tipos as string[]).includes(tipo));

function armarTarjeta(
  parte: ParteParaTarjeta,
  dia: string,
  ctx: {
    mapa: Record<number, string>;
    chatsConFallaDeEnvio: Set<number>;
    estado: EstadoGuardado | undefined;
    siguiente: InformeParaTarjetas | null;
    tiposDelEquipoSiguiente: Set<string>;
  },
): TarjetaDeAccion {
  const faltantes: string[] = [];
  const h = parte.resumen?.habilidad ?? null;
  const def = h ? definicionDe(h.clave) : null;
  const enlace = (r: ChatRef) => enlaceDeChat(r, ctx.mapa, parte.cierres);

  const errores: ErrorEnTarjeta[] = parte.errores.map((e) => {
    const texto = limpio(e.detalle);
    return {
      ...enlace(e),
      ...clasificarItem({ tipo: e.tipo, texto, numero: e.numero }, ctx.chatsConFallaDeEnvio),
      tipo: e.tipo,
      tipoNombre: NOMBRE_DEL_TIPO[e.tipo] ?? e.tipo,
      texto,
    };
  });
  const pendientes: PendienteEnTarjeta[] = parte.pendientes.map((p) => {
    const porque = limpio(p.porque);
    return {
      ...enlace(p),
      ...clasificarItem({ texto: porque, numero: p.numero }, ctx.chatsConFallaDeEnvio),
      temperatura: p.temperatura,
      urgente: Boolean(p.urgente),
      porque,
      siguienteMensaje: limpio(p.siguienteMensaje),
      etapa: p.etapa ?? "",
    };
  });
  const aciertos = parte.aciertos.map((a) => ({ ...enlace(a), texto: limpio(a.texto) }));

  const evidencia = (h?.evidencia ?? []).map((e) => {
    const texto = limpio(e.texto);
    const delError = errores.find((x) => x.ref === e.ref && esDeLaHabilidad(def, x.tipo));
    const clasif = delError
      ? { operativo: delError.operativo, regla: delError.regla, dudoso: delError.dudoso }
      : clasificarItem({ texto, numero: e.numero }, new Set());
    return { ...enlace(e), ...clasif, texto };
  });

  if (!parte.resumen) faltantes.push("El Coach no guardó el resumen de esta asesora ese día: no hay métricas ni habilidad.");
  else if (!h) faltantes.push("Sin habilidad prioritaria: el Coach no encontró errores medidos ese día.");
  if (h && !evidencia.length) faltantes.push("El Coach no guardó chats de evidencia para esta habilidad.");
  if (evidencia.some((e) => !e.href)) faltantes.push("Algún chat de la evidencia no tiene número: no se puede abrir desde aquí.");
  if (h && !def) faltantes.push(`La habilidad «${h.nombre}» no está en el catálogo actual: falta la regla fija de la acción.`);

  // Los casos de la habilidad. Si la metrica cuenta errores (bajar), es la cifra del Coach; si cuenta
  // lo que SI se hizo (cotizaciones, subir), los casos son los errores guardados de esos tipos.
  const deLaHabilidad = errores.filter((e) => esDeLaHabilidad(def, e.tipo));
  const casos = h ? (h.metrica.sentido === "bajar" ? h.metrica.hoy : deLaHabilidad.length) : 0;
  const operativosEnLaHabilidad = deLaHabilidad.filter((e) => e.operativo).length;

  const situacion = h ? { valor: h.metrica.hoy, texto: h.metrica.nombre } : null;
  const meta = h ? { valor: h.metrica.meta, texto: textoDeMeta(h.metrica), deDonde: deDondeSaleLaMeta(h) } : null;

  const queHacerHoy = h ? limpio(h.queHacerDiferente) || null : null;
  let accion: string | null = null;
  if (h) {
    const practicar = evidencia.length
      ? `Antes del primer chat: abre ${evidencia.length === 1 ? "el chat" : `los ${evidencia.length} chats`} de la evidencia y reescribe tu respuesta con el mensaje modelo.`
      : "Antes del primer chat: practica el mensaje modelo.";
    const regla = def && def.queHacer !== h.queHacerDiferente ? def.queHacer : null;
    accion = regla ? `${regla} ${practicar}` : practicar;
  }

  // Cadena: que ocurrio -> patron -> habilidad -> que hacer -> como se mide.
  const cadena: PasoDeLaCadena[] = [];
  if (h) {
    const primera = evidencia[0];
    const otros = Math.max(0, casos - 1);
    cadena.push({
      paso: "ocurrio",
      titulo: "Qué ocurrió",
      texto: primera
        ? `${primera.ref}: ${primera.texto}${otros ? ` Y ${otros} caso${otros === 1 ? "" : "s"} más.` : ""}`
        : `${casos} ${h.metrica.nombre}.`,
    });
    const totalErrores = parte.errores.length;
    cadena.push({
      paso: "patron",
      titulo: "Patrón",
      texto: [
        `${deLaHabilidad.length || casos} de ${totalErrores} errores del día son de este tipo`,
        h.etapaCritica ? `y la venta se pierde ${NOMBRE_DE_ETAPA[h.etapaCritica]}` : "",
        operativosEnLaHabilidad
          ? `(${operativosEnLaHabilidad} parece${operativosEnLaHabilidad === 1 ? "" : "n"} del sistema: ver Supervisor)`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
        .concat("."),
    });
    cadena.push({ paso: "habilidad", titulo: "Habilidad", texto: h.nombre });
    cadena.push({ paso: "hacer", titulo: "Qué hacer diferente", texto: queHacerHoy ?? "Sin texto del Coach." });
    cadena.push({
      paso: "medida",
      titulo: "Cómo se mide mañana",
      texto: `En el informe del ${diaCorto(moverDia(dia, 1))} se cuenta «${h.metrica.nombre}». Cumple si queda en ${textoDeMeta(h.metrica)}.`,
    });
  }

  // Estado: automatico con el informe del dia siguiente; si no, lo que marco una persona.
  let medidaSiguiente: TarjetaDeAccion["medidaSiguiente"] = null;
  if (h && ctx.siguiente) {
    const valor = medirMetrica(
      h,
      ctx.siguiente.asesoras.find((p) => p.userId === parte.userId),
      ctx.tiposDelEquipoSiguiente,
    );
    if (valor !== null) medidaSiguiente = { dia: ctx.siguiente.dia, valor, cumple: cumpleMeta(valor, h.metrica) };
  }
  let estado: TarjetaDeAccion["estado"];
  if (medidaSiguiente?.cumple) {
    estado = {
      valor: "cumplido",
      origen: "automatico",
      detalle: `Cumplido: el ${diaCorto(medidaSiguiente.dia)} quedó en ${medidaSiguiente.valor} (meta ${textoDeMeta(h!.metrica)}).`,
    };
  } else if (ctx.estado) {
    const nota = medidaSiguiente
      ? ` El ${diaCorto(medidaSiguiente.dia)} quedó en ${medidaSiguiente.valor}: no alcanzó la meta (${textoDeMeta(h!.metrica)}).`
      : "";
    estado = { valor: ctx.estado.estado, origen: "manual", detalle: `Marcado a mano.${nota}` };
  } else {
    estado = {
      valor: "pendiente",
      origen: "sin_marcar",
      detalle: medidaSiguiente
        ? `El ${diaCorto(medidaSiguiente.dia)} quedó en ${medidaSiguiente.valor}: no alcanzó la meta (${textoDeMeta(h!.metrica)}).`
        : h
          ? `Se marca solo cuando salga el informe del ${diaCorto(moverDia(dia, 1))} (11:30 p. m.) o cuando alguien lo marque.`
          : "Sin acción para marcar.",
    };
  }

  return {
    userId: parte.userId,
    nombre: parte.nombre,
    habilidad: h ? { clave: h.clave, nombre: h.nombre } : null,
    porQue: h ? porQueDe(h, casos, dia) : "",
    situacion,
    meta,
    queHacerHoy,
    accion,
    mensajeModelo: h ? limpio(h.ejemplo) || null : null,
    cadena,
    estado,
    medidaSiguiente,
    evidencia,
    faltantes,
    explicacion: {
      impacto: h ? h.impacto : null,
      ranking: (h?.ranking ?? []).map((r) => ({ nombre: definicionDe(r.clave)?.nombre ?? r.clave, impacto: r.impacto })),
      etapa: h?.etapaCritica ? NOMBRE_DE_ETAPA[h.etapaCritica] : null,
      incluyeErrorDelEquipo: Boolean(h?.incluyeErrorDelEquipo),
      redactadoPor: h?.redactadoPor ?? null,
    },
    diagnostico: {
      chats: parte.chats,
      puntaje: parte.puntaje,
      ejes: parte.puntajes?.ejes ?? {},
      metricas: parte.resumen?.metricas ?? null,
      loQueHizoBien: limpio(parte.resumen?.loQueHizoBien),
    },
    aciertos,
    errores,
    pendientes,
  };
}

/* ------------------------------------------------------------------------------------------------
   Todo el informe
------------------------------------------------------------------------------------------------ */

export function armarAccionesDeHoy(informe: InformeParaTarjetas, opciones: OpcionesDeTarjetas = {}): AccionesDeHoy {
  const mapa = opciones.conversacionPorNumero ?? {};
  const r = informe.resumenEquipo;
  const fallas = r?.fallasDelSistema ?? [];
  const chatsConFallaDeEnvio = new Set(
    fallas.filter((f) => RE_FALLA_DE_ENVIO.test(f.texto)).flatMap((f) => refsCitadas(`${f.ref ?? ""} ${f.texto}`)),
  );
  const siguiente = opciones.siguiente ?? null;
  const tiposDelEquipoSiguiente = new Set<string>((siguiente?.resumenEquipo?.problemasDelEquipo ?? []).map((p) => p.tipo));

  const tarjetas = informe.asesoras
    .map((parte) =>
      armarTarjeta(parte, informe.dia, {
        mapa,
        chatsConFallaDeEnvio,
        estado: opciones.estados?.[parte.userId],
        siguiente,
        tiposDelEquipoSiguiente,
      }),
    )
    // Primero las que tienen accion, por impacto; despues el resto por nombre.
    .sort(
      (a, b) =>
        Number(Boolean(b.habilidad)) - Number(Boolean(a.habilidad)) ||
        (b.explicacion.impacto ?? 0) - (a.explicacion.impacto ?? 0) ||
        a.nombre.localeCompare(b.nombre, "es"),
    );

  const enlacesDe = (texto: string) =>
    refsCitadas(texto).map((numero) => enlaceDeChat({ ref: `#${numero}`, numero, ultimos4: "", nombre: "" }, mapa));

  const operativo: ItemOperativo[] = [];
  if (r?.sinAsesora) {
    operativo.push({
      origen: "sin_asesora",
      texto: `${r.sinAsesora} chat${r.sinAsesora === 1 ? "" : "s"} con movimiento quedaron sin asesora asignada.`,
      asesora: null,
      regla: "Cifra del resumen del equipo (sinAsesora).",
      dudoso: false,
      chats: [],
    });
  }
  for (const f of fallas) {
    operativo.push({
      origen: "falla_del_sistema",
      texto: limpio(f.texto),
      asesora: null,
      regla: "El Coach ya la guardó como falla del sistema o del bot.",
      dudoso: false,
      chats: enlacesDe(`${f.ref ?? ""}`),
    });
  }
  const motivoSistema = r?.motivos.find((m) => m.motivo === "sistema");
  if (motivoSistema?.casos) {
    operativo.push({
      origen: "motivo_sistema",
      texto: `${motivoSistema.casos} chat${motivoSistema.casos === 1 ? "" : "s"} no cerraron por el sistema o el bot (motivo de no cierre).`,
      asesora: null,
      regla: "Motivo de no cierre «sistema» del resumen del equipo.",
      dudoso: false,
      chats: [],
    });
  }

  const reclasificados: AccionesDeHoy["reclasificados"] = [];
  for (const t of tarjetas) {
    for (const e of t.errores.filter((x) => x.operativo)) {
      operativo.push({
        origen: "error_reclasificado",
        texto: `${e.tipoNombre}: ${e.texto}`,
        asesora: t.nombre,
        regla: e.regla ?? "",
        dudoso: e.dudoso,
        chats: [e],
      });
      reclasificados.push({ asesora: t.nombre, tipo: e.tipo, ref: e.ref, texto: e.texto, regla: e.regla ?? "", dudoso: e.dudoso });
    }
    for (const p of t.pendientes.filter((x) => x.operativo)) {
      operativo.push({
        origen: "pendiente_operativo",
        texto: `Pendiente: ${p.porque}`,
        asesora: t.nombre,
        regla: p.regla ?? "",
        dudoso: p.dudoso,
        chats: [p],
      });
      reclasificados.push({ asesora: t.nombre, tipo: "pendiente", ref: p.ref, texto: p.porque, regla: p.regla ?? "", dudoso: p.dudoso });
    }
  }

  return {
    dia: informe.dia,
    diaDeAccion: moverDia(informe.dia, 1),
    tarjetas,
    operativo,
    problemasDelEquipo: r?.problemasDelEquipo ?? [],
    reclasificados,
  };
}
