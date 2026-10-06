import { z } from "zod";

import { leerConexionConGestion } from "@/lib/sincronizacion-gestion";

/**
 * ENVÍOS DESDE GESTIÓN: a dónde llegamos y cuánto queda el total con envío.
 *
 * Pedido de Alex (06-10-2026): las asesoras tenían que salir del chat para saber si el envío a la
 * ciudad del cliente era gratis, adicional, se cotizaba o no llegábamos. Gestión (magilus.com) es
 * la fuente de las ubicaciones y de las tarifas; aquí solo se consulta.
 *
 * Usa la MISMA conexión que la sincronización del catálogo (`gestion:catalogo:<workspaceId>`): del
 * `url` se toma solo el origen y se llama `/api/transporte/ubicaciones` con la misma llave.
 *
 * Ninguna función lanza: si Gestión no responde, tarda o devuelve algo raro, se devuelve `{ error }`
 * y el panel lo dice sin romper el chat.
 */

export type EstadoDeEnvio = "GRATIS" | "ADICIONAL" | "COTIZAR" | "NO_LLEGA";

const ESTADOS: readonly EstadoDeEnvio[] = ["GRATIS", "ADICIONAL", "COTIZAR", "NO_LLEGA"];

export type UbicacionDeGestion = {
  tipo: "ciudad" | "corregimiento";
  id: string;
  cityId: string;
  nombre: string;
  ciudad: string;
  departamento: string;
  envio: EstadoDeEnvio;
  pendienteRevision: boolean;
  exacta: boolean;
  cotizacion: { tipo: string | null; envio: number | null; total: number | null } | null;
};

export type ProductoDeEnvio = {
  codigo: string;
  nombre: string;
  precio: number;
  envioAdicional: number | null;
};

export type ResultadoDeBusqueda =
  | { ok: true; resultados: UbicacionDeGestion[]; producto: ProductoDeEnvio | null }
  | { error: string };

export type ResultadoDeAgregar =
  | { ok: true; creado: boolean; id: string; nombre: string }
  | { error: string };

const NO_SE_PUDO = "No se pudo consultar Gestión";

/* Validación tolerante: lo que no se entiende se descarta o se vuelve null, no tumba la lista. */
const idFlexible = z.union([z.string(), z.number()]).transform((valor) => String(valor));
const numeroONull = z.preprocess((valor) => {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = typeof valor === "string" ? Number(valor) : valor;
  return typeof numero === "number" && Number.isFinite(numero) ? numero : null;
}, z.number().nullable());
const textoSuave = z.preprocess((valor) => (typeof valor === "string" ? valor : valor == null ? "" : String(valor)), z.string());

const ubicacionSchema = z.object({
  tipo: z.preprocess((valor) => (valor === "corregimiento" ? "corregimiento" : "ciudad"), z.enum(["ciudad", "corregimiento"])),
  id: idFlexible,
  cityId: idFlexible,
  nombre: textoSuave,
  ciudad: textoSuave,
  departamento: textoSuave,
  envio: z.preprocess(
    (valor) => (typeof valor === "string" && (ESTADOS as readonly string[]).includes(valor.toUpperCase()) ? valor.toUpperCase() : "COTIZAR"),
    z.enum(["GRATIS", "ADICIONAL", "COTIZAR", "NO_LLEGA"]),
  ),
  pendienteRevision: z.preprocess((valor) => valor === true, z.boolean()),
  exacta: z.preprocess((valor) => valor === true, z.boolean()),
  cotizacion: z
    .object({
      tipo: z.preprocess((valor) => (typeof valor === "string" ? valor : null), z.string().nullable()),
      envio: numeroONull,
      total: numeroONull,
    })
    .nullable()
    .catch(null)
    .optional()
    .transform((valor) => valor ?? null),
});

const productoSchema = z
  .object({
    codigo: textoSuave,
    nombre: textoSuave,
    precio: numeroONull.transform((valor) => valor ?? 0),
    envioAdicional: numeroONull,
  })
  .nullable()
  .catch(null)
  .optional()
  .transform((valor) => valor ?? null);

const busquedaSchema = z.object({
  resultados: z.array(z.unknown()),
  producto: productoSchema,
});

const agregarSchema = z.object({
  creado: z.preprocess((valor) => valor === true, z.boolean()),
  id: idFlexible,
  nombre: textoSuave,
});

async function baseDeGestion(workspaceId: string): Promise<{ origen: string; llave: string } | null> {
  try {
    const conexion = await leerConexionConGestion(workspaceId);
    if (!conexion) return null;
    return { origen: new URL(conexion.url).origin, llave: conexion.llave };
  } catch {
    return null;
  }
}

export async function buscarUbicaciones(
  workspaceId: string,
  q: string,
  productoCodigo?: string | null,
): Promise<ResultadoDeBusqueda> {
  const texto = q.trim();
  if (texto.length < 2) {
    return { error: "Escribe al menos 2 letras" };
  }
  const base = await baseDeGestion(workspaceId);
  if (!base) {
    return { error: "Este negocio no tiene conexión con Gestión" };
  }

  try {
    const url = new URL("/api/transporte/ubicaciones", base.origen);
    url.searchParams.set("q", texto.slice(0, 80));
    if (productoCodigo?.trim()) url.searchParams.set("producto", productoCodigo.trim());
    url.searchParams.set("limit", "20");

    const respuesta = await fetch(url, {
      headers: { Authorization: `Bearer ${base.llave}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!respuesta.ok) {
      console.warn("[envios-gestion] busqueda fallida", { workspaceId, status: respuesta.status });
      return { error: NO_SE_PUDO };
    }
    const datos = busquedaSchema.safeParse(await respuesta.json());
    if (!datos.success) {
      return { error: NO_SE_PUDO };
    }
    const resultados: UbicacionDeGestion[] = [];
    for (const crudo of datos.data.resultados) {
      const fila = ubicacionSchema.safeParse(crudo);
      if (!fila.success || !fila.data.nombre) continue;
      const { cotizacion, ...resto } = fila.data;
      resultados.push({ ...resto, cotizacion: cotizacion ?? null });
    }
    return { ok: true, resultados, producto: datos.data.producto ?? null };
  } catch (error) {
    console.warn("[envios-gestion] busqueda sin respuesta", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: NO_SE_PUDO };
  }
}

export async function agregarUbicacion(
  workspaceId: string,
  input: { cityId: string; nombre: string },
): Promise<ResultadoDeAgregar> {
  const nombre = input.nombre.trim();
  if (!input.cityId || nombre.length < 2) {
    return { error: "Faltan el nombre o la ciudad" };
  }
  const base = await baseDeGestion(workspaceId);
  if (!base) {
    return { error: "Este negocio no tiene conexión con Gestión" };
  }

  try {
    const respuesta = await fetch(new URL("/api/transporte/ubicaciones", base.origen), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${base.llave}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cityId: input.cityId, nombre, origen: "CRM" }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (respuesta.status === 404) {
      return { error: "Gestión no encontró esa ciudad" };
    }
    if (respuesta.status === 400) {
      return { error: "Gestión rechazó los datos de la ubicación" };
    }
    if (!respuesta.ok) {
      console.warn("[envios-gestion] agregar fallido", { workspaceId, status: respuesta.status });
      return { error: NO_SE_PUDO };
    }
    const datos = agregarSchema.safeParse(await respuesta.json());
    if (!datos.success) {
      return { error: NO_SE_PUDO };
    }
    return { ok: true, creado: datos.data.creado, id: datos.data.id, nombre: datos.data.nombre || nombre };
  } catch (error) {
    console.warn("[envios-gestion] agregar sin respuesta", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: NO_SE_PUDO };
  }
}
