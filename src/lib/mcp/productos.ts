import { prisma } from "@/lib/prisma";
import { slugifyProductSegment } from "@/lib/product-slugs";

/*
  CARGAR PRODUCTOS HABLANDO.

  Alex tiene decenas de productos y cargarlos uno por uno en la pantalla es una tarde perdida
  (25-09-2026). Dictándolos por acá, el catálogo se llena en minutos: "silla hidráulica, 780 mil,
  cuero tex, base cromada".

  Por qué importa que esto exista: el agente va a responder precios y materiales leyendo la FICHA
  del producto, no reglas escritas a mano. Una ficha vacía es un agente que sigue escalando a una
  persona por preguntas que debería contestar solo.

  El catálogo es compartido entre negocios; lo que ata un producto a ESTE negocio es su embudo
  (`ProductPlaybook`). Por eso, al crear uno, se le crea también el embudo: sin eso el producto
  existe pero no es de nadie, y no aparece ni en Producto V2 ni en las demás herramientas.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_PRODUCTOS = [
  {
    name: "crear_producto",
    title: "Cargar un producto",
    description:
      "Agrega un producto al catalogo del negocio con su precio y su descripcion. La descripcion es lo que el agente va a leer para contestar de que material es, que medidas tiene y que incluye: conviene que diga hechos concretos, no adjetivos.",
    inputSchema: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Como lo llama el negocio: 'Silla hidraulica de barberia'" },
        precio: { type: "number", description: "Precio de venta al publico, en pesos" },
        descripcion: {
          type: "string",
          description:
            "Material, medidas, que incluye, peso que soporta. Es lo que el agente usara para responder: 'Cuero tex, estructura metalica, base cromada de 60 cm, soporta 150 kg'",
        },
        codigo: { type: "string", description: "Referencia con la que lo pide el cliente, si tiene: 'CAV-16'" },
        precio_mayorista: { type: "number", description: "Precio por cantidad, si manejan" },
        cantidad_minima_mayorista: { type: "number", description: "Desde cuantas unidades aplica el mayorista" },
        imagen_url: { type: "string", description: "Foto principal, si ya esta subida en algun lado" },
      },
      required: ["nombre", "precio"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "editar_producto",
    title: "Editar un producto",
    description:
      "Cambia el precio, la descripcion o el codigo de un producto que ya existe. Se manda solo lo que cambia.",
    inputSchema: {
      type: "object",
      properties: {
        producto_id: { type: "string", description: "Id del producto (ver listar_productos)" },
        nombre: { type: "string" },
        precio: { type: "number" },
        descripcion: { type: "string" },
        codigo: { type: "string" },
        precio_mayorista: { type: "number" },
        cantidad_minima_mayorista: { type: "number" },
      },
      required: ["producto_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
] as const;

const NOMBRES = new Set(HERRAMIENTAS_MCP_PRODUCTOS.map((herramienta) => herramienta.name));

export function esHerramientaDeProductos(nombre: string) {
  return NOMBRES.has(nombre as (typeof HERRAMIENTAS_MCP_PRODUCTOS)[number]["name"]);
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() ? valor.trim() : undefined;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : undefined;
}

/** Un slug que no choque con otro: el catalogo exige que sea unico. */
async function slugLibre(nombre: string, codigo?: string): Promise<string> {
  const base = [slugifyProductSegment(nombre), codigo ? slugifyProductSegment(codigo) : ""]
    .filter(Boolean)
    .join("-");
  const inicial = base || `producto-${Date.now()}`;
  const parecidos = await prisma.product.findMany({
    where: { slug: { startsWith: inicial } },
    select: { slug: true },
  });
  const usados = new Set(parecidos.map((fila) => fila.slug));
  if (!usados.has(inicial)) {
    return inicial;
  }
  let intento = 2;
  while (usados.has(`${inicial}-${intento}`)) {
    intento += 1;
  }
  return `${inicial}-${intento}`;
}

export async function ejecutarHerramientaMcpProductos(
  nombre: string,
  argumentos: Argumentos,
  contexto: Contexto,
): Promise<unknown> {
  switch (nombre) {
    case "crear_producto": {
      const nombreDelProducto = texto(argumentos.nombre);
      const precio = numero(argumentos.precio);
      if (!nombreDelProducto || precio === undefined) {
        throw new Error("Hace falta el nombre y el precio");
      }

      const codigo = texto(argumentos.codigo);
      const repetido = await prisma.product.findFirst({
        where: { name: { equals: nombreDelProducto, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (repetido) {
        throw new Error(
          `Ya existe un producto llamado "${repetido.name}". Si querias cambiarle algo, usa editar_producto con el id ${repetido.id}.`,
        );
      }

      const producto = await prisma.product.create({
        data: {
          name: nombreDelProducto,
          slug: await slugLibre(nombreDelProducto, codigo),
          code: codigo ?? null,
          description: texto(argumentos.descripcion) ?? null,
          price: precio,
          wholesalePrice: numero(argumentos.precio_mayorista) ?? 0,
          minWholesaleQty: numero(argumentos.cantidad_minima_mayorista) ?? 6,
          // La foto no es obligatoria para que el agente pueda responder: se agrega despues.
          thumbnailUrl: texto(argumentos.imagen_url) ?? "",
        },
        select: { id: true, name: true, price: true, code: true },
      });

      // Sin embudo, el producto existe pero no es de este negocio: no lo ve ni Producto V2.
      await prisma.productPlaybook.create({
        data: { workspaceId: contexto.workspaceId, productId: producto.id },
      });

      return {
        ok: true,
        producto_id: producto.id,
        nombre: producto.name,
        precio: Number(producto.price),
        codigo: producto.code,
        nota: "Cargado. Si le falta la descripcion con material y medidas, el agente no podra responder esas preguntas.",
      };
    }

    case "editar_producto": {
      const productoId = texto(argumentos.producto_id);
      if (!productoId) {
        throw new Error("Falta el id del producto");
      }

      const suyo = await prisma.productPlaybook.findFirst({
        where: { productId: productoId, workspaceId: contexto.workspaceId },
        select: { id: true },
      });
      if (!suyo) {
        throw new Error("Ese producto no es de este negocio");
      }

      const producto = await prisma.product.update({
        where: { id: productoId },
        data: {
          ...(texto(argumentos.nombre) ? { name: texto(argumentos.nombre) } : {}),
          ...(numero(argumentos.precio) !== undefined ? { price: numero(argumentos.precio) } : {}),
          ...(argumentos.descripcion !== undefined ? { description: texto(argumentos.descripcion) ?? null } : {}),
          ...(argumentos.codigo !== undefined ? { code: texto(argumentos.codigo) ?? null } : {}),
          ...(numero(argumentos.precio_mayorista) !== undefined
            ? { wholesalePrice: numero(argumentos.precio_mayorista) }
            : {}),
          ...(numero(argumentos.cantidad_minima_mayorista) !== undefined
            ? { minWholesaleQty: numero(argumentos.cantidad_minima_mayorista) }
            : {}),
        },
        select: { id: true, name: true, price: true, code: true, description: true },
      });

      return {
        ok: true,
        producto_id: producto.id,
        nombre: producto.name,
        precio: Number(producto.price),
        codigo: producto.code,
        descripcion: producto.description,
      };
    }

    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
