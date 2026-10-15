import type { EstadoDeEnvio } from "@/lib/envios-gestion";

/**
 * LAS DOS FORMAS DE PAGO DEL PANEL DE ENVÍO: 50 % de anticipo o contraentrega.
 *
 * Política de Alex (07-10-2026, bóveda Magilus: Ventas/2026-10-06-tabla-envios-v1.md, "Decisiones
 * del 7-oct"):
 * - Envío GRATIS a las ciudades de envío gratis SOLO pagando 50 % de anticipo + 50 % al terminar la
 *   fabricación (antes del envío).
 * - Contraentrega SOLO para el COMBO DE CAMILLA. El cliente paga por adelantado el envío (costo
 *   adicional) y el combo al recibir. Decisión del 14-oct: el valor del envío NO es fijo (antes
 *   $100.000 Bogotá / $150.000 resto); la asesora lo confirma con Ingrid caso a caso.
 * - Decisión del 14-oct (2): el dueño o un administrador puede GUARDAR el valor del envío de
 *   contraentrega de una ubicación (ciudad o corregimiento) desde el mismo panel; queda para todas
 *   las asesoras. Sin valor guardado sigue "Por confirmar con Ingrid". Se guarda en AppSetting (ver
 *   `lib/envio-contraentrega-guardado.ts`).
 *
 * Lógica pura (sin red ni base): la prueba es `npm run test:contraentrega`.
 */
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

/** Tope de un envío de contraentrega: más que esto es casi seguro un error de digitación. */
export const ENVIO_CONTRAENTREGA_MAXIMO = 2_000_000;

/** Lo que se guarda por ubicación (una fila de AppSetting por ubicación). */
export type EnvioContraentregaGuardado = {
  valor: number;
  nombre: string;
  actualizadoPor: string;
  fecha: string;
};

/** Clave de AppSetting del valor de una ubicación. El tipo va en la clave: ciudad y corregimiento son tablas distintas en Gestión. */
export function claveEnvioContraentrega(workspaceId: string, tipo: "ciudad" | "corregimiento", ubicacionId: string): string {
  return `envio:contraentrega:${workspaceId}:${tipo}:${ubicacionId}`;
}

/**
 * Valida lo que escribe el admin: entero en COP, > 0 y < 2.000.000. Acepta "150000", "150.000",
 * "$150.000" o "150,000" (puntos y comas son separadores de miles; no hay centavos).
 */
export function validarEnvioContraentrega(
  entrada: unknown,
): { ok: true; valor: number } | { ok: false; error: string } {
  let valor: number;
  if (typeof entrada === "number") {
    valor = entrada;
  } else if (typeof entrada === "string") {
    const limpio = entrada.replace(/[$\s.,]/g, "");
    if (!/^\d+$/.test(limpio)) return { ok: false, error: "Escribe solo el valor en pesos, sin centavos" };
    valor = Number(limpio);
  } else {
    return { ok: false, error: "Escribe el valor del envío" };
  }
  if (!Number.isSafeInteger(valor)) return { ok: false, error: "El valor tiene que ser un número entero en pesos" };
  if (valor <= 0) return { ok: false, error: "El valor tiene que ser mayor que cero" };
  if (valor >= ENVIO_CONTRAENTREGA_MAXIMO) {
    return { ok: false, error: `El valor tiene que ser menor que ${pesos(ENVIO_CONTRAENTREGA_MAXIMO)}` };
  }
  return { ok: true, valor };
}

/** Lee la fila guardada; si está dañada o el valor no es válido, como si no hubiera nada. */
export function leerEnvioContraentregaGuardado(texto: string | null | undefined): EnvioContraentregaGuardado | null {
  if (!texto) return null;
  try {
    const dato = JSON.parse(texto) as Partial<EnvioContraentregaGuardado> | null;
    if (!dato || typeof dato !== "object") return null;
    const validado = validarEnvioContraentrega(dato.valor);
    if (!validado.ok || typeof dato.valor !== "number") return null;
    return {
      valor: validado.valor,
      nombre: typeof dato.nombre === "string" ? dato.nombre : "",
      actualizadoPor: typeof dato.actualizadoPor === "string" ? dato.actualizadoPor : "",
      fecha: typeof dato.fecha === "string" ? dato.fecha : "",
    };
  } catch {
    return null;
  }
}

/**
 * Solo el dueño o un administrador (del negocio o de la plataforma) edita el valor. Las asesoras y
 * las supervisoras solo lo ven.
 */
export function puedeEditarEnvioContraentrega(access: {
  isOwner: boolean;
  role: string;
  membershipRole: string;
}): boolean {
  return access.isOwner || access.role === "ADMIN" || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN";
}

/**
 * Valor del envío en contraentrega: el guardado por el admin para ESA ubicación, o null ("Por
 * confirmar con Ingrid"). No hay valor fijo por defecto (14-oct): nunca se inventa.
 */
export function envioContraentrega(ubicacion: UbicacionParaPago, guardado: number | null = null): number | null {
  if (ubicacion.envio === "NO_LLEGA") return null;
  if (guardado === null) return null;
  const validado = validarEnvioContraentrega(guardado);
  return validado.ok ? validado.valor : null;
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
 * total escrito, si el admin guardó el valor del envío de esa ubicación; si no, se confirma con Ingrid.
 */
export function opcionContraentrega(input: {
  ubicacion: UbicacionParaPago;
  lugar: string;
  producto: { nombre: string; precio: number; codigo?: string | null; categoria?: string | null } | null;
  anticipoConEnvioGratis: boolean;
  /** Valor guardado por el admin para esta ubicación (o null si no hay). */
  envioGuardado?: number | null;
}): OpcionContraentrega {
  const { ubicacion, lugar, producto, anticipoConEnvioGratis } = input;
  if (!producto) return { estado: "NO_APLICA", motivo: "Elige un producto para ver la contraentrega" };
  if (!esComboDeCamilla(producto)) return { estado: "NO_APLICA", motivo: "Este producto no tiene contraentrega" };
  if (ubicacion.envio === "NO_LLEGA") return { estado: "NO_APLICA", motivo: "No llegamos a esta ubicación" };
  if (!(producto.precio > 0)) return { estado: "NO_APLICA", motivo: "El producto no tiene precio en Gestión" };

  const otraOpcion = anticipoConEnvioGratis
    ? " Si prefieres, también puedes separarlo con el *50%* y así el envío te sale *gratis*. ¿Cuál te queda mejor?"
    : " ¿Te queda bien así?";
  const envio = envioContraentrega(ubicacion, input.envioGuardado ?? null);
  if (envio === null) {
    return {
      estado: "COTIZAR",
      producto: producto.precio,
      texto:
        `¡Sí! Con contraentrega pagas solo el envío por adelantado y tu *${producto.nombre}* (*${pesos(producto.precio)}*) ` +
        `lo pagas al recibirlo. El envío a *${lugar}* es un costo adicional: te lo confirmo en un momento y te doy el *total exacto*.` +
        otraOpcion,
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
