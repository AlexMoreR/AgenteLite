import { randomUUID } from "node:crypto";

import {
  guardarLibro,
  leerHistorialDelLibro,
  leerLibro,
  volverAVersion,
} from "@/features/agente-v3/servicios/almacen";
import { simularConversacion } from "@/features/agente-v3/servicios/simulador";
import { decidir } from "@/features/agente-v3/motor/decidir";
import { PASOS_DEL_EMBUDO, revisarLibro, type ReglaV3 } from "@/features/agente-v3/domain/reglas";

/*
  AGENTE V3 POR MCP: el libro de reglas se dicta hablando.

  Es la forma de trabajo que pidió Alex (21-sep-2026): él manda una captura con el error y cuenta
  qué debería haber pasado; yo escribo o corrijo la regla. La pantalla del V3 queda para entrar a
  mirar lo que quedó, no para tener que armarlo a mano.

  Tres cosas que este archivo cuida:
  1. NADA de esto toca al V2. El agente que vende hoy sigue igual hasta que el simulador convenza.
  2. Todo cambio deja la versión anterior completa: volver atrás es una llamada.
  3. Se avisan los problemas (frases cortas, reglas que no hacen nada) sin bloquear: la decisión es
     de quien dicta la regla.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const BORRA = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

const PASOS = PASOS_DEL_EMBUDO.map((paso) => paso.paso);

const ESQUEMA_DE_REGLA = {
  type: "object",
  properties: {
    nombre: { type: "string", description: "En palabras del negocio: 'Cuando pide fotos del combo, mandar las fotos'" },
    cuando: {
      type: "object",
      description:
        "Que dispara la regla. tipo frase (texto literal, lo mas predecible), intencion (la evalua la IA), paso (viene hablando de ese producto y esta en ese paso), sin_respuesta (minutos callado) o siempre.",
      properties: {
        tipo: { type: "string", enum: ["frase", "intencion", "paso", "sin_respuesta", "siempre"] },
        frases: { type: "array", items: { type: "string" } },
        exacta: { type: "boolean" },
        descripcion: { type: "string" },
        producto: { type: "string" },
        paso: { type: "string", enum: PASOS },
        minutos: { type: "number" },
      },
      required: ["tipo"],
    },
    soloSi: {
      type: "object",
      description: "Condiciones extra. productoActivo acepta un id, 'ninguno' o 'cualquiera'.",
      properties: {
        productoActivo: { type: "string" },
        pasoActual: { type: "string", enum: PASOS },
        noSiYaSeEnvio: { type: "string" },
        esPrimerMensaje: { type: "boolean" },
      },
    },
    entonces: {
      type: "array",
      description: "Que hace. Lista cerrada de acciones: mensaje, flujo, responder_con_ia, activar_producto, ir_al_paso, cambiar_etapa_crm, avisar_asesor, pausar_ia.",
      items: {
        type: "object",
        properties: {
          tipo: {
            type: "string",
            enum: [
              "mensaje",
              "flujo",
              "responder_con_ia",
              "activar_producto",
              "ir_al_paso",
              "cambiar_etapa_crm",
              "avisar_asesor",
              "pausar_ia",
            ],
          },
          texto: { type: "string" },
          flujoId: { type: "string" },
          titulo: { type: "string" },
          guia: { type: "string" },
          productoId: { type: "string" },
          nombre: { type: "string" },
          paso: { type: "string", enum: PASOS },
          etapa: { type: "string" },
          motivo: { type: "string" },
        },
        required: ["tipo"],
      },
    },
    activa: { type: "boolean", description: "Por defecto true" },
  },
  required: ["nombre", "cuando", "entonces"],
} as const;

export const HERRAMIENTAS_MCP_V3 = [
  {
    name: "v3_ver_reglas",
    title: "Ver el libro de reglas (V3)",
    description:
      "El libro de reglas del agente V3: como habla el negocio y cada regla con su disparador, sus condiciones y lo que hace. El V3 no atiende clientes todavia: se escribe y se prueba en el simulador.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "v3_empezar",
    title: "Empezar el libro de reglas (V3)",
    description:
      "SE LLAMA PRIMERO cuando el libro esta vacio o casi. Devuelve las preguntas que hay que hacerle a la persona, en orden, ANTES de escribir ninguna regla. No inventar el negocio: preguntar, esperar la respuesta, y recien ahi escribir.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "v3_que_falta",
    title: "Que le falta al libro (V3)",
    description:
      "Mira el libro como esta hoy y dice que huecos tiene (sin saludo, un producto sin pasos, reglas que nunca se van a disparar) y que preguntar para taparlos.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "v3_escribir_como_hablamos",
    title: "Como habla el negocio (V3)",
    description:
      "Guarda el texto de como habla el negocio: tono, que vende, que nunca decir. Es lo unico que la IA usa para redactar; las decisiones las toman las reglas.",
    inputSchema: {
      type: "object",
      properties: { texto: { type: "string" } },
      required: ["texto"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "v3_crear_regla",
    title: "Crear una regla (V3)",
    description:
      "Agrega una regla al libro. Mejor frases largas que palabras sueltas, y condiciones explicitas (productoActivo, pasoActual) en vez de aclaraciones en prosa: el motor las verifica de verdad.",
    inputSchema: { ...ESQUEMA_DE_REGLA, additionalProperties: false },
    annotations: ESCRIBE,
  },
  {
    name: "v3_editar_regla",
    title: "Editar una regla (V3)",
    description: "Cambia una regla que ya existe. Se manda solo lo que cambia.",
    inputSchema: {
      type: "object",
      properties: { regla_id: { type: "string" }, ...ESQUEMA_DE_REGLA.properties },
      required: ["regla_id"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "v3_borrar_regla",
    title: "Borrar una regla (V3)",
    description: "Saca una regla del libro. La version anterior queda guardada para poder volver.",
    inputSchema: {
      type: "object",
      properties: { regla_id: { type: "string" } },
      required: ["regla_id"],
      additionalProperties: false,
    },
    annotations: BORRA,
  },
  {
    name: "v3_probar_mensaje",
    title: "Probar un mensaje (V3)",
    description:
      "Dice que regla ganaria con ese mensaje y por que, sin mandar nada. Sirve para responder '¿por que contesto eso?' antes de que pase.",
    inputSchema: {
      type: "object",
      properties: {
        mensaje: { type: "string" },
        producto_activo: { type: "string", description: "Id del producto del que se viene hablando, si hay" },
        paso_actual: { type: "string", enum: PASOS },
        es_primer_mensaje: { type: "boolean" },
      },
      required: ["mensaje"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "v3_simular_conversacion",
    title: "Simular una conversacion real (V3)",
    description:
      "Toma una conversacion que YA paso y muestra, mensaje por mensaje, que habria hecho el V3 al lado de lo que contesto el V2. No envia nada ni toca al cliente.",
    inputSchema: {
      type: "object",
      properties: {
        conversacion_id: { type: "string", description: "Id de la conversacion (ver listar_conversaciones)" },
        tope: { type: "number", description: "Cuantos mensajes del cliente mirar (por defecto 12)" },
      },
      required: ["conversacion_id"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "v3_historial",
    title: "Versiones del libro (V3)",
    description: "Las versiones guardadas del libro de reglas, con quien las hizo y que cambio.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "v3_volver_a_version",
    title: "Volver a una version (V3)",
    description: "Deja el libro como estaba en esa version. Lo de ahora se guarda como una version mas.",
    inputSchema: {
      type: "object",
      properties: { version: { type: "number" } },
      required: ["version"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
] as const;

const NOMBRES = new Set(HERRAMIENTAS_MCP_V3.map((herramienta) => herramienta.name));

export function esHerramientaV3(nombre: string) {
  return NOMBRES.has(nombre as (typeof HERRAMIENTAS_MCP_V3)[number]["name"]);
}

function comoRegla(argumentos: Argumentos, base?: ReglaV3): ReglaV3 {
  const cuando = (argumentos.cuando ?? base?.cuando) as ReglaV3["cuando"];
  const entonces = (argumentos.entonces ?? base?.entonces ?? []) as ReglaV3["entonces"];
  return {
    id: base?.id ?? `regla-${randomUUID()}`,
    nombre: typeof argumentos.nombre === "string" ? argumentos.nombre : (base?.nombre ?? ""),
    cuando,
    soloSi: (argumentos.soloSi as ReglaV3["soloSi"]) ?? base?.soloSi,
    entonces,
    activa: typeof argumentos.activa === "boolean" ? argumentos.activa : (base?.activa ?? true),
    autor: base?.autor,
    creadaEl: base?.creadaEl ?? new Date().toISOString(),
  };
}

export async function ejecutarHerramientaMcpV3(
  nombre: string,
  argumentos: Argumentos,
  contexto: Contexto,
): Promise<unknown> {
  const libro = await leerLibro(contexto.workspaceId);

  if (nombre === "v3_ver_reglas") {
    return {
      version: libro.version,
      actualizado: libro.actualizadoEl,
      como_hablamos: libro.comoHablamos || "(todavia sin escribir)",
      reglas: libro.reglas.map((regla) => ({
        regla_id: regla.id,
        nombre: regla.nombre,
        activa: regla.activa,
        cuando: regla.cuando,
        solo_si: regla.soloSi,
        entonces: regla.entonces,
      })),
      problemas: revisarLibro(libro),
      nota:
        libro.reglas.length === 0
          ? "El libro esta vacio. Se arma hablando: conta que hace el negocio y que deberia contestar el agente en cada caso."
          : undefined,
    };
  }

  /*
    El arranque es PREGUNTANDO, no escribiendo.

    Alex lo pidio asi (21-sep-2026) y ademas es lo unico honesto: un libro inventado se ve prolijo
    y contesta cosas que el negocio nunca dijo. Las preguntas van en el orden en que se necesitan
    para escribir la primera regla util, no en el orden de un formulario.
  */
  if (nombre === "v3_empezar") {
    return {
      como_trabajar:
        "Preguntale UNA cosa por vez y espera la respuesta. Despues de cada respuesta, escribi la regla " +
        "con v3_crear_regla y mostrale en palabras que quedo. No inventes productos, precios ni textos: si " +
        "falta un dato, preguntalo. Si ya existe algo parecido en el V2, podes leerlo con ver_agente o " +
        "listar_productos y proponerselo para confirmar, pero no lo des por hecho.",
      preguntas: [
        {
          tema: "El negocio",
          pregunta: "¿Qué vende el negocio y a quién? ¿Cómo querés que hable: de tú o de usted, corto o explicado?",
          para: "v3_escribir_como_hablamos",
        },
        {
          tema: "El saludo",
          pregunta:
            "Cuando escribe alguien por primera vez, ¿qué tiene que recibir? ¿Un saludo fijo, un catálogo, o que la IA salude a su manera?",
          para: "Una regla con cuando.tipo=siempre y soloSi.esPrimerMensaje=true",
        },
        {
          tema: "Qué vende",
          pregunta:
            "Nombrame los productos con los que trabaja el agente. Por cada uno: ¿cómo se da cuenta de que el cliente pregunta por ese, con qué palabras?",
          para: "Reglas con cuando.tipo=frase (frases largas) y accion activar_producto",
        },
        {
          tema: "El recorrido de la venta",
          pregunta:
            "Para el primer producto: ¿qué le pregunta primero, qué le cuenta después, y qué le manda cuando el cliente dice que sí?",
          para: "Reglas con cuando.tipo=paso, una por paso del embudo",
        },
        {
          tema: "Los envíos de material",
          pregunta: "¿Qué catálogos, fotos o PDF tiene que mandar, y en qué momento exacto de la charla?",
          para: "Acciones tipo flujo, con soloSi para que no se pisen entre ellas",
        },
        {
          tema: "Cuándo entra una persona",
          pregunta: "¿En qué casos tiene que dejar de contestar y avisarle a un asesor?",
          para: "Reglas con accion avisar_asesor y pausar_ia",
        },
        {
          tema: "Si no contesta",
          pregunta: "Si el cliente se queda callado, ¿a los cuántos minutos le escribís de nuevo y qué le decís?",
          para: "Reglas con cuando.tipo=sin_respuesta",
        },
      ],
      despues:
        "Con las primeras reglas escritas, corre v3_simular_conversacion sobre 2 o 3 charlas reales y mostrale la comparacion contra lo que contesto el V2. Ahi se ve si falta algo.",
    };
  }

  if (nombre === "v3_que_falta") {
    const huecos: Array<{ falta: string; preguntar: string }> = [];
    if (!libro.comoHablamos.trim()) {
      huecos.push({
        falta: "No está escrito cómo habla el negocio.",
        preguntar: "¿Qué vende, a quién, y cómo querés que hable: de tú o de usted, corto o explicado?",
      });
    }
    if (!libro.reglas.some((regla) => regla.soloSi?.esPrimerMensaje === true)) {
      huecos.push({
        falta: "No hay nada para el primer mensaje: al cliente nuevo no lo recibe nadie.",
        preguntar: "Cuando alguien escribe por primera vez, ¿qué tiene que recibir?",
      });
    }
    const productos = new Set(
      libro.reglas.flatMap((regla) =>
        regla.entonces.filter((accion) => accion.tipo === "activar_producto").map((accion) => accion.productoId),
      ),
    );
    for (const producto of productos) {
      const pasos = libro.reglas.filter(
        (regla) => regla.cuando.tipo === "paso" && regla.cuando.producto === producto,
      );
      if (pasos.length === 0) {
        huecos.push({
          falta: `El producto ${producto} se activa pero no tiene ningún paso escrito: nadie sabe qué decir después.`,
          preguntar: `Para ${producto}: ¿qué le pregunta primero, qué le cuenta después, y qué le manda si dice que sí?`,
        });
      }
    }
    if (!libro.reglas.some((regla) => regla.entonces.some((accion) => accion.tipo === "avisar_asesor"))) {
      huecos.push({
        falta: "No hay ningún caso en el que entre una persona.",
        preguntar: "¿En qué casos tiene que dejar de contestar y avisarle a un asesor?",
      });
    }
    return { huecos, problemas: revisarLibro(libro), reglas: libro.reglas.length };
  }

  if (nombre === "v3_escribir_como_hablamos") {
    const texto = String(argumentos.texto ?? "").trim();
    const resultado = await guardarLibro({
      workspaceId: contexto.workspaceId,
      libro: { ...libro, comoHablamos: texto },
      autor: "Claude",
      resumen: "Cambio como habla el negocio",
    });
    return { ok: true, version: resultado.version };
  }

  if (nombre === "v3_crear_regla") {
    const regla = comoRegla(argumentos);
    if (!regla.nombre.trim() || !regla.cuando || regla.entonces.length === 0) {
      throw new Error("Una regla necesita nombre, cuando se dispara y que hace");
    }
    const resultado = await guardarLibro({
      workspaceId: contexto.workspaceId,
      libro: { ...libro, reglas: [...libro.reglas, regla] },
      autor: "Claude",
      resumen: `Regla nueva: ${regla.nombre}`,
    });
    return { ok: true, regla_id: regla.id, version: resultado.version, problemas: resultado.problemas };
  }

  if (nombre === "v3_editar_regla") {
    const reglaId = String(argumentos.regla_id ?? "");
    const actual = libro.reglas.find((regla) => regla.id === reglaId);
    if (!actual) {
      throw new Error("Esa regla no esta en el libro");
    }
    const regla = comoRegla(argumentos, actual);
    const resultado = await guardarLibro({
      workspaceId: contexto.workspaceId,
      libro: { ...libro, reglas: libro.reglas.map((fila) => (fila.id === reglaId ? regla : fila)) },
      autor: "Claude",
      resumen: `Regla corregida: ${regla.nombre}`,
    });
    return { ok: true, version: resultado.version, problemas: resultado.problemas };
  }

  if (nombre === "v3_borrar_regla") {
    const reglaId = String(argumentos.regla_id ?? "");
    const actual = libro.reglas.find((regla) => regla.id === reglaId);
    if (!actual) {
      throw new Error("Esa regla no esta en el libro");
    }
    const resultado = await guardarLibro({
      workspaceId: contexto.workspaceId,
      libro: { ...libro, reglas: libro.reglas.filter((regla) => regla.id !== reglaId) },
      autor: "Claude",
      resumen: `Regla borrada: ${actual.nombre}`,
    });
    return { ok: true, version: resultado.version, aviso: "Para recuperarla: v3_volver_a_version." };
  }

  if (nombre === "v3_probar_mensaje") {
    const decision = decidir({
      libro,
      mensaje: String(argumentos.mensaje ?? ""),
      estado: {
        productoActivo: (argumentos.producto_activo as string) ?? null,
        pasoActual: (argumentos.paso_actual as never) ?? null,
        flujosEnviados: [],
        esPrimerMensaje: argumentos.es_primer_mensaje !== false,
      },
    });
    return {
      gana: decision.regla ? { regla_id: decision.regla.id, nombre: decision.regla.nombre } : null,
      haria: decision.acciones,
      porque: decision.porque,
      tambien_encajaban: decision.tambienEncajaban,
    };
  }

  if (nombre === "v3_simular_conversacion") {
    const resultado = await simularConversacion({
      workspaceId: contexto.workspaceId,
      conversationId: String(argumentos.conversacion_id ?? ""),
      libro,
      tope: typeof argumentos.tope === "number" ? argumentos.tope : undefined,
    });
    if (resultado.error) {
      throw new Error(resultado.error);
    }
    return { turnos: resultado.turnos };
  }

  if (nombre === "v3_historial") {
    const historial = await leerHistorialDelLibro(contexto.workspaceId);
    return {
      versiones: historial.map((version) => ({
        version: version.version,
        cuando: version.at,
        autor: version.autor,
        que_cambio: version.resumen,
        reglas: version.libro.reglas.length,
      })),
    };
  }

  if (nombre === "v3_volver_a_version") {
    const resultado = await volverAVersion({
      workspaceId: contexto.workspaceId,
      version: Number(argumentos.version),
      autor: "Claude",
    });
    if (!resultado.ok) {
      throw new Error(resultado.error);
    }
    return { ok: true, version: resultado.version };
  }

  throw new Error(`Herramienta desconocida: ${nombre}`);
}
