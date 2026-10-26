import { resumenParaDecir, type FilaDePauta } from "@/features/pauta/dominio/reporte";
import { esDia, leerReporteDePauta } from "@/features/pauta/servicios/leer-reporte";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  VENTAS POR CAMPAÑA DESDE CLAUDE (solo lectura).

  Devuelve lo mismo que la pantalla CRM → Pauta (features/pauta/dominio/reporte.ts): por campaña y
  anuncio, gasto, chats, Calientes, ventas, monto, tasa de cierre y costo por venta, ordenado por
  ventas, más una frase para decir por voz. Sin fechas usa el mes en curso. No escribe nada y no le
  manda ningún cambio a Meta. El negocio sale de la clave, nunca de un argumento. Lo pueden usar las
  mismas personas que ven la pantalla: dueño, administradores y supervisora.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_VENTAS_POR_CAMPANA = [
  {
    name: "ventas_por_campana",
    title: "Ventas por campaña y anuncio",
    description:
      "Dice que campaña y que anuncio de Meta traen ventas: por campaña y anuncio, en un rango de fechas, el gasto (de Meta Ads, solo lectura), los chats que llegaron, cuantos llegaron a Caliente, las ventas, el monto vendido, la tasa de cierre (ventas / chats) y el costo por venta (gasto / ventas). Las ventas sin chat de anuncio salen en 'Organico / Marketplace / Otro'. Ordenado por ventas. Trae 'resumen_para_decir' para contestar por voz '¿que campana vendio este mes?'. Sin desde/hasta usa el mes en curso. Si falta la llave de Meta, el gasto sale 'no disponible'; si Gestion no da la lista de ventas, se cuentan los GANADO del CRM sin monto. Solo lectura: no cambia nada en Meta ni en el bot.",
    inputSchema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, el primer dia del mes en curso." },
        hasta: { type: "string", description: "AAAA-MM-DD (hora de Colombia), incluido. Por defecto, hoy." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_VENTAS_POR_CAMPANA.map((herramienta) => herramienta.name));

export function esHerramientaDeVentasPorCampana(nombre: string) {
  return NOMBRES.has(nombre);
}

function leerDia(valor: unknown, nombre: string): string | null {
  const dia = typeof valor === "string" ? valor.trim() : "";
  if (!dia) return null;
  if (!esDia(dia)) throw new Error(`${nombre} debe ser AAAA-MM-DD.`);
  return dia;
}

/** "—" cuando no hay dato, como en la pantalla. */
function filaParaClaude(f: FilaDePauta) {
  return {
    nombre: f.nombre,
    gasto: f.gasto,
    chats: f.chats,
    calientes: f.calientes,
    ventas: f.ventas,
    monto_vendido: f.monto,
    tasa_de_cierre_pct: f.tasaCierre === null ? "—" : Math.round(f.tasaCierre * 10) / 10,
    costo_por_venta: f.costoPorVenta === null ? "—" : Math.round(f.costoPorVenta),
  };
}

async function ventasPorCampana(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver la pauta: es solo del dueño, los administradores y la supervisora.");
  }
  const lectura = await leerReporteDePauta(contexto.workspaceId, { desde: leerDia(args.desde, "desde"), hasta: leerDia(args.hasta, "hasta") });
  const { reporte } = lectura;
  return {
    desde: lectura.desde,
    hasta: lectura.hasta,
    gasto_disponible: reporte.gastoDisponible,
    ventas_contadas_con: lectura.fuenteDeVentas === "gestion" ? "ventas pagadas de Gestión" : lectura.fuenteDeVentas === "crm" ? "GANADO del CRM (sin monto)" : "sin ventas guardadas en el rango",
    campanas: reporte.campanas.map((campana) => ({ ...filaParaClaude(campana), anuncios: campana.anuncios.map(filaParaClaude) })),
    organico_marketplace_otro: filaParaClaude(reporte.organico),
    total_pauta: filaParaClaude(reporte.total),
    resumen_para_decir: resumenParaDecir(reporte, lectura),
  };
}

export async function ejecutarHerramientaMcpVentasPorCampana(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "ventas_por_campana":
      return ventasPorCampana(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
