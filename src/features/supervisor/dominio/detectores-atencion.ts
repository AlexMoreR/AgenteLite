/**
 * DETECTORES DE ATENCIÓN (código puro, deterministas, sin IA). Los corre el chequeo ligero de cada
 * 5 minutos sobre los chats abiertos.
 *
 * SOLO ALERTAN. Nunca reasignan, nunca escriben al cliente, nunca mueven etapas: eso lo decide una
 * persona (o el Director, en otra fase).
 */

import { minutosLaborales as minutosLaboralesDelEquipo } from "../../coach/reglas";
import { detectarSenales, esSenalDeCompra } from "../../embudo/dominio/senales";
import { mensajePorSenales } from "../../seguimiento-inteligente/dominio/mensajes";
import { familiaDelTexto, nombreDeFamilia } from "../../seguimiento-inteligente/dominio/producto";
import { calificar, type Calificacion } from "../../seguimiento-inteligente/dominio/temperatura";
import { motivoDeExclusion } from "./exclusiones";
import { horaBogota, diaSemanaBogota } from "./linea-base";
import type { Hallazgo } from "./tipos";

const MIN = 60_000;

export type ChatAbierto = {
  conversationId: string;
  asesoraId: string | null;
  asesoraNombre?: string | null;
  /** NUEVO, CALIFICADO, PROPUESTA, NEGOCIACION (=Caliente), GANADO, PERDIDO. */
  etapa: string | null;
  /** Último mensaje del cliente (sin notas del sistema). */
  ultimoClienteEn: Date | null;
  /** Última respuesta de una persona (CRM o celular). */
  ultimaRespuestaHumanaEn: Date | null;
  /** Textos del cliente desde la última respuesta humana (o los últimos), del más viejo al más nuevo. */
  textosPendientes: string[];
  /** El chat tiene la IA pausada (lo atiende una persona). */
  pausado?: boolean;
  /* Para las exclusiones (ver exclusiones.ts). */
  telefono?: string | null;
  esLid?: boolean;
  telefonoDescubierto?: string | null;
  metadata?: unknown;
  dormidoHasta?: Date | null;
  /** Los últimos textos del cliente (no solo los pendientes): si nombra Colombia no es "del exterior". */
  textosDelCliente?: string[];
  /** Cuándo se le asignó el chat a la asesora actual (nota "auto-asignado"), si se sabe. */
  asignadaEn?: Date | null;
  /** Temperatura guardada por el seguimiento inteligente (EmbudoLead.temperatura), si hay. */
  temperatura?: string | null;
  /** Nombre del contacto (para el mensaje sugerido). */
  nombreCliente?: string | null;
};

export type HorarioLaboral = { desde: number; hasta: number; dias: number[] };
/** Lunes a sábado, 8 a. m. a 6 p. m. (Bogotá). */
export const HORARIO_POR_DEFECTO: HorarioLaboral = { desde: 8, hasta: 18, dias: [1, 2, 3, 4, 5, 6] };

export function enHorario(fecha: Date, horario: HorarioLaboral = HORARIO_POR_DEFECTO): boolean {
  const h = horaBogota(fecha);
  return horario.dias.includes(diaSemanaBogota(fecha)) && h >= horario.desde && h < horario.hasta;
}

/** Minutos de espera contados SOLO dentro del horario laboral (de a 1 min, máximo 7 días). */
export function minutosLaborales(desde: Date, hasta: Date, horario: HorarioLaboral = HORARIO_POR_DEFECTO): number {
  let total = 0;
  const fin = Math.min(hasta.getTime(), desde.getTime() + 7 * 24 * 60 * MIN);
  // Se avanza por bloques de 15 min para que sea barato; la precisión alcanza para umbrales de 15/60.
  for (let t = desde.getTime(); t < fin; t += 15 * MIN) {
    const paso = Math.min(15 * MIN, fin - t);
    if (enHorario(new Date(t), horario)) total += paso / MIN;
  }
  return Math.round(total);
}

export type EstadoDeEspera = {
  chat: ChatAbierto;
  esperando: boolean;
  minutos: number;
  minutosLaborales: number;
  senalFuerte: boolean;
  senal: boolean;
  caliente: boolean;
  frase: string | null;
};

export function estadoDeEspera(chat: ChatAbierto, ahora: Date, horario = HORARIO_POR_DEFECTO): EstadoDeEspera {
  const esperando =
    Boolean(chat.ultimoClienteEn) &&
    (!chat.ultimaRespuestaHumanaEn || (chat.ultimoClienteEn as Date).getTime() > chat.ultimaRespuestaHumanaEn.getTime());
  const senales = chat.textosPendientes.flatMap((t) => detectarSenales(t).map((s) => ({ ...s, texto: t })));
  const fuerte = senales.find((s) => s.grupo === "fuerte");
  const cualquiera = senales.find(esSenalDeCompra);
  return {
    chat,
    esperando,
    minutos: esperando ? Math.floor((ahora.getTime() - (chat.ultimoClienteEn as Date).getTime()) / MIN) : 0,
    minutosLaborales: esperando ? minutosLaborales(chat.ultimoClienteEn as Date, ahora, horario) : 0,
    senalFuerte: Boolean(fuerte),
    senal: Boolean(cualquiera),
    caliente: chat.etapa === "NEGOCIACION",
    frase: (fuerte ?? cualquiera)?.fragmento ?? null,
  };
}

export const UMBRALES_ATENCION = {
  esperaImportante: 15,
  esperaCritica: 60,
  sinDuenaMin: 10,
  saturadaDesde: 4,
  retomarDesdeH: 24,
  retomarHastaH: 72,
  /** Lead interesado asignado sin ningún mensaje humano: IMPORTANTE desde estos minutos laborales… */
  asignadoSinRespuestaMin: 30,
  /** …y CRÍTICO pasado este tope si está Caliente. */
  asignadoSinRespuestaCriticoMin: 120,
};

function hallazgoBase(parcial: Partial<Hallazgo> & Pick<Hallazgo, "clave" | "severidad" | "titulo" | "que" | "desde">): Hallazgo {
  return {
    familia: "ATENCION",
    producto: null,
    leadsAfectados: 0,
    evidencia: { chats: [], reglas: [], versiones: [] },
    metrica: "",
    esperado: "",
    observado: "",
    hechos: [],
    hipotesis: [],
    causaPosible: "",
    impacto: "",
    recomendacion: "",
    queCambiar: "Nada en el sistema: es atención del equipo.",
    riesgo: "Ninguno: es un aviso.",
    comoMedir: "",
    tocaProduccion: false,
    ...parcial,
  };
}

/**
 * El chequeo de atención. Agrupa por asesora para no mandar un aviso por chat: un incidente =
 * "N chats calientes esperando a Fulana", que se actualiza en cada vuelta.
 */
export function detectarAtencion(chats: ChatAbierto[], ahora: Date, horario = HORARIO_POR_DEFECTO): Hallazgo[] {
  const salida: Hallazgo[] = [];
  // Fuera: PERDIDO/GANADO, fuera de Colombia, dormidos por fecha futura y los que ya respondió una
  // persona (exclusiones.ts). "ya_respondio" coincide con "no está esperando", que ya se exigía.
  const estados = chats
    .filter((c) => {
      const motivo = motivoDeExclusion({ ...c, textos: [...(c.textosDelCliente ?? []), ...c.textosPendientes] }, ahora);
      return motivo === null || motivo === "ya_respondio";
    })
    .map((c) => estadoDeEspera(c, ahora, horario));
  const u = UMBRALES_ATENCION;

  // A1 / A3: calientes o con señal fuerte esperando, por asesora (solo cuenta el tiempo laboral).
  const urgentes = estados.filter(
    (e) => e.esperando && (e.caliente || e.senalFuerte) && e.minutosLaborales >= u.esperaImportante && e.minutos <= u.retomarDesdeH * 60,
  );
  const porAsesora = new Map<string, EstadoDeEspera[]>();
  for (const e of urgentes) {
    const clave = e.chat.asesoraId ?? "sin-duena";
    porAsesora.set(clave, [...(porAsesora.get(clave) ?? []), e]);
  }
  for (const [asesora, lista] of porAsesora) {
    const orden = [...lista].sort((a, b) => b.minutosLaborales - a.minutosLaborales);
    const peor = orden[0];
    const critico = peor.minutosLaborales >= u.esperaCritica;
    const nombre = peor.chat.asesoraNombre ?? (asesora === "sin-duena" ? "nadie (sin dueña)" : asesora);
    const saturada = lista.length >= u.saturadaDesde;
    salida.push(
      hallazgoBase({
        clave: `ATENCION:caliente-esperando:${asesora}`,
        severidad: critico ? "CRITICO" : "IMPORTANTE",
        titulo: `${lista.length} chat(s) caliente(s) esperando respuesta de ${nombre}${saturada ? " (saturada)" : ""}`,
        que: `El más antiguo lleva ${peor.minutosLaborales} min laborales sin respuesta humana${peor.frase ? ` ("${peor.frase}")` : ""}.`,
        desde: peor.chat.ultimoClienteEn as Date,
        asesoraId: asesora === "sin-duena" ? null : asesora,
        leadsAfectados: lista.length,
        evidencia: { chats: orden.slice(0, 10).map((e) => e.chat.conversationId), reglas: [], versiones: [] },
        metrica: "Minutos laborales sin respuesta humana con señal fuerte o etapa Caliente",
        esperado: `< ${u.esperaImportante} min`,
        observado: orden.slice(0, 5).map((e) => `${e.minutosLaborales} min`).join(", "),
        hechos: orden.slice(0, 5).map((e) => `Chat ${e.chat.conversationId}: ${e.minutosLaborales} min laborales${e.caliente ? ", etapa Caliente" : ""}${e.frase ? `, dijo "${e.frase}"` : ""}.`),
        hipotesis: saturada ? ["La asesora tiene más chats calientes de los que puede atender a tiempo."] : [],
        causaPosible: saturada ? "Carga alta de la asesora." : "Respuesta humana lenta.",
        impacto: "Un cliente con intención fuerte que espera más de 15 min se enfría; con más de 1 h, la venta suele perderse.",
        recomendacion: saturada
          ? `Que ${nombre} atienda primero estos chats; si no puede, que el dueño decida pasar algunos a otra asesora (el Supervisor NO reasigna).`
          : `Que ${nombre} conteste estos chats ya, empezando por el más antiguo.`,
        comoMedir: "Mediana de espera tras señal fuerte < 15 min.",
      }),
    );
  }

  // A2: con señal y sin dueña.
  const sinDuena = estados.filter((e) => e.esperando && e.senal && !e.chat.asesoraId && e.minutos >= u.sinDuenaMin && e.minutos <= u.retomarDesdeH * 60);
  if (sinDuena.length) {
    const peor = [...sinDuena].sort((a, b) => b.minutos - a.minutos)[0];
    salida.push(
      hallazgoBase({
        clave: "ATENCION:senal-sin-duena",
        severidad: enHorario(ahora, horario) ? "IMPORTANTE" : "OBSERVACION",
        titulo: `${sinDuena.length} chat(s) con señal de compra sin asesora asignada`,
        que: `El más antiguo lleva ${peor.minutos} min${peor.frase ? ` ("${peor.frase}")` : ""}.`,
        desde: peor.chat.ultimoClienteEn as Date,
        leadsAfectados: sinDuena.length,
        evidencia: { chats: sinDuena.slice(0, 10).map((e) => e.chat.conversationId), reglas: [], versiones: [] },
        metrica: "Chats con señal sin dueña",
        esperado: "0",
        observado: String(sinDuena.length),
        hechos: sinDuena.slice(0, 5).map((e) => `Chat ${e.chat.conversationId}: ${e.minutos} min, "${e.frase ?? ""}".`),
        recomendacion: "Asignarlos a mano desde la bandeja (el rescate de huérfanos actúa a los 30 min).",
        comoMedir: "Chats con señal sin dueña = 0.",
      }),
    );
  }

  // A4: oportunidades a retomar (señal fuerte, callado hace 24–72 h, nadie le respondió después).
  const retomar = estados.filter(
    (e) => e.esperando && e.senalFuerte && e.minutos >= u.retomarDesdeH * 60 && e.minutos <= u.retomarHastaH * 60,
  );
  if (retomar.length) {
    salida.push(
      hallazgoBase({
        clave: "ATENCION:oportunidades-a-retomar",
        severidad: "OBSERVACION",
        titulo: `${retomar.length} oportunidad(es) con intención fuerte sin respuesta hace 1–3 días`,
        que: "Clientes que preguntaron cómo separar, pagar o mandaron datos y nadie les respondió después.",
        desde: retomar.map((e) => e.chat.ultimoClienteEn as Date).sort((a, b) => a.getTime() - b.getTime())[0],
        leadsAfectados: retomar.length,
        evidencia: { chats: retomar.slice(0, 15).map((e) => e.chat.conversationId), reglas: [], versiones: [] },
        metrica: "Leads con señal fuerte abandonados",
        esperado: "0",
        observado: String(retomar.length),
        hechos: retomar.slice(0, 5).map((e) => `Chat ${e.chat.conversationId}: callado hace ${Math.round(e.minutos / 60)} h, dijo "${e.frase ?? ""}".`),
        recomendacion: "Incluirlos en el Plan del día de la asesora con un mensaje para retomar (la asesora escribe; el sistema no envía nada).",
        comoMedir: "Que cada uno tenga respuesta humana en 24 h.",
      }),
    );
  }

  // A5: lead interesado asignado a una asesora y sin NINGÚN mensaje humano desde la asignación.
  salida.push(...detectarAsignadoSinRespuesta(chats, ahora, new Set(urgentes.map((e) => e.chat.conversationId))));
  return salida;
}

/** Señales que, aunque solas den Frío, ya son interés suficiente para que una persona escriba. */
const INTERES_DIRECTO = new Set(["pregunta_uso", "fotos_producto", "precio", "precio_producto"]);

export type InteresDelLead = {
  interesado: boolean;
  caliente: boolean;
  /** "Caliente", "Tibio" o "con interés" (precio, fotos de un producto…). */
  nivel: string;
  frase: string | null;
  calificacion: Calificacion;
};

/** ¿El lead mostró interés? Temperatura del seguimiento inteligente, etapa del CRM o sus textos. */
export function interesDelLead(chat: ChatAbierto, ahora: Date): InteresDelLead {
  const textos = [...(chat.textosDelCliente ?? []), ...chat.textosPendientes].filter((t) => t && t.trim());
  const unicos = [...new Set(textos)];
  const en = chat.ultimoClienteEn ?? ahora;
  const familia = unicos.map((t) => familiaDelTexto(t)).find(Boolean) ?? null;
  const calificacion = calificar({ mensajes: unicos.map((texto) => ({ texto, en })), ahora: en, productoInteres: familia, etapaCrm: chat.etapa });
  const base = calificacion.temperaturaBase;
  const guardada = chat.temperatura ?? null;
  const caliente = guardada === "CALIENTE" || chat.etapa === "NEGOCIACION" || base === "CALIENTE";
  const tibio = guardada === "TIBIO" || base === "TIBIO";
  const directa = calificacion.senales.find((s) => INTERES_DIRECTO.has(s.tipo));
  const principal = [...calificacion.senales].filter((s) => s.grupo !== "negativa").sort((a, b) => b.peso - a.peso)[0];
  return {
    interesado: !calificacion.noInteresa && (caliente || tibio || Boolean(directa)),
    caliente: caliente && !calificacion.noInteresa,
    nivel: caliente ? "Caliente" : tibio ? "Tibio" : "con interés",
    frase: (principal ?? directa)?.fragmento ?? null,
    calificacion,
  };
}

/**
 * "LEAD INTERESADO ASIGNADO SIN RESPUESTA HUMANA" (pedido de Alexander, caso cv16c1a0 del 10-oct:
 * "Sirve para pestañas?" + "Fotos", auto-asignado a Ingrid a las 10:22, el bot mandó fotos y precio y
 * dos seguimientos, y ninguna persona escribió en 3 h).
 *
 * Sale cuando: el chat tiene asesora, el lead mostró interés, y NADIE del equipo escribió (CRM o
 * celular) desde la asignación por más de 30 min LABORALES (L–V 8–18, S 9–14, el horario del Coach).
 * IMPORTANTE desde 30 min; CRÍTICO pasadas 2 h si está Caliente. No sale para PERDIDO/GANADO, fuera
 * de Colombia, dormidos, ni si la asesora ya escribió. Los que ya están en "caliente esperando" no se
 * repiten aquí. Agrupa por asesora (un incidente por asesora) y trae el mensaje sugerido.
 */
export function detectarAsignadoSinRespuesta(chats: ChatAbierto[], ahora: Date, yaAvisados: Set<string> = new Set()): Hallazgo[] {
  const u = UMBRALES_ATENCION;
  type Fila = { chat: ChatAbierto; minutos: number; interes: InteresDelLead; sugerido: string };
  const filas: Fila[] = [];
  for (const chat of chats) {
    if (!chat.asesoraId || !chat.asignadaEn || yaAvisados.has(chat.conversationId)) continue;
    // Solo asignaciones de las últimas 24 h: lo más viejo ya es "oportunidad a retomar" o tarea del
    // seguimiento inteligente (la simulación del 10-oct mostró chats de 1–2 días tapando los de hoy).
    if (ahora.getTime() - chat.asignadaEn.getTime() > u.retomarDesdeH * 60 * MIN) continue;
    const motivo = motivoDeExclusion({ ...chat, textos: [...(chat.textosDelCliente ?? []), ...chat.textosPendientes] }, ahora);
    if (motivo === "etapa_cerrada" || motivo === "fuera_de_colombia" || motivo === "dormido") continue;
    // Cualquier mensaje humano desde la asignación (aunque el cliente haya vuelto a escribir) = ya escribió.
    if (chat.ultimaRespuestaHumanaEn && chat.ultimaRespuestaHumanaEn.getTime() >= chat.asignadaEn.getTime()) continue;
    const minutos = minutosLaboralesDelEquipo(chat.asignadaEn, ahora);
    if (minutos < u.asignadoSinRespuestaMin) continue;
    const interes = interesDelLead(chat, ahora);
    if (!interes.interesado) continue;
    const textos = [...(chat.textosDelCliente ?? []), ...chat.textosPendientes];
    const familia = textos.map((t) => familiaDelTexto(t)).find(Boolean) ?? null;
    const sugerido = mensajePorSenales({ nombre: chat.nombreCliente ?? null, producto: nombreDeFamilia(familia), senales: interes.calificacion.senales });
    filas.push({ chat, minutos, interes, sugerido });
  }
  const porAsesora = new Map<string, Fila[]>();
  for (const f of filas) porAsesora.set(f.chat.asesoraId as string, [...(porAsesora.get(f.chat.asesoraId as string) ?? []), f]);
  const salida: Hallazgo[] = [];
  for (const [asesora, lista] of porAsesora) {
    const orden = [...lista].sort((a, b) => Number(b.interes.caliente) - Number(a.interes.caliente) || b.minutos - a.minutos);
    const critico = orden.some((f) => f.interes.caliente && f.minutos > u.asignadoSinRespuestaCriticoMin);
    const peor = [...lista].sort((a, b) => b.minutos - a.minutos)[0];
    const nombre = peor.chat.asesoraNombre ?? asesora;
    salida.push(
      hallazgoBase({
        clave: `ATENCION:asignado-sin-respuesta:${asesora}`,
        severidad: critico ? "CRITICO" : "IMPORTANTE",
        titulo: `${lista.length} lead(s) interesado(s) asignado(s) a ${nombre} sin respuesta humana`,
        que: `El más antiguo lleva ${peor.minutos} min laborales desde que se le asignó y nadie del equipo le ha escrito${peor.interes.frase ? ` ("${peor.interes.frase}")` : ""}. El bot no reemplaza a la asesora.`,
        desde: peor.chat.asignadaEn as Date,
        asesoraId: asesora,
        leadsAfectados: lista.length,
        evidencia: { chats: orden.slice(0, 10).map((f) => f.chat.conversationId), reglas: [], versiones: [] },
        metrica: "Minutos laborales desde la asignación sin ningún mensaje humano (lead con interés)",
        esperado: `< ${u.asignadoSinRespuestaMin} min`,
        observado: orden.slice(0, 5).map((f) => `${f.minutos} min`).join(", "),
        hechos: [
          // Una línea por cada chat de la evidencia: la tarjeta lee de aquí los minutos y la frase.
          ...orden
            .slice(0, 10)
            .map((f) => `Chat ${f.chat.conversationId}: ${f.minutos} min laborales desde la asignación sin mensaje humano, ${f.interes.nivel}${f.interes.frase ? `, dijo "${f.interes.frase}"` : ""}.`),
          ...orden.slice(0, 3).map((f) => `Mensaje sugerido para el chat ${f.chat.conversationId}: ${f.sugerido}`),
        ],
        hipotesis: [],
        causaPosible: "La asesora no vio la asignación o está atendiendo otros chats; el bot contestó y el chat no quedó como pendiente.",
        impacto: "Un lead que pregunta por su servicio o pide fotos de un producto y no recibe a una persona en la primera hora casi nunca compra.",
        recomendacion: `Que ${nombre} le escriba ya a cada uno, empezando por ${critico ? "los calientes" : "el más antiguo"}. Mensaje sugerido: ${orden[0].sugerido}`,
        comoMedir: "Primer mensaje humano en menos de 30 min laborales desde la asignación.",
        valores: { minutosMaximo: peor.minutos, calientes: lista.filter((f) => f.interes.caliente).length },
      }),
    );
  }
  return salida;
}
