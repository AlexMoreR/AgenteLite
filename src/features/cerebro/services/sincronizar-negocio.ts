import { prisma } from "@/lib/prisma";
import { almacenDeLaBase } from "./almacen";
import { driveDelNegocio, modoDelCerebro } from "./conexion";
import { sincronizarConAlmacen, type ResultadoDeSincronizacion } from "./sincronizar";

/** Sincroniza el cerebro de un negocio con su Drive (el botón "Sincronizar ahora" y la vuelta de cada hora). */
export async function sincronizarElCerebro(workspaceId: string): Promise<ResultadoDeSincronizacion> {
  try {
    const { drive, conexion } = await driveDelNegocio(workspaceId);
    if (!conexion.carpetaId) throw new Error("Falta elegir la carpeta del cerebro.");
    return await sincronizarConAlmacen({ workspaceId, carpetaId: conexion.carpetaId, drive, almacen: almacenDeLaBase });
  } catch (fallo) {
    const error = fallo instanceof Error ? fallo.message : "No se pudo sincronizar";
    await almacenDeLaBase.anotarSincronizacion(workspaceId, { ok: false, error }, new Date()).catch(() => undefined);
    return { ok: false, nuevos: 0, cambiados: 0, movidos: 0, ausentes: 0, sinCambio: 0, noSePudoLeer: [], truncado: false, error };
  }
}

/**
 * La vuelta de cada hora (la llama el reloj del servidor). Sin ninguna conexión es UNA consulta y sale.
 * Un negocio que falla no frena a los demás.
 */
export async function sincronizarCerebroDeTodos() {
  const conexiones = await prisma.cerebroConexion.findMany({
    // Con la cuenta de servicio no hay permiso guardado: basta con la carpeta elegida.
    where: modoDelCerebro() === "cuenta-servicio" ? { carpetaId: { not: null } } : { tokenCifrado: { not: null }, carpetaId: { not: null } },
    select: { workspaceId: true },
  });
  let bien = 0;
  let mal = 0;
  for (const { workspaceId } of conexiones) {
    const resultado = await sincronizarElCerebro(workspaceId);
    if (resultado.ok) bien += 1;
    else mal += 1;
  }
  return { negocios: conexiones.length, bien, mal };
}
