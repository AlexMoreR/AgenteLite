import { Prisma } from "@prisma/client";

import { leerConfigDeAvisos } from "@/features/agente-v3/servicios/avisos";
import { CacheConTtl } from "@/lib/cache-en-memoria";
import { normalizarEtiqueta } from "@/lib/llamada-pide-resultado";
import { prisma } from "@/lib/prisma";

/**
 * QUIEN ES DEL EQUIPO Y QUIEN ES PROVEEDOR: los contactos que la bandeja separa de los clientes
 * (ver `whereDeGrupo` en ./filtros-de-bandeja).
 *
 * Del EQUIPO son:
 * - los contactos con la etiqueta EQUIPO;
 * - los numeros que reciben los avisos internos ("Necesita atención", el Supervisor): Mi empresa →
 *   Equipo, guardados en la config de avisos;
 * - las propias lineas del negocio (`WhatsAppChannel.phoneNumber`): un chat de una linea con otra.
 * PROVEEDORES: la etiqueta PROVEEDOR (o PROVEEDORES). Un contacto con las dos queda solo en el equipo.
 *
 * No se usa `User.phone`: no es el numero de avisos y muchas veces esta vacio o es otro.
 *
 * Los telefonos se comparan con y sin el 57 (Colombia): un contacto guardado "3001234567" y un
 * aviso a "573001234567" son la misma persona.
 *
 * En frio es UNA consulta (la config de avisos se lee dentro de la misma SQL que etiquetas y
 * telefonos), y por un minuto ninguna: la bandeja pide la lista cada pocos segundos y esto cambia
 * muy de vez en cuando. Desde la parte 4 la vista por defecto (clientes) la usa en cada pedido, y el
 * tope de consultas de /list no se sube. Si esa SQL falla (una base sin pg_input_is_valid, por
 * ejemplo), se cae al camino de antes: la config por Prisma y la SQL con los numeros ya leidos.
 */

export type ContactosInternos = {
  /** Contact.id del equipo (etiqueta EQUIPO o un numero interno). */
  equipoIds: string[];
  /** Contact.id con etiqueta PROVEEDOR que NO son del equipo. */
  proveedorIds: string[];
  /** Los numeros internos, solo digitos, con y sin 57 (para la linea oficial: phoneNumber / waId). */
  variantesDeTelefono: string[];
  /** Los Tag.id que cuentan como EQUIPO y como PROVEEDOR. */
  etiquetasEquipoIds: string[];
  etiquetasProveedorIds: string[];
};

/** La clave de la config de avisos (la misma de agente-v3/servicios/avisos). */
const CLAVE_DE_AVISOS = "agente-v3:avisos:";

const NOMBRES_EQUIPO = ["equipo"];
const NOMBRES_PROVEEDOR = ["proveedor", "proveedores"];

const VIDA_DE_LA_CACHE_MS = 60_000;
const cacheDeInternos = new CacheConTtl<ContactosInternos>({ ttlMs: VIDA_DE_LA_CACHE_MS, maxEntradas: 50 });

/** Para las pruebas. */
export function vaciarCacheDeContactosInternos() {
  cacheDeInternos.vaciar();
}

/** ¿Que es esta etiqueta? Por nombre o slug, sin tildes ni mayusculas. */
export function tipoDeEtiquetaInterna(etiqueta: { name?: string | null; slug?: string | null }): "equipo" | "proveedor" | null {
  const textos = [normalizarEtiqueta(etiqueta.name), normalizarEtiqueta(etiqueta.slug)];
  if (textos.some((t) => NOMBRES_EQUIPO.includes(t))) return "equipo";
  if (textos.some((t) => NOMBRES_PROVEEDOR.includes(t))) return "proveedor";
  return null;
}

/**
 * La consulta unica. Devuelve dos tipos de fila:
 * - "telefono": cada variante de un numero interno y, si hay, el contacto que tiene ese numero.
 * - "etiqueta": cada etiqueta candidata (el nombre o el slug contienen equipo/proveedor) y cada
 *   contacto que la tiene. La decision final (nombre exacto) la toma `tipoDeEtiquetaInterna`.
 *
 * `numerosDeAvisos` null: los numeros de avisos se leen de la config guardada (`AppSetting`) en la
 * misma consulta, con las reglas de `leerConfigDeAvisos`: JSON valido, con `canalId` y `destinos`.
 * Con una lista, se usa esa (el camino de respaldo).
 */
export function sqlContactosInternos(workspaceId: string, numerosDeAvisos: string[] | null): Prisma.Sql {
  const sinTildes = (columna: Prisma.Sql) => Prisma.sql`translate(lower(${columna}), 'áéíóúü', 'aeiouu')`;
  const nombre = sinTildes(Prisma.sql`t."name"`);
  const slug = sinTildes(Prisma.sql`t."slug"`);
  const deLosAvisos =
    numerosDeAvisos === null
      ? Prisma.sql`
      SELECT regexp_replace(d->>'numero', '[^0-9]', '', 'g')
      FROM (
        SELECT s."value"::jsonb AS v
        FROM "AppSetting" s
        WHERE s."key" = ${`${CLAVE_DE_AVISOS}${workspaceId}`} AND pg_input_is_valid(s."value", 'jsonb')
      ) cfg
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(cfg.v -> 'destinos') = 'array' THEN cfg.v -> 'destinos' ELSE '[]'::jsonb END
      ) AS d
      WHERE coalesce(cfg.v ->> 'canalId', '') <> '' AND jsonb_typeof(d -> 'numero') = 'string'`
      : Prisma.sql`
      SELECT regexp_replace(a.n, '[^0-9]', '', 'g') FROM unnest(${numerosDeAvisos}::text[]) AS a(n)`;
  return Prisma.sql`
    WITH numeros AS (
      SELECT regexp_replace(ch."phoneNumber", '[^0-9]', '', 'g') AS n
      FROM "WhatsAppChannel" ch
      WHERE ch."workspaceId" = ${workspaceId} AND ch."phoneNumber" IS NOT NULL
      UNION
      ${deLosAvisos}
    ),
    variantes AS (
      SELECT n FROM numeros WHERE length(n) >= 10
      UNION
      SELECT substr(n, 3) FROM numeros WHERE length(n) = 12 AND n LIKE '57%'
      UNION
      SELECT '57' || n FROM numeros WHERE length(n) = 10
    )
    SELECT 'telefono' AS "tipo", v.n AS "valor", co."id" AS "contactId", NULL::text AS "nombre", NULL::text AS "slug"
    FROM variantes v
    LEFT JOIN "Contact" co ON co."workspaceId" = ${workspaceId} AND co."phoneNumber" = v.n
    UNION ALL
    SELECT 'etiqueta', t."id", ct."contactId", t."name", t."slug"
    FROM "Tag" t
    LEFT JOIN "ContactTag" ct ON ct."tagId" = t."id"
    WHERE t."workspaceId" = ${workspaceId}
      AND (${nombre} LIKE '%equipo%' OR ${slug} LIKE '%equipo%'
        OR ${nombre} LIKE '%proveedor%' OR ${slug} LIKE '%proveedor%')
  `;
}

export type FilaDeInternos = {
  tipo: "telefono" | "etiqueta";
  valor: string;
  contactId: string | null;
  nombre: string | null;
  slug: string | null;
};

/** Las filas de la consulta, ordenadas en las cinco listas. Sin base: se prueba sola. */
export function armarContactosInternos(filas: readonly FilaDeInternos[]): ContactosInternos {
  const equipo = new Set<string>();
  const proveedores = new Set<string>();
  const variantes = new Set<string>();
  const etiquetasEquipo = new Set<string>();
  const etiquetasProveedor = new Set<string>();

  for (const fila of filas) {
    if (fila.tipo === "telefono") {
      if (fila.valor) variantes.add(fila.valor);
      if (fila.contactId) equipo.add(fila.contactId);
      continue;
    }
    const tipo = tipoDeEtiquetaInterna({ name: fila.nombre, slug: fila.slug });
    if (tipo === "equipo") {
      etiquetasEquipo.add(fila.valor);
      if (fila.contactId) equipo.add(fila.contactId);
    } else if (tipo === "proveedor") {
      etiquetasProveedor.add(fila.valor);
      if (fila.contactId) proveedores.add(fila.contactId);
    }
  }
  // EQUIPO gana: un contacto con las dos etiquetas (o proveedor con numero interno) es del equipo.
  for (const id of equipo) proveedores.delete(id);

  const ordenada = (conjunto: Set<string>) => [...conjunto].sort();
  return {
    equipoIds: ordenada(equipo),
    proveedorIds: ordenada(proveedores),
    variantesDeTelefono: ordenada(variantes),
    etiquetasEquipoIds: ordenada(etiquetasEquipo),
    etiquetasProveedorIds: ordenada(etiquetasProveedor),
  };
}

export async function contactosInternos(workspaceId: string): Promise<ContactosInternos> {
  return cacheDeInternos.obtener(workspaceId, async () => {
    try {
      const filas = await prisma.$queryRaw<FilaDeInternos[]>(sqlContactosInternos(workspaceId, null));
      return armarContactosInternos(filas);
    } catch (error) {
      console.warn("[contactos-internos] la consulta unica fallo; se leen los avisos aparte", error);
      const config = await leerConfigDeAvisos(workspaceId);
      const numeros = Array.from(new Set((config?.destinos ?? []).map((destino) => destino.numero).filter(Boolean)));
      const filas = await prisma.$queryRaw<FilaDeInternos[]>(sqlContactosInternos(workspaceId, numeros));
      return armarContactosInternos(filas);
    }
  });
}
