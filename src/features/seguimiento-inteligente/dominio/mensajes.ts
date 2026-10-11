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
  /**
   * El cliente está ESPERANDO respuesta (Supervisor): se le responde lo que pidió. Con fotos pedidas
   * se le ofrecen las fotos (no "¿pudiste ver las fotos?", que afirma que ya se le mandaron).
   */
  esperando?: boolean;
};

/** El mensaje neutro cuando no hay una señal clara (nunca afirma algo que el cliente no dijo). */
export function mensajeNeutro(nombre: string | null): string {
  return `${hola(nombre)} ¿Te quedó alguna duda? Con gusto te ayudo 😊`;
}

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
    // Solo con color elegido de verdad (senal.valor) Y producto claro: ver `utilizable`.
    tipos: ["eligio_color"],
    texto: (c) => {
      const color = c.senales.find((s) => s.tipo === "eligio_color")?.valor;
      return `${hola(c.nombre)} ¡Excelente elección! 😍 Para apartar ${el(c.producto)} en color *${color}* es con el *50 %*. ¿Te envío los datos para consignar?`;
    },
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
    // Sin artículo ("El camillas" / "El camilla" salían mal).
    texto: (c) => `${hola(c.nombre)} ${c.producto ? `*${c.producto[0].toUpperCase()}${c.producto.slice(1)}* viene` : "Viene"} en [colores / medidas]. ¿Cuál te gusta más para tu espacio?`,
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
    tipos: ["pregunta_uso"],
    texto: (c) => {
      const fragmento = c.senales.find((s) => s.tipo === "pregunta_uso")?.fragmento ?? "";
      const servicio = /\b(?:para|pa)\s+([\p{L}]{3,20})/iu.exec(fragmento)?.[1]?.toLowerCase() ?? null;
      const para = servicio && !/^(que|qué|q)$/.test(servicio) ? `*${servicio}*` : "[su servicio]";
      return `${hola(c.nombre)} ¡Claro que sí! ${el(c.producto)} te sirve para ${para} 😊 Te explico cómo lo usarías y te confirmo precio y envío. ¿Para qué ciudad sería?`;
    },
  },
  {
    tipos: ["fotos_producto"],
    texto: (c) =>
      `${hola(c.nombre)} Te comparto las fotos y el video de ${el(c.producto)} 📸 ¿Cuál te gustó más? Así te confirmo precio, colores y el envío a tu ciudad.`,
  },
  {
    tipos: ["precio_producto", "precio"],
    texto: (c) => `${hola(c.nombre)} ${el(c.producto)} está en [precio] 😊 ¿Para qué ciudad sería, así te confirmo el envío?`,
  },
  {
    // Sin "Para lo que vas a hacer te queda perfecto" (afirmaba algo que nadie confirmó).
    tipos: ["fotos_video", "dijo_servicio"],
    texto: (c) =>
      c.esperando && c.senales.some((s) => s.tipo === "fotos_video")
        ? `${hola(c.nombre)} Te comparto las fotos${c.producto ? ` de ${el(c.producto)}` : ""} 📸 ¿Cuál te gustó más? Así te confirmo precio, colores y el envío a tu ciudad.`
        : `${hola(c.nombre)} ¿Pudiste ver las fotos${c.producto ? ` de ${el(c.producto)}` : ""}? 😊 ¿Para qué ciudad sería, así te confirmo precio y envío?`,
  },
];

/**
 * ¿La señal sirve para armar el mensaje? "Eligió color" solo si el color es una elección clara
 * (`valor`) Y el producto está claro: si no, "¡Excelente elección! … en ese color" afirmaría algo
 * que el cliente no dijo (caso real •••• 8462 / •••• 5903 del 11-oct).
 */
function utilizable(s: SenalCalificada, producto: string | null): boolean {
  if (s.grupo === "negativa") return false;
  if (s.tipo === "eligio_color") return Boolean(s.valor && producto);
  return true;
}

/** La señal que manda en el mensaje: la de mayor peso; entre iguales, la más reciente. */
export function senalPrincipal(senales: SenalCalificada[], producto: string | null = null, exigirColorClaro = false): SenalCalificada | null {
  const utiles = senales.filter((s) => (exigirColorClaro ? utilizable(s, producto) : s.grupo !== "negativa"));
  return [...utiles].sort((a, b) => b.peso - a.peso || b.en.getTime() - a.en.getTime())[0] ?? null;
}

/**
 * El mensaje según la señal principal. Sin señal útil → mensaje NEUTRO ("¿Te quedó alguna duda?"),
 * que no da por hecho producto, color ni que ya se le mandó información.
 */
export function mensajePorSenales(c: ContextoDelMensaje): string {
  const principal = senalPrincipal(c.senales, c.producto, true);
  const plantilla = principal ? POR_SENAL.find((p) => p.tipos.includes(principal.tipo)) : null;
  if (plantilla) return plantilla.texto(c);
  return mensajeNeutro(c.nombre);
}

export function mensajeDeCotizacion(c: ContextoDelMensaje, horas: number): string {
  const ref = c.cotizacion?.ref ? ` *${c.cotizacion.ref}*` : "";
  const total = c.cotizacion?.total ?? "[total]";
  return horas <= 24
    ? `${hola(c.nombre)} ¿Pudiste revisar la cotización${ref} por *${total}*? 😊 Si te parece, la dejamos separada hoy con el *50 %*.`
    : `${hola(c.nombre)} Te escribo por la cotización${ref} (*${total}*). ¿Qué te faltaría para decidirte? Si quieres la ajustamos a lo que necesitas 🙌`;
}

/** La asesora pidió los datos y el cliente no los mandó (2 h / 24 h / 72 h). Sin precios. */
export function mensajeDeFormulario(c: ContextoDelMensaje & { color?: string | null }, horas: number): string {
  const enColor = c.color ? ` en color *${c.color}*` : "";
  if (horas <= 2) return `${hola(c.nombre)} ¿Te ayudo a completar los datos? Así te separo ${el(c.producto)}${enColor} 😊`;
  if (horas <= 24) return `${hola(c.nombre)} ¿Pudiste ver los datos que te pedí? Si quieres me los mandas por aquí de a poquito y te dejo ${el(c.producto)}${enColor} separado 🙌`;
  return `${hola(c.nombre)} Te escribo por ${el(c.producto)}${enColor} 😊 ¿Te ayudo a terminar los datos o prefieres que te llame?`;
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
