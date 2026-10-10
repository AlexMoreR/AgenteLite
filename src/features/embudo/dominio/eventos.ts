/**
 * LOS EVENTOS DEL EMBUDO y cómo cambian la foto de cada lead (Embudo F1).
 *
 * Todo esto es código puro —sin base, sin Next—: lo usan el registro en vivo
 * (servicios/eventos.ts), el relleno histórico (dominio/relleno.ts) y las pruebas
 * (scripts/check-embudo.mjs). Así el pasado y el presente se cuentan con la MISMA regla.
 */

import { mensajeConContenido } from "../../../lib/turno-con-contenido";
import { hayMezcla } from "./combo";
import { detectarSenales, motivoDelPuntaje, puntajeSombra, type Senal, type TipoDeSenal } from "./senales";

export const TIPOS_DE_EVENTO = [
  "ENTRADA",
  "BIENVENIDA_ENVIADA",
  "CLIENTE_RESPONDIO",
  "PASO_ENTRA",
  "RECOMENDACION_ENVIADA",
  "ACEPTO_INFO",
  "SENAL",
  "TURNO_V3",
  "SEGUIMIENTO_ENVIADO",
  /** Un automático que NO salió (o se corrió) por el anti-bloqueo o el freno. No toca la foto del lead. */
  "SEGUIMIENTO_FRENADO",
  "TEMPERATURA",
  "ETAPA_CRM",
  "ESCALADO",
  "ASIGNADA",
  "ASESORA_RESPONDIO",
  "COTIZACION",
  "ANTICIPO",
  "VENTA",
  "INCUMPLIMIENTO",
  /** F2 seguimiento inteligente: lo que el motor decidió (o habría decidido, en sombra). */
  "SIGUIENTE_ACCION",
  /** F2: se agendó un mensaje útil del producto. */
  "MENSAJE_UTIL",
  /** F2: teléfono fuera de Colombia (se excluye de métricas y seguimientos). */
  "EXTERIOR",
  /** F2: descarte por la cadencia (3 toques sin respuesta), hecho o "habría descartado" en sombra. */
  "DESCARTE_CADENCIA",
] as const;

export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number];

export type OrigenDeEvento = "motor" | "reloj" | "asesora" | "gestion" | "backfill" | "webhook";

export const PASOS = ["PRESENTACION", "IDENTIFICACION", "PRODUCTO", "OBJECIONES", "CIERRE"] as const;
export type Paso = (typeof PASOS)[number];

export function ordenDelPaso(paso: string | null | undefined): number {
  return paso ? PASOS.indexOf(paso as Paso) : -1;
}

/** El más avanzado de los dos (PRESENTACION < IDENTIFICACION < PRODUCTO < OBJECIONES < CIERRE). */
export function pasoMayor(a: string | null | undefined, b: string | null | undefined): string | null {
  const ia = ordenDelPaso(a);
  const ib = ordenDelPaso(b);
  if (ia < 0 && ib < 0) return a ?? b ?? null;
  return ib > ia ? (b as string) : (a as string);
}

/** Un evento listo para guardar. `producto` ya viene como clave del embudo ("combo-camilla" o id). */
export type EventoDelEmbudo = {
  tipo: TipoDeEvento;
  origen: OrigenDeEvento;
  paso?: string | null;
  producto?: string | null;
  reglaId?: string | null;
  reglaNombre?: string | null;
  libroVersion?: number | null;
  datos?: Record<string, unknown> | null;
  claveUnica?: string | null;
  createdAt?: Date;
};

/**
 * Lo que el motor V3 cuenta de un turno (ver ResultadoV3.traza en agente-v3/motor/ejecutar.ts).
 * Va como tipo estructural para no atar el dominio del embudo al motor.
 */
export type TrazaDelTurno = {
  libroVersion: number | null;
  antes: { pasoActual: string | null; producto: string | null; esPrimerMensaje: boolean } | null;
  despues: { pasoActual: string | null; producto: string | null } | null;
  intenciones: string[];
  tiposDeAccion: string[];
  conSaludo: boolean;
  envioFlujo: boolean;
  mensajesEnviados: number;
  reglaId: string | null;
  reglaNombre: string | null;
  cuando: string;
};

/**
 * Los eventos de un turno del V3, sin tocar nada: qué pasó según la traza del motor.
 *
 * - BIENVENIDA_ENVIADA: primer turno con saludo que de verdad salió.
 * - CLIENTE_RESPONDIO: la clienta ya había recibido algo y escribió CON contenido (no "hola",
 *   "ok", un emoji) — con el paso en que estaba.
 * - PASO_ENTRA: cambió de paso (o de producto).
 * - RECOMENDACION_ENVIADA: salió un flujo o entró a PRODUCTO.
 * - SENAL: una por señal de compra del texto de la clienta.
 * - TURNO_V3: siempre, con cuántos mensajes salieron y qué acciones hubo.
 *
 * `producto` de antes/después es el id del V3; quien llama lo traduce con `claveProducto`.
 */
export function eventosDelTurno(input: {
  conversationId: string;
  traza: TrazaDelTurno;
  atendido: boolean;
  mensajeCliente: string;
  tipoMensaje?: string | null;
  claveProducto?: (productoId: string | null) => string | null;
  origen?: OrigenDeEvento;
  /** Para que el relleno histórico sea idempotente (id del mensaje / nota de la vuelta). */
  idDelTurno?: string | null;
  cuando?: Date;
  /**
   * Sacar las señales del texto del turno. En vivo las señales salen de CADA mensaje entrante en
   * el webhook (también cuando el bot está en pausa), así que el turno solo las saca de un audio
   * transcrito, que el webhook todavía no tenía en texto.
   */
  incluirSenales?: boolean;
}): EventoDelEmbudo[] {
  const { traza, conversationId } = input;
  const origen = input.origen ?? "motor";
  const clave = input.claveProducto ?? ((id: string | null) => id);
  const cuando = input.cuando ?? new Date(traza.cuando);
  const antesPaso = traza.antes?.pasoActual ?? null;
  const antesProducto = traza.antes?.producto ?? null;
  const despuesPaso = traza.despues?.pasoActual ?? antesPaso;
  const despuesProducto = traza.despues?.producto ?? antesProducto;
  const productoDespues = clave(despuesProducto);
  const comun = {
    origen,
    libroVersion: traza.libroVersion,
    reglaId: traza.reglaId,
    reglaNombre: traza.reglaNombre,
    createdAt: cuando,
  };
  const eventos: EventoDelEmbudo[] = [];
  const sufijo = input.idDelTurno ? `:${input.idDelTurno}` : "";

  const esPrimero = traza.antes?.esPrimerMensaje === true;
  if (esPrimero && traza.conSaludo && traza.mensajesEnviados > 0) {
    eventos.push({
      ...comun,
      tipo: "BIENVENIDA_ENVIADA",
      paso: "PRESENTACION",
      producto: productoDespues,
      claveUnica: `BIENVENIDA:${conversationId}`,
    });
  }

  const conContenido = mensajeConContenido({ type: input.tipoMensaje ?? "TEXT", content: input.mensajeCliente });
  if (!esPrimero && traza.antes && conContenido) {
    const paso = antesPaso ?? "PRESENTACION";
    eventos.push({
      ...comun,
      tipo: "CLIENTE_RESPONDIO",
      paso,
      producto: clave(antesProducto),
      // Una por paso y por chat: el panel pregunta "¿contestó en este paso?", no cuántas veces.
      claveUnica: `RESPONDIO:${conversationId}:${paso}`,
    });
  }

  if (despuesPaso && (despuesPaso !== antesPaso || (despuesProducto && despuesProducto !== antesProducto))) {
    eventos.push({
      ...comun,
      tipo: "PASO_ENTRA",
      paso: despuesPaso,
      producto: productoDespues,
      datos: { desde: antesPaso, productoAntes: clave(antesProducto) },
      claveUnica: `PASO:${conversationId}:${productoDespues ?? "-"}:${despuesPaso}`,
    });
  }

  if (traza.envioFlujo || (despuesPaso === "PRODUCTO" && antesPaso !== "PRODUCTO")) {
    eventos.push({
      ...comun,
      tipo: "RECOMENDACION_ENVIADA",
      paso: despuesPaso,
      producto: productoDespues,
      datos: { flujo: traza.envioFlujo },
      claveUnica: `RECOMENDACION:${conversationId}`,
    });
  }

  for (const senal of input.incluirSenales === false ? [] : detectarSenales(input.mensajeCliente)) {
    eventos.push({
      ...comun,
      tipo: "SENAL",
      paso: antesPaso,
      producto: clave(antesProducto),
      datos: { senal: senal.tipo, grupo: senal.grupo, peso: senal.peso, fragmento: senal.fragmento },
      claveUnica: sufijo ? `SENAL:${conversationId}${sufijo}:${senal.tipo}` : null,
    });
  }

  eventos.push({
    ...comun,
    tipo: "TURNO_V3",
    paso: despuesPaso,
    producto: productoDespues,
    datos: {
      atendido: input.atendido,
      mensajes: traza.mensajesEnviados,
      acciones: traza.tiposDeAccion,
      intenciones: traza.intenciones,
      pasoAntes: antesPaso,
    },
    claveUnica: sufijo ? `TURNO:${conversationId}${sufijo}` : null,
  });

  return eventos;
}

/* ------------------------------------------------------------------------------------------------
   LA FOTO DEL LEAD
------------------------------------------------------------------------------------------------ */

export type SenalGuardada = { tipo: TipoDeSenal; fragmento: string; en: string };

export type FotoDelLead = {
  conversationId: string;
  contactId: string;
  workspaceId: string;
  channelId: string;
  productoEntrada: string | null;
  productoActual: string | null;
  mezcla: boolean;
  anuncioId: string | null;
  anuncioTitulo: string | null;
  anuncioRed: string | null;
  entradaEn: Date;
  libroVersionEntrada: number | null;
  pasoActual: string | null;
  pasoMaximo: string | null;
  temperatura: string | null;
  puntaje: number | null;
  motivo: string | null;
  senales: SenalGuardada[] | null;
  transferencia: string;
  asignadaA: string | null;
  asignadaEn: Date | null;
  primeraRespuestaAsesoraEn: Date | null;
  ultimoClienteEn: Date | null;
  ultimoBotEn: Date | null;
  cotizacionRef: string | null;
  cotizacionEn: Date | null;
  anticipoEn: Date | null;
  ventaEn: Date | null;
  /* F2 (seguimiento inteligente). Opcionales: el relleno histórico de F1 no los conoce. */
  productoInteres?: string | null;
  temperaturaEn?: Date | null;
  accion?: string | null;
  accionDatos?: Record<string, unknown> | null;
  accionEn?: Date | null;
  tareaPrioridad?: string | null;
  tareaVence?: Date | null;
  mensajesUtiles?: number;
  exterior?: boolean;
  dormidoHasta?: Date | null;
  fechaCompra?: Date | null;
};

export type ContextoDelLead = {
  conversationId: string;
  contactId: string;
  workspaceId: string;
  channelId: string;
  /** Cuándo empezó la charla: la entrada si el lead nace de un evento que no es ENTRADA. */
  inicioDeLaCharla: Date;
};

export function leadVacio(contexto: ContextoDelLead): FotoDelLead {
  return {
    conversationId: contexto.conversationId,
    contactId: contexto.contactId,
    workspaceId: contexto.workspaceId,
    channelId: contexto.channelId,
    productoEntrada: null,
    productoActual: null,
    mezcla: false,
    anuncioId: null,
    anuncioTitulo: null,
    anuncioRed: null,
    entradaEn: contexto.inicioDeLaCharla,
    libroVersionEntrada: null,
    pasoActual: null,
    pasoMaximo: null,
    temperatura: null,
    puntaje: null,
    motivo: null,
    senales: null,
    transferencia: "NO",
    asignadaA: null,
    asignadaEn: null,
    primeraRespuestaAsesoraEn: null,
    ultimoClienteEn: null,
    ultimoBotEn: null,
    cotizacionRef: null,
    cotizacionEn: null,
    anticipoEn: null,
    ventaEn: null,
  };
}

function masTarde(a: Date | null, b: Date): Date {
  return a && a.getTime() > b.getTime() ? a : b;
}

function masTemprano(a: Date | null, b: Date): Date {
  return a && a.getTime() < b.getTime() ? a : b;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Hasta cuántas señales se guardan en la foto (las primeras de cada tipo). */
const MAXIMO_DE_SENALES = 20;

/**
 * Cómo queda la foto del lead después de un evento. Pura: recibe la foto anterior (o null si el
 * lead no existía) y devuelve la nueva. Nunca baja el paso máximo ni deshace una asignación.
 */
export function aplicarEvento(anterior: FotoDelLead | null, evento: EventoDelEmbudo, contexto: ContextoDelLead): FotoDelLead {
  const lead: FotoDelLead = anterior ? { ...anterior } : leadVacio(contexto);
  const cuando = evento.createdAt ?? new Date();
  const datos = evento.datos ?? {};

  // El producto que trae cualquier evento cuenta como "actual" (y como entrada si no había).
  if (evento.producto && evento.tipo !== "ENTRADA") {
    lead.productoActual = evento.producto;
    if (!lead.productoEntrada) lead.productoEntrada = evento.producto;
  }
  if (evento.paso && ordenDelPaso(evento.paso) >= 0 && evento.tipo !== "SENAL" && evento.tipo !== "CLIENTE_RESPONDIO") {
    lead.pasoActual = evento.paso;
  }
  if (evento.paso && ordenDelPaso(evento.paso) >= 0) {
    lead.pasoMaximo = pasoMayor(lead.pasoMaximo, evento.paso);
  }

  switch (evento.tipo) {
    case "ENTRADA": {
      lead.entradaEn = anterior ? masTemprano(lead.entradaEn, cuando) : cuando;
      lead.anuncioId = lead.anuncioId ?? texto(datos.anuncioId);
      lead.anuncioTitulo = lead.anuncioTitulo ?? texto(datos.anuncioTitulo);
      lead.anuncioRed = lead.anuncioRed ?? texto(datos.anuncioRed);
      if (evento.producto) {
        lead.productoEntrada = evento.producto;
        lead.productoActual = lead.productoActual ?? evento.producto;
      }
      lead.libroVersionEntrada = lead.libroVersionEntrada ?? evento.libroVersion ?? null;
      lead.ultimoClienteEn = masTarde(lead.ultimoClienteEn, cuando);
      break;
    }
    case "BIENVENIDA_ENVIADA":
    case "SEGUIMIENTO_ENVIADO":
    case "RECOMENDACION_ENVIADA":
      lead.ultimoBotEn = masTarde(lead.ultimoBotEn, cuando);
      break;
    case "CLIENTE_RESPONDIO":
      lead.ultimoClienteEn = masTarde(lead.ultimoClienteEn, cuando);
      break;
    case "TURNO_V3": {
      // Hubo turno = la clienta escribió; si salió algo, también habló el bot.
      lead.ultimoClienteEn = masTarde(lead.ultimoClienteEn, cuando);
      if (typeof datos.mensajes === "number" && datos.mensajes > 0) {
        lead.ultimoBotEn = masTarde(lead.ultimoBotEn, cuando);
      }
      if (lead.libroVersionEntrada === null && typeof evento.libroVersion === "number") {
        lead.libroVersionEntrada = evento.libroVersion;
      }
      break;
    }
    case "SENAL": {
      const tipo = texto(datos.senal) as TipoDeSenal | null;
      if (tipo) {
        const lista = [...(lead.senales ?? [])];
        if (!lista.some((senal) => senal.tipo === tipo) && lista.length < MAXIMO_DE_SENALES) {
          lista.push({ tipo, fragmento: texto(datos.fragmento) ?? "", en: cuando.toISOString() });
        }
        lead.senales = lista;
        // Con la calificación F2 prendida, el puntaje y el motivo son los de F2 (con caída por
        // silencio y señales extra): la señal suelta ya no los pisa.
        if (!lead.temperaturaEn) {
          lead.puntaje = puntajeSombra(lista.map((senal) => senal.tipo));
          lead.motivo = motivoDelPuntaje(lista, lead.puntaje);
        }
      }
      break;
    }
    case "TEMPERATURA": {
      const temperatura = texto(datos.temperatura);
      if (temperatura) lead.temperatura = temperatura;
      if (typeof datos.puntaje === "number") lead.puntaje = datos.puntaje;
      lead.motivo = texto(datos.motivo) ?? lead.motivo;
      if ("productoInteres" in datos) lead.productoInteres = texto(datos.productoInteres);
      lead.temperaturaEn = cuando;
      break;
    }
    case "SIGUIENTE_ACCION": {
      lead.accion = texto(datos.accion);
      lead.accionDatos = datos;
      lead.accionEn = cuando;
      lead.tareaPrioridad = lead.accion === "tarea_asesora" ? texto(datos.prioridad) : null;
      const vence = texto(datos.vence);
      lead.tareaVence = lead.accion === "tarea_asesora" && vence ? new Date(vence) : null;
      const dormido = texto(datos.dormidoHasta);
      lead.dormidoHasta = lead.accion === "dormido" && dormido ? new Date(dormido) : null;
      const compra = texto(datos.fechaCompra);
      if (compra) lead.fechaCompra = new Date(compra);
      break;
    }
    case "MENSAJE_UTIL":
      lead.mensajesUtiles = (lead.mensajesUtiles ?? 0) + 1;
      lead.ultimoBotEn = masTarde(lead.ultimoBotEn, cuando);
      break;
    case "EXTERIOR":
      lead.exterior = true;
      break;
    case "ESCALADO":
      if (lead.transferencia !== "ASIGNADA") lead.transferencia = "ESCALADO";
      break;
    case "ASIGNADA":
      lead.transferencia = "ASIGNADA";
      lead.asignadaA = texto(datos.asesora) ?? lead.asignadaA;
      lead.asignadaEn = lead.asignadaEn ?? cuando;
      break;
    case "ASESORA_RESPONDIO":
      lead.primeraRespuestaAsesoraEn = lead.primeraRespuestaAsesoraEn
        ? masTemprano(lead.primeraRespuestaAsesoraEn, cuando)
        : cuando;
      break;
    case "COTIZACION":
      lead.cotizacionRef = lead.cotizacionRef ?? texto(datos.cotizacion);
      lead.cotizacionEn = lead.cotizacionEn ?? cuando;
      break;
    case "ANTICIPO":
      lead.anticipoEn = lead.anticipoEn ?? cuando;
      break;
    case "VENTA":
      lead.ventaEn = lead.ventaEn ?? cuando;
      lead.cotizacionRef = lead.cotizacionRef ?? texto(datos.cotizacion);
      break;
    default:
      break;
  }

  lead.mezcla = hayMezcla({
    mezclaAntes: anterior?.mezcla,
    productoEntrada: lead.productoEntrada,
    productoActual: lead.productoActual,
  });
  return lead;
}

/** Las señales de un texto como eventos SENAL (las usa el relleno histórico). */
export function eventosDeSenales(input: {
  conversationId: string;
  texto: string;
  paso: string | null;
  producto: string | null;
  origen: OrigenDeEvento;
  idDelMensaje?: string | null;
  cuando: Date;
}): EventoDelEmbudo[] {
  return detectarSenales(input.texto).map((senal: Senal) => ({
    tipo: "SENAL" as const,
    origen: input.origen,
    paso: input.paso,
    producto: input.producto,
    datos: { senal: senal.tipo, grupo: senal.grupo, peso: senal.peso, fragmento: senal.fragmento },
    claveUnica: input.idDelMensaje ? `SENAL:${input.conversationId}:${input.idDelMensaje}:${senal.tipo}` : null,
    createdAt: input.cuando,
  }));
}
