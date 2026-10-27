import { esDiaValido, familiaDePedido } from "@/features/embudo/dominio/comparar";
import { textoDelEmbudoPorPaso, HORAS_PARA_QUEDARSE, MINIMO_POR_PASO, type GrupoPorPaso } from "@/features/embudo/dominio/por-paso";
import { nombreDeFamilia } from "@/features/embudo/dominio/semanal";
import { leerEmbudoPorPaso } from "@/features/embudo/servicios/leer-embudo-por-paso";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  EMBUDO POR PASO DESDE CLAUDE (solo lectura).

  Devuelve lo mismo que la pantalla /cliente/direccion/embudo-por-paso: por producto y rango de
  fechas, cuántos chats llegaron a cada paso del bot (Presentación, Producto, Objeciones, Cierre),
  cuántos se quedaron en cada uno (más de 24 h sin responder), la tasa de paso a paso y el tiempo
  promedio en cada paso. Los chats que tomó una asesora salen aparte. Usa EL MISMO cálculo que la
  pantalla (features/embudo/dominio/por-paso.ts).

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
      "En que paso del bot se queda la gente. Por producto y rango de fechas (dia en que entro el chat): cuantos chats LLEGARON a cada paso (Presentacion, Producto, Objeciones, Cierre), cuantos SE QUEDARON en cada uno (es su paso actual y llevan mas de 24 horas sin escribir), la tasa de paso a paso (ej. 60 % de Presentacion pasa a Producto), el paso donde mas se cae y el tiempo promedio en cada paso. Los chats que tomo una asesora (IA en pausa o chat asignado) salen aparte en 'tomados_por_asesora' para no mezclarlos con los del bot. Trae 'resumen_para_decir' con una frase para la reunion de las 8:00 y avisa 'pocos_datos' si un paso tiene menos de 30 chats. Solo lectura: no cambia el bot ni manda mensajes.",
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

function grupoParaClaude(grupo: GrupoPorPaso) {
  return {
    chats: grupo.chats,
    chats_con_paso: grupo.conPaso,
    pasos: grupo.pasos.map((paso) => ({
      paso: paso.nombre,
      llegaron: paso.llegaron,
      se_quedaron: paso.seQuedaron,
      en_curso: paso.enCurso,
      pct_que_se_quedaron: paso.pctSeQuedaron,
      pct_que_pasa_al_siguiente: paso.tasaAlSiguiente,
      horas_promedio_en_el_paso: paso.horasPromedio,
      pocos_datos: paso.pocosDatos,
    })),
    paso_donde_mas_se_cae: grupo.mayorCaida
      ? {
          entre: `${grupo.mayorCaida.desdeNombre} y ${grupo.mayorCaida.haciaNombre}`,
          pct_que_pasa: grupo.mayorCaida.tasa,
          no_pasaron: grupo.mayorCaida.noPasaron,
          pocos_datos: grupo.mayorCaida.pocosDatos,
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
  const base = {
    producto: nombreDeFamilia(familia),
    desde: lectura.desde,
    hasta: lectura.hasta,
    regla_se_quedo: `Se quedó = es su paso actual y lleva más de ${HORAS_PARA_QUEDARSE} horas sin escribir (no cuenta quien ya compró).`,
    minimo_de_chats_por_paso: MINIMO_POR_PASO,
  };
  if (!lectura.activo) {
    return { ...base, resumen_para_decir: "El registro del embudo está apagado en este negocio: no hay datos del embudo por paso." };
  }
  return {
    ...base,
    solo_el_bot: grupoParaClaude(lectura.embudo.bot),
    tomados_por_asesora: grupoParaClaude(lectura.embudo.asesora),
    resumen_para_decir: textoDelEmbudoPorPaso({
      producto: nombreDeFamilia(familia),
      desde: lectura.desde,
      hasta: lectura.hasta,
      embudo: lectura.embudo,
    }),
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
