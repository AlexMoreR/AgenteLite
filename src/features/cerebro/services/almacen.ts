import { prisma } from "@/lib/prisma";
import type { AlmacenDelCerebro } from "./sincronizar";

/** El almacén real del cerebro: la copia en la base (CerebroDocumento) y la conexión (CerebroConexion). */
export const almacenDeLaBase: AlmacenDelCerebro = {
  async copia(workspaceId) {
    const filas = await prisma.cerebroDocumento.findMany({
      where: { workspaceId },
      select: {
        driveId: true,
        nombre: true,
        ruta: true,
        tipo: true,
        padreId: true,
        versionDrive: true,
        modificadoEnDrive: true,
        enDrive: true,
        texto: true,
      },
    });
    return filas.map((fila) => ({
      driveId: fila.driveId,
      nombre: fila.nombre,
      ruta: fila.ruta,
      tipo: fila.tipo,
      padreId: fila.padreId,
      versionDrive: fila.versionDrive,
      modificadoEnDrive: fila.modificadoEnDrive ? fila.modificadoEnDrive.toISOString() : null,
      enDrive: fila.enDrive,
      tieneTexto: fila.texto !== null,
    }));
  },

  async guardar(workspaceId, archivo, texto, ahora) {
    const ficha = {
      padreId: archivo.padreId,
      nombre: archivo.nombre,
      ruta: archivo.ruta,
      tipo: archivo.tipo,
      esCarpeta: archivo.esCarpeta,
      modificadoEnDrive: archivo.modificadoEnDrive ? new Date(archivo.modificadoEnDrive) : null,
      versionDrive: archivo.versionDrive,
      linkDrive: archivo.linkDrive,
      enDrive: true,
      sincronizadoEn: ahora,
    };
    // texto null = solo cambió la ficha (nombre o lugar): el texto que ya está se deja.
    const conTexto = texto ? { texto: texto.texto, textoTruncado: texto.truncado } : {};
    await prisma.cerebroDocumento.upsert({
      where: { workspaceId_driveId: { workspaceId, driveId: archivo.driveId } },
      create: { workspaceId, driveId: archivo.driveId, ...ficha, ...conTexto },
      update: { ...ficha, ...conTexto },
    });
  },

  async marcarAusentes(workspaceId, driveIds, ahora) {
    await prisma.cerebroDocumento.updateMany({
      where: { workspaceId, driveId: { in: driveIds } },
      data: { enDrive: false, sincronizadoEn: ahora },
    });
  },

  async anotarSincronizacion(workspaceId, resultado, ahora) {
    await prisma.cerebroConexion.updateMany({
      where: { workspaceId },
      data: resultado.ok ? { ultimaSincronizacion: ahora, ultimoError: null } : { ultimoError: resultado.error?.slice(0, 500) ?? "error" },
    });
  },
};
