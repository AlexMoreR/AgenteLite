import { prisma } from "@/lib/prisma";
import type { ClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { alcanceDe, historialDeTarjeta, linkDeLaTarjeta } from "@/features/tableros-inteligentes/services/tableros";
import { conclusionSugerida, documentoSugerido, sePuedePasarAlCerebro } from "./reglas";
import { textoDelPaso } from "./textos";
import { permisosDelCerebro } from "./permisos";
import { escribirEnElCerebro } from "./escribir";
import { filasDelCerebro } from "./consultas";

/*
  CEREBRO: el puente con el Tablero IA, "Pasar al cerebro". Desde una tarjeta HECHA (o de un tipo llamado
  "Decisión") se escribe SOLO la conclusión —no la tarjeta entera— en el documento que corresponda, con
  la fecha y el link a la tarjeta. Queda anotado en el historial de la tarjeta y en el registro del cerebro.
*/

type Acceso = Pick<ClientWorkspaceAccess, "userId" | "workspaceId" | "isOwner" | "role" | "membershipRole">;

async function tarjetaPasable(acceso: Acceso, tarjetaId: string) {
  const { tarjeta } = await historialDeTarjeta(alcanceDe(acceso), tarjetaId);
  const tipo = await prisma.tipoTarjeta.findUnique({ where: { id: tarjeta.tipoId }, select: { nombre: true } });
  if (!sePuedePasarAlCerebro(tarjeta, tipo?.nombre)) {
    throw new Error('"Pasar al cerebro" solo se hace con una tarjeta HECHA o de un tipo "Decisión".');
  }
  return tarjeta;
}

export type PreparacionDelPaso = {
  titulo: string;
  conclusion: string;
  link: string;
  /** Documentos .md/.txt donde se puede agregar, y carpetas donde se puede crear uno nuevo. */
  documentos: Array<{ driveId: string; ruta: string }>;
  carpetas: Array<{ driveId: string | null; ruta: string }>;
  sugerido: { driveId: string; ruta: string } | null;
  conectado: boolean;
};

export async function prepararPasoAlCerebro(acceso: Acceso, tarjetaId: string): Promise<PreparacionDelPaso> {
  const permisos = await permisosDelCerebro(acceso);
  if (!permisos.ver) throw new Error("No tienes acceso al cerebro.");
  const tarjeta = await tarjetaPasable(acceso, tarjetaId);
  const conexion = await prisma.cerebroConexion.findUnique({ where: { workspaceId: acceso.workspaceId }, select: { carpetaId: true } });
  const filas = (await filasDelCerebro(acceso.workspaceId)).filter((fila) => fila.enDrive);
  const documentos = filas.filter((fila) => fila.escribible).map((fila) => ({ driveId: fila.driveId, ruta: fila.ruta }));
  return {
    titulo: tarjeta.titulo,
    conclusion: conclusionSugerida(tarjeta),
    link: linkDeLaTarjeta(tarjeta.id),
    documentos,
    carpetas: [
      { driveId: null, ruta: "(la carpeta principal del cerebro)" },
      ...filas.filter((fila) => fila.esCarpeta).map((fila) => ({ driveId: fila.driveId, ruta: fila.ruta })),
    ],
    sugerido: documentoSugerido(
      filas.filter((fila) => !fila.esCarpeta).map((fila) => ({ driveId: fila.driveId, nombre: fila.nombre, ruta: fila.ruta, legibleParaEscribir: fila.escribible })),
      tarjeta.titulo,
    ),
    conectado: Boolean(conexion?.carpetaId),
  };
}

export type PedidoDelPaso = {
  tarjetaId: string;
  conclusion: string;
  /** Agregar al final de este documento… */
  driveId?: string;
  /** …o crear uno nuevo (con este nombre, en esta carpeta; sin carpeta = la principal). */
  nombreNuevo?: string;
  carpetaId?: string | null;
};

export async function pasarAlCerebro(acceso: Acceso, pedido: PedidoDelPaso) {
  const tarjeta = await tarjetaPasable(acceso, pedido.tarjetaId);
  if (!pedido.conclusion.trim()) throw new Error("Falta la conclusión que se va a guardar.");
  const bloque = textoDelPaso({ conclusion: pedido.conclusion, titulo: tarjeta.titulo, link: linkDeLaTarjeta(tarjeta.id) });
  const nuevo = !pedido.driveId;
  const resultado = await escribirEnElCerebro({
    workspaceId: acceso.workspaceId,
    userId: acceso.userId,
    origen: "TABLERO",
    modo: nuevo ? "crear" : "agregar",
    contenido: bloque,
    ...(nuevo ? { nombre: pedido.nombreNuevo, carpetaId: pedido.carpetaId ?? undefined } : { driveId: pedido.driveId }),
    tarjetaId: tarjeta.id,
  });
  // Queda anotado en el historial de la tarjeta (la acción es texto: no hace falta migrar).
  await prisma.historialTarjeta.create({
    data: {
      tarjetaId: tarjeta.id,
      quien: acceso.userId,
      origen: "PANTALLA",
      accion: "cerebro",
      despues: {
        documento: resultado.ruta,
        driveId: resultado.driveId,
        accion: resultado.accion,
        ...(resultado.pendiente ? { notaPorCrearEnAizen1: resultado.pendiente.id } : {}),
      },
    },
  });
  return resultado;
}
