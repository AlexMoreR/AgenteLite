import { getFlowReply } from "@/lib/agent-product-flow";
import type { FlowStep } from "@/lib/agent-product-flow";

import { leerLibro } from "../servicios/almacen";
import { RESPUESTA_POR_MAYOR, pidePorMayor } from "../servicios/mayorista";
import {
  catalogoActivo,
  nombreLegible,
  pieDeFotoDelProducto,
  productosInactivos,
  reconocerEnElCatalogo,
  reconocerPorCodigo,
  textoDeUnProducto,
  textoDeVariasOpciones,
  type ProductoDelCatalogoV3,
} from "../servicios/catalogo";
import { anotarDecision } from "../servicios/decisiones";
import { clasificarIntenciones } from "./clasificar";
import { decidir, siguienteEstado, type EstadoDeLaCharla } from "./decidir";
import { mandarRespaldo } from "./respaldo";
import { fotoDelClienteReciente, type MensajeReciente } from "./foto-y-precio";
import { guardarEstado, leerEstado } from "./estado";
import type { Accion, LibroDeReglas, ReglaV3 as Regla } from "../domain/reglas";

/** Los productos que nombra una regla: el que activa, el del paso y el de su condición. */
function productosDeLaRegla(regla: Regla): string[] {
  const ids: string[] = [];
  for (const accion of regla.entonces) {
    if (accion.tipo === "activar_producto") ids.push(accion.productoId);
  }
  if (regla.cuando.tipo === "paso" && regla.cuando.producto) ids.push(regla.cuando.producto);
  const condicion = regla.soloSi?.productoActivo;
  if (condicion && condicion !== "ninguno" && condicion !== "cualquiera") ids.push(condicion);
  return ids;
}

/**
 * EL EJECUTOR: convierte la decisión del motor en cosas que pasan.
 *
 * El motor decide y esto ejecuta; están separados a propósito. El motor es una función pura que se
 * puede probar mil veces sin enviar nada, y todo lo que toca el mundo real —mandar un WhatsApp,
 * avisar a una asesora, mover una etapa— pasa por acá, en un solo lugar donde se puede mirar.
 *
 * Quien lo llama le pasa CÓMO hacer cada cosa (enviarPaso, avisarAsesor, cambiarEtapa...). Así
 * este archivo no sabe nada de WhatsApp ni de Prisma, y el día que haya otro canal —Instagram, la
 * API oficial— se reusa entero.
 */

/** Lo que devuelve el redactor: el porqué, si a la clienta le llegó algo y por qué falló la IA. */
export type ResultadoDelRedactor = { porque: string; respondio: boolean; causa: string | null };

export type Herramientas = {
  enviarPaso: (paso: FlowStep) => Promise<boolean>;
  avisarAsesor: (motivo: string) => Promise<void>;
  cambiarEtapa: (etapa: string) => Promise<void>;
  pausarIa: () => Promise<void>;
  /** Cuando la regla dice "que conteste la IA": recibe la guía escrita en el libro. */
  responderConIa: (guia: string) => Promise<void | ResultadoDelRedactor>;
  /**
   * ¿Este mismo texto ya salió en esta conversación hace poco?
   *
   * Vive acá y no dentro del motor porque es una pregunta a la base, y el motor es una función
   * pura. Quien no la implemente puede devolver false: se comporta como antes.
   */
  yaLoDijimos: (texto: string) => Promise<boolean>;
  /**
   * La charla entró a un paso del embudo de un producto: programar los seguimientos que alguien
   * escribió para ESE paso (día 1, día 3...). Antes lo hacía solo el V2; desde que el V3 atiende
   * no salía ninguno (Alex, 03-10-2026). Opcional: quien no lo implemente no programa nada.
   */
  alEntrarAlPaso?: (productoId: string, paso: string) => Promise<void>;
  /**
   * Ninguna regla del libro aplica: que conteste el redactor de la estrella, con sus candados (no
   * inventar, nunca mayorista, avisar a una asesora si falta un dato). Devuelve el porqué (un texto), o
   * null si no pudo hacerse cargo, o el objeto del redactor: con `respondio: false` el motor manda el
   * respaldo. Un texto sigue funcionando como siempre. Opcional: sin esto el mensaje sigue su camino.
   */
  responderSinRegla?: (contexto: { foto: string | null }) => Promise<string | null | ResultadoDelRedactor>;
  /** El id del flujo con ese título (para el respaldo), o null si no existe. Opcional. */
  buscarFlujo?: (titulo: string) => Promise<string | null>;
  /**
   * MEDIR (Embudo F1): se llama una vez al terminar el turno con la traza de lo que pasó. Solo
   * mira: no puede cambiar ninguna decisión. Quien lo implemente tiene que volver al instante
   * (agendar el registro en segundo plano) y no lanzar; igual se llama dentro de un try.
   * Opcional: sin esto no se registra nada.
   */
  registrarTraza?: (traza: TrazaV3, resultado: { atendido: boolean; regla: string | null }) => void;
};

/**
 * Lo que pasó en un turno, para el embudo (F1). No interviene en ninguna decisión: se va llenando
 * mientras el motor decide, y se entrega al final.
 */
export type TrazaV3 = {
  libroVersion: number | null;
  /** Estado de la charla antes del turno (null si el motor salió antes de leerlo). */
  antes: { pasoActual: string | null; producto: string | null; esPrimerMensaje: boolean } | null;
  /** Estado después (null = no cambió o el motor salió antes de guardarlo). */
  despues: { pasoActual: string | null; producto: string | null } | null;
  /** Ids de las reglas de intención que reconoció la IA. */
  intenciones: string[];
  /** Tipos de las acciones que decidió el motor (saludo incluido), antes del filtro de no repetir. */
  tiposDeAccion: string[];
  /** Salió el saludo del primer mensaje. */
  conSaludo: boolean;
  /** Se ejecutó al menos un flujo (catálogo, fotos...). */
  envioFlujo: boolean;
  /** Pasos que salieron por enviarPaso en este turno (los del redactor se cuentan aparte). */
  mensajesEnviados: number;
  reglaId: string | null;
  reglaNombre: string | null;
  /** Lo que se mandó de respaldo cuando la IA no logró redactar (null/ausente = no hizo falta). */
  respaldo?: { tipo: "ficha" | "texto" | "nada"; causa: string | null } | null;
  /** Cuándo empezó el turno (ISO). */
  cuando: string;
};

export type ResultadoV3 = {
  /** Si el V3 se hizo cargo de este mensaje. false = que siga el camino de siempre. */
  atendido: boolean;
  regla: string | null;
  porque: string;
  acciones: number;
  /** Para el embudo (F1). No cambia nada de lo de arriba. */
  traza?: TrazaV3;
};

/** Un texto es el porqué (sin saber si respondió); null = no pudo; un objeto se usa tal cual. */
function porqueYRespondio(resultado: string | null | ResultadoDelRedactor | undefined): {
  porque: string | null;
  respondio: boolean | null;
  causa: string | null;
} {
  if (!resultado) return { porque: null, respondio: null, causa: null };
  if (typeof resultado === "string") return { porque: resultado, respondio: null, causa: null };
  return { porque: resultado.porque, respondio: resultado.respondio, causa: resultado.causa };
}

/**
 * El redactor no logró que le llegara nada a la clienta: se manda el respaldo y, si cambió el estado
 * (la ficha pasa la charla a PRODUCTO), se guarda otra vez. Nunca rompe el turno.
 */
async function respaldarSiFalla(
  input: {
    workspaceId: string;
    conversationId: string;
    incluirApiOficial?: boolean;
    herramientas: Herramientas;
  },
  libro: LibroDeReglas,
  estado: EstadoDeLaCharla,
  redactor: { porque: string; causa: string | null },
  traza: TrazaV3,
): Promise<{ porque: string; acciones: number }> {
  try {
    const respaldo = await mandarRespaldo({
      workspaceId: input.workspaceId,
      estado,
      libro,
      incluirApiOficial: input.incluirApiOficial,
      causa: redactor.causa,
      herramientas: input.herramientas,
    });
    traza.respaldo = { tipo: respaldo.tipo, causa: redactor.causa };
    if (respaldo.estado !== estado) {
      await guardarEstado(input.conversationId, respaldo.estado);
      traza.despues = { pasoActual: respaldo.estado.pasoActual, producto: respaldo.estado.productoActivo };
    }
    return { porque: `${redactor.porque} ${respaldo.nota}`, acciones: respaldo.enviados };
  } catch (error) {
    console.error("[agente-v3] respaldo", error instanceof Error ? error.message : error);
    return { porque: redactor.porque, acciones: 0 };
  }
}

export async function atenderConAgenteV3(input: {
  workspaceId: string;
  conversationId: string;
  /** Lo que acaba de escribir el cliente. */
  mensaje: string;
  /** Últimos mensajes para que la IA entienda un "si" suelto. */
  historial?: Array<{ de: "cliente" | "negocio"; texto: string }>;
  /** A qué mensaje nuestro le respondió, si usó "responder" de WhatsApp. */
  citado?: string;
  incluirApiOficial?: boolean;
  /**
   * Lo que muestra la foto que acaba de mandar, descrito por la IA. NO se mezcla con `mensaje`: las
   * reglas por frase engancharían palabras de la descripción como si ella las hubiera escrito.
   */
  foto?: string | null;
  /**
   * Los últimos mensajes del chat CON su tipo y su hora, del más viejo al más nuevo (incluido el
   * que se está contestando). El historial de texto no alcanza: una foto sin texto no aparece ahí,
   * y es justo lo que hace falta para saber que "¿qué valor tiene así?" pregunta por la foto.
   */
  recientes?: MensajeReciente[];
  herramientas: Herramientas;
}): Promise<ResultadoV3> {
  /*
    La hora se toma ANTES de evaluar, no despues.

    Si un mensaje entra mientras el motor esta pensando, esa vuelta no lo vio. Marcando el inicio,
    ese mensaje sigue contando como "sin decidir" y el rescate lo puede levantar; marcando el
    final, quedaria tapado por una decision que nunca lo miro.
  */
  const inicio = new Date();
  /*
    La traza del embudo (F1) se llena mientras el motor decide y se entrega al final. El único
    cambio en el camino del motor es contar los pasos que salen por enviarPaso: el envoltorio
    llama al original, espera lo mismo y devuelve lo mismo.
  */
  const traza: TrazaV3 = {
    libroVersion: null,
    antes: null,
    despues: null,
    intenciones: [],
    tiposDeAccion: [],
    conSaludo: false,
    envioFlujo: false,
    mensajesEnviados: 0,
    reglaId: null,
    reglaNombre: null,
    cuando: inicio.toISOString(),
  };
  const enviarPasoOriginal = input.herramientas.enviarPaso;
  const herramientasContadas: Herramientas = {
    ...input.herramientas,
    enviarPaso: async (paso) => {
      const salio = await enviarPasoOriginal(paso);
      if (salio !== false) traza.mensajesEnviados += 1;
      return salio;
    },
  };
  const resultado = await evaluar({ ...input, herramientas: herramientasContadas }, traza);

  /*
    Queda huella de TODA vuelta, haya respondido o no.

    Va en el envoltorio y no adentro a proposito: el motor tiene varias salidas -libro vacio,
    ninguna regla, se callo para no repetirse- y si la marca viviera en cada una, la proxima
    salida que alguien agregue se olvidaria de dejarla. Y una vuelta sin huella es, para el
    rescate, un mensaje que nadie miro.
  */
  await anotarDecision(input.conversationId, {
    cuando: inicio.toISOString(),
    atendido: resultado.atendido,
    regla: resultado.regla,
  });

  // Embudo F1: solo se entrega la traza. Cualquier falla de quien la recibe se traga acá.
  try {
    input.herramientas.registrarTraza?.(traza, { atendido: resultado.atendido, regla: resultado.regla });
  } catch (error) {
    console.error("[agente-v3] registrarTraza", error instanceof Error ? error.message : error);
  }

  return { ...resultado, traza };
}

async function evaluar(
  input: {
    workspaceId: string;
    conversationId: string;
    mensaje: string;
    historial?: Array<{ de: "cliente" | "negocio"; texto: string }>;
    citado?: string;
    incluirApiOficial?: boolean;
    foto?: string | null;
    recientes?: MensajeReciente[];
    herramientas: Herramientas;
  },
  traza: TrazaV3,
): Promise<ResultadoV3> {
  const libroCompleto = await leerLibro(input.workspaceId);
  traza.libroVersion = typeof libroCompleto.version === "number" ? libroCompleto.version : null;
  if (libroCompleto.reglas.length === 0) {
    return { atendido: false, regla: null, porque: "El libro de reglas está vacío.", acciones: 0 };
  }

  const estado = await leerEstado(input.conversationId);
  traza.antes = {
    pasoActual: estado.pasoActual,
    producto: estado.productoActivo,
    esPrimerMensaje: estado.esPrimerMensaje,
  };

  /*
    Un producto INACTIVO (oculto o borrado en Gestión) no se ofrece, aunque tenga reglas (Alex,
    03-10-2026): esas reglas no se aplican, y si la charla ya era de ese producto, sigue una persona.
  */
  const nombrados = [...new Set([...libroCompleto.reglas.flatMap(productosDeLaRegla), ...(estado.productoActivo ? [estado.productoActivo] : [])])];
  const inactivos = await productosInactivos(input.workspaceId, nombrados).catch(() => new Set<string>());
  if (estado.productoActivo && inactivos.has(estado.productoActivo)) {
    await input.herramientas.avisarAsesor(
      "La clienta habla de un producto que ya no está activo en Gestión: el agente no lo ofrece",
    );
    return {
      atendido: true,
      regla: null,
      porque: "El producto de esta charla ya no está activo en Gestión: se avisó a una asesora.",
      acciones: 0,
    };
  }
  /*
    Compra por cantidad o precio al por mayor: lo atiende una persona, y el agente no da el precio
    (Alex, 03-10-2026). Va ANTES de las reglas a propósito: una regla de precios contestaría con la
    lista de precios al detal a quien pidió seis sillas.
  */
  if (pidePorMayor(input.mensaje)) {
    traza.reglaNombre = "Compra por cantidad";
    traza.tiposDeAccion = ["mensaje", "avisar_asesor"];
    const yaSeLeDijo = await input.herramientas.yaLoDijimos(RESPUESTA_POR_MAYOR);
    if (!yaSeLeDijo) {
      await input.herramientas.enviarPaso({ kind: "text", content: RESPUESTA_POR_MAYOR });
    }
    await input.herramientas.avisarAsesor(
      "La clienta pide precio al por mayor o 3 o más unidades: el agente no da ese precio",
    );
    return {
      atendido: true,
      regla: "Compra por cantidad",
      porque: "La clienta pidió precio al por mayor o 3 o más unidades: el agente no da ese precio y avisó a una asesora.",
      acciones: yaSeLeDijo ? 0 : 1,
    };
  }

  /*
    Una foto SIN texto: no hay palabras para las reglas. Si se evaluaran igual, la "red del paso"
    (las reglas que contestan cualquier cosa) respondería algo genérico a una foto que pregunta por
    algo concreto. La contesta el redactor, mirando la foto como contexto.
  */
  if (!input.mensaje.trim() && input.foto) {
    const redactor = porqueYRespondio(await input.herramientas.responderSinRegla?.({ foto: input.foto }));
    if (redactor.porque) {
      const estadoAvanzado = siguienteEstado(estado, []);
      await guardarEstado(input.conversationId, estadoAvanzado);
      if (redactor.respondio === false) {
        const respaldo = await respaldarSiFalla(
          input,
          libroCompleto,
          estadoAvanzado,
          { porque: redactor.porque, causa: redactor.causa },
          traza,
        );
        return { atendido: true, regla: "Redactor (foto)", ...respaldo };
      }
      return { atendido: true, regla: "Redactor (foto)", porque: redactor.porque, acciones: 1 };
    }
    return { atendido: false, regla: null, porque: "Llegó una foto sin texto y no hubo redactor.", acciones: 0 };
  }

  const libro =
    inactivos.size === 0
      ? libroCompleto
      : {
          ...libroCompleto,
          reglas: libroCompleto.reglas.filter((regla) => !productosDeLaRegla(regla).some((id) => inactivos.has(id))),
        };

  /*
    La IA solo se llama si hay reglas de intención que puedan aplicar AHORA.

    Filtrar antes por las condiciones (producto activo, paso) evita pagar una llamada para preguntar
    por intenciones que el estado ya descartó. En una charla dentro del embudo suelen quedar una o
    dos candidatas, no las veinte del libro.
  */
  /*
    ¿La clienta mandó una foto hace poco? Una foto con texto en ESTE mensaje cuenta, y también una
    de sus 2 últimos mensajes (10 min). Solo las de ella: las fotos del combo que mandamos nosotros
    no son una pregunta por otra referencia.
  */
  const fotoReciente = fotoDelClienteReciente(input.recientes);
  const fotoDelCliente =
    fotoReciente || input.foto
      ? {
          pie: fotoReciente?.pie ?? (input.foto ? input.mensaje.trim() || null : null),
          descripcion: input.foto ?? null,
        }
      : null;

  const intencionesReconocidas = await clasificarIntenciones({
    mensaje: input.mensaje,
    reglas: libro.reglas,
    historial: input.historial,
    citado: input.citado,
    fotoDelCliente,
  });

  const decision = decidir({ libro, mensaje: input.mensaje, estado, intencionesReconocidas, fotoDelCliente });
  const acciones = [...decision.saludo, ...decision.acciones];
  traza.intenciones = [...intencionesReconocidas];
  traza.tiposDeAccion = acciones.map((accion) => accion.tipo);
  traza.conSaludo = decision.saludo.length > 0;
  traza.reglaId = decision.regla?.id ?? null;
  traza.reglaNombre = decision.regla?.nombre ?? (decision.saludo.length ? "Saludo" : null);

  if (acciones.length === 0) {
    // Ninguna regla aplica: si la clienta nombró un producto del catálogo, se le responde con él.
    const delCatalogo = await responderDesdeElCatalogo(input).catch((error) => {
      console.error("[agente-v3] catalogo", error instanceof Error ? error.message : error);
      return null;
    });
    // Nada que hacer no es un error: el cliente dijo algo que no le toca a ninguna regla.
    const estadoSinCambios = siguienteEstado(estado, []);
    await guardarEstado(input.conversationId, estadoSinCambios);
    if (delCatalogo) {
      return { atendido: true, regla: "Catálogo de Gestión", porque: delCatalogo, acciones: 1 };
    }
    /*
      Ni regla ni catálogo: contesta el redactor (Alex, 03-10-2026), con los candados de la estrella.
      Antes el mensaje quedaba sin respuesta hasta que entrara una asesora.
    */
    const delRedactor = porqueYRespondio(await input.herramientas.responderSinRegla?.({ foto: input.foto ?? null }));
    if (delRedactor.porque) {
      if (delRedactor.respondio === false) {
        const respaldo = await respaldarSiFalla(
          input,
          libroCompleto,
          estadoSinCambios,
          { porque: delRedactor.porque, causa: delRedactor.causa },
          traza,
        );
        return { atendido: true, regla: "Redactor", ...respaldo };
      }
      return { atendido: true, regla: "Redactor", porque: delRedactor.porque, acciones: 1 };
    }
    return { atendido: false, regla: null, porque: decision.porque, acciones: 0 };
  }

  /*
    NO REPETIR: un texto que ya salió no vuelve a salir.

    Una clienta escribió dos mensajes seguidos —"No me gusta esa varilla" y "Otro modelo por fa"—
    y ninguno encajaba con una regla, así que la red del paso contestó las dos veces con el MISMO
    texto palabra por palabra, uno detrás del otro (Alex, 28-09-2026). Las reglas red son
    justamente las que más se repiten: contestan cuando no se entendió, y cuando no se entiende
    una vez se suele no entender la siguiente.

    La regla de Alex no se negocia: el agente nunca repite un mensaje ya enviado, y si no tiene
    nada nuevo que decir no se traba ni insiste — avisa a un asesor y se calla. Es la misma idea
    que ya estaba escrita para el V2; al V3 le faltaba.
  */
  const filtradas: Accion[] = [];
  let seCallo = false;
  for (const accion of acciones) {
    if (accion.tipo === "mensaje" && (await input.herramientas.yaLoDijimos(accion.texto))) {
      seCallo = true;
      continue;
    }
    filtradas.push(accion);
  }

  const leDiceAlgo = filtradas.some(
    (accion) => accion.tipo === "mensaje" || accion.tipo === "flujo" || accion.tipo === "responder_con_ia",
  );

  /*
    Lo que NO es un mensaje se hace igual: mover la etapa, pausar la IA, avisar.

    Se ejecuta antes de decidir si hay que escalar, y no con un retorno temprano, porque si no una
    regla del tipo [mensaje + cambiar_etapa] perdería la etapa solo porque el texto se repetía.
  */
  const notas = await ejecutarAcciones(filtradas, input);

  /*
    Se calló y no le queda nada que decirle: que siga una persona.

    Callarse a secas dejaría al cliente esperando, y repetir es lo que estamos evitando. No se
    avisa dos veces si la regla ya pedía un asesor por su cuenta, y el aviso tiene además su propia
    antirrepetición, así que esto no le llena el teléfono a nadie.
  */
  const laReglaYaPidioAsesor = filtradas.some((accion) => accion.tipo === "avisar_asesor");
  if (seCallo && !leDiceAlgo && !laReglaYaPidioAsesor) {
    await input.herramientas.avisarAsesor(
      "El agente iba a repetir un mensaje que ya envió y no tiene nada nuevo que decir",
    );
  }

  const nuevoEstado = siguienteEstado(estado, acciones);
  await guardarEstado(input.conversationId, nuevoEstado);
  traza.envioFlujo = filtradas.some((accion) => accion.tipo === "flujo");
  traza.despues = { pasoActual: nuevoEstado.pasoActual, producto: nuevoEstado.productoActivo };

  /*
    Entró a un paso nuevo del embudo (o cambió de producto): se programan los seguimientos de ese
    paso. Solo al CAMBIAR, no en cada mensaje: si no, cada respuesta reprogramaría lo mismo.
  */
  if (
    nuevoEstado.productoActivo &&
    nuevoEstado.pasoActual &&
    (nuevoEstado.pasoActual !== estado.pasoActual || nuevoEstado.productoActivo !== estado.productoActivo)
  ) {
    await input.herramientas
      .alEntrarAlPaso?.(nuevoEstado.productoActivo, nuevoEstado.pasoActual)
      .catch((error) => console.error("[agente-v3] seguimientos del paso", error instanceof Error ? error.message : error));
  }

  const porqueDeLaRegla = !seCallo
    ? decision.porque
    : leDiceAlgo
      ? `${decision.porque} (No se repitió un texto que ya había salido.)`
      : `${decision.porque} Pero ese mensaje ya se había enviado en esta conversación, así que se avisó a un asesor en vez de repetirlo.`;
  // Lo que dejaron las acciones para la nota del chat (por ejemplo, qué producto se reconoció).
  const porque = notas.length ? `${porqueDeLaRegla} ${notas.join(" ")}` : porqueDeLaRegla;

  return {
    atendido: true,
    regla: decision.regla?.nombre ?? "Saludo",
    porque,
    acciones: filtradas.length,
  };
}

/**
 * La clienta preguntó por un producto que ninguna regla cubre (Alex, 03-10-2026: "responder y
 * avisar"). Si lo nombró y está activo en el catálogo, se le dice qué es, cuánto vale y se le manda
 * la foto; si nombró algo que encaja con varios, se le pregunta cuál. En los dos casos se avisa a
 * una asesora. Devuelve el porqué para la nota del chat, o null si no nombró ningún producto.
 */
async function responderDesdeElCatalogo(input: {
  workspaceId: string;
  mensaje: string;
  herramientas: Herramientas;
}): Promise<string | null> {
  const coincidencia = reconocerEnElCatalogo(input.mensaje, await catalogoActivo(input.workspaceId));
  if (!coincidencia) return null;

  const texto =
    coincidencia.tipo === "uno"
      ? textoDeUnProducto(coincidencia.producto)
      : textoDeVariasOpciones(coincidencia.productos, coincidencia.total);

  // La regla de siempre: nunca repetir un mensaje que ya salió; si se repetiría, solo se avisa.
  if (await input.herramientas.yaLoDijimos(texto)) {
    await input.herramientas.avisarAsesor("La clienta volvió a preguntar por un producto del catálogo");
    return "Ya se le había mandado esa información del catálogo: se avisó a una asesora en vez de repetirla.";
  }

  await input.herramientas.enviarPaso({ kind: "text", content: texto });
  if (coincidencia.tipo === "uno" && coincidencia.producto.foto) {
    await input.herramientas.enviarPaso({ kind: "image", url: coincidencia.producto.foto, caption: null });
  }

  const deQue =
    coincidencia.tipo === "uno"
      ? `${nombreLegible(coincidencia.producto.nombre)}${coincidencia.producto.codigo ? ` (${coincidencia.producto.codigo})` : ""}`
      : `${coincidencia.total} productos parecidos`;
  await input.herramientas.avisarAsesor(`La clienta preguntó por ${deQue}, que no tiene reglas en el agente`);

  return coincidencia.tipo === "uno"
    ? `Ninguna regla aplicaba; la clienta nombró ${deQue} del catálogo: se le respondió con precio y foto y se avisó a una asesora.`
    : `Ninguna regla aplicaba; lo que escribió encaja con ${deQue} del catálogo: se le preguntó cuál y se avisó a una asesora.`;
}

type EntradaDeAcciones = {
  workspaceId: string;
  /** Lo que escribió el cliente: de acá sale el código del producto que nombró. */
  mensaje: string;
  incluirApiOficial?: boolean;
  herramientas: Herramientas;
  /** De dónde sale el catálogo. Por defecto, los productos activos de Gestión (las pruebas pasan otro). */
  leerCatalogo?: () => Promise<ProductoDelCatalogoV3[]>;
};

/**
 * Ejecuta las acciones de la regla EN ORDEN. Devuelve las notas que dejaron para el chat.
 *
 * Exportada para las pruebas: así se comprueba que, si una acción falla, las de después (avisar a
 * la asesora, pausar la IA) se cumplen igual.
 */
export async function ejecutarAcciones(acciones: Accion[], input: EntradaDeAcciones): Promise<string[]> {
  const notas: string[] = [];
  for (const accion of acciones) {
    const nota = await ejecutarUna(accion, input);
    if (nota) notas.push(nota);
  }
  return notas;
}

/** Ejecuta una acción. Devuelve una nota para el chat cuando hay algo que contar, o null. */
async function ejecutarUna(accion: Accion, input: EntradaDeAcciones): Promise<string | null> {
  const { herramientas } = input;

  switch (accion.tipo) {
    case "mensaje":
      await herramientas.enviarPaso({ kind: "text", content: accion.texto });
      return null;

    case "mandar_producto_del_mensaje": {
      /*
        La foto del producto que pidió (el cliente llega de magilus.com con "TPV001 Tarima
        Pedicure"): la ve de una mientras le escribe la asesora. Nunca rompe la regla: si no hay un
        código exacto y único, si no tiene foto, si ya se mandó o si falla el envío, no manda nada y
        las acciones siguientes (avisar, pausar) se cumplen igual.
      */
      try {
        const catalogo = await (input.leerCatalogo ?? (() => catalogoActivo(input.workspaceId)))();
        const producto = reconocerPorCodigo(input.mensaje, catalogo);
        if (!producto?.foto) return null;
        const pie = pieDeFotoDelProducto(producto);
        const deQue = `${nombreLegible(producto.nombre)} (${producto.codigo?.trim()})`;
        if (await herramientas.yaLoDijimos(pie)) {
          return `Reconoció ${deQue}; su foto ya se había mandado en este chat y no se repitió.`;
        }
        const salio = await herramientas.enviarPaso({ kind: "image", url: producto.foto, caption: pie });
        return salio === false
          ? `Reconoció ${deQue} en el mensaje, pero su foto no se pudo mandar.`
          : `Reconoció ${deQue} en el mensaje y le mandó su foto.`;
      } catch (error) {
        console.error("[agente-v3] mandar_producto_del_mensaje", error instanceof Error ? error.message : error);
        return null;
      }
    }

    case "flujo": {
      /*
        Un flujo se manda con SUS pasos, igual que en el V2.

        Se reusa `getFlowReply` a propósito: es el mismo camino por el que hoy salen los catálogos,
        con sus fotos, PDFs y textos en orden. Escribir un envío aparte era garantizar que con el
        tiempo el V3 mandara las cosas distinto que el V2 y nadie supiera cuál era la buena.
      */
      const flujo = await getFlowReply({
        workspaceId: input.workspaceId,
        flowId: accion.flujoId,
        includeOfficialApi: input.incluirApiOficial !== false,
      }).catch(() => null);
      for (const paso of flujo?.steps ?? []) {
        await herramientas.enviarPaso(paso);
      }
      return null;
    }

    case "responder_con_ia":
      await herramientas.responderConIa(accion.guia);
      return null;

    case "avisar_asesor":
      await herramientas.avisarAsesor(accion.motivo);
      return null;

    case "cambiar_etapa_crm":
      await herramientas.cambiarEtapa(accion.etapa);
      return null;

    case "pausar_ia":
      await herramientas.pausarIa();
      return null;

    // activar_producto e ir_al_paso no mandan nada: solo mueven el estado, y eso lo hace
    // `siguienteEstado` con la lista completa de acciones.
    default:
      return null;
  }
}
