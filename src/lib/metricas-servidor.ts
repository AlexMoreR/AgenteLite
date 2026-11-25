// Monitoreo del servidor (parte 1): reglas PURAS de grupos, colores y alerta de CPU.
// No toca la base ni manda nada: la ruta que recibe las fotos y la pantalla vienen en las partes 2 y 3.
// Cada "foto" (muestra) la manda un script del VPS y se guarda en la tabla MetricaServidor.

export type GrupoContenedor = "CRM" | "Marketplace" | "Base" | "WAHA" | "Otros";
export type ColorEstado = "verde" | "amarillo" | "rojo";

export const GRUPOS_CONTENEDOR: readonly GrupoContenedor[] = ["CRM", "Marketplace", "Base", "WAHA", "Otros"];

export type ContenedorMuestra = {
  nombre: string;
  grupo: GrupoContenedor;
  /** CPU del contenedor en % (puede pasar de 100 si usa más de un núcleo). */
  cpu: number;
  memMb: number;
  /** Límite de memoria del contenedor; null si no tiene. */
  memLimiteMb: number | null;
};

export type MuestraServidor = {
  cpuTotal: number;
  load1: number;
  nucleos: number | null;
  memUsadaMb: number;
  memTotalMb: number;
  swapUsadoMb: number;
  discoUsadoGb: number;
  discoTotalGb: number;
  contenedores: ContenedorMuestra[];
};

/** Estado de la alerta de CPU (en la parte 2 se guarda en AppSetting). `ultimoEnvio` en ISO. */
export type EstadoAlertaCpu = { activa: boolean; ultimoEnvio: string | null };

/** CPU por encima de este % cuenta como alta ("pasa de 85 %": 85 exacto no cuenta). */
export const UMBRAL_CPU_ALERTA = 85;
/** Cuántas fotos seguidas tienen que estar altas para avisar. */
export const MUESTRAS_PARA_ALERTA = 5;
/**
 * CPU del contenedor de la base (grupo "Base") por encima de este % cuenta como saturada ("pasa de 200 %": 200
 * exacto no cuenta). Es CPU de Docker: 200 % son dos núcleos llenos.
 */
export const UMBRAL_CPU_BASE_ALERTA = 200;
/** Cuántas fotos seguidas tiene que estar saturada la base para avisar. */
export const MUESTRAS_PARA_ALERTA_BASE = 3;
/** Título del aviso de la base. */
export const TITULO_AVISO_BASE = "Base de datos saturada";
/** Minutos de espera antes de repetir el aviso mientras siga alta. */
export const MINUTOS_ENTRE_ALERTAS = 60;
/** Tope de contenedores por foto, para que un cuerpo roto no llene la tabla. */
export const MAXIMO_CONTENEDORES = 200;
const LARGO_MAXIMO_NOMBRE = 200;
/** Mayor valor que cabe en una columna Int de Postgres (los MB se guardan así). */
const MAXIMO_INT = 2_147_483_647;

// mf7 a mf12 en cualquier parte del nombre, con el número exacto: "mf1" o "mf13" no cuentan.
const MARKETPLACE = /mf(?:[7-9]|1[0-2])(?!\d)/;

/** A qué grupo pertenece un contenedor de Docker según su nombre. */
export function grupoDelContenedor(nombre: string): GrupoContenedor {
  const n = String(nombre ?? "").trim().toLowerCase();
  if (n.startsWith("crm-aizenbot_app") || /realtime|files|crons/.test(n)) return "CRM";
  if (MARKETPLACE.test(n)) return "Marketplace";
  if (n.startsWith("crm-postgres")) return "Base";
  if (n.startsWith("crm-waha") || /^waha2(?!\d)/.test(n)) return "WAHA";
  return "Otros";
}

function colorPorLimites(porcentaje: number, amarilloDesde: number, rojoDesde: number): ColorEstado {
  if (porcentaje > rojoDesde) return "rojo";
  if (porcentaje >= amarilloDesde) return "amarillo";
  return "verde";
}

/** CPU: verde < 60, amarillo 60–85, rojo > 85. */
export function colorCpu(porcentaje: number): ColorEstado {
  return colorPorLimites(porcentaje, 60, 85);
}

/** Memoria: verde < 75, amarillo 75–90, rojo > 90. */
export function colorMemoria(porcentaje: number): ColorEstado {
  return colorPorLimites(porcentaje, 75, 90);
}

/** Disco: verde < 75, amarillo 75–90, rojo > 90. */
export function colorDisco(porcentaje: number): ColorEstado {
  return colorPorLimites(porcentaje, 75, 90);
}

/** Usado sobre total en %; 0 si el total no sirve. */
export function porcentaje(usado: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(usado)) return 0;
  return (usado / total) * 100;
}

/**
 * La CPU que cuenta: el mayor entre la CPU total y la carga repartida en los núcleos (load1/nucleos×100).
 * Si no se sabe cuántos núcleos hay, solo la CPU total.
 */
export function cpuEfectivo(muestra: Pick<MuestraServidor, "cpuTotal" | "load1" | "nucleos">): number {
  const nucleos = muestra.nucleos;
  if (nucleos == null || !(nucleos > 0)) return muestra.cpuTotal;
  return Math.max(muestra.cpuTotal, (muestra.load1 / nucleos) * 100);
}

export type ResultadoValidacion = { ok: true; muestra: MuestraServidor } | { ok: false; error: string };

function numeroValido(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0;
}

function esGrupo(valor: unknown): valor is GrupoContenedor {
  return typeof valor === "string" && (GRUPOS_CONTENEDOR as readonly string[]).includes(valor);
}

const CAMPOS_ENTEROS = ["memUsadaMb", "memTotalMb", "swapUsadoMb"] as const;
const CAMPOS_DECIMALES = ["cpuTotal", "load1", "discoUsadoGb", "discoTotalGb"] as const;

/**
 * Revisa y normaliza el cuerpo que manda el script del servidor. Exige números ≥ 0 y la lista de
 * contenedores; redondea los MB a enteros (la tabla los guarda como Int) y le pone el grupo a cada
 * contenedor que no lo traiga (o que traiga uno que no existe). Lo demás que venga se descarta.
 */
export function validarMuestra(json: unknown): ResultadoValidacion {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, error: "El cuerpo tiene que ser un objeto JSON." };
  }
  const cuerpo = json as Record<string, unknown>;

  for (const campo of [...CAMPOS_DECIMALES, ...CAMPOS_ENTEROS]) {
    if (!numeroValido(cuerpo[campo])) {
      return { ok: false, error: `Falta "${campo}" o no es un número mayor o igual a 0.` };
    }
  }
  for (const campo of CAMPOS_ENTEROS) {
    if ((cuerpo[campo] as number) > MAXIMO_INT) {
      return { ok: false, error: `"${campo}" es demasiado grande.` };
    }
  }

  let nucleos: number | null = null;
  if (cuerpo.nucleos !== undefined && cuerpo.nucleos !== null) {
    if (
      !numeroValido(cuerpo.nucleos) ||
      !Number.isInteger(cuerpo.nucleos) ||
      cuerpo.nucleos < 1 ||
      cuerpo.nucleos > MAXIMO_INT
    ) {
      return { ok: false, error: '"nucleos" tiene que ser un número entero mayor que 0.' };
    }
    nucleos = cuerpo.nucleos;
  }

  if (!Array.isArray(cuerpo.contenedores)) {
    return { ok: false, error: 'Falta la lista "contenedores".' };
  }
  if (cuerpo.contenedores.length > MAXIMO_CONTENEDORES) {
    return { ok: false, error: `La lista "contenedores" pasa de ${MAXIMO_CONTENEDORES}.` };
  }

  const contenedores: ContenedorMuestra[] = [];
  for (const [i, crudo] of cuerpo.contenedores.entries()) {
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) {
      return { ok: false, error: `El contenedor ${i + 1} no es un objeto.` };
    }
    const c = crudo as Record<string, unknown>;
    const nombre = typeof c.nombre === "string" ? c.nombre.trim() : "";
    if (!nombre || nombre.length > LARGO_MAXIMO_NOMBRE) {
      return { ok: false, error: `El contenedor ${i + 1} no tiene un nombre válido.` };
    }
    if (!numeroValido(c.cpu) || !numeroValido(c.memMb)) {
      return { ok: false, error: `El contenedor "${nombre}" tiene "cpu" o "memMb" inválido.` };
    }
    let memLimiteMb: number | null = null;
    if (c.memLimiteMb !== undefined && c.memLimiteMb !== null) {
      if (!numeroValido(c.memLimiteMb)) {
        return { ok: false, error: `El contenedor "${nombre}" tiene "memLimiteMb" inválido.` };
      }
      memLimiteMb = Math.round(c.memLimiteMb);
    }
    contenedores.push({
      nombre,
      grupo: esGrupo(c.grupo) ? c.grupo : grupoDelContenedor(nombre),
      cpu: c.cpu,
      memMb: Math.round(c.memMb),
      memLimiteMb,
    });
  }

  return {
    ok: true,
    muestra: {
      cpuTotal: cuerpo.cpuTotal as number,
      load1: cuerpo.load1 as number,
      nucleos,
      memUsadaMb: Math.round(cuerpo.memUsadaMb as number),
      memTotalMb: Math.round(cuerpo.memTotalMb as number),
      swapUsadoMb: Math.round(cuerpo.swapUsadoMb as number),
      discoUsadoGb: cuerpo.discoUsadoGb as number,
      discoTotalGb: cuerpo.discoTotalGb as number,
      contenedores,
    },
  };
}

/**
 * Decide si se manda el aviso de CPU alta.
 * - `ultimasCpu`: la CPU de las últimas fotos, de la más nueva a la más vieja.
 * - `umbral` y `muestras`: por defecto 85 % y 5 fotos (la alerta del servidor); la de la base usa 200 % y 3.
 * - Manda cuando las `muestras` últimas pasan del umbral y (no hay alerta activa o pasaron 60 min del último envío).
 * - Si la última no pasa del umbral, la alerta queda inactiva (se recupera) y puede volver a sonar.
 */
export function evaluarAlerta(entrada: {
  ultimasCpu: number[];
  estado: EstadoAlertaCpu;
  ahora: Date;
  umbral?: number;
  muestras?: number;
}): { mandar: boolean; estadoNuevo: EstadoAlertaCpu } {
  const { ultimasCpu, estado, ahora, umbral = UMBRAL_CPU_ALERTA, muestras = MUESTRAS_PARA_ALERTA } = entrada;
  const sinCambio = { mandar: false, estadoNuevo: { ...estado } };

  if (ultimasCpu.length === 0) return sinCambio;
  if (!(ultimasCpu[0] > umbral)) {
    return { mandar: false, estadoNuevo: { activa: false, ultimoEnvio: estado.ultimoEnvio } };
  }

  const recientes = ultimasCpu.slice(0, muestras);
  const todasAltas = recientes.length === muestras && recientes.every((cpu) => cpu > umbral);
  if (!todasAltas) return sinCambio;

  const mandada = { mandar: true, estadoNuevo: { activa: true, ultimoEnvio: ahora.toISOString() } };
  if (!estado.activa || !estado.ultimoEnvio) return mandada;

  const ultimo = new Date(estado.ultimoEnvio).getTime();
  // Fecha rota: mejor avisar que quedarse callado para siempre.
  if (Number.isNaN(ultimo)) return mandada;
  if (ahora.getTime() - ultimo >= MINUTOS_ENTRE_ALERTAS * 60_000) return mandada;
  return sinCambio;
}

function conComa(valor: number, decimales: number): string {
  return valor.toFixed(decimales).replace(".", ",");
}

function gb(mb: number): string {
  return conComa(mb / 1024, 1);
}

/** Mensaje corto para WhatsApp: CPU, top 3 de contenedores por CPU, memoria y disco. */
export function textoDeAlerta(muestra: MuestraServidor): string {
  const top = [...muestra.contenedores].sort((a, b) => b.cpu - a.cpu).slice(0, 3);
  const lineas = [
    `⚠️ Servidor con CPU alta: ${Math.round(cpuEfectivo(muestra))} %`,
    top.length > 0 ? "Los que más usan:" : "Sin datos de contenedores.",
    ...top.map((c, i) => `${i + 1}. ${c.nombre}: ${Math.round(c.cpu)} % (${c.grupo})`),
    `Memoria: ${gb(muestra.memUsadaMb)} de ${gb(muestra.memTotalMb)} GB`,
    `Disco: ${conComa(muestra.discoUsadoGb, 0)} de ${conComa(muestra.discoTotalGb, 0)} GB`,
  ];
  return lineas.join("\n");
}

/** El contenedor del grupo "Base" que más CPU usa; null si la foto no trae ninguno. */
function contenedorDeLaBase(contenedores: readonly ContenedorMuestra[]): ContenedorMuestra | null {
  let mayor: ContenedorMuestra | null = null;
  for (const c of contenedores) {
    if (c.grupo === "Base" && (mayor === null || c.cpu > mayor.cpu)) mayor = c;
  }
  return mayor;
}

/** CPU (en %) del contenedor de la base que más usa (no la suma); null si no hay ninguno del grupo "Base". */
export function cpuDeLaBase(contenedores: readonly ContenedorMuestra[]): number | null {
  return contenedorDeLaBase(contenedores)?.cpu ?? null;
}

/** Mensaje corto del aviso "Base de datos saturada": la CPU y la memoria de la base y la CPU del servidor. */
export function textoDeAlertaBase(muestra: MuestraServidor): string {
  const base = contenedorDeLaBase(muestra.contenedores);
  const lineas = [
    base
      ? `⚠️ ${TITULO_AVISO_BASE}: ${base.nombre} usa ${Math.round(base.cpu)} % de CPU`
      : `⚠️ ${TITULO_AVISO_BASE}`,
    `Lleva ${MUESTRAS_PARA_ALERTA_BASE} fotos seguidas por encima de ${UMBRAL_CPU_BASE_ALERTA} %.`,
  ];
  if (base) {
    lineas.push(
      base.memLimiteMb
        ? `Memoria de la base: ${gb(base.memMb)} de ${gb(base.memLimiteMb)} GB`
        : `Memoria de la base: ${gb(base.memMb)} GB`,
    );
  }
  lineas.push(`CPU del servidor: ${Math.round(cpuEfectivo(muestra))} %`);
  return lineas.join("\n");
}

// ---------------------------------------------------------------------------------------------------------
// Parte 3: la pantalla Dirección → Servidor. Funciones PURAS que usan la ruta GET y la página.
// ---------------------------------------------------------------------------------------------------------

/** Cuántas horas muestra la pantalla. */
export const HORAS_PANEL = 24;

/** Una foto tal como llega a la pantalla. Los contenedores vienen solo en la última (pesaría mucho en todas). */
export type FotoPanel = {
  tomadaEn: string;
  cpuTotal: number;
  load1: number;
  nucleos: number | null;
  memUsadaMb: number;
  memTotalMb: number;
  discoUsadoGb: number;
  discoTotalGb: number;
  contenedores?: ContenedorMuestra[];
};

/** La fila de la base con los campos que se dibujan (sin `contenedores`). */
export type FilaPanel = Omit<FotoPanel, "tomadaEn" | "contenedores"> & { tomadaEn: Date };

/** Los campos que se leen de la base para la gráfica: nunca `contenedores`. */
export const CAMPOS_PANEL = {
  tomadaEn: true,
  cpuTotal: true,
  load1: true,
  nucleos: true,
  memUsadaMb: true,
  memTotalMb: true,
  discoUsadoGb: true,
  discoTotalGb: true,
} as const;

/** Desde cuándo se leen las fotos: ahora menos 24 h. */
export function inicioDelPanel(ahora: Date): Date {
  return new Date(ahora.getTime() - HORAS_PANEL * 60 * 60_000);
}

/** Convierte el JSON guardado en una lista segura de contenedores; salta las entradas rotas. */
export function leerContenedores(json: unknown): ContenedorMuestra[] {
  if (!Array.isArray(json)) return [];
  const lista: ContenedorMuestra[] = [];
  for (const crudo of json) {
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) continue;
    const c = crudo as Record<string, unknown>;
    const nombre = typeof c.nombre === "string" ? c.nombre.trim() : "";
    if (!nombre || !numeroValido(c.cpu) || !numeroValido(c.memMb)) continue;
    lista.push({
      nombre,
      grupo: esGrupo(c.grupo) ? c.grupo : grupoDelContenedor(nombre),
      cpu: c.cpu,
      memMb: c.memMb,
      memLimiteMb: numeroValido(c.memLimiteMb) ? c.memLimiteMb : null,
    });
  }
  return lista;
}

/** Arma lo que viaja a la pantalla: las fotos en orden, con los contenedores solo en la última. */
export function armarPanelServidor(filas: FilaPanel[], contenedoresDeLaUltima: unknown): FotoPanel[] {
  const fotos: FotoPanel[] = filas.map((fila) => ({ ...fila, tomadaEn: fila.tomadaEn.toISOString() }));
  if (fotos.length > 0) {
    fotos[fotos.length - 1].contenedores = leerContenedores(contenedoresDeLaUltima);
  }
  return fotos;
}

/** De mayor a menor CPU; si empatan, por nombre. No cambia la lista original. */
export function ordenarContenedoresPorCpu(contenedores: readonly ContenedorMuestra[]): ContenedorMuestra[] {
  return [...contenedores].sort((a, b) => b.cpu - a.cpu || a.nombre.localeCompare(b.nombre));
}

export type GrupoDelPanel = {
  grupo: GrupoContenedor;
  contenedores: ContenedorMuestra[];
  /** Suma de la CPU de sus contenedores, en %. */
  cpu: number;
  /** Suma de la memoria de sus contenedores, en MB. */
  memMb: number;
};

/** Los contenedores por grupo, en el orden de GRUPOS_CONTENEDOR y sin los grupos vacíos. */
export function agruparContenedores(contenedores: readonly ContenedorMuestra[]): GrupoDelPanel[] {
  return GRUPOS_CONTENEDOR.map((grupo) => {
    const delGrupo = ordenarContenedoresPorCpu(contenedores.filter((c) => c.grupo === grupo));
    return {
      grupo,
      contenedores: delGrupo,
      cpu: delGrupo.reduce((suma, c) => suma + c.cpu, 0),
      memMb: delGrupo.reduce((suma, c) => suma + c.memMb, 0),
    };
  }).filter((g) => g.contenedores.length > 0);
}

export type PuntoPanel = { tomadaEn: string; cpu: number; memoria: number; disco: number };

/** Por cada foto, el % de CPU (efectiva), de memoria y de disco. */
export function seriePanelServidor(fotos: readonly FotoPanel[]): PuntoPanel[] {
  return fotos.map((foto) => ({
    tomadaEn: foto.tomadaEn,
    cpu: cpuEfectivo(foto),
    memoria: porcentaje(foto.memUsadaMb, foto.memTotalMb),
    disco: porcentaje(foto.discoUsadoGb, foto.discoTotalGb),
  }));
}

// ---------------------------------------------------------------------------------------------------------
// Consultas lentas de la base (alerta, parte 2). Funciones PURAS: la lectura de pg_stat_activity la hace la ruta.
// Solo se mira: nunca se cancela ni se cambia nada en la base.
// ---------------------------------------------------------------------------------------------------------

/** Una consulta que lleva más de esto (en segundos) cuenta como lenta. */
export const SEGUNDOS_CONSULTA_LENTA = 10;
/** Cuántas fotos seguidas tiene que haber consultas lentas para avisar. */
export const FOTOS_PARA_ALERTA_CONSULTAS = 2;
/** Tope de consultas que se leen, se guardan y van en el aviso. */
export const MAXIMO_CONSULTAS_LENTAS = 5;
/** Título exacto del aviso. */
export const TITULO_AVISO_CONSULTAS_LENTAS = "Base de datos con consultas lentas";

/** Lo que se lee de pg_stat_activity: la base, cuántos segundos lleva y el texto (null si Postgres no lo deja ver). */
export type ConsultaLenta = { base: string; segundos: number; texto: string | null };
/** Lo que se guarda y se muestra: nunca el texto de la consulta, solo la frase de `resumirConsulta`. */
export type ConsultaResumida = { base: string; segundos: number; resumen: string };
/** Estado del aviso. `ultimoAvisoEn` en ISO. */
export type EstadoConsultasLentas = { rachaDeFotos: number; ultimoAvisoEn: string | null };

const LARGO_MAXIMO_IDENTIFICADOR = 63;
const MAXIMO_TABLAS_EN_RESUMEN = 4;

/** Un nombre de Postgres (tabla o base) limpio: sin comillas ni caracteres de control, y corto. */
function nombreLimpio(valor: string): string {
  return valor
    .replace(/"/g, "")
    .replace(/[^\p{L}\p{N}_$\-. ]/gu, "")
    .trim()
    .slice(0, LARGO_MAXIMO_IDENTIFICADOR);
}

// Una sola pasada de izquierda a derecha, para que una comilla dentro de otra cosa no desfase el resto. En orden:
// identificador entre comillas dobles (se conserva), comentarios, texto con $tag$, texto E'…' (con escapes \'),
// texto '…' (también B'…', X'…' y U&'…') y números. Todo lo que no es identificador se quita.
const PIEZAS_DEL_SQL = new RegExp(
  [
    String.raw`(?<ident>"(?:[^"]|"")*(?:"|$))`,
    String.raw`\/\*[\s\S]*?(?:\*\/|$)`,
    String.raw`--[^\n]*`,
    String.raw`\$(?<tag>[A-Za-z_][\w]*)?\$[\s\S]*?(?:\$\k<tag>\$|$)`,
    String.raw`(?<![\w$])[Ee]'(?:[^'\\]|\\[\s\S]|'')*(?:'|$)`,
    String.raw`(?:(?<![\w$])(?:[BbXx]|[Uu]&))?'(?:[^']|'')*(?:'|$)`,
    String.raw`(?<![\w$])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`,
  ].join("|"),
  "g",
);

/**
 * Quita del SQL los comentarios y todos los valores escritos (textos entre comillas simples, textos con $$ y
 * números), para que al buscar las tablas no se pueda colar ningún dato. Los identificadores entre comillas
 * dobles se dejan tal cual.
 */
function sqlSinValores(texto: string): string {
  return texto.replace(PIEZAS_DEL_SQL, (pieza, ...resto) => {
    const grupos = resto[resto.length - 1] as { ident?: string };
    return grupos.ident !== undefined ? pieza : " ";
  });
}

// Un nombre de tabla: "Message", public.users o "public"."Message". El último grupo es la tabla.
const IDENT = String.raw`(?:"[^"]{1,128}"|[A-Za-z_][\w$]{0,127})`;
const NOMBRE_TABLA = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;
// Pegado al nombre no puede venir "(": eso es una función (unnest(...), now()), no una tabla. Con espacio sí
// (INSERT INTO "Message" ("id", …) o CREATE INDEX … ON "Message" (…)).
const NO_FUNCION = String.raw`(?![\w$"(]|\s*\.)`;
const TABLAS_NORMALES = new RegExp(String.raw`\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:ONLY\s+)?${NOMBRE_TABLA}${NO_FUNCION}`, "gi");
const TABLAS_MANTENIMIENTO = new RegExp(
  String.raw`\b(?:ON|TABLE|VACUUM(?:\s*\([^)]*\))?(?:\s+(?:FULL|FREEZE|VERBOSE|ANALYZE))*|ANALYZE(?:\s*\([^)]*\))?(?:\s+VERBOSE)?|CLUSTER(?:\s+VERBOSE)?)\s+(?:ONLY\s+|CONCURRENTLY\s+)?${NOMBRE_TABLA}${NO_FUNCION}`,
  "gi",
);
// Palabras que pueden quedar tras FROM/ON/TABLE y no son tablas.
const NO_SON_TABLAS = new Set(["select", "lateral", "only", "concurrently", "verbose", "full", "freeze", "analyze", "set", "where", "values", "default", "conflict", "true", "false", "null", "if", "not", "exists", "skip", "nowait", "of"]);

type Accion = "leer" | "guardar" | "cambiar" | "borrar" | "mantenimiento" | "otra";

function accionDe(sql: string): Accion {
  const primera = sql.trim().match(/^[(\s]*([A-Za-z]+)/)?.[1]?.toUpperCase() ?? "";
  if (primera === "SELECT" || primera === "TABLE" || primera === "VALUES") return "leer";
  if (primera === "INSERT" || primera === "COPY" || primera === "MERGE") return "guardar";
  if (primera === "UPDATE") return "cambiar";
  if (primera === "DELETE" || primera === "TRUNCATE") return "borrar";
  if (["VACUUM", "ANALYZE", "ANALYSE", "REINDEX", "CLUSTER", "REFRESH"].includes(primera)) return "mantenimiento";
  if (primera === "CREATE" || primera === "DROP" || primera === "ALTER") {
    return /^\s*(?:CREATE|DROP|ALTER)\s+(?:UNIQUE\s+)?INDEX\b/i.test(sql) || /^\s*ALTER\s+TABLE\b/i.test(sql)
      ? "mantenimiento"
      : "otra";
  }
  if (primera === "WITH") {
    // La acción de un WITH es la que viene al final; basta con ver si escribe algo.
    if (/\bINSERT\s+INTO\b/i.test(sql)) return "guardar";
    if (/\bUPDATE\s+\S+\s+SET\b/i.test(sql)) return "cambiar";
    if (/\bDELETE\s+FROM\b/i.test(sql)) return "borrar";
    return "leer";
  }
  return "otra";
}

function tablasDe(sql: string, accion: Accion): string[] {
  const tablas: string[] = [];
  const patrones = accion === "mantenimiento" ? [TABLAS_NORMALES, TABLAS_MANTENIMIENTO] : [TABLAS_NORMALES];
  for (const patron of patrones) {
    for (const coincidencia of sql.matchAll(patron)) {
      // Solo la tabla, sin el esquema ("public"."Message" → Message).
      const partes = coincidencia[1].split(/\s*\.\s*(?=["A-Za-z_])/);
      const nombre = nombreLimpio(partes[partes.length - 1]);
      if (!nombre || NO_SON_TABLAS.has(nombre.toLowerCase()) || tablas.includes(nombre)) continue;
      tablas.push(nombre);
    }
  }
  return tablas.slice(0, MAXIMO_TABLAS_EN_RESUMEN);
}

function listaConY(nombres: string[]): string {
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

const VERBOS: Record<Accion, { conTabla: string; sinTabla: string }> = {
  leer: { conTabla: "Leyendo", sinTabla: "Leyendo datos" },
  guardar: { conTabla: "Guardando en", sinTabla: "Guardando datos" },
  cambiar: { conTabla: "Cambiando", sinTabla: "Cambiando datos" },
  borrar: { conTabla: "Borrando de", sinTabla: "Borrando datos" },
  mantenimiento: { conTabla: "Mantenimiento de", sinTabla: "Mantenimiento de la base" },
  otra: { conTabla: "Consulta sobre", sinTabla: "Consulta" },
};

/**
 * Frase sencilla de una consulta lenta: la acción y las tablas, cuánto lleva y en qué base. Por ejemplo
 * "Leyendo la tabla Message y Conversation…" sale como "Leyendo las tablas Message y Conversation, hace 23 s
 * (base crm)". NUNCA copia valores (textos, números, teléfonos): solo palabras clave y nombres de tabla.
 * Sin texto (o con `<insufficient privilege>`) dice "consulta de otro usuario de la base".
 */
export function resumirConsulta(texto: string | null | undefined, base: string | null | undefined, segundos: number): string {
  const duracion = `hace ${Number.isFinite(segundos) ? Math.max(0, Math.round(segundos)) : 0} s`;
  const nombreBase = nombreLimpio(String(base ?? "")) || "sin nombre";
  const cola = `${duracion} (base ${nombreBase})`;
  const crudo = String(texto ?? "").trim();
  if (!crudo || crudo === "<insufficient privilege>") return `Consulta de otro usuario de la base, ${cola}`;

  const sql = sqlSinValores(crudo);
  const accion = accionDe(sql);
  const tablas = tablasDe(sql, accion);
  const verbo = VERBOS[accion];
  if (tablas.length === 0) return `${verbo.sinTabla}, ${cola}`;
  const queTabla = tablas.length === 1 ? `la tabla ${tablas[0]}` : `las tablas ${listaConY(tablas)}`;
  return `${verbo.conTabla} ${queTabla}, ${cola}`;
}

/** Las consultas leídas, resumidas (máximo 5): base, segundos y la frase; sin el texto. */
export function resumirConsultas(consultas: readonly ConsultaLenta[]): ConsultaResumida[] {
  return consultas.slice(0, MAXIMO_CONSULTAS_LENTAS).map((consulta) => ({
    base: nombreLimpio(String(consulta.base ?? "")) || "sin nombre",
    segundos: Number.isFinite(consulta.segundos) ? Math.max(0, Math.round(consulta.segundos)) : 0,
    resumen: resumirConsulta(consulta.texto, consulta.base, consulta.segundos),
  }));
}

/**
 * Decide si se avisa "Base de datos con consultas lentas" con la lista de esta foto y el estado guardado.
 * - Cada foto con consultas suma 1 a la racha; una foto sin consultas la vuelve a 0.
 * - Avisa desde la 2ª foto seguida con consultas, y lo repite como máximo cada 60 min.
 */
export function evaluarConsultasLentas(entrada: {
  consultas: readonly unknown[];
  estado: EstadoConsultasLentas;
  ahora: Date;
}): { mandar: boolean; estadoNuevo: EstadoConsultasLentas } {
  const { consultas, estado, ahora } = entrada;
  if (consultas.length === 0) {
    return { mandar: false, estadoNuevo: { rachaDeFotos: 0, ultimoAvisoEn: estado.ultimoAvisoEn } };
  }
  const anterior = Number.isInteger(estado.rachaDeFotos) && estado.rachaDeFotos > 0 ? estado.rachaDeFotos : 0;
  const rachaDeFotos = anterior + 1;
  const sinAviso = { mandar: false, estadoNuevo: { rachaDeFotos, ultimoAvisoEn: estado.ultimoAvisoEn } };
  if (rachaDeFotos < FOTOS_PARA_ALERTA_CONSULTAS) return sinAviso;

  const mandada = { mandar: true, estadoNuevo: { rachaDeFotos, ultimoAvisoEn: ahora.toISOString() } };
  if (!estado.ultimoAvisoEn) return mandada;
  const ultimo = new Date(estado.ultimoAvisoEn).getTime();
  // Fecha rota: mejor avisar que quedarse callado para siempre.
  if (Number.isNaN(ultimo)) return mandada;
  if (ahora.getTime() - ultimo >= MINUTOS_ENTRE_ALERTAS * 60_000) return mandada;
  return sinAviso;
}

/** Mensaje del aviso: el título y las consultas resumidas. */
export function textoDeAlertaConsultas(consultas: readonly ConsultaResumida[]): string {
  const lista = consultas.slice(0, MAXIMO_CONSULTAS_LENTAS);
  return [
    `⚠️ ${TITULO_AVISO_CONSULTAS_LENTAS}`,
    `${FOTOS_PARA_ALERTA_CONSULTAS} fotos seguidas con consultas de más de ${SEGUNDOS_CONSULTA_LENTA} s:`,
    ...lista.map((consulta, i) => `${i + 1}. ${consulta.resumen}`),
  ].join("\n");
}
