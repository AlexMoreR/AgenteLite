import { Prisma } from "@prisma/client";

import { leerConfigDeAvisos } from "@/features/agente-v3/servicios/avisos";
import { CacheConTtl } from "@/lib/cache-en-memoria";
import { normalizarEtiqueta } from "@/lib/llamada-pide-resultado";
import { prisma } from "@/lib/prisma";

/**
 * QUIENES SON "DE ADENTRO" en la bandeja: el equipo y los proveedores.
 *
 * Es la regla UNICA que usan la lista de WhatsApp y la de la API oficial para separar los chats
 * de clientes de los avisos internos (ver `GrupoDeBandeja` en ../domain/filtros-de-bandeja).
 *
 * - EQUIPO: los contactos con la etiqueta EQUIPO, los numeros que reciben los avisos del agente
 *   (Mi empresa → Equipo) y los numeros de las lineas del propio negocio (el chat de una linea
 *   consigo misma o con otra linea). NO se usa `User.phone`: ese numero no se mantiene.
 * - PROVEEDOR: los contactos con la etiqueta PROVEEDOR (o PROVEEDORES).
 *
 * Un contacto que es de los dos queda solo en EQUIPO.
 *
 * Cambia muy de vez en cuando y se pide en cada refresco de la bandeja: se guarda un minuto. En
 * frio son DOS consultas (la configuracion de avisos y una sola en SQL para etiquetas, telefonos y
 * contactos), para no pasarse de los topes de check-velocidad-bandeja.
 */
export type ContactosInternos = {
  /** Contactos del CRM (`Contact.id`) del equipo. */
  equipoIds: string[];
  /** Contactos del CRM con PROVEEDOR que no son del equipo. */
  proveedorIds: string[];
  /** Los numeros del equipo, solo cifras, con y sin el 57 (para la API oficial). */
  variantesDeTelefono: string[];
  /** Las etiquetas EQUIPO y PROVEEDOR del negocio (ids de Tag). */
  etiquetasEquipoIds: string[];
  etiquetasProveedorIds: string[];
};

const NOMBRES_DE_EQUIPO = new Set(["equipo"]);
const NOMBRES_DE_PROVEEDOR = new Set(["proveedor", "proveedores"]);

function tipoDeEtiqueta(nombre: string | null, slug: string | null): "equipo" | "proveedor" | null {
  const textos = [normalizarEtiqueta(nombre), normalizarEtiqueta(slug)];
  if (textos.some((texto) => NOMBRES_DE_EQUIPO.has(texto))) return "equipo";
  if (textos.some((texto) => NOMBRES_DE_PROVEEDOR.has(texto))) return "proveedor";
  return null;
}

type FilaInterna = {
  tipo: "etiqueta" | "contactoConEtiqueta" | "variante" | "contactoPorTelefono";
  id: string;
  nombre: string | null;
  slug: string | null;
  etiquetaId: string | null;
};

/** La consulta unica (sin la configuracion de avisos). Exportada para las pruebas. */
export function sqlDeContactosInternos(workspaceId: string, numerosDeAvisos: string[]): Prisma.Sql {
  return Prisma.sql`
    WITH numeros AS (
      SELECT DISTINCT n FROM (
        SELECT unnest(${numerosDeAvisos}::text[]) AS n
        UNION ALL
        SELECT regexp_replace(w."phoneNumber", '[^0-9]', '', 'g') AS n
        FROM "WhatsAppChannel" w
        WHERE w."workspaceId" = ${workspaceId} AND w."phoneNumber" IS NOT NULL
      ) todos
      WHERE length(n) >= 10
    ),
    variantes AS (
      SELECT n AS v FROM numeros
      UNION SELECT substr(n, 3) FROM numeros WHERE n LIKE '57%' AND length(n) = 12
      UNION SELECT '57' || n FROM numeros WHERE length(n) = 10
    ),
    etiquetas AS (
      -- Filtro grueso en SQL; el exacto (normalizarEtiqueta) se hace en el codigo.
      SELECT t."id", t."name", t."slug"
      FROM "Tag" t
      WHERE t."workspaceId" = ${workspaceId}
        AND (lower(t."name") LIKE '%equipo%' OR lower(t."slug") LIKE '%equipo%'
          OR lower(t."name") LIKE '%proveedor%' OR lower(t."slug") LIKE '%proveedor%')
    )
    SELECT 'etiqueta' AS "tipo", e."id" AS "id", e."name" AS "nombre", e."slug" AS "slug", NULL::text AS "etiquetaId"
    FROM etiquetas e
    UNION ALL
    SELECT 'contactoConEtiqueta', ct."contactId", NULL, NULL, ct."tagId"
    FROM "ContactTag" ct
    WHERE ct."workspaceId" = ${workspaceId} AND ct."tagId" IN (SELECT e2."id" FROM etiquetas e2)
    UNION ALL
    SELECT 'variante', v, NULL, NULL, NULL FROM variantes
    UNION ALL
    SELECT 'contactoPorTelefono', ctc."id", NULL, NULL, NULL
    FROM "Contact" ctc
    WHERE ctc."workspaceId" = ${workspaceId} AND ctc."phoneNumber" IN (SELECT v2.v FROM variantes v2)
  `;
}

/** Arma el resultado con las filas de la consulta. Exportada para las pruebas. */
export function armarContactosInternos(filas: FilaInterna[]): ContactosInternos {
  const etiquetasEquipo = new Set<string>();
  const etiquetasProveedor = new Set<string>();
  for (const fila of filas) {
    if (fila.tipo !== "etiqueta") continue;
    const tipo = tipoDeEtiqueta(fila.nombre, fila.slug);
    if (tipo === "equipo") etiquetasEquipo.add(fila.id);
    if (tipo === "proveedor") etiquetasProveedor.add(fila.id);
  }

  const equipo = new Set<string>();
  const proveedor = new Set<string>();
  const variantes = new Set<string>();
  for (const fila of filas) {
    if (fila.tipo === "contactoPorTelefono") equipo.add(fila.id);
    else if (fila.tipo === "variante") variantes.add(fila.id);
    else if (fila.tipo === "contactoConEtiqueta" && fila.etiquetaId) {
      if (etiquetasEquipo.has(fila.etiquetaId)) equipo.add(fila.id);
      else if (etiquetasProveedor.has(fila.etiquetaId)) proveedor.add(fila.id);
    }
  }
  // EQUIPO gana: un contacto con las dos queda solo en el equipo.
  for (const id of equipo) proveedor.delete(id);

  return {
    equipoIds: [...equipo].sort(),
    proveedorIds: [...proveedor].sort(),
    variantesDeTelefono: [...variantes].sort(),
    etiquetasEquipoIds: [...etiquetasEquipo].sort(),
    etiquetasProveedorIds: [...etiquetasProveedor].sort(),
  };
}

const VIDA_DE_LA_CACHE_MS = 60_000;
const cache = new CacheConTtl<ContactosInternos>({ ttlMs: VIDA_DE_LA_CACHE_MS, maxEntradas: 50 });

export async function contactosInternos(workspaceId: string): Promise<ContactosInternos> {
  return cache.obtener(workspaceId, async () => {
    const config = await leerConfigDeAvisos(workspaceId).catch(() => null);
    const numeros = Array.from(new Set((config?.destinos ?? []).map((destino) => destino.numero)));
    const filas = await prisma.$queryRaw<FilaInterna[]>(sqlDeContactosInternos(workspaceId, numeros));
    return armarContactosInternos(filas);
  });
}

/** Para las pruebas. */
export function vaciarCacheDeContactosInternos() {
  cache.vaciar();
}
