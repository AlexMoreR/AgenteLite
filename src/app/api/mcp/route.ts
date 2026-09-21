import { NextResponse } from "next/server";

import { validarClaveMcp } from "@/lib/mcp/claves";
import { HERRAMIENTAS_MCP, ejecutarHerramientaMcp } from "@/lib/mcp/herramientas";

export const dynamic = "force-dynamic";

/*
  Servidor MCP del CRM: la puerta por la que Claude entra (14-sep-2026, plan MCP + Agente V3).

  Etapa 1: leer. Etapa 2 (18-sep-2026): corregir el guion del embudo, los textos del agente y los
  seguimientos. Todo lo que escribe queda en un historial con el "antes" completo y se puede
  deshacer, en el chat o desde Mi empresa -> Claude.

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
          "Herramientas del CRM Aizenbot, limitadas al negocio de la clave. Sirven para encontrar errores " +
          "del agente de WhatsApp y corregirlos: leer conversaciones, ver que dijo el agente, compararlo " +
          "con la informacion correcta (productos, configuracion, datos del negocio) y despues arreglar el " +
          "guion de un paso del embudo, un texto del agente o un seguimiento. Lo que se cambia queda activo " +
          "al instante y se puede deshacer con deshacer_cambio. Tambien se puede armar el diagrama del " +
          "agente: crear una condicion con sus palabras, una caja de flujo, y conectarlas. Antes de cambiar " +
          "algo, leer siempre lo que hay hoy (ver_embudo_del_producto, ver_textos_del_agente, " +
          "ver_diagrama_del_agente) y decirle a la persona que se va a tocar. " +
          "Aparte esta el AGENTE V3 (herramientas v3_*), que es el libro de reglas nuevo y todavia NO atiende " +
          "clientes: se escribe y se prueba en el simulador. Si el libro esta vacio, llamar v3_empezar y hacer " +
          "esas preguntas de a una; nunca inventar productos, precios ni textos del negocio.",
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

/*
  La clave puede venir por cabecera o EN LA DIRECCION (/api/mcp/aizen_mcp_...).

  Claude Code manda la cabecera sin problema, pero el conector de claude.ai solo ofrece OAuth o
  "sin inicio de sesion": no hay donde escribir una clave (Alex, 21-sep-2026, con el dialogo
  abierto). Con la clave en la direccion se conecta hoy, sin esperar a que exista el OAuth.

  Tiene un costo y hay que saberlo: una clave en la direccion queda escrita en los registros del
  servidor. Por eso se puede revocar en un clic desde Mi empresa -> Claude.
*/
export async function atenderMcp(request: Request, claveDeLaRuta?: string) {
  const autorizacion = request.headers.get("authorization") ?? "";
  const claveDeCabecera = autorizacion.toLowerCase().startsWith("bearer ") ? autorizacion.slice(7).trim() : "";
  const clave = claveDeCabecera || (claveDeLaRuta ?? "").trim();
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

export async function POST(request: Request) {
  return atenderMcp(request);
}

// Sin sesiones ni avisos del servidor: no hay canal GET que abrir.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
