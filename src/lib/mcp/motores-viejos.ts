import { agenteActivo, lineaConV3 } from "@/features/seguimientos/dominio/motores-viejos";

/*
  MOTORES VIEJOS EN EL MCP (24-nov-2026): quién atiende cada línea, calculado en vivo (con las líneas y los
  agentes del negocio que la herramienta acaba de leer) y sin escribir nada.

  El que atiende a los clientes es el agente V3 (libro de reglas). El embudo por producto y el diagrama
  del agente V1/V2 son motores viejos: si el agente ya no atiende ninguna línea sin V3, el MCP lo muestra
  como INACTIVO para que nadie corrija ahí lo que el bot dice. La fuente real es v3_ver_reglas.

  Es la misma regla que usan el webhook y scripts/apagar-motores-viejos.mjs
  (features/seguimientos/dominio/motores-viejos.ts): una línea con metadata.agenteV3 = true la atiende el
  V3; si no, la atiende su agente V1/V2 si está prendido y en ACTIVE; si no, la atienden personas.
*/

export const ESTADO_INACTIVO = "INACTIVO, no se usa";
export const FUENTE_REAL = "v3_ver_reglas";
export const AVISO_INACTIVO =
  "INACTIVO, no se usa: el que atiende es el agente V3 (libro de reglas). La fuente real es v3_ver_reglas.";
export const ATIENDE_V3 = "Agente V3 (libro de reglas)";

export type QuienAtiende = "V3" | "V1/V2" | "personas";

type EstadoDelAgente = { status: string; isActive: boolean };
export type LineaParaCalcular = {
  id: string;
  name: string;
  metadata: unknown;
  agentId: string | null;
  agent: (EstadoDelAgente & { name?: string }) | null;
};
export type AgenteParaCalcular = { id: string; status: string; isActive: boolean };

export type UsoDelAgente = {
  /** Está activo y atiende al menos una línea sin V3. */
  seUsa: boolean;
  lineasSinV3: { id: string; nombre: string }[];
};

/** ¿Quién atiende esta línea? */
export function quienAtiende(linea: Pick<LineaParaCalcular, "metadata" | "agent">): QuienAtiende {
  if (lineaConV3(linea.metadata)) return "V3";
  if (linea.agent && agenteActivo(linea.agent)) return "V1/V2";
  return "personas";
}

/** El texto de `atiende` que muestra el MCP para una línea. */
export function textoDeQuienAtiende(linea: Pick<LineaParaCalcular, "metadata" | "agent">): string {
  const quien = quienAtiende(linea);
  if (quien === "V3") return ATIENDE_V3;
  if (quien === "V1/V2") return `${linea.agent?.name ?? "Agente"} (agente V1/V2, sin V3)`;
  if (linea.agent) return `${linea.agent.name ?? "Agente"} en pausa: la atienden solo personas`;
  return "sin agente: la atienden solo personas";
}

/** Para cada agente V1/V2: si se usa y qué líneas sin V3 atiende todavía. */
export function usoDeLosAgentes(lineas: LineaParaCalcular[], agentes: AgenteParaCalcular[]): Map<string, UsoDelAgente> {
  const uso = new Map<string, UsoDelAgente>();
  for (const agente of agentes) {
    const lineasSinV3 = agenteActivo(agente)
      ? lineas
          .filter((linea) => linea.agentId === agente.id && !lineaConV3(linea.metadata))
          .map((linea) => ({ id: linea.id, nombre: linea.name }))
      : [];
    uso.set(agente.id, { seUsa: lineasSinV3.length > 0, lineasSinV3 });
  }
  return uso;
}

/** Lo que el MCP quiere de un agente V1/V2 para saber si se usa: su estado y sus líneas. */
export type AgenteConLineas = AgenteParaCalcular & { channels: { id: string; name: string; metadata: unknown }[] };

/**
 * Las primeras claves de la respuesta de una herramienta que lee un agente V1/V2 (ver_agente,
 * ver_textos_del_agente, ver_diagrama_del_agente): estado, fuente_real y, si no se usa, el aviso.
 */
export function cabeceraDelAgente(agente: AgenteConLineas | null) {
  const uso = agente
    ? usoDeLosAgentes(
        agente.channels.map((linea) => ({ ...linea, agentId: agente.id, agent: agente })),
        [agente],
      ).get(agente.id)
    : undefined;
  return {
    estado: estadoDelAgente(uso),
    fuente_real: FUENTE_REAL,
    ...(uso?.seUsa ? {} : { aviso_motor_viejo: AVISO_INACTIVO }),
  };
}

/** El texto de `estado` que muestra el MCP para un agente V1/V2. */
export function estadoDelAgente(uso: UsoDelAgente | undefined): string {
  if (!uso?.seUsa) return ESTADO_INACTIVO;
  return `ACTIVO: todavía atiende ${uso.lineasSinV3.length === 1 ? "la línea" : "las líneas"} sin V3 ${uso.lineasSinV3
    .map((linea) => `"${linea.nombre}"`)
    .join(", ")}`;
}
