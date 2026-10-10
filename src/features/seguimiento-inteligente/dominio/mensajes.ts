/**
 * EL MENSAJE SUGERIDO de cada tarea para la asesora (código puro).
 *
 * La asesora lo copia, lo ajusta y lo manda ella: el sistema no le escribe al cliente. Lo que va
 * entre [corchetes] lo completa ella (precio, valor del envío, días) porque depende de la ciudad, la
 * referencia y la tabla vigente. Nunca ofrece contraentrega ni "envío gratis" (política vigente).
 */

import type { SenalCalificada } from "./temperatura";

export type ContextoDelMensaje = {
  nombre: string | null;
  producto: string | null;
  senales: SenalCalificada[];
  cotizacion?: { ref: string | null; total: string | null } | null;
  fechaComo?: string | null;
};

function hola(nombre: string | null): string {
  const limpio = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return limpio && /^[\p{L}]{2,20}$/u.test(limpio) ? `¡Hola, ${limpio[0].toUpperCase()}${limpio.slice(1).toLowerCase()}!` : "¡Hola!";
}

function el(producto: string | null): string {
  return producto ? `tu *${producto}*` : "tu pedido";
}

const POR_SENAL: Array<{ tipos: string[]; texto: (c: ContextoDelMensaje) => string }> = [
  {
    tipos: ["separar", "anticipo_pago", "comprobante", "acepta_precio", "decision_proxima"],
    texto: (c) => `${hola(c.nombre)} 🙌 Para separar ${el(c.producto)} es con el *50 %* y el otro *50 %* cuando esté terminado, después de enviarte fotos y video. ¿Te paso los datos para consignar?`,
  },
  {
    tipos: ["pide_cotizacion"],
    texto: (c) => `${hola(c.nombre)} Te preparo la cotización de ${el(c.producto)} 📝 ¿Me confirmas la ciudad y la cantidad para dejarla lista hoy?`,
  },
  {
    tipos: ["direccion_fecha"],
    texto: (c) => `${hola(c.nombre)} Ya tengo tus datos ✍️ Te confirmo el total de ${el(c.producto)} con el envío a tu ciudad: [total]. ¿Lo dejamos separado hoy con el 50 %?`,
  },
  {
    tipos: ["eligio_color"],
    texto: (c) => `${hola(c.nombre)} ¡Excelente elección! 😍 Para apartar ${el(c.producto)} en ese color es con el *50 %*. ¿Te envío los datos para consignar?`,
  },
  {
    tipos: ["varias_unidades"],
    texto: (c) => `${hola(c.nombre)} Por cantidad te puedo mejorar el precio 🙌 ¿Cuántas unidades necesitas exactamente y para qué ciudad?`,
  },
  {
    tipos: ["envio_ciudad"],
    texto: (c) => `${hola(c.nombre)} Te confirmo el envío de ${el(c.producto)} a tu ciudad: [valor según la tabla de envíos]. ¿Te lo dejo separado?`,
  },
  {
    tipos: ["forma_pago"],
    texto: (c) => `${hola(c.nombre)} Se paga *50 %* para separar y *50 %* cuando esté terminado, después de enviarte fotos y video 📦 ¿Te lo dejo separado?`,
  },
  {
    tipos: ["color_medidas"],
    texto: (c) => `${hola(c.nombre)} ${c.producto ? `El ${c.producto}` : "Viene"} en [colores / medidas]. ¿Cuál te gusta más para tu espacio?`,
  },
  {
    tipos: ["tiempo_fabricacion"],
    texto: (c) => `${hola(c.nombre)} ${el(c.producto)} queda listo en [días hábiles] después de separarlo. ¿Para cuándo lo necesitas?`,
  },
  {
    tipos: ["garantia"],
    texto: (c) => `${hola(c.nombre)} ${el(c.producto)} tiene garantía de [tiempo] y lo fabricamos nosotros en Cali 💪 ¿Te lo dejo separado?`,
  },
  {
    tipos: ["precio_producto", "precio"],
    texto: (c) => `${hola(c.nombre)} ${el(c.producto)} está en [precio] 😊 ¿Para qué ciudad sería, así te confirmo el envío?`,
  },
];

/** La señal que manda en el mensaje: la de mayor peso; entre iguales, la más reciente. */
export function senalPrincipal(senales: SenalCalificada[]): SenalCalificada | null {
  const utiles = senales.filter((s) => s.grupo !== "negativa");
  return [...utiles].sort((a, b) => b.peso - a.peso || b.en.getTime() - a.en.getTime())[0] ?? null;
}

export function mensajePorSenales(c: ContextoDelMensaje): string {
  const principal = senalPrincipal(c.senales);
  const plantilla = principal ? POR_SENAL.find((p) => p.tipos.includes(principal.tipo)) : null;
  if (plantilla) return plantilla.texto(c);
  return `${hola(c.nombre)} ¿Pudiste ver la información de ${el(c.producto)}? 😊 Cuéntame qué te gustaría saber y te ayudo a dejarlo listo.`;
}

export function mensajeDeCotizacion(c: ContextoDelMensaje, horas: number): string {
  const ref = c.cotizacion?.ref ? ` *${c.cotizacion.ref}*` : "";
  const total = c.cotizacion?.total ?? "[total]";
  return horas <= 24
    ? `${hola(c.nombre)} ¿Pudiste revisar la cotización${ref} por *${total}*? 😊 Si te parece, la dejamos separada hoy con el *50 %*.`
    : `${hola(c.nombre)} Te escribo por la cotización${ref} (*${total}*). ¿Qué te faltaría para decidirte? Si quieres la ajustamos a lo que necesitas 🙌`;
}

export function mensajeDeFechaFutura(c: ContextoDelMensaje): string {
  return `${hola(c.nombre)} Hace unas semanas me dijiste que para *${c.fechaComo ?? "esta fecha"}* ibas a necesitar ${el(c.producto)} 😊 ¿Te lo separamos con el *50 %* para tenerlo a tiempo?`;
}

export function mensajeDeCadencia(c: ContextoDelMensaje, dia: number, ultimo: boolean): string {
  if (ultimo) {
    return `${hola(c.nombre)} No quiero insistirte 🙏 Si ${el(c.producto)} es para más adelante, dime la fecha y te escribo en ese momento 🙌`;
  }
  return dia <= 3 ? mensajePorSenales(c) : `${hola(c.nombre)} ¿Pudiste pensarlo? 😊 Cualquier duda de ${el(c.producto)} (envío, colores o forma de pago) te la resuelvo por aquí.`;
}
