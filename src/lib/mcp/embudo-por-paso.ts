import { esDiaValido, familiaDePedido } from "@/features/embudo/dominio/comparar";
import { textoPorPaso } from "@/features/embudo/dominio/por-paso";
import { nombreDeFamilia } from "@/features/embudo/dominio/semanal";
import { leerEmbudoPorPaso } from "@/features/embudo/servicios/leer-embudo-por-paso";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  EMBUDO POR PASO DESDE CLAUDE (solo lectura).

  Devuelve lo mismo que la pantalla /cliente/crm/embudo-por-paso: por producto y rango de fechas,
  cuántos clientes llegaron a cada paso del bot (Presentación, Producto, Objeciones, Cierre), cuántos
  se quedaron en cada uno, el % que pasa de un paso al siguiente y el paso donde más se cae la gente,
  separando los chats que tomó una asesora. Usa EL MISMO cálculo que la pantalla
  (features/embudo/dominio/por-paso.ts).

  No escribe nada, no manda mensajes y no toca el bot. El negocio sale de la clave, nunca de un
  argumento. Lo pueden usar dueño, administradores y supervisora.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_EMBUDO_POR_PASO = [
  {
    name: "embudo_por_paso",
    title: "Embudo por paso del bot",
    description:
      "En que paso del bot se queda cada cliente. Por producto y rango de fechas (de entrada del chat): cuantos clientes llegaron a cada paso (Presentacion, Producto, Objeciones, Cierre), cuantos SE QUEDARON en cada uno (estan en ese paso y llevan mas de 24 horas sin escribir), el % que pasa de un paso al siguiente, el horas promedio en cada paso y el paso donde mas se cae la gente. Separa 'solo_bot' de 'con_asesora' (IA en pausa o chat asignado). Con menos de 30 clientes en un paso marca 'pocos_datos'. Trae 'resumen_para_decir' para la reunion de las 8:00 y la pagina 'Embudo en WhatsApp'. Solo lectura: no cambia el bot ni manda mensajes.",
    inputSchema: {
      type: "object",
      properties: {
        producto: {
          type: "string",
          description: "Familia de producto: combo, camillas, manicura, sillas, lavacabezas, marketplace u otros (tambien acepta el nombre). Por defecto combo.",
        },
        desde: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hace 30 dias." },
        hasta: { type: "string", description: "AAAA-MM-DD (hora de Colombia), incluido. Por defecto, hoy." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_EMBUDO_POR_PASO.map((herramienta) => herramienta.name));

export function esHerramientaDeEmbudoPorPaso(nombre: string) {
  return NOMBRES.has(nombre);
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function leerDia(valor: unknown, nombre: string): string | null {
  const dia = texto(valor);
  if (!dia) return null;
  if (!esDiaValido(dia)) throw new Error(`${nombre} debe ser AAAA-MM-DD.`);
  return dia;
}

async function embudoPorPaso(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver el embudo por paso: es solo del dueño, los administradores y la supervisora.");
  }
  const pedido = texto(args.producto);
  const familia = pedido ? familiaDePedido(pedido) : "combo";
  if (!familia) throw new Error(`No reconozco el producto "${pedido}". Usa combo, camillas, manicura, sillas, lavacabezas, marketplace u otros.`);

  const lectura = await leerEmbudoPorPaso(contexto.workspaceId, {
    familia,
    desde: leerDia(args.desde, "desde"),
    hasta: leerDia(args.hasta, "hasta"),
  });
  const base = { producto: nombreDeFamilia(familia), desde: lectura.desde, hasta: lectura.hasta };
  if (!lectura.activo) {
    return { ...base, resumen_para_decir: "El registro del embudo está apagado en este negocio: no hay datos." };
  }
  const grupo = (g: typeof lectura.embudo.soloBot) => ({
    chats: g.chats,
    pasos: g.pasos.map((paso) => ({
      paso: paso.nombre,
      llegaron: paso.llegaron,
      se_quedaron: paso.seQuedaron,
      pct_que_pasa_desde_el_paso_anterior: paso.pasaDesdeAnterior,
      horas_promedio_en_el_paso: paso.horasPromedio,
      pocos_datos: paso.pocosDatos,
    })),
    mayor_caida: g.mayorCaida
      ? { de: g.mayorCaida.desde, a: g.mayorCaida.hasta, pct_que_pasa: g.mayorCaida.pctQuePasa, se_caen: g.mayorCaida.seCaen }
      : null,
  });
  return {
    ...base,
    chats_en_total: lectura.embudo.total,
    solo_bot: grupo(lectura.embudo.soloBot),
    con_asesora: grupo(lectura.embudo.conAsesora),
    resumen_para_decir: textoPorPaso(lectura.embudo, nombreDeFamilia(familia)),
  };
}

export async function ejecutarHerramientaMcpEmbudoPorPaso(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "embudo_por_paso":
      return embudoPorPaso(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
