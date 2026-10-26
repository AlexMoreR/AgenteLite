import { claveHerramientaParaContar, clavePantallaParaContar, hoyEnBogota, type TipoDeUso } from "@/features/agentes-de-area/dominio/reglas";
import { prisma } from "@/lib/prisma";

/**
 * EL CONTADOR DE USO (Agente de Sistemas). Suma una visita a una pantalla o una llamada a una herramienta del MCP en
 * `UsoDelSistemaDia` (una fila por negocio, día, tipo, clave y persona). NUNCA frena ni rompe a quien lo llama: si la
 * base falla, se traga el error. Las visitas y llamadas del propio Agente de Sistemas no se cuentan.
 */

type Uso = { workspaceId: string; tipo: TipoDeUso; clave: string; quien: string };

async function sumar({ workspaceId, tipo, clave, quien }: Uso): Promise<void> {
  const fecha = hoyEnBogota();
  await prisma.usoDelSistemaDia.upsert({
    where: { workspaceId_fecha_tipo_clave_quien: { workspaceId, fecha, tipo, clave, quien } },
    create: { workspaceId, fecha, tipo, clave, quien, veces: 1 },
    update: { veces: { increment: 1 } },
  });
}

/** Cuenta una pantalla `/cliente/...` que abrió alguien del equipo. Devuelve sin esperar a nadie y nunca lanza. */
export async function contarPantalla(args: { workspaceId: string; userId: string; ruta: unknown }): Promise<void> {
  try {
    const clave = clavePantallaParaContar(args.ruta);
    if (clave) await sumar({ workspaceId: args.workspaceId, tipo: "pantalla", clave, quien: args.userId });
  } catch {
    // El contador es un extra: si falla, la pantalla sigue igual.
  }
}

/** Cuenta una llamada a una herramienta del MCP. Nunca lanza. */
export async function contarHerramienta(args: { workspaceId: string; userId: string; nombre: unknown }): Promise<void> {
  try {
    const clave = claveHerramientaParaContar(args.nombre);
    if (clave) await sumar({ workspaceId: args.workspaceId, tipo: "herramienta", clave, quien: args.userId });
  } catch {
    // Igual: nunca rompe la herramienta.
  }
}
