/**
 * DETECTORES DE ATENCIÓN (código puro, deterministas, sin IA). Los corre el chequeo ligero de cada
 * 5 minutos sobre los chats abiertos.
 *
 * SOLO ALERTAN. Nunca reasignan, nunca escriben al cliente, nunca mueven etapas: eso lo decide una
 * persona (o el Director, en otra fase).
 */

import { detectarSenales } from "../../embudo/dominio/senales";
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
  const cualquiera = senales.find((s) => s.grupo !== "negativa");
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
  return salida;
}
