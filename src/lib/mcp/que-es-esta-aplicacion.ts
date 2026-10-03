import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { leerLibro } from "@/features/agente-v3/servicios/almacen";
import { prisma } from "@/lib/prisma";

/**
 * "¿QUE ES ESTA APLICACION?" PARA UN ASESOR DE IA.
 *
 * Pedido de Alex (01-10-2026): que una IA conectada por el MCP entienda el sistema sin que el se lo
 * explique cada vez.
 *
 * Mezcla dos fuentes, y la respuesta dice de cual salio cada cosa:
 *  - EN VIVO, lo que se puede leer del sistema que esta corriendo: los modelos y relaciones del
 *    esquema de Prisma, las versiones de package.json, las pantallas que existen en el build, el
 *    arranque del contenedor, las lineas de WhatsApp, los agentes y el estado de cada automatizacion.
 *    Eso no se puede desactualizar.
 *  - El ARCHIVO `docs/que-es-esta-aplicacion.md`, versionado y editable, con lo que el codigo no sabe:
 *    el negocio, las decisiones, lo que falta y las advertencias. El Dockerfile lo copia a la imagen.
 *
 * Y las cruza: un modelo, una pantalla o una automatizacion que existe y no tiene linea en el archivo
 * sale en `falta_describir`; una linea de algo que ya no existe sale en `descrito_pero_no_existe`.
 * Asi el archivo no se pudre en silencio, que es lo que le paso a docs/crm-contexto.md.
 *
 * El codigo fuente (src/) NO viaja en la imagen de produccion: por eso las pantallas se leen de las
 * rutas del build (.next/server/app/cliente) y no de src/app.
 */

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_APLICACION = [
  {
    name: "que_es_esta_aplicacion",
    title: "Que es esta aplicacion",
    description:
      "Explica el sistema completo para entenderlo antes de trabajar: que hace el CRM y que problema resuelve, stack y despliegue, modulos, modelo de datos (cada entidad y sus relaciones), los agentes V1/V2/V3 y cual atiende cada linea, conceptos del negocio, lineas de WhatsApp, automatizaciones prendidas y apagadas, lo que NO existe hoy y advertencias de operacion. Lo que se puede leer del sistema se lee en vivo; el resto sale de docs/que-es-esta-aplicacion.md. Conviene llamarla al empezar una conversacion sobre el CRM.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: SOLO_LECTURA,
  },
];

const NOMBRES = new Set(HERRAMIENTAS_MCP_APLICACION.map((herramienta) => herramienta.name));

export function esHerramientaDeLaAplicacion(nombre: string) {
  return NOMBRES.has(nombre);
}

export async function ejecutarHerramientaMcpAplicacion(
  nombre: string,
  _argumentos: Argumentos,
  contexto: Contexto,
): Promise<unknown> {
  if (nombre !== "que_es_esta_aplicacion") {
    throw new Error(`No existe la herramienta "${nombre}".`);
  }
  return queEsEstaAplicacion(contexto);
}

const ARCHIVO = path.join("docs", "que-es-esta-aplicacion.md");
const FUENTE_ARCHIVO = `archivo ${ARCHIVO.replace(/\\/g, "/")} (editable)`;
const FUENTE_VIVO = "en vivo";

/** Si una fuente falla, se dice cual y por que, y el resto de la respuesta sale igual. */
async function seguro<T>(que: string, leer: () => Promise<T>): Promise<T | { no_se_pudo_leer: string }> {
  try {
    return await leer();
  } catch (error) {
    return { no_se_pudo_leer: `${que}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── El archivo editable ───────────────────────────────────────────────────────────────────────

/** El cuerpo de una seccion `## Titulo`, hasta la siguiente. */
function seccion(markdown: string, titulo: string): string {
  const lineas = markdown.split(/\r?\n/);
  const inicio = lineas.findIndex((linea) => linea.trim().toLowerCase() === `## ${titulo}`.toLowerCase());
  if (inicio < 0) {
    return "";
  }
  const resto = lineas.slice(inicio + 1);
  const fin = resto.findIndex((linea) => linea.startsWith("## "));
  return (fin < 0 ? resto : resto.slice(0, fin)).join("\n").trim();
}

/** Las lineas `- \`clave\`: descripcion` de una seccion. */
function listaConClave(cuerpo: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const linea of cuerpo.split(/\r?\n/)) {
    const encontrado = /^\s*-\s*`([^`]+)`\s*:\s*(.+)$/.exec(linea);
    if (encontrado) {
      mapa.set(encontrado[1].trim(), encontrado[2].trim());
    }
  }
  return mapa;
}

/** Cruza lo que existe con lo que esta descrito. */
function cruzar(existentes: string[], descritos: Map<string, string>) {
  const existe = new Set(existentes);
  return {
    falta_describir: existentes.filter((clave) => !descritos.has(clave)),
    descrito_pero_no_existe: [...descritos.keys()].filter((clave) => !existe.has(clave)),
  };
}

// ── El esquema de Prisma ──────────────────────────────────────────────────────────────────────

type ModeloDelEsquema = {
  nombre: string;
  comentario: string | null;
  campos: Array<{ nombre: string; tipo: string; lista: boolean }>;
};

function leerModelosYEnums(esquema: string) {
  const lineas = esquema.split(/\r?\n/);
  const modelos: ModeloDelEsquema[] = [];
  const enums: Record<string, string[]> = {};

  for (let i = 0; i < lineas.length; i += 1) {
    const modelo = /^model\s+(\w+)\s*\{/.exec(lineas[i]);
    const enumeracion = /^enum\s+(\w+)\s*\{/.exec(lineas[i]);
    if (!modelo && !enumeracion) {
      continue;
    }

    // Los comentarios `///` de arriba del bloque: su primera oracion sirve de descripcion de respaldo.
    const comentarios: string[] = [];
    for (let j = i - 1; j >= 0 && lineas[j].trim().startsWith("///"); j -= 1) {
      comentarios.unshift(lineas[j].trim().replace(/^\/\/\/\s?/, ""));
    }

    const cuerpo: string[] = [];
    for (let k = i + 1; k < lineas.length && !lineas[k].startsWith("}"); k += 1) {
      const limpia = lineas[k].trim();
      if (limpia && !limpia.startsWith("//") && !limpia.startsWith("@@")) {
        cuerpo.push(limpia);
      }
    }

    if (enumeracion) {
      enums[enumeracion[1]] = cuerpo.map((linea) => linea.split(/\s+/)[0]);
      continue;
    }

    const texto = comentarios.join(" ").trim();
    modelos.push({
      nombre: modelo![1],
      comentario: texto ? texto.split(/(?<=\.)\s/)[0] : null,
      campos: cuerpo.map((linea) => {
        const [nombre, tipoCrudo = ""] = linea.split(/\s+/);
        return { nombre, tipo: tipoCrudo.replace(/[?[\]]/g, ""), lista: tipoCrudo.endsWith("[]") };
      }),
    });
  }

  return { modelos, enums };
}

async function modeloDeDatos(entidadesDescritas: Map<string, string>) {
  const esquema = await readFile(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const { modelos, enums } = leerModelosYEnums(esquema);
  const nombres = new Set(modelos.map((modelo) => modelo.nombre));

  return {
    fuente: `${FUENTE_VIVO} (prisma/schema.prisma) + descripciones del ${FUENTE_ARCHIVO}`,
    total_de_entidades: modelos.length,
    entidades: modelos.map((modelo) => {
      const relaciones = modelo.campos
        .filter((campo) => nombres.has(campo.tipo))
        .map((campo) => `${campo.nombre} -> ${campo.tipo} (${campo.lista ? "varios" : "uno"})`);
      return {
        nombre: modelo.nombre,
        que_es:
          entidadesDescritas.get(modelo.nombre) ??
          (modelo.comentario ? `${modelo.comentario} (del comentario del esquema)` : "(sin descripcion)"),
        // Workspace cuelga de casi todo: sin tope, una sola entidad ocuparia media respuesta.
        se_relaciona_con: relaciones.length > 12 ? [...relaciones.slice(0, 12), `y ${relaciones.length - 12} mas`] : relaciones,
      };
    }),
    enums,
    ...cruzar(
      modelos.map((modelo) => modelo.nombre),
      entidadesDescritas,
    ),
  };
}

// ── Lo que corre ──────────────────────────────────────────────────────────────────────────────

async function versiones() {
  const paquete = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const todas = { ...paquete.devDependencies, ...paquete.dependencies };
  const de = (nombre: string) => todas[nombre] ?? null;
  return {
    next: de("next"),
    react: de("react"),
    typescript: de("typescript"),
    tailwindcss: de("tailwindcss"),
    prisma: de("prisma"),
    prisma_client: de("@prisma/client"),
    next_auth: de("next-auth"),
    base_ui: de("@base-ui/react"),
    node_del_servidor: process.version,
  };
}

/** Las pantallas que existen: las rutas del build en produccion, src/app en desarrollo. */
async function pantallas(): Promise<string[]> {
  const candidatas = [
    path.join(process.cwd(), ".next", "server", "app", "cliente"),
    path.join(process.cwd(), "src", "app", "cliente"),
  ];
  for (const carpeta of candidatas) {
    try {
      const entradas = await readdir(carpeta, { withFileTypes: true });
      const dirs = entradas
        .filter((entrada) => entrada.isDirectory() && !entrada.name.startsWith("_") && !entrada.name.startsWith("("))
        .map((entrada) => entrada.name);
      // Una carpeta sin ninguna pagina adentro no es una pantalla (paso con una vacia).
      const conPagina: string[] = [];
      for (const dir of dirs) {
        const adentro = await readdir(path.join(carpeta, dir), { recursive: true }).catch(() => [] as string[]);
        if (adentro.some((archivo) => /(^|[\\/])page\.(js|tsx|ts)$/.test(String(archivo)))) {
          conPagina.push(dir);
        }
      }
      if (conPagina.length > 0) {
        return conPagina.sort();
      }
    } catch {
      // Se prueba la siguiente.
    }
  }
  throw new Error("no se encontraron las rutas del build ni src/app");
}

/** Lo que el arranque del contenedor hace de verdad, leido del script. */
async function arranqueDelContenedor() {
  const script = await readFile(path.join(process.cwd(), "docker", "entrypoint.sh"), "utf8");
  const conSetEu = /^\s*set\s+-[a-z]*e[a-z]*u|^\s*set\s+-[a-z]*u[a-z]*e/m.test(script);
  const posMigracion = script.indexOf("prisma migrate deploy");
  const posArranque = script.search(/npm (run )?start/);
  const migraAntes = posMigracion >= 0 && posArranque >= 0 && posMigracion < posArranque;
  return {
    archivo: "docker/entrypoint.sh",
    corre_migraciones_al_arrancar: posMigracion >= 0,
    migra_antes_de_arrancar_el_servidor: migraAntes,
    corta_ante_cualquier_error_set_eu: conSetEu,
    conclusion:
      conSetEu && migraAntes
        ? "Una migracion que falla impide que el servidor arranque: la app queda caida hasta corregirla."
        : "El arranque no coincide con lo esperado: revisar docker/entrypoint.sh.",
  };
}

type MetadataDeLinea = {
  gateway?: { kind?: unknown };
  agenteV3?: unknown;
  collaboratorIds?: unknown;
  monitorIds?: unknown;
  pausedAssignmentIds?: unknown;
};

function cuantos(valor: unknown) {
  return Array.isArray(valor) ? valor.length : 0;
}

async function lineasYAgentes(workspaceId: string) {
  const [canales, agentes, libro] = await Promise.all([
    prisma.whatsAppChannel.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: {
        name: true,
        purpose: true,
        provider: true,
        status: true,
        metadata: true,
        agent: { select: { name: true, agentType: true, status: true, isActive: true } },
      },
    }),
    prisma.agent.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { name: true, agentType: true, status: true, isActive: true, graph: true },
    }),
    leerLibro(workspaceId),
  ]);

  const lineas = canales.map((canal) => {
    const metadata = (canal.metadata && typeof canal.metadata === "object" ? canal.metadata : {}) as MetadataDeLinea;
    const gateway = typeof metadata.gateway?.kind === "string" ? metadata.gateway.kind : canal.provider;
    const atiende =
      metadata.agenteV3 === true
        ? "Agente V3 (libro de reglas)"
        : canal.agent
          ? `${canal.agent.name} (${canal.agent.agentType}, ${canal.agent.status}${canal.agent.isActive ? "" : ", inactivo"})`
          : "sin agente: la atienden solo personas";
    return {
      linea: canal.name,
      tipo: canal.purpose === "ADMIN" ? "administrativa (no alimenta el CRM)" : "de ventas",
      gateway,
      estado_de_conexion: canal.status,
      atiende,
      colaboradoras: cuantos(metadata.collaboratorIds) || "abierta a todo el equipo",
      fuera_del_reparto: cuantos(metadata.pausedAssignmentIds),
      monitoras: cuantos(metadata.monitorIds),
    };
  });

  const reglas = libro.reglas ?? [];
  const porDisparador: Record<string, number> = {};
  for (const regla of reglas.filter((regla) => regla.activa)) {
    porDisparador[regla.cuando.tipo] = (porDisparador[regla.cuando.tipo] ?? 0) + 1;
  }

  return {
    lineas,
    agentes_v1_v2: agentes.map((agente) => ({
      nombre: agente.name,
      tipo: agente.agentType,
      estado: agente.status,
      activo: agente.isActive,
      tiene_diagrama: agente.graph !== null,
    })),
    libro_v3: {
      version: libro.version ?? null,
      reglas: reglas.length,
      activas: reglas.filter((regla) => regla.activa).length,
      activas_por_disparador: porDisparador,
    },
    reglas_sin_respuesta_activas: reglas.filter((regla) => regla.activa && regla.cuando.tipo === "sin_respuesta").length,
    hay_lineas_con_v3: lineas.some((linea) => linea.atiende.startsWith("Agente V3")),
  };
}

async function bandera(clave: string) {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave }, select: { value: true } });
  return fila?.value ?? null;
}

async function automatizaciones(
  workspaceId: string,
  descritas: Map<string, string>,
  v3: { reglasSinRespuesta: number; hayLineasConV3: boolean },
) {
  const [reglasProgramadas, campanasEnCurso, ultimoInforme, rescate, descarte, transcripcionApagada] =
    await Promise.all([
      prisma.followRule.count({ where: { workspaceId, isActive: true } }),
      prisma.campaign.count({ where: { workspaceId, status: "RUNNING" } }),
      prisma.dailyReport.findFirst({
        where: { workspaceId },
        orderBy: { reportDate: "desc" },
        select: { reportDate: true },
      }),
      bandera(`agente-v3:rescate:${workspaceId}`),
      bandera(`crm:descarte-automatico:${workspaceId}`),
      bandera("transcripcion-de-audios:apagada"),
    ]);

  const sinInterruptor = "activa (no tiene interruptor: corre siempre)";
  const estados: Record<string, string> = {
    seguimientos_programados: reglasProgramadas > 0 ? `activa: ${reglasProgramadas} reglas prendidas` : "sin reglas prendidas",
    seguimientos_v3:
      v3.hayLineasConV3 && v3.reglasSinRespuesta > 0
        ? `activa: ${v3.reglasSinRespuesta} reglas "sin respuesta" prendidas`
        : v3.hayLineasConV3
          ? "apagada: no hay reglas \"sin respuesta\" prendidas en el libro"
          : "no aplica: ninguna linea usa el Agente V3",
    aviso_cliente_esperando: v3.hayLineasConV3 ? sinInterruptor : "no aplica: ninguna linea usa el Agente V3",
    rescate_de_mensajes_v3: rescate === "off" ? "apagada (agente-v3:rescate = off)" : "activa",
    rescate_de_chats_huerfanos: sinInterruptor,
    // Corre en cada mensaje de la clienta (webhook), no en el reloj. Se gobierna desde Equipo
    // (pausa de reparto y horario por vendedora), no con una bandera.
    reparto_por_turno: sinInterruptor,
    enfriamiento_por_llamadas: sinInterruptor,
    temperatura: sinInterruptor,
    descarte_automatico: descarte === "on" ? "ACTIVA: mueve leads a Descartado" : "apagada",
    campanas: campanasEnCurso > 0 ? `activa: ${campanasEnCurso} en curso` : "sin campañas en curso",
    transcripcion_de_audios: !process.env.OPENAI_API_KEY?.trim()
      ? "apagada: falta la clave de OpenAI"
      : transcripcionApagada === "si"
        ? "apagada (transcripcion-de-audios:apagada = si)"
        : "activa",
    purga_de_webhooks: sinInterruptor,
    informe_diario: ultimoInforme
      ? `activa: ultimo informe del ${ultimoInforme.reportDate.toISOString().slice(0, 10)}`
      : "sin informes generados",
  };

  return {
    fuente: `${FUENTE_VIVO} (banderas y tablas) + que hace cada una del ${FUENTE_ARCHIVO}`,
    corren_en: "el reloj del servidor (/api/cron/follows, cada minuto), salvo el informe diario, que tiene su propio reloj",
    lista: Object.entries(estados).map(([clave, estado]) => ({
      clave,
      estado,
      que_hace: descritas.get(clave) ?? "(sin descripcion en el archivo)",
    })),
    ...cruzar(Object.keys(estados), descritas),
  };
}

// ── La respuesta ──────────────────────────────────────────────────────────────────────────────

async function queEsEstaAplicacion(contexto: Contexto) {
  const archivo = await readFile(path.join(process.cwd(), ARCHIVO), "utf8").catch(() => "");
  const sin = (texto: string) => texto || `(no esta en el ${FUENTE_ARCHIVO})`;

  const modulosDescritos = listaConClave(seccion(archivo, "Módulos"));
  const entidadesDescritas = listaConClave(seccion(archivo, "Entidades"));
  const automatizacionesDescritas = listaConClave(seccion(archivo, "Automatizaciones"));

  const enVivo = await seguro("lineas y agentes", () => lineasYAgentes(contexto.workspaceId));
  const datosV3 =
    "lineas" in enVivo
      ? { reglasSinRespuesta: enVivo.reglas_sin_respuesta_activas, hayLineasConV3: enVivo.hay_lineas_con_v3 }
      : { reglasSinRespuesta: 0, hayLineasConV3: false };

  const [stack, modulos, datos, autos, arranque] = await Promise.all([
    seguro("versiones de package.json", versiones),
    seguro("pantallas del build", async () => {
      const existentes = await pantallas();
      return {
        fuente: `${FUENTE_VIVO} (rutas /cliente del build) + descripciones del ${FUENTE_ARCHIVO}`,
        lista: existentes.map((clave) => ({
          clave,
          ruta: `/cliente/${clave}`,
          que_hace: modulosDescritos.get(clave) ?? "(sin descripcion en el archivo)",
        })),
        ...cruzar(existentes, modulosDescritos),
      };
    }),
    seguro("esquema de Prisma", () => modeloDeDatos(entidadesDescritas)),
    seguro("automatizaciones", () => automatizaciones(contexto.workspaceId, automatizacionesDescritas, datosV3)),
    seguro("arranque del contenedor", arranqueDelContenedor),
  ]);

  return {
    como_leer_esto: `Cada seccion dice su fuente: "${FUENTE_VIVO}" es el sistema que esta corriendo y no puede estar desactualizado; el ${FUENTE_ARCHIVO} lo escribe y corrige Alex. Si hay contradiccion, manda lo que esta en vivo.`,
    ...(archivo ? {} : { aviso: `No se pudo leer el ${FUENTE_ARCHIVO}: solo sale la parte en vivo.` }),
    que_es_y_que_resuelve: { fuente: FUENTE_ARCHIVO, texto: sin(seccion(archivo, "Qué es y qué resuelve")) },
    stack_y_despliegue: {
      versiones: { fuente: `${FUENTE_VIVO} (package.json)`, ...stack },
      descripcion: { fuente: FUENTE_ARCHIVO, texto: sin(seccion(archivo, "Stack y despliegue")) },
    },
    modulos,
    modelo_de_datos: datos,
    agentes: {
      explicacion: { fuente: FUENTE_ARCHIVO, texto: sin(seccion(archivo, "Agentes")) },
      en_este_negocio:
        "lineas" in enVivo
          ? {
              fuente: FUENTE_VIVO,
              quien_atiende_cada_linea: enVivo.lineas.map((linea) => ({ linea: linea.linea, atiende: linea.atiende })),
              agentes_v1_v2: enVivo.agentes_v1_v2,
              libro_v3: enVivo.libro_v3,
            }
          : enVivo,
    },
    conceptos_del_negocio: { fuente: FUENTE_ARCHIVO, texto: sin(seccion(archivo, "Conceptos del negocio")) },
    lineas_de_whatsapp: "lineas" in enVivo ? { fuente: FUENTE_VIVO, lista: enVivo.lineas } : enVivo,
    automatizaciones: autos,
    que_no_existe_hoy: { fuente: FUENTE_ARCHIVO, texto: sin(seccion(archivo, "Qué no existe hoy")) },
    advertencias_de_operacion: {
      arranque_del_contenedor: { fuente: `${FUENTE_VIVO} (docker/entrypoint.sh)`, ...arranque },
      del_archivo: { fuente: FUENTE_ARCHIVO, texto: sin(seccion(archivo, "Advertencias de operación")) },
    },
  };
}
