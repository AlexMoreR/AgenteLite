import { prisma } from "@/lib/prisma";

/**
 * EL CONTADOR DE USO (Agente de Sistemas).
 *
 * Hoy el CRM no guarda cuántas veces se abre una pantalla ni cuántas veces se llama una herramienta del MCP, y
 * sin eso nadie puede decir si lo que se construyó se usa. Esto suma UNA vez por día, tipo, clave y persona.
 *
 * Nunca frena ni rompe nada: si la base falla, se ignora. Se llama sin `await` desde el latido y desde el MCP.
 * Solo cuenta desde el día que se sube: lo de antes no tiene uso medido.
 */

export type TipoDeUso = "PANTALLA" | "HERRAMIENTA";

/** Las herramientas del propio Agente de Sistemas no se cuentan: inflarían el uso de lo que revisa. */
export const HERRAMIENTAS_QUE_NO_CUENTAN: ReadonlySet<string> = new Set(["revision_de_sistemas", "agente_de_sistemas"]);

/** El día de hoy en Colombia (sin horario de verano: desfase fijo de 5 h). */
export function diaDeUso(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** La ruta sin parámetros ni número de chat: "/cliente/chats/abc?x=1" se cuenta en "/cliente/chats". Solo /cliente/*. */
export function rutaParaContar(ruta: string): string | null {
  const limpia = ruta.split(/[?#]/)[0].trim();
  if (!limpia.startsWith("/cliente")) return null;
  if (limpia.startsWith("/cliente/chats/")) return "/cliente/chats";
  return limpia.replace(/\/+$/, "").slice(0, 200) || null;
}

type Uso = { workspaceId: string; tipo: TipoDeUso; clave: string; quien: string; fecha?: string };

/** Suma 1 al contador. Devuelve una promesa que NUNCA rechaza. */
export function registrarUso(uso: Uso): Promise<void> {
  const clave = uso.tipo === "PANTALLA" ? rutaParaContar(uso.clave) : uso.clave.slice(0, 120);
  if (!clave || !uso.quien) return Promise.resolve();
  if (uso.tipo === "HERRAMIENTA" && HERRAMIENTAS_QUE_NO_CUENTAN.has(clave)) return Promise.resolve();
  const fecha = uso.fecha ?? diaDeUso();
  try {
    return Promise.resolve(
      prisma.usoDelSistemaDia.upsert({
        where: { workspaceId_fecha_tipo_clave_quien: { workspaceId: uso.workspaceId, fecha, tipo: uso.tipo, clave, quien: uso.quien } },
        create: { workspaceId: uso.workspaceId, fecha, tipo: uso.tipo, clave, quien: uso.quien, veces: 1 },
        update: { veces: { increment: 1 } },
      }),
    ).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}
