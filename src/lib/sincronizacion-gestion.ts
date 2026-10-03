import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * SINCRONIZACIÓN DE PRODUCTOS DESDE GESTIÓN (magilus.com), la fuente de verdad del catálogo.
 *
 * Pedido de Alex (03-10-2026): el CRM tenía 6 productos escritos a mano, con fotos rotas y códigos
 * que no coincidían con Gestión (el combo era CAV-16 aquí y CMB05 allá). Ahora el catálogo viene
 * de Gestión una vez al día y con el botón "Sincronizar con Gestión".
 *
 * Qué manda Gestión (se sobrescribe en cada sincronización): nombre, código, precio, precio
 * mayorista, cantidad mínima mayorista, categoría e imágenes.
 *
 * Qué es del CRM (NUNCA se toca): la descripción de venta para el agente, el embudo, los
 * seguimientos, los flujos, las reglas del agente. Un producto nuevo de Gestión nace con la
 * descripción de Gestión como punto de partida; después es del CRM.
 *
 * Nunca se borra un producto: todo lo que cuelga de él (embudo, seguimientos, conocimiento del
 * agente) se borraría en cascada, y las reglas del Agente V3 guardan su id. Si en Gestión se oculta
 * o se borra, aquí queda INACTIVO, y el agente deja de conocerlo.
 *
 * Fotos rotas: antes de guardar, cada imagen se pide de verdad. La que no carga no se guarda, así no
 * sale en la pantalla ni la manda el agente.
 */

const CLAVE_CONEXION = "gestion:catalogo:";
const CLAVE_EMPAREJAMIENTO = "gestion:emparejamiento:";
const CLAVE_ULTIMA = "gestion:ultima-sincronizacion:";

export type ConexionConGestion = { url: string; llave: string };

/** Lo que devuelve /api/catalogo/productos de Gestión. */
type ProductoDeGestion = {
  id: string;
  codigo: string | null;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  precio: number;
  precio_mayorista: number;
  cantidad_minima_mayorista: number;
  es_combo: boolean;
  oculto: boolean;
  imagenes: string[];
};

/**
 * El emparejamiento de los productos que ya existían en el CRM con los de Gestión. Mientras no
 * esté APROBADO por Alex, la sincronización no corre: si corriera, crearía otro "Combo Camilla
 * Divan" al lado del Combo Camillas, y el embudo quedaría colgado del que pasa a inactivo.
 */
export type Emparejamiento = {
  aprobado: boolean;
  /** id del producto del CRM → id del producto en Gestión (null = queda manual, sin pareja). */
  pares: Record<string, string | null>;
};

export type ResumenDeSincronizacion = {
  en: string;
  creados: number;
  actualizados: number;
  inactivados: number;
  imagenesDescartadas: number;
  conflictosDeCodigo: string[];
  error?: string;
};

function leerJson<T>(valor: string | null | undefined): T | null {
  if (!valor) return null;
  try {
    return JSON.parse(valor) as T;
  } catch {
    return null;
  }
}

export async function leerConexionConGestion(workspaceId: string): Promise<ConexionConGestion | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_CONEXION}${workspaceId}` } });
  const conexion = leerJson<ConexionConGestion>(fila?.value);
  return conexion?.url && conexion.llave ? conexion : null;
}

export async function leerEmparejamiento(workspaceId: string): Promise<Emparejamiento | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_EMPAREJAMIENTO}${workspaceId}` } });
  return leerJson<Emparejamiento>(fila?.value);
}

export async function leerUltimaSincronizacion(workspaceId: string): Promise<ResumenDeSincronizacion | null> {
  const fila = await prisma.appSetting.findUnique({ where: { key: `${CLAVE_ULTIMA}${workspaceId}` } });
  return leerJson<ResumenDeSincronizacion>(fila?.value);
}

async function guardarUltima(workspaceId: string, resumen: ResumenDeSincronizacion) {
  const key = `${CLAVE_ULTIMA}${workspaceId}`;
  const value = JSON.stringify(resumen);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Los negocios que tienen conexión con Gestión configurada. */
export async function negociosConGestion(): Promise<string[]> {
  const filas = await prisma.appSetting.findMany({
    where: { key: { startsWith: CLAVE_CONEXION } },
    select: { key: true },
  });
  return filas.map((fila) => fila.key.slice(CLAVE_CONEXION.length));
}

async function traerCatalogo(conexion: ConexionConGestion): Promise<ProductoDeGestion[]> {
  const respuesta = await fetch(conexion.url, {
    headers: { Authorization: `Bearer ${conexion.llave}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!respuesta.ok) {
    throw new Error(`Gestión respondió ${respuesta.status}`);
  }
  const datos = (await respuesta.json()) as { productos?: ProductoDeGestion[] };
  if (!Array.isArray(datos.productos)) {
    throw new Error("Gestión no devolvió la lista de productos");
  }
  return datos.productos;
}

/**
 * ¿La imagen carga de verdad? Se pide con GET y se mira el tipo: un 200 que devuelve la página de
 * error en HTML también es una foto rota.
 */
async function cargaLaImagen(url: string): Promise<boolean> {
  try {
    const respuesta = await fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const tipo = respuesta.headers.get("content-type") ?? "";
    // No se descarga el archivo entero: con saber que existe alcanza.
    await respuesta.body?.cancel().catch(() => {});
    return respuesta.ok && (tipo.startsWith("image/") || tipo.startsWith("video/"));
  } catch {
    return false;
  }
}

async function revisarImagenes(urls: string[]): Promise<Set<string>> {
  const buenas = new Set<string>();
  const pendientes = [...new Set(urls)];
  const DE_A = 8;
  for (let i = 0; i < pendientes.length; i += DE_A) {
    const tanda = pendientes.slice(i, i + DE_A);
    const resultados = await Promise.all(tanda.map(async (url) => [url, await cargaLaImagen(url)] as const));
    for (const [url, ok] of resultados) {
      if (ok) buenas.add(url);
    }
  }
  return buenas;
}

function slugBase(nombre: string, codigo: string | null) {
  return `${nombre} ${codigo ?? ""}`
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "producto";
}

async function slugLibre(tx: Prisma.TransactionClient, workspaceId: string, base: string) {
  for (let intento = 0; intento < 50; intento += 1) {
    const slug = intento === 0 ? base : `${base}-${intento + 1}`;
    const existe = await tx.product.findFirst({ where: { workspaceId, slug }, select: { id: true } });
    if (!existe) return slug;
  }
  return `${base}-${Date.now()}`;
}

async function categoriaDelNegocio(tx: Prisma.TransactionClient, workspaceId: string, nombre: string | null) {
  const limpio = nombre?.trim();
  if (!limpio) return null;
  const existente = await tx.category.findFirst({ where: { workspaceId, name: limpio }, select: { id: true } });
  if (existente) return existente.id;
  const creada = await tx.category.create({
    data: { workspaceId, name: limpio, slug: await slugCategoria(tx, workspaceId, limpio) },
    select: { id: true },
  });
  return creada.id;
}

async function slugCategoria(tx: Prisma.TransactionClient, workspaceId: string, nombre: string) {
  const base = slugBase(nombre, null);
  for (let intento = 0; intento < 50; intento += 1) {
    const slug = intento === 0 ? base : `${base}-${intento + 1}`;
    const existe = await tx.category.findFirst({ where: { workspaceId, slug }, select: { id: true } });
    if (!existe) return slug;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Sincroniza el catálogo de un negocio. Devuelve el resumen, que también queda guardado para la
 * insignia "Sincronizado desde Gestión" de la pantalla.
 */
export async function sincronizarConGestion(workspaceId: string): Promise<ResumenDeSincronizacion> {
  const resumen: ResumenDeSincronizacion = {
    en: new Date().toISOString(),
    creados: 0,
    actualizados: 0,
    inactivados: 0,
    imagenesDescartadas: 0,
    conflictosDeCodigo: [],
  };

  try {
    const conexion = await leerConexionConGestion(workspaceId);
    if (!conexion) {
      throw new Error("Este negocio no tiene conexión con Gestión");
    }
    const emparejamiento = await leerEmparejamiento(workspaceId);
    if (!emparejamiento?.aprobado) {
      throw new Error("Falta aprobar qué producto del CRM corresponde a cuál de Gestión");
    }

    const catalogo = await traerCatalogo(conexion);
    const todasLasImagenes = catalogo.flatMap((producto) => producto.imagenes);
    const imagenesQueCargan = await revisarImagenes(todasLasImagenes);
    resumen.imagenesDescartadas = new Set(todasLasImagenes).size - imagenesQueCargan.size;

    // Primera vez: los productos que ya existían quedan enlazados con su pareja de Gestión.
    for (const [productoId, gestionId] of Object.entries(emparejamiento.pares)) {
      if (!gestionId) continue;
      await prisma.product.updateMany({
        where: { id: productoId, workspaceId, gestionId: null },
        data: { gestionId },
      });
    }

    const delCrm = await prisma.product.findMany({
      where: { workspaceId },
      select: { id: true, gestionId: true, code: true, origen: true },
    });
    const porGestionId = new Map(delCrm.filter((p) => p.gestionId).map((p) => [p.gestionId!, p]));
    const ahora = new Date();

    for (const remoto of catalogo) {
      const imagenes = remoto.imagenes.filter((url) => imagenesQueCargan.has(url));
      const codigo = remoto.codigo?.trim() || null;
      const local = porGestionId.get(remoto.id);

      // El código es único por negocio: si otro producto del CRM ya lo usa, no se pisa.
      const codigoOcupado = codigo
        ? delCrm.some((p) => p.code === codigo && p.gestionId !== remoto.id)
        : false;
      if (codigoOcupado) {
        resumen.conflictosDeCodigo.push(codigo!);
      }

      await prisma.$transaction(async (tx) => {
        const categoryId = await categoriaDelNegocio(tx, workspaceId, remoto.categoria);
        const deGestion = {
          name: remoto.nombre.trim(),
          ...(codigoOcupado ? {} : { code: codigo }),
          price: new Prisma.Decimal(remoto.precio || 0),
          wholesalePrice: new Prisma.Decimal(remoto.precio_mayorista || 0),
          minWholesaleQty: remoto.cantidad_minima_mayorista || 1,
          categoryId,
          thumbnailUrl: imagenes[0] ?? "",
          origen: "GESTION",
          gestionId: remoto.id,
          sincronizadoEl: ahora,
          estadoEnGestion: remoto.oculto ? "oculto" : "visible",
          activo: !remoto.oculto,
        };

        let productoId: string;
        if (local) {
          await tx.product.update({ where: { id: local.id }, data: deGestion });
          productoId = local.id;
          resumen.actualizados += 1;
        } else {
          const creado = await tx.product.create({
            data: {
              ...deGestion,
              workspaceId,
              slug: await slugLibre(tx, workspaceId, slugBase(remoto.nombre, codigo)),
              // Solo al nacer: el punto de partida. Desde ahí la descripción es del CRM.
              description: remoto.descripcion,
            },
            select: { id: true },
          });
          productoId = creado.id;
          resumen.creados += 1;
        }

        await tx.productImage.deleteMany({ where: { productId: productoId } });
        if (imagenes.length > 0) {
          await tx.productImage.createMany({
            data: imagenes.map((url, orden) => ({ productId: productoId, url, order: orden })),
          });
        }
      });
    }

    // Los que ya no están en Gestión: inactivos, nunca borrados.
    const idsEnGestion = catalogo.map((producto) => producto.id);
    const inactivados = await prisma.product.updateMany({
      where: { workspaceId, origen: "GESTION", gestionId: { notIn: idsEnGestion }, activo: true },
      data: { activo: false, estadoEnGestion: "no_existe", sincronizadoEl: ahora },
    });
    resumen.inactivados = inactivados.count;
  } catch (error) {
    resumen.error = error instanceof Error ? error.message : String(error);
    console.error("[gestion] sincronizacion fallida", { workspaceId, error: resumen.error });
  }

  await guardarUltima(workspaceId, resumen);
  if (!resumen.error) {
    console.log("[gestion] sincronizado", { workspaceId, ...resumen });
  }
  return resumen;
}

/** Corre una vez al día (cuelga del cron de seguimientos), de madrugada en Colombia. */
export async function sincronizarSiTocaHoy(ahora = new Date()): Promise<number> {
  const bogota = new Date(ahora.getTime() - 5 * 3_600_000);
  if (bogota.getUTCHours() !== 3) {
    return 0;
  }
  const hoy = bogota.toISOString().slice(0, 10);
  let corridas = 0;
  for (const workspaceId of await negociosConGestion()) {
    const ultima = await leerUltimaSincronizacion(workspaceId);
    const diaDeLaUltima = ultima ? new Date(new Date(ultima.en).getTime() - 5 * 3_600_000).toISOString().slice(0, 10) : null;
    if (diaDeLaUltima === hoy) continue;
    await sincronizarConGestion(workspaceId);
    corridas += 1;
  }
  return corridas;
}
