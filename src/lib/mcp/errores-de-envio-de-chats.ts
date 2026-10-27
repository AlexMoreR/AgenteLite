import { prisma } from "@/lib/prisma";
import { esDia } from "@/features/pauta/servicios/leer-reporte";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  ERRORES DE ENVIO DE CHATS DESDE CLAUDE (solo lectura).

  Cuenta los textos del chat que no salieron (tabla ChatSendError, que llena la ruta
  /api/cliente/chats/enviar): por dia, por linea y por motivo. Sirve para medir la queja de las
  asesoras ("al enviar sale error y toca recargar"): una semana despues de arreglarlo, los errores
  por dia deben estar cerca de cero. No escribe nada ni envia nada. El negocio sale de la clave.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const DIAS_POR_DEFECTO = 7;

export const HERRAMIENTAS_MCP_ERRORES_DE_ENVIO = [
  {
    name: "errores_de_envio_de_chats",
    title: "Errores de envío de chats",
    description:
      "Cuenta los textos de /cliente/chats que NO salieron, para medir si las asesoras todavia tienen que recargar para enviar: errores por dia, por linea (con su gateway: WAHA, Evolution GO, Evolution API u oficial) y por motivo (version_vieja, sin_red, timeout_gateway, gateway_rechazo, conexion_cerrada, guardado_fallo, sin_sesion, otro), mas los ultimos errores con hora y linea. Cada fila es un intento fallido (un mensaje puede sumar hasta 3 antes de salir solo). Sin desde/hasta usa los ultimos 7 dias. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hace 7 dias." },
        hasta: { type: "string", description: "AAAA-MM-DD (hora de Colombia), incluido. Por defecto, hoy." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_ERRORES_DE_ENVIO.map((herramienta) => herramienta.name));

export function esHerramientaDeErroresDeEnvio(nombre: string) {
  return NOMBRES.has(nombre);
}

function leerDia(valor: unknown, nombre: string): string | null {
  const dia = typeof valor === "string" ? valor.trim() : "";
  if (!dia) return null;
  if (!esDia(dia)) throw new Error(`${nombre} debe ser AAAA-MM-DD.`);
  return dia;
}

/** Colombia es UTC-5 todo el año: medianoche local = 05:00 UTC. */
function inicioDelDia(dia: string) {
  return new Date(`${dia}T05:00:00.000Z`);
}

function diaDeColombia(fecha: Date) {
  return new Date(fecha.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function erroresDeEnvio(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver esto: es solo del dueño, los administradores y la supervisora.");
  }
  const hoy = diaDeColombia(new Date());
  const hasta = leerDia(args.hasta, "hasta") ?? hoy;
  const desde =
    leerDia(args.desde, "desde") ?? diaDeColombia(new Date(inicioDelDia(hasta).getTime() - (DIAS_POR_DEFECTO - 1) * 86_400_000));
  const inicio = inicioDelDia(desde);
  const fin = new Date(inicioDelDia(hasta).getTime() + 86_400_000);

  const filas = await prisma.chatSendError.findMany({
    where: { workspaceId: contexto.workspaceId, createdAt: { gte: inicio, lt: fin } },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: {
      createdAt: true,
      lineaNombre: true,
      gateway: true,
      motivo: true,
      detalle: true,
      intento: true,
      origen: true,
    },
  });

  const contar = <T extends string>(claves: T[]) => {
    const conteo = new Map<string, number>();
    for (const clave of claves) conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
    return conteo;
  };
  const ordenado = (mapa: Map<string, number>) =>
    [...mapa.entries()].sort((a, b) => b[1] - a[1]).map(([nombre, errores]) => ({ nombre, errores }));

  const porDia = contar(filas.map((fila) => diaDeColombia(fila.createdAt)));
  const dias: Array<{ dia: string; errores: number }> = [];
  for (let t = inicioDelDia(desde).getTime(); t < fin.getTime(); t += 86_400_000) {
    const dia = diaDeColombia(new Date(t));
    dias.push({ dia, errores: porDia.get(dia) ?? 0 });
  }

  return {
    desde,
    hasta,
    total_errores: filas.length,
    por_dia: dias,
    por_linea: ordenado(contar(filas.map((fila) => `${fila.lineaNombre ?? "sin línea"} (${fila.gateway ?? "?"})`))),
    por_motivo: ordenado(contar(filas.map((fila) => fila.motivo))),
    ultimos: filas.slice(0, 20).map((fila) => ({
      hora: fila.createdAt.toISOString(),
      linea: fila.lineaNombre,
      gateway: fila.gateway,
      motivo: fila.motivo,
      intento: fila.intento,
      origen: fila.origen,
      detalle: fila.detalle,
    })),
    nota: filas.length >= 5000 ? "Hay mas de 5000 errores en el rango: el conteo esta cortado." : undefined,
  };
}

export async function ejecutarHerramientaMcpErroresDeEnvio(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "errores_de_envio_de_chats":
      return erroresDeEnvio(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
