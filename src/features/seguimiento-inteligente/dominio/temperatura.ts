/**
 * F2: CALIFICACIÓN FRÍO / TIBIO / CALIENTE con puntaje y MOTIVO (código puro).
 *
 * Reutiliza el detector de señales del embudo F1 (embudo/dominio/senales.ts) con los pesos del
 * diseño (+4 fuerte, +2 media, +1 débil, negativas) y suma lo que pidió Alexander para el
 * seguimiento inteligente:
 *  - CALIENTE también si ELIGIÓ COLOR ("en negro") o pide 2 o más unidades.
 *  - TIBIO si pregunta el precio de un producto concreto (con el producto identificado).
 *  - Caída por silencio: −1 por cada 24 h sin escribir (no baja una cotización ni un Caliente que
 *    puso una persona en el CRM).
 *
 * El motivo guarda las 3 señales que más pesan con el texto del cliente.
 */

import {
  TIPOS_DE_SENAL,
  UMBRAL_CALIENTE,
  UMBRAL_TIBIO,
  detectarSenales,
  normalizarConservando,
  temperaturaDelPuntaje,
  type Temperatura,
} from "../../embudo/dominio/senales";
import { familiaDelTexto, nombreDeFamilia } from "./producto";

export type { Temperatura };

export type MensajeDelCliente = { texto: string; en: Date };

export type SenalCalificada = {
  tipo: string;
  etiqueta: string;
  peso: number;
  grupo: "fuerte" | "media" | "debil" | "negativa";
  fragmento: string;
  en: Date;
};

export type Calificacion = {
  temperatura: Temperatura;
  /** Con la caída por silencio (lo que se muestra). */
  puntaje: number;
  /** Sin la caída: la temperatura con la que terminó de hablar (la usa el motor para las tareas). */
  puntajeBase: number;
  temperaturaBase: Temperatura;
  motivo: string;
  senales: SenalCalificada[];
  noInteresa: boolean;
  diasDeSilencio: number;
};

const PESOS = new Map(TIPOS_DE_SENAL.map((s) => [s.tipo as string, s]));

const EXTRAS: Record<string, { etiqueta: string; peso: number; grupo: SenalCalificada["grupo"] }> = {
  eligio_color: { etiqueta: "eligió color", peso: 4, grupo: "fuerte" },
  varias_unidades: { etiqueta: "pide 2 o más unidades", peso: 4, grupo: "fuerte" },
  precio_producto: { etiqueta: "preguntó el precio de un producto concreto", peso: 2, grupo: "media" },
};

const COLORES = /\b(negr[oa]s?|blanc[oa]s?|rosad[oa]s?|rosa|beige|gris|dorad[oa]s?|nude|palo de rosa|azul|rojo|roja|vinotinto|cafe|marfil|crema|plateado|plateada|verde|morado|lila|fucsia)\b/;
const PREGUNTA_DE_COLOR = /\?|\b(que|cuales|q|hay|tienen|manejan|viene|vienen|otros?) (colores|color)\b|\bcolores\b/;

/** "En negro", "el blanco", "negra porfa": eligió (no preguntó qué colores hay). */
export function eligioColor(texto: string): string | null {
  const normal = normalizarConservando(texto).replace(/\s+/g, " ").trim();
  if (normal.length > 60 || PREGUNTA_DE_COLOR.test(normal)) return null;
  const m = COLORES.exec(normal);
  return m ? texto.slice(Math.max(0, m.index - 15), m.index + m[0].length + 15).trim() : null;
}

const UNIDADES =
  /\b([2-9]|\d{2}|dos|tres|cuatro|cinco|seis|siete|ocho|diez|doce|varias|varios)\s+(camillas?|combos?|sillas?|butacos?|lavacabezas|mesas?|poltronas?|unidades|tocadores?|carritos?|escaleras?|puestos?)\b/;

export function variasUnidades(texto: string): string | null {
  const normal = normalizarConservando(texto).replace(/\s+/g, " ");
  const m = UNIDADES.exec(normal);
  return m ? texto.slice(Math.max(0, m.index - 10), m.index + m[0].length + 10).trim() : null;
}

function nombreDeTemperatura(t: Temperatura): string {
  return t === "CALIENTE" ? "Caliente" : t === "TIBIO" ? "Tibio" : "Frío";
}

/**
 * La calificación de un lead con TODO lo que escribió (del más viejo al más nuevo).
 * Cada tipo de señal cuenta una vez (la más reciente queda como ejemplo).
 */
export function calificar(input: {
  mensajes: MensajeDelCliente[];
  ahora: Date;
  /** La familia de producto identificada (del V3 o de lo que nombró). */
  productoInteres: string | null;
  cotizacionEn?: Date | null;
  etapaCrm?: string | null;
  caidaPorDia?: number;
  precioConProductoEsTibio?: boolean;
}): Calificacion {
  const porTipo = new Map<string, SenalCalificada>();
  const anotar = (senal: SenalCalificada) => porTipo.set(senal.tipo, senal);
  let precioConProducto: SenalCalificada | null = null;

  for (const mensaje of input.mensajes) {
    const texto = mensaje.texto ?? "";
    if (!texto.trim()) continue;
    const senales = detectarSenales(texto);
    for (const senal of senales) {
      const def = PESOS.get(senal.tipo);
      anotar({ tipo: senal.tipo, etiqueta: def?.etiqueta ?? senal.tipo, peso: senal.peso, grupo: senal.grupo, fragmento: senal.fragmento, en: mensaje.en });
    }
    const color = eligioColor(texto);
    if (color) anotar({ tipo: "eligio_color", ...EXTRAS.eligio_color, fragmento: color, en: mensaje.en });
    const unidades = variasUnidades(texto);
    if (unidades) anotar({ tipo: "varias_unidades", ...EXTRAS.varias_unidades, fragmento: unidades, en: mensaje.en });
    const precio = senales.find((s) => s.tipo === "precio");
    if (precio && (familiaDelTexto(texto) || input.productoInteres)) {
      precioConProducto = { tipo: "precio_producto", ...EXTRAS.precio_producto, fragmento: precio.fragmento, en: mensaje.en };
    }
  }
  if (precioConProducto && input.precioConProductoEsTibio !== false) {
    anotar({
      ...precioConProducto,
      etiqueta: `preguntó el precio de ${nombreDeFamilia(familiaDelTexto(precioConProducto.fragmento) ?? input.productoInteres) ?? "un producto concreto"}`,
    });
  }

  const senales = [...porTipo.values()];
  const noInteresa = porTipo.has("no_interesa");
  let base = 0;
  let hayFuerte = false;
  for (const senal of senales) {
    base += senal.peso;
    if (senal.grupo === "fuerte") hayFuerte = true;
  }
  if (hayFuerte) base = Math.max(base, UMBRAL_CALIENTE);
  // Una pregunta concreta (envío, colores, medidas, fabricación, garantía, forma de pago, precio de
  // un producto identificado) ya es TIBIO, aunque sea la única señal (pedido de Alexander).
  if (senales.some((s) => s.grupo === "media") && !porTipo.has("solo_mirando")) base = Math.max(base, UMBRAL_TIBIO);
  if (noInteresa) base = 0;
  base = Math.max(0, base);

  const ultimo = input.mensajes.length ? input.mensajes[input.mensajes.length - 1].en : null;
  const diasDeSilencio = ultimo ? Math.max(0, Math.floor((input.ahora.getTime() - ultimo.getTime()) / 86_400_000)) : 0;
  const conCotizacion = Boolean(input.cotizacionEn);
  const calientePorPersona = input.etapaCrm === "NEGOCIACION";
  let puntaje = conCotizacion ? base : Math.max(0, base - diasDeSilencio * (input.caidaPorDia ?? 1));
  let puntajeBase = base;
  if (calientePorPersona && !noInteresa) {
    puntaje = Math.max(puntaje, UMBRAL_CALIENTE);
    puntajeBase = Math.max(puntajeBase, UMBRAL_CALIENTE);
  }
  if (conCotizacion && !noInteresa) {
    puntaje = Math.max(puntaje, UMBRAL_TIBIO);
    puntajeBase = Math.max(puntajeBase, UMBRAL_TIBIO);
  }
  const temperatura = temperaturaDelPuntaje(puntaje);

  const principales = [...senales]
    .sort((a, b) => Math.abs(b.peso) - Math.abs(a.peso) || b.en.getTime() - a.en.getTime())
    .slice(0, 3)
    .map((s) => `${s.etiqueta} ('${s.fragmento.slice(0, 60)}')`);
  const extras: string[] = [];
  if (calientePorPersona) extras.push("etapa Caliente en el CRM");
  if (conCotizacion) extras.push("tiene cotización");
  if (!conCotizacion && diasDeSilencio > 0 && base > 0 && input.caidaPorDia !== 0) extras.push(`−${diasDeSilencio} por ${diasDeSilencio} día(s) en silencio`);
  const partes = [...principales, ...extras];
  const motivo = `${nombreDeTemperatura(temperatura)} (${puntaje})${partes.length ? `: ${partes.join(" + ")}` : ": sin señales de compra"}`;

  return {
    temperatura,
    puntaje,
    puntajeBase,
    temperaturaBase: temperaturaDelPuntaje(puntajeBase),
    motivo: motivo.slice(0, 500),
    senales,
    noInteresa,
    diasDeSilencio,
  };
}
