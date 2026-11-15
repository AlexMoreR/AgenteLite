import { Prisma } from "@prisma/client";

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
 * En frio es UNA sola SQL (la config de avisos, las etiquetas y los telefonos), y por un minuto
 * ninguna: la bandeja pide la lista cada pocos segundos y esto cambia muy de vez en cuando. Desde que
 * la vista por defecto es "clientes" (parte 4) esto corre en cada bandeja en frio: la config de
 * avisos va dentro de la misma SQL para no sumar una consulta (tope de check-velocidad-bandeja).
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

const NOMBRES_EQUIPO = ["equipo"];
const NOMBRES_PROVEEDOR = ["proveedor", "proveedores"];

const VIDA_DE_LA_CACHE_MS = 60_000;
const cacheDeInternos = new CacheConTtl<ContactosInternos>({ ttlMs: VIDA_DE_LA_CACHE_MS, maxEntradas: 50 });

/** Para las pruebas. */
export function vaciarCacheDeContactosInternos() {
  cacheDeInternos.vaciar();
}

/**
 * La clave de la config de avisos en AppSetting: la MISMA que usa leerConfigDeAvisos
 * (features/agente-v3/servicios/avisos, `CLAVE`). check-bandeja-sin-internos comprueba que coincidan.
 */
export const PREFIJO_CONFIG_DE_AVISOS = "agente-v3:avisos:";

/*
  Los numeros de `destinos[].numero` se sacan del texto guardado con una expresion regular y no con
  un cast a jsonb: un valor roto no tumba la bandeja (leerConfigDeAvisos tambien lo ignora). Como
  ahi, la config cuenta solo si tiene `canalId`. Van como parametros, sin barras invertidas en la SQL.
*/
const PATRON_CANAL_ID = '"canalId"[[:space:]]*:[[:space:]]*"[^"]+"';
const PATRON_NUMERO = '"numero"[[:space:]]*:[[:space:]]*"([^"]*)"';

/** ¿Que es esta etiqueta? Por nombre o slug, sin tildes ni mayusculas. */
export function tipoDeEtiquetaInterna(etiqueta: { name?: string | null; slug?: string | null }): "equipo" | "proveedor" | null {
  const textos = [normalizarEtiqueta(etiqueta.name), normalizarEtiqueta(etiqueta.slug)];
  if (textos.some((t) => NOMBRES_EQUIPO.includes(t))) return "equipo";
  if (textos.some((t) => NOMBRES_PROVEEDOR.includes(t))) return "proveedor";
  return null;
}

/**
 * La consulta unica (los numeros internos: las lineas del negocio y los `destinos` de la config de
 * avisos). Devuelve dos tipos de fila:
 * - "telefono": cada variante de un numero interno y, si hay, el contacto que tiene ese numero.
 * - "etiqueta": cada etiqueta candidata (el nombre o el slug contienen equipo/proveedor) y cada
 *   contacto que la tiene. La decision final (nombre exacto) la toma `tipoDeEtiquetaInterna`.
 */
export function sqlContactosInternos(workspaceId: string): Prisma.Sql {
  const sinTildes = (columna: Prisma.Sql) => Prisma.sql`translate(lower(${columna}), 'áéíóúü', 'aeiouu')`;
  const nombre = sinTildes(Prisma.sql`t."name"`);
  const slug = sinTildes(Prisma.sql`t."slug"`);
  return Prisma.sql`
    WITH config AS (
      SELECT s."value" AS v
      FROM "AppSetting" s
      WHERE s."key" = ${PREFIJO_CONFIG_DE_AVISOS + workspaceId} AND s."value" ~ ${PATRON_CANAL_ID}
    ),
    numeros AS (
      SELECT regexp_replace(ch."phoneNumber", '[^0-9]', '', 'g') AS n
      FROM "WhatsAppChannel" ch
      WHERE ch."workspaceId" = ${workspaceId} AND ch."phoneNumber" IS NOT NULL
      UNION
      SELECT regexp_replace(r.m[1], '[^0-9]', '', 'g')
      FROM config, regexp_matches(config.v, ${PATRON_NUMERO}, 'g') AS r(m)
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

/**
 * Lo mismo, pero si la consulta falla devuelve null y lo anota (`donde`): sin los internos el grupo
 * no filtra y la bandeja sale con todo, en vez de caerse. Desde que la vista por defecto es
 * "clientes" esto corre en cada bandeja (lista, pantalla y linea oficial), no solo en las pastillas.
 */
export async function contactosInternosSiSePuede(workspaceId: string, donde: string): Promise<ContactosInternos | null> {
  try {
    return await contactosInternos(workspaceId);
  } catch (error) {
    console.error(`[${donde}] no se pudieron leer los contactos internos`, error);
    return null;
  }
}

export async function contactosInternos(workspaceId: string): Promise<ContactosInternos> {
  return cacheDeInternos.obtener(workspaceId, async () => {
    const filas = await prisma.$queryRaw<FilaDeInternos[]>(sqlContactosInternos(workspaceId));
    return armarContactosInternos(filas);
  });
}
