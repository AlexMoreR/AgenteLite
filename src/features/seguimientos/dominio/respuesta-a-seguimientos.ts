/**
 * % DE RESPUESTA A LOS SEGUIMIENTOS AUTOMATICOS (pedido del dueño, 6-nov-2026). Codigo puro, sin base.
 *
 * Para medir "seguimiento al proyecto, no a la venta": compara dos rangos de fechas (por defecto la base
 * del 2 al 6 de nov contra lo de despues) y dice que % de los seguimientos automaticos tuvo respuesta.
 *  - Solo seguimientos automaticos: los del reloj del V3 y los follows de reglas o etapas
 *    (`clasificarFollow` = "automatico"). Los manuales, campañas y automatizaciones no cuentan.
 *  - Solo a clientes que YA habian respondido la bienvenida antes de ese seguimiento (a los demas les
 *    sale el texto fijo de la regla, T-599: no cambian con esta tarea).
 *  - Respondio = el cliente escribio (texto, audio o foto) dentro de las 24 h siguientes y antes del
 *    siguiente seguimiento del mismo chat.
 *  - Se separa en texto de la IA y texto fijo (o de respaldo).
 *  - Con menos de 30 envios en un grupo el % no se da: "faltan datos".
 * Compara dos semanas distintas, sin grupo de control: no prueba la causa.
 */

import { clasificarFollow } from "@/lib/anti-bloqueo/reglas";
import { clienteRespondioLaBienvenida } from "@/features/seguimientos/dominio/sin-respuesta-a-la-bienvenida";

/** Rango de la base (antes del cambio), hora de Bogota, incluidos los dos dias. */
export const BASE_POR_DEFECTO = { desde: "2026-11-02", hasta: "2026-11-06" } as const;
/** Desde cuando se mide "despues" si no se dice. */
export const DESPUES_POR_DEFECTO_DESDE = "2026-11-07";

/** Envios minimos de un grupo para dar su %. */
export const ENVIOS_MINIMOS = 30;
/** Ventana para contar una respuesta. */
export const VENTANA_DE_RESPUESTA_MS = 24 * 60 * 60 * 1000;
/** Un follow cuenta como el de un mensaje si se ejecuto a menos de esto del mensaje. */
export const TOLERANCIA_DEL_FOLLOW_MS = 10 * 60 * 1000;
/** Rango maximo que se puede pedir (dias). */
export const DIAS_MAXIMOS_POR_RANGO = 62;

/** Lo que cuenta como respuesta del cliente (igual que la bienvenida). */
const TIPOS_DE_RESPUESTA = new Set(["TEXT", "AUDIO", "IMAGE"]);

const FALTAN_DATOS = `faltan datos (menos de ${ENVIOS_MINIMOS} envíos)`;

/* ----------------------------------------------------------------------------------------------
   Fechas (dias AAAA-MM-DD en hora de Bogota, UTC-5 todo el año)
---------------------------------------------------------------------------------------------- */

export function esDia(valor: unknown): valor is string {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T12:00:00.000Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

/** El dia de Bogota de una fecha. */
export function diaDeBogota(fecha: Date): string {
  return new Date(fecha.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type Rango = { desde: string; hasta: string };

/** Inicio y fin (incluido) del rango en milisegundos. */
export function limitesDelRango(rango: Rango): { inicio: number; fin: number } {
  return {
    inicio: new Date(`${rango.desde}T00:00:00.000-05:00`).getTime(),
    fin: new Date(`${rango.hasta}T23:59:59.999-05:00`).getTime(),
  };
}

/** Errores del rango (vacio = valido). */
export function erroresDelRango(nombre: string, rango: Rango): string[] {
  if (!esDia(rango.desde) || !esDia(rango.hasta)) return [`${nombre}: las fechas van como AAAA-MM-DD.`];
  const { inicio, fin } = limitesDelRango(rango);
  if (inicio > fin) return [`${nombre}: «desde» (${rango.desde}) va después de «hasta» (${rango.hasta}).`];
  const dias = Math.round((fin - inicio) / 86_400_000);
  if (dias > DIAS_MAXIMOS_POR_RANGO) return [`${nombre}: máximo ${DIAS_MAXIMOS_POR_RANGO} días por rango (pediste ${dias}).`];
  return [];
}

/* ----------------------------------------------------------------------------------------------
   Que seguimiento es automatico
---------------------------------------------------------------------------------------------- */

/** Un mensaje de seguimiento enviado (rawPayload.source en ORIGENES_DE_SEGUIMIENTO). */
export type SeguimientoEnviado = {
  conversationId: string;
  contactId: string | null;
  en: Date;
  /** "follow", "agente-v3-seguimiento" o "agente-v3-seguimiento-ia". */
  origen: string;
  /** rawPayload.seguimientoQueEscucha.deIA (null = sin marca: salio el texto fijo). */
  marcaDeIA: boolean | null;
};

/** Un follow ejecutado, para saber si el mensaje "follow" fue automatico. */
export type FollowEjecutado = {
  contactId: string;
  name: string | null;
  followRuleId: string | null;
  executedAt: Date;
};

/**
 * ¿Es un seguimiento automatico? Los del reloj del V3 siempre. Un "follow" solo si el follow del mismo
 * contacto que se ejecuto mas cerca (a menos de 10 min) es de la clase "automatico". null = no se
 * encontro su follow (no se cuenta).
 */
export function esAutomatico(envio: SeguimientoEnviado, follows: readonly FollowEjecutado[]): boolean | null {
  if (envio.origen === "agente-v3-seguimiento" || envio.origen === "agente-v3-seguimiento-ia") return true;
  if (envio.origen !== "follow" || !envio.contactId) return null;
  let elMasCerca: FollowEjecutado | null = null;
  let distancia = Infinity;
  for (const follow of follows) {
    if (follow.contactId !== envio.contactId) continue;
    const d = Math.abs(follow.executedAt.getTime() - envio.en.getTime());
    if (d <= TOLERANCIA_DEL_FOLLOW_MS && d < distancia) {
      elMasCerca = follow;
      distancia = d;
    }
  }
  if (!elMasCerca) return null;
  return clasificarFollow({ name: elMasCerca.name, followRuleId: elMasCerca.followRuleId }) === "automatico";
}

/** ¿Lo escribio la IA? El origen del V3 con IA o la marca del redactor. */
export function esDeIA(envio: SeguimientoEnviado): boolean {
  return envio.origen === "agente-v3-seguimiento-ia" || envio.marcaDeIA === true;
}

/* ----------------------------------------------------------------------------------------------
   La medicion de un rango
---------------------------------------------------------------------------------------------- */

/** Un mensaje del chat (sin contenido): para la bienvenida y para ver si respondio. */
export type MensajeDelChat = { direction: string; type: string; createdAt: Date };

export type Grupo = {
  envios: number;
  respondieron: number;
  /** % con un decimal, o "faltan datos" con menos de 30 envios. */
  porcentaje: number | string;
};

export type MedicionDelRango = {
  desde: string;
  hasta: string;
  total: Grupo;
  texto_de_ia: Grupo;
  texto_fijo: Grupo;
  /** Lo que no entra en la cuenta, y por que. */
  no_se_cuentan: {
    no_habia_respondido_la_bienvenida: number;
    no_automaticos: number;
    sin_su_follow: number;
    todavia_sin_24_horas: number;
  };
};

function grupo(envios: number, respondieron: number): Grupo {
  return {
    envios,
    respondieron,
    porcentaje: envios < ENVIOS_MINIMOS ? FALTAN_DATOS : Math.round((respondieron / envios) * 1000) / 10,
  };
}

/**
 * Mide un rango. `seguimientos` son los mensajes de seguimiento de los chats (tambien los de hasta
 * 24 h despues del rango: el siguiente seguimiento corta la ventana). `mensajesPorChat`, todos los mensajes de
 * cada chat (para la bienvenida y la respuesta). `ahora`, para no contar como "no respondio" un
 * seguimiento cuyas 24 h no han pasado.
 */
export function medirRango(input: {
  rango: Rango;
  seguimientos: readonly SeguimientoEnviado[];
  follows: readonly FollowEjecutado[];
  mensajesPorChat: ReadonlyMap<string, readonly MensajeDelChat[]>;
  ahora: Date;
}): MedicionDelRango {
  const { inicio, fin } = limitesDelRango(input.rango);
  const porChat = new Map<string, SeguimientoEnviado[]>();
  for (const s of input.seguimientos) {
    const lista = porChat.get(s.conversationId) ?? [];
    lista.push(s);
    porChat.set(s.conversationId, lista);
  }
  for (const lista of porChat.values()) lista.sort((a, b) => a.en.getTime() - b.en.getTime());
  // Los follows por contacto, para no recorrerlos todos en cada envio.
  const followsPorContacto = new Map<string, FollowEjecutado[]>();
  for (const f of input.follows) {
    const lista = followsPorContacto.get(f.contactId) ?? [];
    lista.push(f);
    followsPorContacto.set(f.contactId, lista);
  }

  const cuenta = { ia: { envios: 0, respondieron: 0 }, fijo: { envios: 0, respondieron: 0 } };
  const noSeCuentan = { no_habia_respondido_la_bienvenida: 0, no_automaticos: 0, sin_su_follow: 0, todavia_sin_24_horas: 0 };

  for (const [conversationId, lista] of porChat) {
    const mensajes = input.mensajesPorChat.get(conversationId) ?? [];
    for (const envio of lista) {
      const en = envio.en.getTime();
      if (en < inicio || en > fin) continue;

      const auto = esAutomatico(envio, followsPorContacto.get(envio.contactId ?? "") ?? []);
      if (auto === null) {
        noSeCuentan.sin_su_follow += 1;
        continue;
      }
      if (!auto) {
        noSeCuentan.no_automaticos += 1;
        continue;
      }
      if (!clienteRespondioLaBienvenida(mensajes.filter((m) => m.createdAt.getTime() < en))) {
        noSeCuentan.no_habia_respondido_la_bienvenida += 1;
        continue;
      }

      // La ventana: 24 h, o hasta el siguiente seguimiento del chat si sale antes.
      const siguiente = lista.find((otro) => otro.en.getTime() > en);
      const limite = Math.min(en + VENTANA_DE_RESPUESTA_MS, siguiente ? siguiente.en.getTime() : Infinity);
      const respondio = mensajes.some(
        (m) => m.direction === "INBOUND" && TIPOS_DE_RESPUESTA.has(m.type) && m.createdAt.getTime() > en && m.createdAt.getTime() <= limite,
      );
      if (!respondio && !siguiente && en + VENTANA_DE_RESPUESTA_MS > input.ahora.getTime()) {
        noSeCuentan.todavia_sin_24_horas += 1;
        continue;
      }

      const destino = esDeIA(envio) ? cuenta.ia : cuenta.fijo;
      destino.envios += 1;
      if (respondio) destino.respondieron += 1;
    }
  }

  return {
    desde: input.rango.desde,
    hasta: input.rango.hasta,
    total: grupo(cuenta.ia.envios + cuenta.fijo.envios, cuenta.ia.respondieron + cuenta.fijo.respondieron),
    texto_de_ia: grupo(cuenta.ia.envios, cuenta.ia.respondieron),
    texto_fijo: grupo(cuenta.fijo.envios, cuenta.fijo.respondieron),
    no_se_cuentan: noSeCuentan,
  };
}

/** Diferencia en puntos (despues - antes) de un grupo, o el motivo si no se puede. */
export function diferenciaEnPuntos(antes: Grupo, despues: Grupo): number | string {
  if (typeof antes.porcentaje !== "number" || typeof despues.porcentaje !== "number") return FALTAN_DATOS;
  return Math.round((despues.porcentaje - antes.porcentaje) * 10) / 10;
}

/** Una frase para decir por voz. */
export function resumenParaDecir(base: MedicionDelRango, despues: MedicionDelRango): string {
  const frase = (m: MedicionDelRango) =>
    typeof m.total.porcentaje === "number"
      ? `del ${m.desde} al ${m.hasta} contestó el ${m.total.porcentaje} % (${m.total.respondieron} de ${m.total.envios})`
      : `del ${m.desde} al ${m.hasta} faltan datos (${m.total.envios} envíos)`;
  const dif = diferenciaEnPuntos(base.total, despues.total);
  const cambio =
    typeof dif === "number" ? ` La diferencia es de ${dif > 0 ? "+" : ""}${dif} puntos; compara dos semanas distintas, no prueba la causa.` : "";
  return `Seguimientos automáticos a clientes que ya habían respondido: ${frase(base)}; ${frase(despues)}.${cambio}`;
}
