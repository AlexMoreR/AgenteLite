import type { EstadoDeEnvio } from "@/lib/envios-gestion";

/**
 * LAS DOS FORMAS DE PAGO DEL PANEL DE ENVÍO: 50 % de anticipo o contraentrega.
 *
 * Política de Alex (07-10-2026, bóveda Magilus: Ventas/2026-10-06-tabla-envios-v1.md, "Decisiones
 * del 7-oct"):
 * - Envío GRATIS a las ciudades de envío gratis SOLO pagando 50 % de anticipo + 50 % al terminar la
 *   fabricación (antes del envío).
 * - Contraentrega SOLO para el COMBO DE CAMILLA. El envío se paga por adelantado y el combo al
 *   recibir: Bogotá $100.000; Cali, Medellín y todas las demás ciudades de envío gratis $150.000
 *   fijo; ciudades que no son de envío gratis: se cotiza con Ingrid.
 *
 * Gestión no expone estos valores: viven aquí, en un solo lugar. Si Alex los cambia, se cambian en
 * `ENVIO_CONTRAENTREGA`. Es lógica pura (sin red ni base): la prueba es `npm run test:contraentrega`.
 */

export const ENVIO_CONTRAENTREGA = {
  bogota: 100_000,
  ciudadGratis: 150_000,
} as const;

/** Ciudades que la política nombra con su valor, por si Gestión aún no las marca como GRATIS. */
const CIUDADES_CON_VALOR: ReadonlyArray<{ claves: string[]; valor: number }> = [
  { claves: ["bogota", "bogota d.c.", "bogota, d.c.", "bogota dc"], valor: ENVIO_CONTRAENTREGA.bogota },
  { claves: ["cali", "santiago de cali"], valor: ENVIO_CONTRAENTREGA.ciudadGratis },
  { claves: ["medellin"], valor: ENVIO_CONTRAENTREGA.ciudadGratis },
];

const formatoPesos = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
export function pesos(valor: number): string {
  return `$${formatoPesos.format(valor)}`;
}

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Combo de camilla = categoría "COMBO DE CAMILLAS" de Gestión; si no hay categoría, código CMB. */
export function esComboDeCamilla(producto: { codigo?: string | null; categoria?: string | null } | null): boolean {
  if (!producto) return false;
  const categoria = normalizar(producto.categoria);
  if (categoria) return /\bcombos?\b.*\bcamillas?\b/.test(categoria);
  return /^cmb/i.test((producto.codigo ?? "").trim());
}

export type UbicacionParaPago = {
  tipo: "ciudad" | "corregimiento";
  nombre: string;
  ciudad: string;
  envio: EstadoDeEnvio;
};

/** Valor del envío en contraentrega, o null si se cotiza con Ingrid. */
export function envioContraentrega(ubicacion: UbicacionParaPago): number | null {
  if (ubicacion.envio === "NO_LLEGA") return null;
  const ciudad = normalizar(ubicacion.ciudad || ubicacion.nombre);
  const nombrada = CIUDADES_CON_VALOR.find((fila) => fila.claves.includes(ciudad));
  // Una ciudad nombrada vale siempre; su corregimiento solo si Gestión no lo saca de la cobertura.
  if (nombrada && (ubicacion.tipo === "ciudad" || ubicacion.envio === "GRATIS")) return nombrada.valor;
  if (ubicacion.envio === "GRATIS") return ENVIO_CONTRAENTREGA.ciudadGratis;
  return null;
}

export type OpcionAnticipo =
  | { estado: "TOTAL"; total: number; separar: number; envio: number; envioGratis: boolean; texto: string }
  | { estado: "COTIZAR" | "NO_LLEGA"; texto: string };

export type OpcionContraentrega =
  | { estado: "TOTAL"; envio: number; producto: number; total: number; texto: string }
  | { estado: "COTIZAR"; producto: number; texto: string }
  | { estado: "NO_APLICA"; motivo: string };

function textoCotizar(lugar: string) {
  return `¡Sí llegamos a *${lugar}*! 🚚 Déjame cotizarte el envío y en un momento te doy el *total exacto*. Mientras tanto, ¿de qué *color* lo quieres?`;
}

function textoNoLlega(lugar: string) {
  return `Por ahora no tenemos envío a *${lugar}* 🙏 ¿Tienes una ciudad cercana donde lo podamos entregar?`;
}

/** El 50 % para separar (el otro 50 % se paga al terminar la fabricación). */
export function valorParaSeparar(total: number): number {
  return Math.round(total / 2);
}

/**
 * Opción "50 % anticipo": un solo mensaje con el total, lo que se paga para separar y si el envío es
 * gratis o va incluido. Sin total (producto sin precio o envío por cotizar) no se inventa nada.
 */
export function opcionAnticipo(input: {
  estado: EstadoDeEnvio;
  lugar: string;
  producto: string | null;
  total: number | null;
  precio: number | null;
}): OpcionAnticipo {
  const { estado, lugar, producto, total, precio } = input;
  if (estado === "NO_LLEGA") return { estado: "NO_LLEGA", texto: textoNoLlega(lugar) };
  if ((estado !== "GRATIS" && estado !== "ADICIONAL") || total === null || !(total > 0) || !producto) {
    return { estado: "COTIZAR", texto: textoCotizar(lugar) };
  }
  const separar = valorParaSeparar(total);
  const envioGratis = estado === "GRATIS";
  const envio = envioGratis || precio === null ? 0 : Math.max(0, total - precio);
  const envioTexto = envioGratis
    ? `el envío a *${lugar}* te sale *gratis* 🚚`
    : `el envío a *${lugar}* ya va incluido 🚚`;
  const texto =
    `¡Perfecto! Tu *${producto}* queda en *${pesos(total)}* en total y ${envioTexto} ` +
    `Separas con el *50%* (*${pesos(separar)}*) y el otro 50% cuando esté listo, antes del envío. ` +
    `Te mando fotos del producto terminado antes del segundo pago. ¿De qué *color* lo quieres?`;
  return { estado: "TOTAL", total, separar, envio, envioGratis, texto };
}

/**
 * Opción "Contraentrega": solo combo de camilla. Envío por adelantado + combo al recibir, con el
 * total escrito. Si la ciudad no es de envío gratis, el envío se cotiza con Ingrid.
 */
export function opcionContraentrega(input: {
  ubicacion: UbicacionParaPago;
  lugar: string;
  producto: { nombre: string; precio: number; codigo?: string | null; categoria?: string | null } | null;
  anticipoConEnvioGratis: boolean;
}): OpcionContraentrega {
  const { ubicacion, lugar, producto, anticipoConEnvioGratis } = input;
  if (!producto) return { estado: "NO_APLICA", motivo: "Elige un producto para ver la contraentrega" };
  if (!esComboDeCamilla(producto)) return { estado: "NO_APLICA", motivo: "Este producto no tiene contraentrega" };
  if (ubicacion.envio === "NO_LLEGA") return { estado: "NO_APLICA", motivo: "No llegamos a esta ubicación" };
  if (!(producto.precio > 0)) return { estado: "NO_APLICA", motivo: "El producto no tiene precio en Gestión" };

  const otraOpcion = anticipoConEnvioGratis
    ? " Si prefieres, también puedes separarlo con el *50%* y así el envío te sale *gratis*. ¿Cuál te queda mejor?"
    : " ¿Te queda bien así?";
  const envio = envioContraentrega(ubicacion);
  if (envio === null) {
    return {
      estado: "COTIZAR",
      producto: producto.precio,
      texto:
        `¡Sí! Con contraentrega pagas solo el envío por adelantado y tu *${producto.nombre}* (*${pesos(producto.precio)}*) ` +
        `lo pagas al recibirlo. El envío a *${lugar}* te lo cotizo y en un momento te doy el *total exacto*.`,
    };
  }
  const total = producto.precio + envio;
  return {
    estado: "TOTAL",
    envio,
    producto: producto.precio,
    total,
    texto:
      `¡Sí! Con contraentrega pagas solo el envío por adelantado: *${pesos(envio)}*, y tu *${producto.nombre}* ` +
      `(*${pesos(producto.precio)}*) lo pagas al recibirlo en *${lugar}*. Total: *${pesos(total)}*.${otraOpcion}`,
  };
}
