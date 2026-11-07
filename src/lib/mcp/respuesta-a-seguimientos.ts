import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";
import {
  BASE_POR_DEFECTO,
  diaDeBogota,
  diferenciaEnPuntos,
  DESPUES_POR_DEFECTO_DESDE,
  ENVIOS_MINIMOS,
  erroresDelRango,
  resumenParaDecir,
  type Rango,
} from "@/features/seguimientos/dominio/respuesta-a-seguimientos";
import { medirRespuestaEnElRango, SEGUIMIENTOS_MAXIMOS_POR_RANGO } from "@/features/seguimientos/services/respuesta-a-seguimientos";

/*
  % DE RESPUESTA A LOS SEGUIMIENTOS DESDE CLAUDE (solo lectura; pedido del dueño, 6-nov-2026).

  Para medir "hazle seguimiento al proyecto, no a la venta": compara dos rangos de fechas (por defecto
  la base del 2 al 6 de nov contra desde el 7 de nov hasta hoy) y dice que % de los seguimientos
  automaticos a clientes que ya habian respondido la bienvenida tuvo respuesta en 24 h, separado en
  texto de la IA y texto fijo. No escribe nada ni manda mensajes. El negocio sale de la clave, nunca de
  un argumento. La pueden usar las mismas personas que ven el Supervisor.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_RESPUESTA_A_SEGUIMIENTOS = [
  {
    name: "respuesta_a_seguimientos",
    title: "% de respuesta a los seguimientos automáticos",
    description:
      `Compara dos rangos de fechas: que % de los seguimientos automaticos (reloj del V3 y follows de reglas o etapas) a clientes que YA habian respondido la bienvenida tuvo respuesta del cliente (texto, audio o foto) en las 24 h siguientes y antes del siguiente seguimiento. Separado en texto de la IA y texto fijo. Por defecto la base es del ${BASE_POR_DEFECTO.desde} al ${BASE_POR_DEFECTO.hasta} y el despues desde el ${DESPUES_POR_DEFECTO_DESDE} hasta hoy (hora de Colombia). Con menos de ${ENVIOS_MINIMOS} envios en un grupo dice 'faltan datos'. Compara semanas distintas sin grupo de control: no prueba la causa. Trae 'resumen_para_decir'. Solo lectura.`,
    inputSchema: {
      type: "object",
      properties: {
        base_desde: { type: "string", description: `AAAA-MM-DD (hora de Colombia). Por defecto ${BASE_POR_DEFECTO.desde}.` },
        base_hasta: { type: "string", description: `AAAA-MM-DD, incluido. Por defecto ${BASE_POR_DEFECTO.hasta}.` },
        despues_desde: { type: "string", description: `AAAA-MM-DD. Por defecto ${DESPUES_POR_DEFECTO_DESDE}.` },
        despues_hasta: { type: "string", description: "AAAA-MM-DD, incluido. Por defecto hoy." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_RESPUESTA_A_SEGUIMIENTOS.map((herramienta) => herramienta.name));

export function esHerramientaDeRespuestaASeguimientos(nombre: string) {
  return NOMBRES.has(nombre);
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Los dos rangos pedidos, con sus valores por defecto. Lanza si una fecha no sirve. */
export function rangosPedidos(args: Argumentos, ahora: Date): { base: Rango; despues: Rango } {
  const base: Rango = { desde: texto(args.base_desde) ?? BASE_POR_DEFECTO.desde, hasta: texto(args.base_hasta) ?? BASE_POR_DEFECTO.hasta };
  const despuesDesde = texto(args.despues_desde) ?? DESPUES_POR_DEFECTO_DESDE;
  // Sin "hasta": hoy, o el mismo "desde" si hoy todavia no llega (AAAA-MM-DD se compara como texto).
  const hoy = diaDeBogota(ahora);
  const despues: Rango = { desde: despuesDesde, hasta: texto(args.despues_hasta) ?? (hoy < despuesDesde ? despuesDesde : hoy) };
  const errores = [...erroresDelRango("base", base), ...erroresDelRango("después", despues)];
  if (errores.length) throw new Error(errores.join(" "));
  return { base, despues };
}

async function respuestaASeguimientos(args: Argumentos, contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para ver esta medición: es solo del dueño, los administradores y la supervisora.");
  }
  const ahora = new Date();
  const { base, despues } = rangosPedidos(args, ahora);
  const [antes, luego] = await Promise.all([
    medirRespuestaEnElRango(contexto.workspaceId, base, ahora),
    medirRespuestaEnElRango(contexto.workspaceId, despues, ahora),
  ]);
  const advertencias = [
    "Compara dos rangos distintos sin grupo de control: el anuncio, el volumen y otros cambios también cuentan. No prueba la causa.",
    "La base no está limpia: el texto fijo para quien no respondió la bienvenida (T-599) y la regla del chat 8927 entraron entre el 5 y el 6 de nov.",
  ];
  if (antes.cortado || luego.cortado) {
    advertencias.push(`Se leyeron como máximo ${SEGUIMIENTOS_MAXIMOS_POR_RANGO} seguimientos por rango: faltan algunos; pide un rango más corto.`);
  }
  return {
    base: antes.medicion,
    despues: luego.medicion,
    diferencia_en_puntos: {
      total: diferenciaEnPuntos(antes.medicion.total, luego.medicion.total),
      texto_de_ia: diferenciaEnPuntos(antes.medicion.texto_de_ia, luego.medicion.texto_de_ia),
      texto_fijo: diferenciaEnPuntos(antes.medicion.texto_fijo, luego.medicion.texto_fijo),
    },
    como_se_cuenta:
      "Cada seguimiento automático (reloj del V3 y follows de reglas o etapas) a un cliente que ya había respondido la bienvenida. Contestó = escribió (texto, audio o foto) en las 24 h siguientes y antes del siguiente seguimiento. Texto de IA = lo escribió la IA y pasó la revisión; texto fijo = el agendado o un respaldo. No se cuentan los manuales, campañas y automatizaciones, los que no se pudieron unir con su follow, ni los que todavía no cumplen 24 h sin respuesta.",
    advertencias,
    resumen_para_decir: resumenParaDecir(antes.medicion, luego.medicion),
  };
}

export async function ejecutarHerramientaMcpRespuestaASeguimientos(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "respuesta_a_seguimientos":
      return respuestaASeguimientos(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
