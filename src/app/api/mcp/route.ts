import { NextResponse } from "next/server";

import { validarClaveMcp } from "@/lib/mcp/claves";
import { HERRAMIENTAS_MCP, ejecutarHerramientaMcp } from "@/lib/mcp/herramientas";

export const dynamic = "force-dynamic";

/*
  Servidor MCP del CRM: la puerta por la que Claude entra a leer (14-sep-2026, etapa 1 del plan
  MCP + Agente V3 con Alex). SOLO LECTURA: ninguna herramienta escribe, asi que no puede romper nada.

  Protocolo MCP "Streamable HTTP" en su forma mas simple: cada POST trae un mensaje JSON-RPC y se
  contesta con JSON. Sin sesiones ni SSE: no hay nada que el servidor tenga que empujar solo. Se
  escribio a mano en vez de sumar el SDK para no agregar dependencias al build de Docker.

  Acceso: `Authorization: Bearer aizen_mcp_...`. La clave define el negocio; Claude nunca elige de
  que workspace leer.
*/

const VERSION_PROTOCOLO = "2025-06-18";
const VERSIONES_ACEPTADAS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

type Pedido = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function respuesta(id: Pedido["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function error(id: Pedido["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function atender(pedido: Pedido, contexto: { workspaceId: string; userId: string }) {
  // Las notificaciones no llevan id y no se contestan.
  const esNotificacion = pedido.id === undefined;

  switch (pedido.method) {
    case "initialize": {
      const pedida = typeof pedido.params?.protocolVersion === "string" ? pedido.params.protocolVersion : "";
      return respuesta(pedido.id, {
        protocolVersion: VERSIONES_ACEPTADAS.has(pedida) ? pedida : VERSION_PROTOCOLO,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "aizenbot-crm", version: "1.0.0" },
        instructions:
          "Herramientas de SOLO LECTURA del CRM Aizenbot, limitadas al negocio de la clave. Sirven para " +
          "encontrar errores del agente de WhatsApp: leer conversaciones, ver que dijo el agente y " +
          "compararlo con la informacion correcta (productos, configuracion del agente, datos del negocio). " +
          "Nada se modifica: las correcciones se proponen a la persona para que las aplique.",
      });
    }
    case "ping":
      return respuesta(pedido.id, {});
    case "tools/list":
      return respuesta(pedido.id, { tools: HERRAMIENTAS_MCP });
    case "tools/call": {
      const nombre = typeof pedido.params?.name === "string" ? pedido.params.name : "";
      const argumentos =
        pedido.params?.arguments && typeof pedido.params.arguments === "object"
          ? (pedido.params.arguments as Record<string, unknown>)
          : {};
      try {
        const resultado = await ejecutarHerramientaMcp(nombre, argumentos, contexto);
        return respuesta(pedido.id, {
          content: [{ type: "text", text: JSON.stringify(resultado, null, 2) }],
        });
      } catch (fallo) {
        // Un error de la herramienta se le devuelve a Claude como resultado, para que lo lea y ajuste.
        return respuesta(pedido.id, {
          isError: true,
          content: [{ type: "text", text: fallo instanceof Error ? fallo.message : "No se pudo completar" }],
        });
      }
    }
    default:
      if (esNotificacion) {
        return null;
      }
      return error(pedido.id, -32601, `Metodo no soportado: ${pedido.method ?? "(vacio)"}`);
  }
}

export async function POST(request: Request) {
  const autorizacion = request.headers.get("authorization") ?? "";
  const clave = autorizacion.toLowerCase().startsWith("bearer ") ? autorizacion.slice(7).trim() : "";
  const contexto = await validarClaveMcp(clave);
  if (!contexto) {
    return NextResponse.json(error(null, -32001, "Clave invalida o revocada"), { status: 401 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json(error(null, -32700, "JSON invalido"), { status: 400 });
  }

  const pedidos = Array.isArray(cuerpo) ? (cuerpo as Pedido[]) : [cuerpo as Pedido];
  const respuestas = (await Promise.all(pedidos.map((pedido) => atender(pedido, contexto)))).filter(Boolean);

  // Solo notificaciones: se aceptan sin cuerpo.
  if (respuestas.length === 0) {
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(Array.isArray(cuerpo) ? respuestas : respuestas[0]);
}

// Sin sesiones ni avisos del servidor: no hay canal GET que abrir.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
