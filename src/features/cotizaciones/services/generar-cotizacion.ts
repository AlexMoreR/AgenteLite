/**
 * GENERAR LA COTIZACION EN GESTION desde la ficha del chat (reglas puras, sin imports).
 *
 * La ficha junta los datos del cliente; aqui se arma el pedido para POST /api/cotizaciones de
 * Gestion (magilus.com) y se dice, en palabras simples, que falta para poder generarla.
 * Gestion vuelve a validar todo y pone el precio: el CRM NUNCA manda precios.
 *
 * Sin imports a proposito: scripts/check-generar-cotizacion.mjs lo prueba transpilado.
 */

export type DatosDeLaFicha = {
  fullName: string;
  document: string;
  email: string;
  city: string;
  department: string;
  address: string;
  products: string;
};

export type ProductoDelCatalogo = {
  id: string;
  codigo: string | null;
  nombre: string;
  precio: number;
  origen: string; // "GESTION" | "MANUAL"
  activo: boolean;
};

export type LineaElegida = { productId: string; cantidad: number };

export type Faltante = { campo: string; mensaje: string };

export type PedidoDeCotizacion = {
  client: {
    fullName: string;
    document: string;
    email?: string;
    phone: string;
    city: string;
    department: string;
    address: string;
  };
  items: { productCode: string; quantity: number }[];
  asesoraEmail?: string;
  origin?: string;
  linea?: string;
  crmConversationId?: string;
  crmContactId?: string;
  notes?: string;
};

const CANTIDAD_MAXIMA = 10_000;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function limpio(valor: string | null | undefined): string {
  return (valor ?? "").trim().replace(/\s+/g, " ");
}

export function esCantidadValida(cantidad: number): boolean {
  return Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= CANTIDAD_MAXIMA;
}

/**
 * Lo que pide Gestion del cliente (mismas reglas que /api/cotizaciones), dicho para la asesora.
 * `telefono` undefined = no se revisa (el navegador no lo sabe; lo revisa el servidor).
 */
export function faltantesDelCliente(ficha: DatosDeLaFicha, telefono: string | null | undefined): Faltante[] {
  const faltan: Faltante[] = [];
  if (limpio(ficha.fullName).length < 2) faltan.push({ campo: "fullName", mensaje: "Nombre completo del cliente" });
  if (!limpio(ficha.document)) faltan.push({ campo: "document", mensaje: "Cédula o NIT" });
  const correo = limpio(ficha.email);
  if (correo && !CORREO.test(correo)) faltan.push({ campo: "email", mensaje: "El correo no es válido (o déjalo vacío)" });
  if (telefono !== undefined && (telefono ?? "").replace(/\D/g, "").length < 7) {
    faltan.push({ campo: "phone", mensaje: "Teléfono real del cliente (este chat no tiene número)" });
  }
  if (limpio(ficha.city).length < 2) faltan.push({ campo: "city", mensaje: "Ciudad" });
  if (limpio(ficha.department).length < 2) faltan.push({ campo: "department", mensaje: "Departamento" });
  if (limpio(ficha.address).length < 5) faltan.push({ campo: "address", mensaje: "Dirección de entrega completa" });
  return faltan;
}

/** Los productos elegidos: que existan, vengan de Gestion (con codigo), esten activos y con cantidad. */
export function faltantesDeProductos(lineas: LineaElegida[], catalogo: ProductoDelCatalogo[]): Faltante[] {
  if (lineas.length === 0) {
    return [{ campo: "items", mensaje: "Elegir al menos un producto con su cantidad" }];
  }
  const porId = new Map(catalogo.map((producto) => [producto.id, producto]));
  const faltan: Faltante[] = [];
  lineas.forEach((linea, indice) => {
    const producto = porId.get(linea.productId);
    if (!producto) {
      faltan.push({ campo: `items[${indice}]`, mensaje: `El producto ${indice + 1} ya no está en el catálogo` });
      return;
    }
    if (producto.origen !== "GESTION" || !limpio(producto.codigo)) {
      faltan.push({ campo: `items[${indice}]`, mensaje: `${producto.nombre} no viene de Gestión: elige uno sincronizado` });
    } else if (!producto.activo) {
      faltan.push({ campo: `items[${indice}]`, mensaje: `${producto.nombre} está inactivo` });
    }
    if (!esCantidadValida(linea.cantidad)) {
      faltan.push({ campo: `items[${indice}].cantidad`, mensaje: `Cantidad de ${producto.nombre}` });
    }
  });
  return faltan;
}

/** Junta cantidades del mismo producto (Gestion cotiza una linea por producto pedido). */
export function juntarLineas(lineas: LineaElegida[]): LineaElegida[] {
  const totales = new Map<string, number>();
  for (const linea of lineas) {
    totales.set(linea.productId, (totales.get(linea.productId) ?? 0) + linea.cantidad);
  }
  return [...totales.entries()].map(([productId, cantidad]) => ({ productId, cantidad }));
}

export function armarPedidoDeCotizacion(input: {
  ficha: DatosDeLaFicha;
  lineas: LineaElegida[];
  catalogo: ProductoDelCatalogo[];
  telefono: string | null;
  asesoraEmail?: string | null;
  origen?: string | null;
  linea?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
}): { ok: true; pedido: PedidoDeCotizacion } | { ok: false; faltantes: Faltante[] } {
  const lineas = juntarLineas(input.lineas);
  const faltantes = [
    ...faltantesDelCliente(input.ficha, input.telefono),
    ...faltantesDeProductos(lineas, input.catalogo),
  ];
  if (faltantes.length > 0) {
    return { ok: false, faltantes };
  }
  const porId = new Map(input.catalogo.map((producto) => [producto.id, producto]));
  const correo = limpio(input.ficha.email);
  const pedido: PedidoDeCotizacion = {
    client: {
      fullName: limpio(input.ficha.fullName),
      document: limpio(input.ficha.document),
      ...(correo ? { email: correo.toLowerCase() } : {}),
      phone: (input.telefono ?? "").replace(/\D/g, ""),
      city: limpio(input.ficha.city),
      department: limpio(input.ficha.department),
      address: limpio(input.ficha.address),
    },
    items: lineas.map((linea) => ({
      productCode: limpio(porId.get(linea.productId)!.codigo),
      quantity: linea.cantidad,
    })),
  };
  if (input.asesoraEmail?.trim()) pedido.asesoraEmail = input.asesoraEmail.trim().toLowerCase();
  if (input.origen?.trim()) pedido.origin = input.origen.trim();
  if (input.linea?.trim()) pedido.linea = input.linea.trim();
  if (input.conversationId?.trim()) pedido.crmConversationId = input.conversationId.trim();
  if (input.contactId?.trim()) pedido.crmContactId = input.contactId.trim();
  const notas = limpio(input.ficha.products);
  if (notas) pedido.notes = `Pedido en el chat: ${notas}`.slice(0, 1000);
  return { ok: true, pedido };
}

/**
 * "Productos" de la ficha (texto libre) -> lineas, cuando se puede.
 *
 * Conservador: un renglon cuenta solo si nombra el CODIGO de un producto o TODAS las palabras de su
 * nombre; si varios encajan gana el nombre mas largo. Lo que no encaja se devuelve en `sinReconocer`
 * para que la asesora lo elija a mano. Cantidad: "2 sillas", "x2", "2x", "(2)"; si no hay, 1.
 */
export function interpretarProductos(
  texto: string,
  catalogo: ProductoDelCatalogo[],
): { lineas: LineaElegida[]; sinReconocer: string[] } {
  const elegibles = catalogo.filter((producto) => producto.activo && producto.origen === "GESTION" && limpio(producto.codigo));
  const piezas = texto
    .split(/\n|;|,|\s+\+\s+|\s+y\s+(?=\d)/i)
    .map((pieza) => pieza.trim())
    .filter(Boolean);
  const lineas: LineaElegida[] = [];
  const sinReconocer: string[] = [];

  for (const pieza of piezas) {
    const cantidadMatch =
      /(?:^|\s)x\s*(\d{1,4})\b/i.exec(pieza) ??
      /\b(\d{1,4})\s*x(?:\s|$)/i.exec(pieza) ??
      /\((\d{1,4})\)/.exec(pieza) ??
      /^\s*(\d{1,4})\b/.exec(pieza);
    const cantidad = cantidadMatch ? Number(cantidadMatch[1]) : 1;
    const normal = ` ${normalizar(pieza)} `;

    let mejor: { producto: ProductoDelCatalogo; largo: number } | null = null;
    for (const producto of elegibles) {
      const codigo = normalizar(producto.codigo ?? "");
      const porCodigo = codigo.length >= 3 && normal.includes(` ${codigo} `);
      const palabras = normalizar(producto.nombre).split(" ").filter((palabra) => palabra.length > 1);
      const porNombre = palabras.length > 0 && palabras.every((palabra) => normal.includes(` ${palabra} `) || normal.includes(` ${palabra}s `) || normal.includes(` ${palabra}es `));
      if (!porCodigo && !porNombre) continue;
      const largo = porCodigo ? 1000 + codigo.length : palabras.join(" ").length;
      if (!mejor || largo > mejor.largo) mejor = { producto, largo };
    }

    if (mejor && esCantidadValida(cantidad)) {
      lineas.push({ productId: mejor.producto.id, cantidad });
    } else {
      sinReconocer.push(pieza);
    }
  }
  return { lineas: juntarLineas(lineas), sinReconocer };
}

/**
 * Cuenta de Gestion de cada asesora (decision de Alex, 18-10-2026): los correos del CRM y de
 * Gestion no coinciden, asi que va un mapa fijo en AppSetting gestion:asesoras:<workspaceId> =
 * {"<crmUserId>": "<correo del usuario en Gestion>"}. Sin entrada (o mapa invalido) se usa el
 * correo propio del usuario del CRM.
 */
export const CLAVE_ASESORAS_GESTION = "gestion:asesoras:";

export function correoDeLaAsesoraEnGestion(mapaCrudo: unknown, crmUserId: string, correoPropio: string | null | undefined): string | null {
  let mapa: unknown = mapaCrudo;
  if (typeof mapaCrudo === "string") {
    try {
      mapa = JSON.parse(mapaCrudo);
    } catch {
      mapa = null;
    }
  }
  if (mapa && typeof mapa === "object" && !Array.isArray(mapa)) {
    const valor = (mapa as Record<string, unknown>)[crmUserId];
    if (typeof valor === "string" && CORREO.test(valor.trim())) {
      return valor.trim().toLowerCase();
    }
  }
  const propio = (correoPropio ?? "").trim().toLowerCase();
  return propio || null;
}

export type CreadaPor = { email: string; nombre: string | null; fallback: boolean };

export type RespuestaDeGestion =
  | {
      tipo: "creada";
      reutilizada: boolean;
      quoteId: string;
      codigo: string;
      total: number;
      shareUrl: string;
      pdfUrl: string | null;
      creadaPor: CreadaPor | null;
    }
  | { tipo: "faltan"; faltantes: Faltante[] }
  | { tipo: "error"; mensaje: string };

/** Lee la respuesta de POST /api/cotizaciones sin confiar en su forma. */
export function leerRespuestaDeGestion(status: number, cuerpo: unknown): RespuestaDeGestion {
  const datos = cuerpo && typeof cuerpo === "object" ? (cuerpo as Record<string, unknown>) : {};
  if (status === 422 && Array.isArray(datos.missing)) {
    const faltantes = datos.missing
      .map((item) => {
        const registro = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
          campo: typeof registro.campo === "string" ? registro.campo : "",
          mensaje: typeof registro.mensaje === "string" ? registro.mensaje : "",
        };
      })
      .filter((item) => item.mensaje);
    return { tipo: "faltan", faltantes };
  }
  if ((status === 200 || status === 201) && datos.ok === true && typeof datos.code === "string" && typeof datos.shareUrl === "string") {
    return {
      tipo: "creada",
      reutilizada: datos.reused === true,
      quoteId: typeof datos.quoteId === "string" ? datos.quoteId : "",
      codigo: datos.code,
      total: typeof datos.total === "number" ? datos.total : Number(datos.total) || 0,
      shareUrl: datos.shareUrl,
      pdfUrl: typeof datos.pdfUrl === "string" ? datos.pdfUrl : null,
      creadaPor: leerCreadaPor(datos.createdBy),
    };
  }
  if (status === 401) return { tipo: "error", mensaje: "Gestión rechazó la llave del CRM. Avísale al administrador." };
  return { tipo: "error", mensaje: `Gestión no pudo generar la cotización (error ${status}). Prueba de nuevo.` };
}

function leerCreadaPor(crudo: unknown): CreadaPor | null {
  if (!crudo || typeof crudo !== "object") return null;
  const registro = crudo as Record<string, unknown>;
  if (typeof registro.email !== "string") return null;
  return {
    email: registro.email,
    nombre: typeof registro.name === "string" && registro.name.trim() ? registro.name.trim() : null,
    fallback: registro.fallback === true,
  };
}

export function formatearPesos(valor: number): string {
  return `$${Math.round(valor).toLocaleString("es-CO")}`;
}

/** El mensaje que sale al cliente solo si la asesora toca "Enviar al cliente". */
export function textoParaElCliente(input: { nombre: string; codigo: string; total: number; shareUrl: string }): string {
  const primerNombre = limpio(input.nombre).split(" ")[0] ?? "";
  const saludo = primerNombre ? `${primerNombre}, aquí` : "Aquí";
  return `${saludo} está tu cotización ${input.codigo} por ${formatearPesos(input.total)}:\n${input.shareUrl}`;
}
