import type { Prisma } from "@prisma/client";

import { asesorasDelReparto, pausadosNuevos } from "@/lib/asignacion-pantalla";
import { leerColaboradores, leerPausadosDeReparto } from "@/lib/channel-collaborators";
import {
  agregarAlHistorial,
  claveConfigDemora,
  claveHistorialDemora,
  estadoDelBotonDeTexto,
  leerHistorialDemoraDeTexto,
  textoDeConfigNueva,
  validarPedidoDeDemora,
  type EstadoDelBoton,
} from "@/lib/demora-de-asesora-ajuste";
import { prisma } from "@/lib/prisma";
import {
  CONFIG_DE_ASIGNACION_POR_DEFECTO,
  claveConfigDeAsignacion,
  guardarConfigDeAsignacion,
  leerConfigDeAsignacionDeTexto,
  type ConfigDeAsignacion,
} from "@/lib/reparto-cuando-lo-necesita";

/*
  LA ASIGNACIÓN DE CHATS DE UN NEGOCIO, LEER Y GUARDAR (T-772, partes 3 y 4). Una sola lógica para la
  pantalla Mi empresa > Equipo > Asignación (src/app/actions/asignacion-actions.ts) y para las
  herramientas del MCP ver_asignacion y cambiar_asignacion (src/lib/mcp/asignacion.ts), con su vuelta
  atrás (deshacer_cambio, src/lib/mcp/cambios.ts).

  Tres cosas: los interruptores (AppSetting `reparto:cuando:<negocio>`), quién está en el reparto de
  cada línea de ventas (`pausedAssignmentIds` de la línea) y los minutos de la regla de demora (la
  misma fila que lee la regla, con su historial). Prendida o apagada de la regla de demora NO se toca
  aquí: eso sigue en Equipo. El permiso lo pide quien llama (la acción o la herramienta).

  Todo se lee directo de la base (sin la memoria de un minuto de leerConfigDeAsignacion) para mostrar y
  comparar lo último guardado. El reparto que corre en el webhook sí usa esa memoria: un cambio tarda
  hasta 1 minuto en aplicar.
*/

export type AsesoraDeLaLinea = { id: string; nombre: string; enElReparto: boolean };

export type LineaDeVentas = {
  id: string;
  nombre: string;
  /** Sin colaboradoras: la ve todo el equipo y su reparto se arma en Conexión. */
  abierta: boolean;
  asesoras: AsesoraDeLaLinea[];
};

export type DatosDeAsignacion = {
  interruptores: ConfigDeAsignacion;
  lineas: LineaDeVentas[];
  minutosAviso: number;
  minutosReasignar: number;
  /** Solo para mostrarlo: aquí no se prende ni se apaga. */
  demoraPrendida: boolean;
};

/** Lo que se pide cambiar. Lo que no venga queda como está. */
export type PedidoDeCambioDeAsignacion = {
  interruptores?: Partial<ConfigDeAsignacion>;
  /** Por línea, las asesoras que quedan FUERA del reparto (las demás de la línea quedan dentro). */
  lineas?: Array<{ id: string; fuera: readonly unknown[] }>;
  minutosAviso?: unknown;
  minutosReasignar?: unknown;
};

/** La foto de lo que se cambia, para mostrar el antes y el después y para deshacer. */
export type FotoDeAsignacion = {
  interruptores: ConfigDeAsignacion;
  /** Solo las líneas tocadas, con su `pausedAssignmentIds` completo. */
  lineas: Array<{ id: string; nombre: string; pausados: string[] }>;
  minutosAviso: number;
  minutosReasignar: number;
};

export type CambioDeAsignacion = {
  antes: FotoDeAsignacion;
  despues: FotoDeAsignacion;
  cambiaAlgo: boolean;
  /** Para escribirlo: la metadata nueva de cada línea tocada y los minutos. */
  canales: Array<{ id: string; metadata: Record<string, unknown> }>;
  demoraAntes: EstadoDelBoton;
  demoraDespues: EstadoDelBoton;
};

type Quien = { id: string; nombre: string };

type Canal = { id: string; name: string; metadata: unknown };

const lineasDeVentas = (workspaceId: string): Promise<Canal[]> =>
  prisma.whatsAppChannel.findMany({
    where: { workspaceId, NOT: { purpose: "ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, metadata: true },
  });

const miembrosActivos = (workspaceId: string) =>
  prisma.workspaceMember.findMany({
    where: { workspaceId, isActive: true },
    select: { userId: true, user: { select: { name: true, email: true } } },
  });

const comoObjeto = (metadata: unknown): Record<string, unknown> =>
  metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};

const mismaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

const mismosInterruptores = (a: ConfigDeAsignacion, b: ConfigDeAsignacion) =>
  (Object.keys(CONFIG_DE_ASIGNACION_POR_DEFECTO) as Array<keyof ConfigDeAsignacion>).every((clave) => a[clave] === b[clave]);

async function leerTodo(workspaceId: string) {
  const [filaConfig, filaDemora, canales, miembros] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: claveConfigDeAsignacion(workspaceId) }, select: { value: true } }),
    prisma.appSetting.findUnique({ where: { key: claveConfigDemora(workspaceId) }, select: { value: true } }),
    lineasDeVentas(workspaceId),
    miembrosActivos(workspaceId),
  ]);
  const nombres = new Map(
    miembros.map((miembro) => [miembro.userId, miembro.user.name?.trim() || miembro.user.email || "Sin nombre"]),
  );
  return {
    interruptores: leerConfigDeAsignacionDeTexto(filaConfig?.value),
    demora: estadoDelBotonDeTexto(filaDemora?.value),
    filaDemora: filaDemora?.value ?? null,
    canales,
    nombres,
    activos: new Set(nombres.keys()),
  };
}

/** Lo que muestran la pantalla y ver_asignacion. */
export async function leerAsignacionDelNegocio(workspaceId: string): Promise<DatosDeAsignacion> {
  const todo = await leerTodo(workspaceId);
  return {
    interruptores: todo.interruptores,
    lineas: todo.canales.map((canal) => {
      const pausados = new Set(leerPausadosDeReparto(canal.metadata));
      const asesoras = asesorasDelReparto(canal.metadata, todo.activos);
      return {
        id: canal.id,
        nombre: canal.name,
        abierta: asesoras.length === 0,
        asesoras: asesoras.map((id) => ({
          id,
          nombre: todo.nombres.get(id) ?? "Sin nombre",
          enElReparto: !pausados.has(id),
        })),
      };
    }),
    minutosAviso: todo.demora.minutosAviso,
    minutosReasignar: todo.demora.minutosReasignar,
    demoraPrendida: todo.demora.activo,
  };
}

/**
 * Calcula el cambio sin escribir nada. Primero se valida todo: si algo no sirve, error y nada se guarda.
 * Con `estricto` (el MCP), una línea que no es de ventas de este negocio, una línea abierta o una
 * asesora que no es de la línea es un error; sin él (la pantalla), se ignoran como siempre.
 */
export async function calcularCambioDeAsignacion(
  workspaceId: string,
  pedido: PedidoDeCambioDeAsignacion,
  opciones: { estricto?: boolean } = {},
): Promise<{ ok: true; cambio: CambioDeAsignacion } | { error: string }> {
  const todo = await leerTodo(workspaceId);

  const interruptores: ConfigDeAsignacion = { ...todo.interruptores };
  for (const [clave, valor] of Object.entries(pedido.interruptores ?? {})) {
    if (!(clave in CONFIG_DE_ASIGNACION_POR_DEFECTO) || typeof valor !== "boolean") {
      return { error: `El interruptor «${clave}» no existe o no es true/false.` };
    }
    interruptores[clave as keyof ConfigDeAsignacion] = valor;
  }

  // Los minutos: lo que no venga queda como está. Prendida o apagada, igual.
  const demora = validarPedidoDeDemora({
    activo: todo.demora.activo,
    minutosAviso: pedido.minutosAviso ?? todo.demora.minutosAviso,
    minutosReasignar: pedido.minutosReasignar ?? todo.demora.minutosReasignar,
  });
  if ("error" in demora) {
    return { error: demora.error };
  }

  const pedidas = new Map<string, readonly unknown[]>();
  for (const linea of Array.isArray(pedido.lineas) ? pedido.lineas : []) {
    if (!linea || typeof linea.id !== "string") {
      if (opciones.estricto) return { error: "Cada línea necesita su id." };
      continue;
    }
    if (!Array.isArray(linea.fuera)) {
      if (opciones.estricto) return { error: `La línea ${linea.id}: «fuera» tiene que ser una lista de ids de asesoras.` };
      pedidas.set(linea.id, []);
      continue;
    }
    pedidas.set(linea.id, linea.fuera);
  }

  if (opciones.estricto) {
    const porId = new Map(todo.canales.map((canal) => [canal.id, canal]));
    for (const [id, fuera] of pedidas) {
      const canal = porId.get(id);
      if (!canal) return { error: `La línea ${id} no es una línea de ventas de este negocio (ver_asignacion da los ids).` };
      const asesoras = asesorasDelReparto(canal.metadata, todo.activos);
      if (asesoras.length === 0) {
        return { error: `La línea «${canal.name}» no tiene colaboradoras (la ve todo el equipo): su reparto se arma en Conexión.` };
      }
      const raras = fuera.filter((asesora) => typeof asesora !== "string" || !asesoras.includes(asesora));
      if (raras.length) {
        return { error: `En la línea «${canal.name}» no son asesoras del reparto: ${raras.map(String).join(", ")} (ver_asignacion da los ids).` };
      }
    }
  }

  const lineasAntes: FotoDeAsignacion["lineas"] = [];
  const lineasDespues: FotoDeAsignacion["lineas"] = [];
  const canales: CambioDeAsignacion["canales"] = [];
  for (const canal of todo.canales) {
    const fuera = pedidas.get(canal.id);
    if (!fuera) continue;
    const pausados = pausadosNuevos(canal.metadata, todo.activos, fuera);
    if (!pausados) continue;
    lineasAntes.push({ id: canal.id, nombre: canal.name, pausados: leerPausadosDeReparto(canal.metadata) });
    lineasDespues.push({ id: canal.id, nombre: canal.name, pausados });
    // Solo cambia la pausa: las colaboradoras (quién trabaja la línea) y las monitoras quedan igual.
    canales.push({ id: canal.id, metadata: { ...comoObjeto(canal.metadata), pausedAssignmentIds: pausados } });
  }

  const antes: FotoDeAsignacion = {
    interruptores: todo.interruptores,
    lineas: lineasAntes,
    minutosAviso: todo.demora.minutosAviso,
    minutosReasignar: todo.demora.minutosReasignar,
  };
  const despues: FotoDeAsignacion = {
    interruptores,
    lineas: lineasDespues,
    minutosAviso: demora.estado.minutosAviso,
    minutosReasignar: demora.estado.minutosReasignar,
  };
  const cambiaAlgo =
    !mismosInterruptores(antes.interruptores, despues.interruptores) ||
    canales.length > 0 ||
    antes.minutosAviso !== despues.minutosAviso ||
    antes.minutosReasignar !== despues.minutosReasignar;

  return {
    ok: true,
    cambio: { antes, despues, cambiaAlgo, canales, demoraAntes: todo.demora, demoraDespues: demora.estado },
  };
}

/** Los minutos, con su historial (primero el historial, como en Equipo). Solo si cambian. */
async function escribirMinutos(workspaceId: string, antes: EstadoDelBoton, despues: EstadoDelBoton, quien: Quien) {
  if (antes.minutosAviso === despues.minutosAviso && antes.minutosReasignar === despues.minutosReasignar) return;
  const claveDemora = claveConfigDemora(workspaceId);
  const claveHistorial = claveHistorialDemora(workspaceId);
  const [filaDemora, filaHistorial] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: claveDemora }, select: { value: true } }),
    prisma.appSetting.findUnique({ where: { key: claveHistorial }, select: { value: true } }),
  ]);
  const historial = agregarAlHistorial(leerHistorialDemoraDeTexto(filaHistorial?.value), {
    en: new Date().toISOString(),
    quienId: quien.id,
    quienNombre: quien.nombre,
    antes,
    despues,
  });
  const configNueva = textoDeConfigNueva(filaDemora?.value, despues);
  await prisma.appSetting.upsert({
    where: { key: claveHistorial },
    create: { key: claveHistorial, value: JSON.stringify(historial) },
    update: { value: JSON.stringify(historial) },
  });
  await prisma.appSetting.upsert({
    where: { key: claveDemora },
    create: { key: claveDemora, value: configNueva },
    update: { value: configNueva },
  });
}

/** Escribe un cambio ya calculado (y validado) con calcularCambioDeAsignacion. */
export async function escribirCambioDeAsignacion(workspaceId: string, cambio: CambioDeAsignacion, quien: Quien) {
  await guardarConfigDeAsignacion(workspaceId, cambio.despues.interruptores);
  for (const canal of cambio.canales) {
    await prisma.whatsAppChannel.update({
      where: { id: canal.id },
      data: { metadata: canal.metadata as Prisma.InputJsonValue },
    });
  }
  await escribirMinutos(workspaceId, cambio.demoraAntes, cambio.demoraDespues, quien);
}

/** ¿El valor guardado en el historial del MCP es una foto que sirve para deshacer? */
export function leerFotoDeAsignacion(valor: unknown): FotoDeAsignacion | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const foto = valor as Record<string, unknown>;
  const interruptores = foto.interruptores as Record<string, unknown> | null;
  if (!interruptores || typeof interruptores !== "object") return null;
  if (!Object.keys(CONFIG_DE_ASIGNACION_POR_DEFECTO).every((clave) => typeof interruptores[clave] === "boolean")) return null;
  if (!Array.isArray(foto.lineas)) return null;
  const lineas: FotoDeAsignacion["lineas"] = [];
  for (const linea of foto.lineas as unknown[]) {
    const l = linea as Record<string, unknown> | null;
    if (!l || typeof l.id !== "string" || typeof l.nombre !== "string" || !Array.isArray(l.pausados)) return null;
    if (!l.pausados.every((id) => typeof id === "string")) return null;
    lineas.push({ id: l.id, nombre: l.nombre, pausados: l.pausados as string[] });
  }
  const enRango = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 120;
  if (!enRango(foto.minutosAviso) || !enRango(foto.minutosReasignar)) return null;
  return {
    interruptores: interruptores as unknown as ConfigDeAsignacion,
    lineas,
    minutosAviso: foto.minutosAviso,
    minutosReasignar: foto.minutosReasignar,
  };
}

/**
 * Deshacer: deja los interruptores, el reparto de las líneas de la foto y los minutos como en `antes`.
 * Si desde el cambio alguien tocó lo mismo (por ejemplo desde la pantalla), no pisa nada y avisa.
 */
export async function restaurarFotoDeAsignacion(
  workspaceId: string,
  antes: FotoDeAsignacion,
  despues: FotoDeAsignacion,
  quien: Quien,
) {
  const todo = await leerTodo(workspaceId);
  const porId = new Map(todo.canales.map((canal) => [canal.id, canal]));

  const distinto: string[] = [];
  if (!mismosInterruptores(todo.interruptores, despues.interruptores)) distinto.push("los interruptores");
  if (todo.demora.minutosAviso !== despues.minutosAviso || todo.demora.minutosReasignar !== despues.minutosReasignar) {
    distinto.push("los minutos");
  }
  for (const linea of despues.lineas) {
    const canal = porId.get(linea.id);
    if (!canal) throw new Error(`La línea «${linea.nombre}» ya no es una línea de ventas de este negocio: no se tocó nada.`);
    if (!mismaLista(leerPausadosDeReparto(canal.metadata), linea.pausados)) distinto.push(`el reparto de «${linea.nombre}»`);
  }
  if (distinto.length) {
    throw new Error(
      `Después de ese cambio alguien tocó ${distinto.join(", ")} (por ejemplo desde Equipo > Asignación). ` +
        "No se tocó nada: revisa con ver_asignacion y cambia con cambiar_asignacion.",
    );
  }

  await guardarConfigDeAsignacion(workspaceId, antes.interruptores);
  for (const linea of antes.lineas) {
    const canal = porId.get(linea.id);
    if (!canal) continue;
    // Solo las que siguen siendo colaboradoras de la línea (la pausa es un subconjunto de ellas).
    const colaboradoras = leerColaboradores(canal.metadata);
    const pausados = linea.pausados.filter((id) => colaboradoras.includes(id));
    await prisma.whatsAppChannel.update({
      where: { id: canal.id },
      data: { metadata: { ...comoObjeto(canal.metadata), pausedAssignmentIds: pausados } as Prisma.InputJsonValue },
    });
  }
  await escribirMinutos(
    workspaceId,
    todo.demora,
    { activo: todo.demora.activo, minutosAviso: antes.minutosAviso, minutosReasignar: antes.minutosReasignar },
    quien,
  );
}
