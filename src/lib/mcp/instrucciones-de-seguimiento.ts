import { prisma } from "@/lib/prisma";
import {
  CANDADOS,
  LO_QUE_RECHAZA_EL_REVISOR,
  NUMERO_MAXIMO_DE_SEGUIMIENTO,
  aplicarCambio,
  avisosDelCambio,
  erroresDelCambio,
  mismasInstrucciones,
  textoActualDelNivel,
  textoGlobalVigente,
  textoNuevoDelNivel,
  type CambioPedido,
  type InstruccionesGuardadas,
} from "@/features/seguimientos/dominio/instrucciones-de-seguimiento";
import { textoPersonalizadoParaLaIA } from "@/features/seguimientos/dominio/seguimiento-que-escucha";
import {
  guardarInstrucciones,
  leerHistorialDeInstrucciones,
  leerInstrucciones,
  volverInstrucciones,
} from "@/features/seguimientos/services/instrucciones-de-seguimiento";

/*
  INSTRUCCIONES DE LOS SEGUIMIENTOS CON IA POR MCP (pedido del dueño, 6-nov-2026): ajustar por voz lo
  que la IA tiene en cuenta al escribir los seguimientos automaticos, sin una tarjeta de codigo cada vez.

  Mismas reglas que el libro V3: leer antes de cambiar (aqui se exige de verdad: sin la version leida
  no se guarda), el cambio queda activo al instante y se deshace en un paso. Cambiar primero muestra
  el antes y el despues sin guardar; solo guarda con confirmado=true. Solo dueño o administrador.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ESCRIBE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const OJO_V3 = "Los seguimientos del reloj del V3 usan este mismo redactor: un cambio aquí también cambia lo que ellos escriben.";

export const HERRAMIENTAS_MCP_INSTRUCCIONES_DE_SEGUIMIENTO = [
  {
    name: "ver_instrucciones_de_seguimientos",
    title: "Ver las instrucciones de los seguimientos con IA",
    description:
      "Lo que la IA tiene en cuenta al escribir los seguimientos automáticos: la versión actual, el texto global, los añadidos por " +
      "producto y por número de seguimiento (1.º, 2.º... desde que el cliente calló; no es el paso del embudo), los candados que no " +
      "se cambian y lo que el revisor rechaza. Leer SIEMPRE antes de cambiar: cambiar pide la versión que devuelve esta herramienta.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "cambiar_instrucciones_de_seguimientos",
    title: "Cambiar las instrucciones de los seguimientos con IA",
    description:
      "Cambia UN nivel: global (reemplaza las reglas editables; texto vacío = las de siempre), producto (añade instrucciones para " +
      "el chat de ese producto; texto vacío = se quita) o numero (para ese número de seguimiento; texto vacío = se quita). " +
      "Sin confirmado=true NO guarda: devuelve el texto actual, el nuevo y los avisos para leérselos a la persona. Con " +
      "confirmado=true y version_leida (la de ver_instrucciones_de_seguimientos) guarda, y queda activo al instante para el " +
      "siguiente seguimiento. Usar confirmado=true solo si la persona dijo que sí en esta conversación. Lo que hable de envío, " +
      "\"gratis\", contraentrega o pago no le llega a la IA (regla fija). Solo dueño o administrador.",
    inputSchema: {
      type: "object",
      properties: {
        nivel: { type: "string", enum: ["global", "producto", "numero"] },
        texto: { type: "string", description: "El texto nuevo completo de ese nivel." },
        producto: { type: "string", description: "Con nivel producto: el id o el nombre exacto del producto." },
        numero: { type: "number", description: `Con nivel numero: de 1 a ${NUMERO_MAXIMO_DE_SEGUIMIENTO}.` },
        version_leida: { type: "number", description: "La versión que devolvió ver_instrucciones_de_seguimientos." },
        confirmado: { type: "boolean", description: "true solo después de leerle el antes y el después y que diga que sí." },
        resumen: { type: "string", description: "Qué cambia, en una línea (queda en el historial)." },
      },
      required: ["nivel", "texto"],
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
  {
    name: "historial_de_instrucciones_de_seguimientos",
    title: "Historial de las instrucciones de los seguimientos",
    description: "Cada cambio de las instrucciones de los seguimientos con IA: versión, fecha, quién y resumen. La versión 0 son las reglas de siempre.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
  {
    name: "volver_instrucciones_de_seguimientos",
    title: "Volver a una versión de las instrucciones de los seguimientos",
    description:
      "Deshace en un paso: sin version vuelve a la anterior; con version, a esa (0 = las reglas de siempre). Volver también queda " +
      "en el historial como una versión nueva y es activo al instante. Solo dueño o administrador.",
    inputSchema: {
      type: "object",
      properties: { version: { type: "number" } },
      additionalProperties: false,
    },
    annotations: ESCRIBE,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_INSTRUCCIONES_DE_SEGUIMIENTO.map((herramienta) => herramienta.name));

export function esHerramientaDeInstruccionesDeSeguimiento(nombre: string) {
  return NOMBRES.has(nombre);
}

/** Quien cambia: solo el dueño o un administrador del negocio de la clave. Devuelve su nombre. */
async function quienPuedeCambiar(contexto: Contexto): Promise<string> {
  const miembro = await prisma.workspaceMember.findFirst({
    where: { workspaceId: contexto.workspaceId, userId: contexto.userId, isActive: true },
    select: { role: true, user: { select: { role: true, name: true } }, workspace: { select: { ownerId: true } } },
  });
  const puede =
    !!miembro &&
    (miembro.user?.role === "ADMIN" ||
      miembro.role === "OWNER" ||
      miembro.role === "ADMIN" ||
      miembro.workspace?.ownerId === contexto.userId);
  if (!miembro || !puede) {
    throw new Error("Solo el dueño o un administrador del negocio puede cambiar las instrucciones de los seguimientos. No se guardó nada.");
  }
  return miembro.user?.name?.trim() || "Dueño o administrador";
}

/** El producto del negocio de la clave, por id o por nombre exacto. Uno de otro negocio no existe aqui. */
async function productoDelNegocio(contexto: Contexto, valor: string, guardadas: InstruccionesGuardadas) {
  const buscado = valor.trim();
  if (!buscado) throw new Error("Falta el producto (el id o el nombre exacto).");
  const porId = await prisma.product.findFirst({
    where: { id: buscado, workspaceId: contexto.workspaceId },
    select: { id: true, name: true },
  });
  if (porId) return { productoId: porId.id, producto: porId.name };
  const porNombre = await prisma.product.findMany({
    where: { workspaceId: contexto.workspaceId, name: { equals: buscado, mode: "insensitive" } },
    select: { id: true, name: true },
    take: 2,
  });
  if (porNombre.length === 1) return { productoId: porNombre[0].id, producto: porNombre[0].name };
  if (porNombre.length > 1) throw new Error(`Hay más de un producto llamado «${buscado}»: usa el id (listar_productos).`);
  // Un añadido de un producto que ya no esta en la lista se puede quitar.
  const guardado = guardadas.porProducto.find((a) => a.productoId === buscado);
  if (guardado) return { productoId: guardado.productoId, producto: guardado.producto };
  throw new Error(`No existe el producto «${buscado}» en este negocio (listar_productos da los ids). No se guardó nada.`);
}

function comoSeVe(guardadas: InstruccionesGuardadas) {
  return {
    version: guardadas.version,
    actualizado_el: guardadas.actualizadoEl,
    actualizado_por: guardadas.actualizadoPor,
    texto_global: {
      es_el_de_siempre: guardadas.global === null,
      texto: textoGlobalVigente(guardadas),
    },
    por_producto: guardadas.porProducto.map((a) => ({ producto_id: a.productoId, producto: a.producto, texto: a.texto })),
    por_numero_de_seguimiento: guardadas.porNumero.map((a) => ({ numero: a.numero, texto: a.texto })),
  };
}

async function ver(contexto: Contexto) {
  const guardadas = await leerInstrucciones(contexto.workspaceId);
  return {
    ...comoSeVe(guardadas),
    candados: CANDADOS,
    lo_que_rechaza_el_revisor: LO_QUE_RECHAZA_EL_REVISOR,
    ojo: [
      "Los candados van siempre al final y no se cambian desde aquí. El revisor sigue siendo el último filtro: si rechaza el texto de la IA, sale un texto de respaldo o nada.",
      OJO_V3,
      "Para cambiar: cambiar_instrucciones_de_seguimientos con version_leida = la versión de arriba.",
    ],
  };
}

function aCambio(args: Argumentos, producto: { productoId: string; producto: string } | null): CambioPedido {
  const texto = typeof args.texto === "string" ? args.texto : null;
  if (args.nivel === "global") return { nivel: "global", texto: texto && texto.trim() ? texto : null };
  if (texto === null) throw new Error("Falta el texto (vacío para quitar el añadido).");
  if (args.nivel === "producto" && producto) return { nivel: "producto", ...producto, texto };
  if (args.nivel === "numero") {
    const numero = typeof args.numero === "number" ? args.numero : Number.NaN;
    return { nivel: "numero", numero, texto };
  }
  throw new Error('nivel tiene que ser "global", "producto" o "numero".');
}

function aQueAplica(cambio: CambioPedido) {
  if (cambio.nivel === "global") return "a todos los seguimientos con IA";
  if (cambio.nivel === "producto") return `a los chats del producto ${cambio.producto}`;
  return `al seguimiento número ${cambio.numero} desde que el cliente dejó de contestar`;
}

async function cambiar(args: Argumentos, contexto: Contexto) {
  const quien = await quienPuedeCambiar(contexto);
  const actual = await leerInstrucciones(contexto.workspaceId);
  const producto =
    args.nivel === "producto" ? await productoDelNegocio(contexto, typeof args.producto === "string" ? args.producto : "", actual) : null;
  const cambio = aCambio(args, producto);
  const errores = erroresDelCambio(cambio);
  if (errores.length) throw new Error(`${errores.join(" ")} No se guardó nada.`);

  const nuevas = aplicarCambio(actual, cambio);
  if (mismasInstrucciones(actual, nuevas)) {
    throw new Error("Ese texto es igual al que ya está: no hay nada que cambiar.");
  }
  const textoActual = textoActualDelNivel(actual, cambio);
  const textoNuevo = textoNuevoDelNivel(cambio);
  const vista = {
    nivel: cambio.nivel,
    aplica: aQueAplica(cambio),
    texto_actual: textoActual || "(no hay)",
    texto_nuevo: textoNuevo || "(se quita)",
    lo_que_le_llega_a_la_ia: (cambio.nivel === "global" && cambio.texto === null ? textoNuevo : textoPersonalizadoParaLaIA(textoNuevo)) || "(nada)",
    avisos: [...avisosDelCambio(cambio), OJO_V3],
  };

  const versionLeida = typeof args.version_leida === "number" ? args.version_leida : null;
  if (args.confirmado !== true) {
    return {
      guardado: false,
      version_actual: actual.version,
      ...vista,
      ...(versionLeida !== null && versionLeida !== actual.version
        ? { version_distinta: `Leíste la versión ${versionLeida} y ahora es la ${actual.version}: vuelve a leer antes de confirmar.` }
        : {}),
      para_guardar: `Léele a la persona el texto actual, el nuevo y los avisos. Si dice que sí, llama otra vez con confirmado=true y version_leida=${actual.version}.`,
    };
  }

  if (versionLeida === null) {
    throw new Error("No se guardó: falta version_leida. Lee primero con ver_instrucciones_de_seguimientos y pásala.");
  }
  const resumen =
    typeof args.resumen === "string" && args.resumen.trim()
      ? args.resumen
      : cambio.nivel === "global"
        ? "Cambio del texto global"
        : cambio.nivel === "producto"
          ? `Añadido para ${cambio.producto}`
          : `Añadido para el seguimiento ${cambio.numero}`;
  const guardadas = await guardarInstrucciones({ workspaceId: contexto.workspaceId, versionLeida, nuevas, quien, resumen });
  return {
    guardado: true,
    version: guardadas.version,
    anterior: versionLeida,
    ...vista,
    activo: "Ya está activo: el siguiente seguimiento con IA lo usa. Los ya enviados no cambian.",
    para_deshacer: "volver_instrucciones_de_seguimientos sin version vuelve a la anterior.",
  };
}

async function historial(contexto: Contexto) {
  const [actual, cambios] = await Promise.all([
    leerInstrucciones(contexto.workspaceId).catch(() => null),
    leerHistorialDeInstrucciones(contexto.workspaceId),
  ]);
  return {
    version_actual: actual?.version ?? null,
    cambios: cambios.map((c) => ({ version: c.version, anterior: c.anterior, fecha: c.fecha, quien: c.quien, resumen: c.resumen })),
    nota: "La versión 0 son las reglas de siempre. Para volver: volver_instrucciones_de_seguimientos.",
  };
}

async function volver(args: Argumentos, contexto: Contexto) {
  const quien = await quienPuedeCambiar(contexto);
  const version = args.version === undefined || args.version === null ? null : typeof args.version === "number" ? args.version : Number.NaN;
  const resultado = await volverInstrucciones({ workspaceId: contexto.workspaceId, version, quien });
  return {
    guardado: true,
    volvio_a: resultado.a,
    version_nueva: resultado.instrucciones.version,
    ...comoSeVe(resultado.instrucciones),
    activo: "Ya está activo: el siguiente seguimiento con IA lo usa.",
  };
}

export async function ejecutarHerramientaMcpInstruccionesDeSeguimiento(nombre: string, args: Argumentos, contexto: Contexto) {
  switch (nombre) {
    case "ver_instrucciones_de_seguimientos":
      return ver(contexto);
    case "cambiar_instrucciones_de_seguimientos":
      return cambiar(args, contexto);
    case "historial_de_instrucciones_de_seguimientos":
      return historial(contexto);
    case "volver_instrucciones_de_seguimientos":
      return volver(args, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
