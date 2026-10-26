import { esDiaValido, familiaDePedido } from "@/features/embudo/dominio/comparar";
import { PASOS_DEL_REPORTE, textoDelEmbudoPorPaso, type GrupoPorPaso } from "@/features/embudo/dominio/por-paso";
import { nombreDeFamilia } from "@/features/embudo/dominio/semanal";
import { leerEmbudoPorPaso } from "@/features/embudo/servicios/leer-embudo-por-paso";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  EMBUDO POR PASO DESDE CLAUDE (solo lectura).

  Devuelve lo mismo que la pantalla /cliente/crm/embudo-por-paso: por producto y rango de fechas,
  cuántos clientes llegaron a cada paso del bot (Presentación, Producto, Objeciones, Cierre),
  cuántos se quedaron en cada uno (más de 24 horas sin escribir), el % que pasa de un paso al
  siguiente y el tiempo promedio en cada paso. Separa "solo el bot" de "lo tomó una asesora". Usa
  EL MISMO cálculo que la pantalla (features/embudo/dominio/por-paso.ts).

  No escribe nada, no manda mensajes y no toca el bot. El negocio sale de la clave, nunca de un
  argumento. Lo pueden usar las mismas personas que ven la pantalla: dueño, administradores y
  supervisora.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_EMBUDO_POR_PASO = [
  {
    name: "embudo_por_paso",
    title: "Embudo por paso del bot",
    description:
      "En que paso del bot se queda cada cliente. Por producto y rango de fechas (de entrada del chat, hora de Colombia) devuelve, para cada paso (Presentacion, Producto, Objeciones, Cierre): cuantos clientes llegaron, cuantos se quedaron ahi (su paso actual y mas de 24 horas sin escribir), el % que pasa al siguiente paso y las horas promedio en el paso. Separa los chats que atendio solo el bot de los que tomo una asesora (IA en pausa o chat asignado). Trae 'paso_donde_mas_se_cae' y 'resumen_para_decir' (una frase para la reunion de las 8:00 y la pagina Embudo en WhatsApp), y avisa 'pocos_datos' si un paso tiene menos de 30 clientes. Solo lectura: no cambia el bot ni manda mensajes.",
    inputSchema: {
      type: "object",
      properties: {
        producto: {
          type: "string",
          description: "Familia de producto: combo, camillas, manicura, sillas, lavacabezas, marketplace u otros (tambien acepta el nombre, ej. 'camillas'). Por defecto combo.",
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

function resumirGrupo(grupo: GrupoPorPaso) {
  return {
    clientes: grupo.total,
    pasos: grupo.pasos.map((paso) => ({
      paso: paso.nombre,
      llegaron: paso.llegaron,
      se_quedaron_aqui: paso.seQuedaron,
      pct_de_los_clientes: paso.pctDelTotal,
      pct_que_pasa_al_siguiente: paso.tasaAlSiguiente,
      horas_promedio_en_el_paso: paso.horasPromedio,
      pocos_datos: paso.pocosDatos,
    })),
    paso_donde_mas_se_cae: grupo.mayorCaida
      ? {
          entre: `${grupo.mayorCaida.desdeNombre} y ${grupo.mayorCaida.haciaNombre}`,
          pct_que_no_pasa: grupo.mayorCaida.pctQueNoPaso,
          clientes_que_quedaron: grupo.mayorCaida.quedaron,
        }
      : null,
  };
}

async function embudoPorPaso(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver el embudo por paso: es solo del dueño, los administradores y la supervisora.");
  }
  const pedidoProducto = texto(args.producto);
  const familia = pedidoProducto ? familiaDePedido(pedidoProducto) : "combo";
  if (!familia) throw new Error(`No reconozco el producto "${pedidoProducto}". Usa combo, camillas, manicura, sillas, lavacabezas, marketplace u otros.`);
  const desde = leerDia(args.desde, "desde");
  const hasta = leerDia(args.hasta, "hasta");
  if (desde && hasta && desde > hasta) throw new Error("desde no puede ser posterior a hasta.");

  const lectura = await leerEmbudoPorPaso(contexto.workspaceId, { familia, desde, hasta });
  const producto = nombreDeFamilia(familia);
  const base = { producto, desde: lectura.desde, hasta: lectura.hasta, pasos_del_reporte: PASOS_DEL_REPORTE.map((paso) => paso.nombre) };
  if (!lectura.activo || !lectura.embudo) {
    return { ...base, resumen_para_decir: "El registro del embudo está apagado en este negocio: no hay datos del embudo por paso." };
  }
  const { soloBot, conAsesora } = lectura.embudo;
  return {
    ...base,
    solo_el_bot: resumirGrupo(soloBot),
    lo_tomo_una_asesora: resumirGrupo(conAsesora),
    se_quedo_aqui_significa: "Su paso actual es ese y lleva más de 24 horas sin escribir (no compró).",
    resumen_para_decir: textoDelEmbudoPorPaso({ producto, desde: lectura.desde, hasta: lectura.hasta, grupo: soloBot }),
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
