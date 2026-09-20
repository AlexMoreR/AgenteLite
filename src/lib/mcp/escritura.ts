import { publicarAgenteV2 } from "@/app/actions/agent-v2-actions";
import { anotarCambioMcp, deshacerCambioMcp, listarCambiosMcp } from "@/lib/mcp/cambios";
import { prisma } from "@/lib/prisma";

/*
  Herramientas que ESCRIBEN (etapa 2 del plan MCP, Alex 18-sep-2026).

  Lo que pidió, con sus palabras: "cambiar el mensaje del paso 2 del embudo del combo de camillas",
  "no está respondiendo bien, corregilo en el prompt" y "conectar un seguimiento cuando el cliente
  manda el primer mensaje del combo". Eso es exactamente lo que se puede tocar: el guion de cada
  paso del embudo, los textos del agente y los seguimientos. Nada más.

  Tres reglas que no se negocian:
  1. El negocio sale de la CLAVE. Todo id que manda Claude se busca dentro de ese negocio.
  2. Todo cambio queda en el historial con el ANTES completo, y se puede deshacer en un clic.
  3. Lo que cambia el agente lo vuelve a PUBLICAR: si no, se edita el diagrama y el que contesta
     sigue con lo viejo. Es el error clásico de este CRM.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const BORRA = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

const TIEMPOS = ["MINUTES", "HOURS", "DAYS"] as const;

export const HERRAMIENTAS_MCP_ESCRITURA = [
  {
    name: "ver_embudo_del_producto",
    title: "Ver el embudo de un producto",
    description:
      "Los pasos del embudo de un producto (PRESENTACION, IDENTIFICACION, PRODUCTO, OBJECIONES, CIERRE) con su objetivo, su guion, el limite para avisar al asesor y los seguimientos de cada paso. Hay que llamarla antes de editar: devuelve los ids.",
    inputSchema: {
      type: "object",
      properties: { producto_id: { type: "string", description: "Id del producto (ver listar_productos)" } },
      required: ["producto_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "editar_paso_del_embudo",
    title: "Editar un paso del embudo",
    description:
      "Cambia el guion (que decir), el objetivo (que hay que lograr) o el limite de mensajes para avisar a un asesor, en un paso del embudo de un producto. Se aplica al instante y queda en el historial para deshacer.",
    inputSchema: {
      type: "object",
      properties: {
        etapa_id: { type: "string", description: "Id del paso (ver ver_embudo_del_producto)" },
        guion: { type: "string", description: "Que decir en este paso. Opcional." },
        objetivo: { type: "string", description: "Que hay que lograr antes de pasar al siguiente. Opcional." },
        avisar_tras_mensajes: {
          type: "number",
          description: "Si el cliente lleva tantos mensajes sin avanzar, se avisa a un asesor. 0 = sin red.",
        },
      },
      required: ["etapa_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "ver_textos_del_agente",
    title: "Ver los textos del agente",
    description:
      "Los textos editables del diagrama de un agente V2, caja por caja: prompt principal, bienvenida, instrucciones y mensajes de cada nodo, con el id del nodo y el nombre del campo. Hay que llamarla antes de editar_texto_del_agente.",
    inputSchema: {
      type: "object",
      properties: { agente_id: { type: "string", description: "Id del agente (ver resumen_del_negocio)" } },
      required: ["agente_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "editar_texto_del_agente",
    title: "Editar un texto del agente",
    description:
      "Cambia un texto del diagrama del agente (el prompt principal, una instruccion, un mensaje) y vuelve a publicar el agente, que es lo que hace que el cambio tenga efecto en WhatsApp. Queda en el historial para deshacer.",
    inputSchema: {
      type: "object",
      properties: {
        agente_id: { type: "string" },
        nodo_id: { type: "string", description: "Id del nodo (ver ver_textos_del_agente)" },
        campo: { type: "string", description: "Nombre del campo, tal cual lo devuelve ver_textos_del_agente" },
        texto: { type: "string", description: "El texto nuevo, completo" },
      },
      required: ["agente_id", "nodo_id", "campo", "texto"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "crear_seguimiento_del_paso",
    title: "Crear un 'si no contesta' en un paso",
    description:
      "Agrega un seguimiento al paso de un embudo: cuanto esperar desde que el lead entro a ese paso y que mandarle si no contesta. Se cancela solo si el cliente escribe antes.",
    inputSchema: {
      type: "object",
      properties: {
        etapa_id: { type: "string", description: "Id del paso (ver ver_embudo_del_producto)" },
        esperar: { type: "number", description: "Cuanto esperar" },
        unidad: { type: "string", enum: TIEMPOS, description: "MINUTES, HOURS o DAYS" },
        texto: { type: "string", description: "El mensaje a enviar" },
        cancelar_si_escribe: { type: "boolean", description: "Por defecto true" },
      },
      required: ["etapa_id", "esperar", "unidad", "texto"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "editar_seguimiento_del_paso",
    title: "Editar un 'si no contesta'",
    description: "Cambia el texto, la espera o si esta activo, en un seguimiento de un paso del embudo.",
    inputSchema: {
      type: "object",
      properties: {
        seguimiento_id: { type: "string" },
        esperar: { type: "number" },
        unidad: { type: "string", enum: TIEMPOS },
        texto: { type: "string" },
        activo: { type: "boolean" },
      },
      required: ["seguimiento_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "borrar_seguimiento_del_paso",
    title: "Borrar un 'si no contesta'",
    description: "Quita un seguimiento de un paso del embudo. Se puede deshacer desde el historial.",
    inputSchema: {
      type: "object",
      properties: { seguimiento_id: { type: "string" } },
      required: ["seguimiento_id"],
      additionalProperties: false,
    },
    annotations: BORRA,
  },
  {
    name: "listar_seguimientos_del_producto",
    title: "Seguimientos de un producto",
    description:
      "Las reglas de seguimiento que se disparan cuando el cliente escribe por ese producto (la primera vez que la charla queda enganchada a ese producto).",
    inputSchema: {
      type: "object",
      properties: { producto_id: { type: "string" } },
      required: ["producto_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "crear_seguimiento_por_producto",
    title: "Seguimiento al preguntar por un producto",
    description:
      "Crea una regla: cuando la charla queda enganchada a ese producto (el cliente pregunta por el), se programa un mensaje para tanto tiempo despues, y se cancela si el cliente escribe antes. Es el 'conectar un seguimiento cuando el cliente manda el primer mensaje del combo'.",
    inputSchema: {
      type: "object",
      properties: {
        producto_id: { type: "string" },
        esperar: { type: "number" },
        unidad: { type: "string", enum: TIEMPOS },
        texto: { type: "string" },
        nombre: { type: "string", description: "Como se llama la regla en la app. Opcional." },
        canal_id: { type: "string", description: "Limitarla a una linea de WhatsApp. Opcional." },
      },
      required: ["producto_id", "esperar", "unidad", "texto"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "borrar_seguimiento_por_producto",
    title: "Borrar una regla de seguimiento",
    description: "Quita una regla de seguimiento del negocio. Se puede deshacer desde el historial.",
    inputSchema: {
      type: "object",
      properties: { regla_id: { type: "string" } },
      required: ["regla_id"],
      additionalProperties: false,
    },
    annotations: BORRA,
  },
  {
    name: "listar_cambios",
    title: "Cambios hechos desde Claude",
    description: "Lo que se cambio desde aca, de lo mas nuevo a lo mas viejo, con su id para deshacer.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "deshacer_cambio",
    title: "Deshacer un cambio",
    description:
      "Deja las cosas como estaban antes de ese cambio. Si despues hubo otro cambio sobre lo mismo, avisa y no toca nada.",
    inputSchema: {
      type: "object",
      properties: { cambio_id: { type: "string", description: "Id del cambio (ver listar_cambios)" } },
      required: ["cambio_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
] as const;

const NOMBRES = new Set(HERRAMIENTAS_MCP_ESCRITURA.map((herramienta) => herramienta.name));

export function esHerramientaDeEscritura(nombre: string) {
  return NOMBRES.has(nombre as (typeof HERRAMIENTAS_MCP_ESCRITURA)[number]["name"]);
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() ? valor : undefined;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

function unidad(valor: unknown): "MINUTES" | "HOURS" | "DAYS" {
  return TIEMPOS.includes(valor as (typeof TIEMPOS)[number]) ? (valor as "MINUTES" | "HOURS" | "DAYS") : "DAYS";
}

/*
  Un producto de ESTE negocio.

  Los productos son del catalogo general; lo que los ata a un negocio es su playbook (el embudo).
  Por eso se busca por ahi: sin playbook en este workspace, el producto no es suyo y no se toca.
*/
async function productoDelNegocio(contexto: Contexto, productoId: string) {
  const playbook = await prisma.productPlaybook.findFirst({
    where: { productId: productoId, workspaceId: contexto.workspaceId },
    select: { id: true, product: { select: { id: true, name: true } } },
  });
  if (!playbook) {
    throw new Error("Ese producto no existe en este negocio (o todavia no tiene embudo armado)");
  }
  return { id: playbook.product.id, name: playbook.product.name, playbookId: playbook.id };
}

/** Un paso del embudo, comprobando que su producto sea de este negocio. */
async function pasoDelNegocio(contexto: Contexto, etapaId: string) {
  const paso = await prisma.productFunnelStage.findFirst({
    where: { id: etapaId, playbook: { workspaceId: contexto.workspaceId } },
    select: {
      id: true,
      stage: true,
      goal: true,
      script: true,
      stuckAfterMessages: true,
      playbook: { select: { product: { select: { id: true, name: true } } } },
    },
  });
  if (!paso) {
    throw new Error("Ese paso no existe en este negocio");
  }
  return paso;
}

/** El agente V2 del negocio, con su diagrama. */
async function agenteDelNegocio(contexto: Contexto, agenteId: string) {
  const agente = await prisma.agent.findFirst({
    where: { id: agenteId, workspaceId: contexto.workspaceId },
    select: { id: true, name: true, graph: true },
  });
  if (!agente) {
    throw new Error("Ese agente no existe en este negocio");
  }
  return agente;
}

/*
  Los campos de un nodo que son TEXTO editable.

  Se listan por nombre y no se acepta cualquier campo: el `data` de un nodo guarda tambien ids,
  listas y posiciones, y dejar que Claude escriba texto encima de un id rompe el diagrama sin que
  nadie lo note hasta que un cliente escribe.
*/
const CAMPOS_DE_TEXTO = new Set([
  "prompt",
  "systemPrompt",
  "instrucciones",
  "instructions",
  "mensaje",
  "message",
  "texto",
  "text",
  "descripcion",
  "description",
  "objetivo",
  "goal",
  "label",
  "nombre",
  "name",
  "fallback",
  "bienvenida",
  "welcome",
  "notas",
  "notes",
]);

type NodoDelGrafo = { id?: string; type?: string; data?: Record<string, unknown> };

export async function ejecutarHerramientaMcpEscritura(
  nombre: string,
  argumentos: Argumentos,
  contexto: Contexto,
): Promise<unknown> {
  switch (nombre) {
    case "ver_embudo_del_producto": {
      const producto = await productoDelNegocio(contexto, String(argumentos.producto_id ?? ""));
      const pasos = await prisma.productFunnelStage.findMany({
        where: { playbookId: producto.playbookId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          stage: true,
          goal: true,
          script: true,
          stuckAfterMessages: true,
          followUps: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, timeType: true, timeValue: true, content: true, isActive: true },
          },
        },
      });
      return {
        producto: { id: producto.id, nombre: producto.name },
        pasos: pasos.map((paso) => ({
          etapa_id: paso.id,
          paso: paso.stage,
          objetivo: paso.goal,
          guion: paso.script,
          avisar_tras_mensajes: paso.stuckAfterMessages,
          seguimientos: paso.followUps.map((seguimiento) => ({
            seguimiento_id: seguimiento.id,
            esperar: seguimiento.timeValue,
            unidad: seguimiento.timeType,
            texto: seguimiento.content,
            activo: seguimiento.isActive,
          })),
        })),
        nota: pasos.length === 0 ? "Este producto todavia no tiene embudo armado." : undefined,
      };
    }

    case "editar_paso_del_embudo": {
      const paso = await pasoDelNegocio(contexto, String(argumentos.etapa_id ?? ""));
      const avisar = numero(argumentos.avisar_tras_mensajes);
      const datos = {
        ...(texto(argumentos.guion) === undefined ? {} : { script: texto(argumentos.guion)! }),
        ...(texto(argumentos.objetivo) === undefined ? {} : { goal: texto(argumentos.objetivo)! }),
        ...(avisar === undefined ? {} : { stuckAfterMessages: avisar > 0 ? Math.round(avisar) : null }),
      };
      if (Object.keys(datos).length === 0) {
        throw new Error("No mandaste nada para cambiar (guion, objetivo o avisar_tras_mensajes)");
      }
      await prisma.productFunnelStage.update({ where: { id: paso.id }, data: datos });
      const cambio = await anotarCambioMcp(contexto.workspaceId, {
        titulo: `Paso ${paso.stage} de ${paso.playbook.product.name}`,
        tabla: "ProductFunnelStage",
        filaId: paso.id,
        accion: "editar",
        antes: { script: paso.script, goal: paso.goal, stuckAfterMessages: paso.stuckAfterMessages },
        despues: datos,
      });
      return { ok: true, cambio_id: cambio.id, aviso: "Ya esta activo. Para volver atras: deshacer_cambio." };
    }

    case "ver_textos_del_agente": {
      const agente = await agenteDelNegocio(contexto, String(argumentos.agente_id ?? ""));
      const grafo = agente.graph as { nodes?: NodoDelGrafo[] } | null;
      const nodos = Array.isArray(grafo?.nodes) ? grafo.nodes : [];
      return {
        agente: { id: agente.id, nombre: agente.name },
        nodos: nodos.map((nodo) => ({
          nodo_id: nodo.id,
          tipo: nodo.type,
          campos: Object.entries(nodo.data ?? {})
            .filter(([campo, valor]) => CAMPOS_DE_TEXTO.has(campo) && typeof valor === "string")
            .map(([campo, valor]) => ({ campo, texto: valor })),
        })),
        nota: "Editar un texto vuelve a publicar el agente: el cambio sale al aire de inmediato.",
      };
    }

    case "editar_texto_del_agente": {
      const agente = await agenteDelNegocio(contexto, String(argumentos.agente_id ?? ""));
      const nodoId = String(argumentos.nodo_id ?? "");
      const campo = String(argumentos.campo ?? "");
      const nuevo = typeof argumentos.texto === "string" ? argumentos.texto : "";
      if (!CAMPOS_DE_TEXTO.has(campo)) {
        throw new Error(`"${campo}" no es un campo de texto editable. Ver ver_textos_del_agente.`);
      }
      const grafo = (agente.graph ?? {}) as { nodes?: NodoDelGrafo[] };
      const nodos = Array.isArray(grafo.nodes) ? grafo.nodes : [];
      const nodo = nodos.find((fila) => fila.id === nodoId);
      if (!nodo) {
        throw new Error("Ese nodo no esta en el diagrama del agente");
      }
      const anterior = nodo.data?.[campo];
      if (typeof anterior !== "string") {
        throw new Error(`El nodo no tiene hoy un texto en "${campo}"`);
      }

      const grafoNuevo = {
        ...grafo,
        nodes: nodos.map((fila) =>
          fila.id === nodoId ? { ...fila, data: { ...(fila.data ?? {}), [campo]: nuevo } } : fila,
        ),
      };
      await prisma.agent.update({ where: { id: agente.id }, data: { graph: grafoNuevo as never } });
      const publicado = await publicarAgenteV2({ agentId: agente.id, workspaceId: contexto.workspaceId });
      const cambio = await anotarCambioMcp(contexto.workspaceId, {
        titulo: `Texto "${campo}" del nodo ${nodo.type ?? nodoId} en ${agente.name}`,
        tabla: "Agent",
        filaId: agente.id,
        accion: "editar",
        // El diagrama entero: es la unica forma de dejarlo igual que antes sin adivinar.
        antes: { graph: agente.graph },
        despues: { nodo_id: nodoId, campo, texto: nuevo },
        agenteId: agente.id,
      });
      return {
        ok: true,
        cambio_id: cambio.id,
        publicado: publicado.ok,
        aviso: publicado.ok
          ? "Cambiado y publicado: ya contesta asi."
          : `Se guardo, pero no se pudo publicar: ${"error" in publicado ? publicado.error : ""}`,
      };
    }

    case "crear_seguimiento_del_paso": {
      const paso = await pasoDelNegocio(contexto, String(argumentos.etapa_id ?? ""));
      const cuerpo = texto(argumentos.texto);
      const esperar = numero(argumentos.esperar);
      if (!cuerpo || esperar === undefined || esperar <= 0) {
        throw new Error("Falta el texto o el tiempo de espera");
      }
      const ultimos = await prisma.productStageFollowUp.count({ where: { stageId: paso.id } });
      const creado = await prisma.productStageFollowUp.create({
        data: {
          stageId: paso.id,
          sortOrder: ultimos,
          timeType: unidad(argumentos.unidad),
          timeValue: Math.round(esperar),
          messageType: "TEXT",
          content: cuerpo,
          cancelOnActivity: argumentos.cancelar_si_escribe !== false,
        },
        select: { id: true },
      });
      const cambio = await anotarCambioMcp(contexto.workspaceId, {
        titulo: `Seguimiento nuevo en el paso ${paso.stage} de ${paso.playbook.product.name}`,
        tabla: "ProductStageFollowUp",
        filaId: creado.id,
        accion: "crear",
        antes: {},
        despues: { texto: cuerpo, esperar, unidad: unidad(argumentos.unidad) },
      });
      return { ok: true, seguimiento_id: creado.id, cambio_id: cambio.id };
    }

    case "editar_seguimiento_del_paso": {
      const seguimientoId = String(argumentos.seguimiento_id ?? "");
      const actual = await prisma.productStageFollowUp.findFirst({
        where: { id: seguimientoId, stage: { playbook: { workspaceId: contexto.workspaceId } } },
        select: {
          id: true,
          content: true,
          timeType: true,
          timeValue: true,
          isActive: true,
          stage: { select: { stage: true } },
        },
      });
      if (!actual) {
        throw new Error("Ese seguimiento no existe en este negocio");
      }
      const esperar = numero(argumentos.esperar);
      const datos = {
        ...(texto(argumentos.texto) === undefined ? {} : { content: texto(argumentos.texto)! }),
        ...(esperar === undefined ? {} : { timeValue: Math.round(esperar) }),
        ...(argumentos.unidad === undefined ? {} : { timeType: unidad(argumentos.unidad) }),
        ...(typeof argumentos.activo === "boolean" ? { isActive: argumentos.activo } : {}),
      };
      if (Object.keys(datos).length === 0) {
        throw new Error("No mandaste nada para cambiar");
      }
      await prisma.productStageFollowUp.update({ where: { id: actual.id }, data: datos });
      const cambio = await anotarCambioMcp(contexto.workspaceId, {
        titulo: `Seguimiento del paso ${actual.stage.stage}`,
        tabla: "ProductStageFollowUp",
        filaId: actual.id,
        accion: "editar",
        antes: {
          content: actual.content,
          timeType: actual.timeType,
          timeValue: actual.timeValue,
          isActive: actual.isActive,
        },
        despues: datos,
      });
      return { ok: true, cambio_id: cambio.id };
    }

    case "borrar_seguimiento_del_paso": {
      const seguimientoId = String(argumentos.seguimiento_id ?? "");
      const actual = await prisma.productStageFollowUp.findFirst({
        where: { id: seguimientoId, stage: { playbook: { workspaceId: contexto.workspaceId } } },
      });
      if (!actual) {
        throw new Error("Ese seguimiento no existe en este negocio");
      }
      await prisma.productStageFollowUp.delete({ where: { id: actual.id } });
      const { createdAt: _creado, updatedAt: _actualizado, ...fila } = actual;
      const cambio = await anotarCambioMcp(contexto.workspaceId, {
        titulo: `Seguimiento borrado (${actual.content?.slice(0, 40) ?? "sin texto"})`,
        tabla: "ProductStageFollowUp",
        filaId: actual.id,
        accion: "borrar",
        antes: fila as unknown as Record<string, unknown>,
        despues: {},
      });
      return { ok: true, cambio_id: cambio.id };
    }

    case "listar_seguimientos_del_producto": {
      const producto = await productoDelNegocio(contexto, String(argumentos.producto_id ?? ""));
      const reglas = await prisma.followRule.findMany({
        where: { workspaceId: contexto.workspaceId, sourceType: "PRODUCT", sourceId: producto.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          timeType: true,
          timeValue: true,
          content: true,
          isActive: true,
          channelId: true,
        },
      });
      return {
        producto: { id: producto.id, nombre: producto.name },
        reglas: reglas.map((regla) => ({
          regla_id: regla.id,
          nombre: regla.name,
          esperar: regla.timeValue,
          unidad: regla.timeType,
          texto: regla.content,
          activa: regla.isActive,
          canal_id: regla.channelId,
        })),
      };
    }

    case "crear_seguimiento_por_producto": {
      const producto = await productoDelNegocio(contexto, String(argumentos.producto_id ?? ""));
      const cuerpo = texto(argumentos.texto);
      const esperar = numero(argumentos.esperar);
      if (!cuerpo || esperar === undefined || esperar <= 0) {
        throw new Error("Falta el texto o el tiempo de espera");
      }
      const canalId = texto(argumentos.canal_id);
      if (canalId) {
        const canal = await prisma.whatsAppChannel.findFirst({
          where: { id: canalId, workspaceId: contexto.workspaceId },
          select: { id: true },
        });
        if (!canal) {
          throw new Error("Esa linea de WhatsApp no es de este negocio");
        }
      }
      const creada = await prisma.followRule.create({
        data: {
          workspaceId: contexto.workspaceId,
          channelId: canalId ?? null,
          name: texto(argumentos.nombre) ?? `Seguimiento ${producto.name}`,
          sourceType: "PRODUCT",
          sourceId: producto.id,
          timeType: unidad(argumentos.unidad),
          timeValue: Math.round(esperar),
          messageType: "TEXT",
          content: cuerpo,
          cancelOnActivity: true,
          isActive: true,
        },
        select: { id: true, name: true },
      });
      const cambio = await anotarCambioMcp(contexto.workspaceId, {
        titulo: `Seguimiento nuevo para ${producto.name}`,
        tabla: "FollowRule",
        filaId: creada.id,
        accion: "crear",
        antes: {},
        despues: { texto: cuerpo, esperar, unidad: unidad(argumentos.unidad) },
      });
      return {
        ok: true,
        regla_id: creada.id,
        cambio_id: cambio.id,
        aviso:
          "Se dispara la primera vez que la charla queda enganchada a ese producto, y se cancela si el cliente escribe antes.",
      };
    }

    case "borrar_seguimiento_por_producto": {
      const reglaId = String(argumentos.regla_id ?? "");
      const regla = await prisma.followRule.findFirst({
        where: { id: reglaId, workspaceId: contexto.workspaceId },
      });
      if (!regla) {
        throw new Error("Esa regla no existe en este negocio");
      }
      await prisma.followRule.delete({ where: { id: regla.id } });
      const { createdAt: _creada, updatedAt: _actualizada, workspaceId: _negocio, ...fila } = regla;
      const cambio = await anotarCambioMcp(contexto.workspaceId, {
        titulo: `Regla borrada: ${regla.name}`,
        tabla: "FollowRule",
        filaId: regla.id,
        accion: "borrar",
        antes: fila as unknown as Record<string, unknown>,
        despues: {},
      });
      return { ok: true, cambio_id: cambio.id };
    }

    case "listar_cambios": {
      const cambios = await listarCambiosMcp(contexto.workspaceId);
      return {
        cambios: cambios.map((cambio) => ({
          cambio_id: cambio.id,
          cuando: cambio.at,
          que: cambio.titulo,
          accion: cambio.accion,
          deshecho: cambio.deshecho === true,
        })),
      };
    }

    case "deshacer_cambio": {
      const resultado = await deshacerCambioMcp(contexto.workspaceId, String(argumentos.cambio_id ?? ""));
      if (!resultado.ok) {
        throw new Error(resultado.error);
      }
      if (resultado.agenteId) {
        await publicarAgenteV2({ agentId: resultado.agenteId, workspaceId: contexto.workspaceId });
      }
      return { ok: true, aviso: `Listo, "${resultado.titulo}" quedo como estaba.` };
    }

    default:
      throw new Error(`Herramienta desconocida: ${nombre}`);
  }
}
