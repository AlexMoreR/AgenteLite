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
          "esas preguntas de a una; nunca inventar productos, precios ni textos del negocio. " +
          "Tambien esta el TABLERO IA (pantalla /cliente/tablero-ia; herramientas listar_tableros, crear_tablero, renombrar_tablero, ver_tablero," +
          "listar_tipos, crear_tipo, editar_tipo, crear_tarjeta, editar_tarjeta, conectar_tarjetas, cambiar_estado_tarjeta, " +
          "borrar_tarjeta, ver_historial_tarjeta, deshacer_cambio_tarjeta, ver_plan_y_resultado, aprobar_tarjeta, ver_coordinador): ahi se anotan las ideas que salen de la " +
          "conversacion con el dueno, como tarjetas unidas con flechas. Cada tarjeta tiene un TIPO (por defecto Area, Idea " +
          "y Tarea) y puede colgar de otra (padre_id) si el tipo lo permite: Area > Idea > Tarea (un Area tambien dentro de " +
          "otra Area). El Area es una carpeta: no tiene estado. Solo los tipos que piden " +
          "aprobacion (Tarea) pasan por POR_APROBAR. Claude nunca aprueba por su cuenta con aprobar_tarjeta, pero desde el 25-oct-2026 el servidor aprueba solo toda Tarea con repo (regla del dueno); " +
          "solo se queda POR_APROBAR, esperando al dueno en la pantalla, la que toca dinero de Gestion o gasto en Meta Ads. Interruptor: Aprobar tareas solo. Si se edita una tarjeta aprobada, vuelve a POR_APROBAR. borrar_tarjeta quita la tarjeta con sus " +
          "flechas y se deshace con deshacer_cambio_tarjeta. Una tarjeta PLAN_LISTO o ERROR se borra solo si el dueno lo " +
          "pidio: antes leerle el titulo y esperar que diga 'si, borrala'; texto_confirmacion es lo que dijo, tal cual. " +
          "Nunca borrar por cuenta propia. No se borra lo que tiene el Coordinador (PLANEANDO, EN_CURSO, SUBIENDO) ni lo de zona protegida. " +
          "TRABAJADOR (fase 2): una Tarea con repo (gestion o aizencrm) la ejecuta un PC aparte: escribe un plan (PLAN_LISTO) " +
          "que pasa solo a construir (PLAN_APROBADO; desde el 24-oct solo espera el si del dueno el plan que toca dinero de Gestion o gasto en Meta Ads, o si el interruptor 'Aprobar planes solo' esta apagado), la construye y prueba en una rama y, si todo pasa, la sube sola a produccion (SUBIENDO -> HECHO, " +
          "con el link del commit); si el despliegue falla, deshace el commit y queda ERROR. Si toca chats " +
          "(zona protegida) o un cambio de Meta Ads que gasta plata, no sube sola: queda POR_REVISAR esperando el si final del dueno. El bot de ventas, el libro V3 y Meta Ads (sin gasto) suben solos con pruebas extra y vigilancia de 30 minutos. Si algo falla antes, " +
          "queda ERROR con el motivo. Esos estados los pone solo el Coordinador; ver_plan_y_resultado muestra el plan, el " +
          "resultado y quien aprobo que. aprobar_tarjeta (momento tarea, plan o subir) se usa SOLO si la persona lo dijo " +
          "explicitamente en esta conversacion: antes leerle el titulo y que se aprueba y esperar que diga 'si, apruebo'; " +
          "texto_confirmacion es lo que dijo, tal cual. Nunca aprobar por cuenta propia. El si final (subir) lo da solo el " +
          "dueno, y solo aplica a chats, a lo que gasta plata en Meta Ads y tarjetas que ya estaban POR_REVISAR. " +
          "Si un cambio con repo se termino por fuera del Coordinador (por ejemplo, lo subio Claude Code a mano) y la tarjeta quedo " +
          "ERROR, FALLIDO o POR_REVISAR, NO se borra: el dueno la marca hecha a mano. Leerle el titulo y esperar que diga 'si, " +
          "marcala hecha'; cambiar_estado_tarjeta con estado HECHO, texto_confirmacion (lo que dijo, tal cual) y nota (que se hizo; " +
          "commit opcional). Nunca por cuenta propia ni mientras el Coordinador la tiene. " +
          "Si toca Meta Ads, el bot de ventas, el libro V3 o los chats, marcar zona_protegida (Claude puede poner la zona, no " +
          "quitarla): las de bot de ventas, Meta Ads y libro V3 tambien se aprueban por voz con aprobar_tarjeta; las de chats, solo en la pantalla. " +
          "CUAL TABLERO (se habla por voz y hay varios, por ejemplo 'Magilus General' de Alexander y 'Desarrollo " +
          "Emanuel'): si el negocio tiene mas de un tablero y la persona no nombro cual, preguntarle antes de actuar. " +
          "Antes de escribir, decir en voz alta el nombre del tablero ('Lo anoto en Magilus General, listo?'). Nunca " +
          "adivinar por el ultimo tablero usado. Cada respuesta del tablero trae `tablero` ({id, nombre, dueno}): repetir ese nombre. " +
          "Cada tablero es de una persona (dueno): ella lo ve en su pantalla y el dueno del negocio ve todos; crear_tablero " +
          "acepta dueno (nombre o email de alguien del negocio) para crearlo a nombre de otra persona. " +
          "RESPONSABLE: crear_tarjeta y editar_tarjeta aceptan responsable (nombre o email de una persona activa del negocio; " +
          "vacio para quitarlo) para asignar una tarjeta sin crearla otra vez en otro tablero; la persona la ve en 'Asignadas a mi' " +
          "aunque este en un tablero que no es suyo, pero solo esa tarjeta. Asignar no reinicia la aprobacion. ver_tablero devuelve " +
          "el responsable de cada tarjeta y acepta responsable para ver solo las de una persona. Si el nombre coincide con dos " +
          "personas, pedir el email.",
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
