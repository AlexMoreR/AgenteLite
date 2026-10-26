// Un agente por proyecto (26-oct-2026). El Coordinador de Sistemas reparte las tarjetas y cada una la trabaja el
// agente de SU proyecto: con su identidad, el CLAUDE.md de la raíz de su repositorio y su propia cola
// (`maxEnParalelo`). Este archivo es PURO: no lee archivos ni la red; los datos salen de `repos.<clave>.agente`
// de la configuración y, si faltan, se deducen de la clave del proyecto.
//
// Mejora continua (26-oct-2026): cada agente anota qué aprendió en `<carpetaTrabajo>/lecciones/<clave>.md` (SOLO en
// aizen1: nunca va al repositorio ni a main). `leccionDe` arma la entrada, `anotarLeccion` la guarda sin repetir la
// misma huella y con tope de entradas, y `leccionesParaElPrompt` devuelve las últimas para las instrucciones. Lo único
// que toca el disco es el archivo de lecciones; si no se puede escribir o leer, la tarjeta sigue como si nada.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** El nombre de cada agente según el proyecto (lo que no esté acá se llama "Agente <clave>"). */
export const NOMBRES_DE_AGENTES = {
  aizencrm: "Agente CRM",
  gestion: "Agente Gestión",
  "messenger-basic": "Agente Marketplace (NETMAGI)",
  marketing: "Agente Marketing",
};

/** Cuántas tarjetas a la vez tiene un agente cuando ni él ni la configuración general lo dicen. */
export const MAX_EN_PARALELO_POR_DEFECTO = 2;

/**
 * Los datos del agente de un proyecto: { nombre, clave, carpeta, archivoClaude, archivoLecciones, archivoLeccionesAprendidas,
 * maxEnParalelo }. `repo` es la entrada de config.repos (con `clave`, `ruta` y, si hay, `agente`). `maxPorDefecto` es el
 * tope que se usa si el agente no trae `maxEnParalelo` (lo que cabe en total, para que quien no configure nada siga igual).
 * `carpetaTrabajo` es la del Coordinador en aizen1: ahí viven las lecciones que el agente aprende (sin ella, no hay archivo).
 */
export function agenteDelRepo(repo, maxPorDefecto = MAX_EN_PARALELO_POR_DEFECTO, carpetaTrabajo = "") {
  const clave = String(repo?.clave ?? "");
  const datos = repo?.agente && typeof repo.agente === "object" ? repo.agente : {};
  const carpeta = typeof repo?.ruta === "string" ? repo.ruta : "";
  const nombre = typeof datos.nombre === "string" && datos.nombre.trim() ? datos.nombre.trim() : (NOMBRES_DE_AGENTES[clave] ?? `Agente ${clave}`);
  const lecciones = typeof datos.lecciones === "string" && datos.lecciones.trim() ? datos.lecciones.trim() : "";
  const maximo = Math.floor(Number(datos.maxEnParalelo));
  return {
    nombre,
    clave,
    carpeta,
    archivoClaude: carpeta ? path.join(carpeta, "CLAUDE.md") : "CLAUDE.md",
    // Lo aprendido solo (distinto de `archivoLecciones`, las reglas escritas a mano): vive en aizen1, nunca en el repo.
    archivoLeccionesAprendidas: carpetaTrabajo && clave ? path.join(carpetaTrabajo, "lecciones", `${clave.replace(/[^\w.-]/g, "_")}.md`) : "",
    archivoLecciones: lecciones ? path.resolve(carpeta || ".", lecciones) : "",
    maxEnParalelo: Number.isFinite(maximo) && maximo >= 1 ? maximo : Math.max(1, Math.floor(Number(maxPorDefecto)) || MAX_EN_PARALELO_POR_DEFECTO),
  };
}

/** La primera línea de las instrucciones: quién eres y de qué proyecto es la tarjeta. */
export function textoDeIdentidad(agente) {
  const lecciones = agente.archivoLecciones ? ` y las lecciones de ${agente.archivoLecciones}` : "";
  return `Eres el ${agente.nombre} del proyecto ${agente.clave}; el Coordinador de Sistemas te pasó esta tarjeta. Sigue el CLAUDE.md de la raíz de tu repositorio${lecciones}.`;
}

// ───────────────────────────────────────────────────────────────────── lecciones aprendidas ──

/** Cuántas lecciones recientes guarda el archivo; las más viejas pasan a "Lecciones viejas (resumidas)". */
export const MAX_LECCIONES = 40;
/** Cuántas lecciones lee un agente antes de trabajar. */
export const LECCIONES_EN_EL_PROMPT = 8;
const LARGO_DE_LINEA = 300;

const TITULO_RECIENTES = "## Lecciones recientes";
const TITULO_VIEJAS = "## Lecciones viejas (resumidas)";

/** La regla para no repetir la falla, un texto fijo por categoría del diagnóstico (diagnostico.mjs: CATEGORIAS). */
export const REGLAS_POR_CATEGORIA = {
  limite_claude: "Si Claude llega a su límite de uso, no insistas: deja la tarjeta esperando el reinicio del cupo.",
  pc_sobrecargado: "No abras más sesiones ni pasos pesados con el PC lleno: espera a que baje la carga.",
  tiempo_agotado: "Haz cambios pequeños y verifica por partes; si la tarea no cabe en el tiempo, pártela antes de construir.",
  no_compila: "Corre `npx tsc --noEmit` y el build antes de terminar; no entregues código que no compila.",
  fallan_pruebas: "Corre las pruebas del módulo que tocaste antes de terminar y arregla lo que falle; no cambies las pruebas para que pasen.",
  lint: "Corre el lint solo de los archivos que cambiaste y deja cero errores nuevos antes de terminar.",
  choca_con_main: "Parte de la versión más reciente de main y evita tocar archivos que otra tarjeta está cambiando.",
  migracion: "Escribe migraciones solo aditivas, a mano, con BEGIN/COMMIT y guardas IF NOT EXISTS; nada de SQL destructivo.",
  no_cambio_nada: "Si de verdad no hace falta cambiar nada, termina con NO_CAMBIE y el motivo; si sí hace falta, cambia el código.",
  carpeta_trabada: "No dejes procesos ni builds corriendo al terminar: liberan la carpeta de trabajo.",
  tarea_muy_grande: "Si la tarea es muy grande, no la hagas entera: hazla en partes pequeñas, en orden.",
  coordinador_cortado: "Si el Coordinador se corta, la tarjeta se vuelve a tomar: deja el trabajo en un punto que se pueda retomar.",
  sesion_atascada: "Si una orden se queda quieta, no la repitas igual: corta, lee el error y prueba otro camino.",
  otra: "Lee el error completo antes de reintentar y arregla la causa, no el síntoma.",
};

const unaLinea = (texto, n = LARGO_DE_LINEA) => {
  const limpio = String(texto ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").replace(/^#+\s*/, "").trim();
  return limpio.length > n ? `${limpio.slice(0, n - 1).trimEnd()}…` : limpio;
};

/** Un código corto que identifica la lección: la misma categoría, resultado, etapa y causa dan la misma huella. */
export function huellaDeLeccion({ categoria, resultado, etapa, causa }) {
  const base = [categoria, resultado, etapa, String(causa ?? "").toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, " ").trim().slice(0, 120)].join("|");
  return crypto.createHash("sha1").update(base).digest("hex").slice(0, 8);
}

/**
 * Una entrada corta para el archivo de lecciones: { fecha, tarjeta, resultado ("fallo" | "bien"), etapa, categoria, causa,
 * arreglo, regla, huella, veces }. `diagnostico` es { categoria, causa } (diagnostico.mjs); `resultado` dice si falló o
 * salió bien. `arreglo` (opcional) cuenta cómo se arregló; `ahora` es la fecha.
 */
export function leccionDe({ tarjeta = {}, resultado = "fallo", diagnostico = {}, etapa = "", arreglo = "", ahora = new Date() } = {}) {
  const categoria = REGLAS_POR_CATEGORIA[diagnostico?.categoria] ? diagnostico.categoria : "otra";
  const quedo = resultado === "bien" ? "bien" : "fallo";
  const causa = unaLinea(diagnostico?.causa || "sin causa conocida");
  const entrada = {
    fecha: (ahora instanceof Date ? ahora : new Date(ahora)).toISOString().slice(0, 10),
    tarjeta: unaLinea(`${tarjeta?.titulo ?? "sin título"}${tarjeta?.id ? ` (${String(tarjeta.id).slice(0, 8)})` : ""}`, 160),
    resultado: quedo,
    etapa: unaLinea(etapa || diagnostico?.etapa || "", 20),
    categoria,
    causa,
    arreglo: unaLinea(arreglo || (quedo === "bien" ? "Se corrigió y la tarjeta subió." : "Se intenta reparar de nuevo con lo que dice la causa.")),
    regla: REGLAS_POR_CATEGORIA[categoria],
    veces: 1,
  };
  return { ...entrada, huella: huellaDeLeccion(entrada) };
}

/** El archivo de lecciones leído: { recientes: [entrada], viejas: [{ huella, fecha, categoria, resultado, regla, veces }] }. */
function leerArchivo(ruta) {
  const vacio = { recientes: [], viejas: [] };
  let texto;
  try {
    texto = fs.readFileSync(ruta, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return vacio;
  }
  const iViejas = texto.indexOf(TITULO_VIEJAS);
  const cuerpoRecientes = iViejas >= 0 ? texto.slice(0, iViejas) : texto;
  const cuerpoViejas = iViejas >= 0 ? texto.slice(iViejas + TITULO_VIEJAS.length) : "";
  const recientes = [];
  for (const bloque of cuerpoRecientes.split(/^### /m).slice(1)) {
    const [encabezado, ...lineas] = bloque.split(/\r?\n/);
    const calce = /^(\S+) · (bien|fallo) · (\S+) · huella:([0-9a-f]+)(?: · veces:(\d+))?/.exec(encabezado.trim());
    if (!calce) continue;
    const campo = (nombre) => lineas.find((linea) => linea.startsWith(`- ${nombre}: `))?.slice(nombre.length + 4).trim() ?? "";
    recientes.push({
      fecha: calce[1],
      resultado: calce[2],
      categoria: calce[3],
      huella: calce[4],
      veces: Number(calce[5]) || 1,
      tarjeta: campo("Tarjeta"),
      etapa: campo("Etapa"),
      causa: campo("Causa"),
      arreglo: campo("Cómo se arregló"),
      regla: campo("Regla"),
    });
  }
  const viejas = [];
  for (const linea of cuerpoViejas.split(/\r?\n/)) {
    const calce = /^- huella:([0-9a-f]+) · (\S+) · (\S+) · (bien|fallo) — (.*?)(?: \(×(\d+)\))?$/.exec(linea.trim());
    if (calce) viejas.push({ huella: calce[1], fecha: calce[2], categoria: calce[3], resultado: calce[4], regla: calce[5], veces: Number(calce[6]) || 1 });
  }
  return { recientes, viejas };
}

function textoDelArchivo(agente, { recientes, viejas }) {
  const partes = [`# Lecciones del ${agente.nombre} (${agente.clave})`, "", "Las anota el Coordinador solo; viven en aizen1 y no se suben al repositorio.", "", TITULO_RECIENTES, ""];
  for (const l of recientes) {
    partes.push(
      `### ${l.fecha} · ${l.resultado} · ${l.categoria} · huella:${l.huella}${l.veces > 1 ? ` · veces:${l.veces}` : ""}`,
      `- Tarjeta: ${l.tarjeta}`,
      `- Etapa: ${l.etapa}`,
      `- Causa: ${l.causa}`,
      `- Cómo se arregló: ${l.arreglo}`,
      `- Regla: ${l.regla}`,
      "",
    );
  }
  partes.push(TITULO_VIEJAS, "");
  for (const v of viejas) partes.push(`- huella:${v.huella} · ${v.fecha} · ${v.categoria} · ${v.resultado} — ${v.regla}${v.veces > 1 ? ` (×${v.veces})` : ""}`);
  return `${partes.join("\n").trimEnd()}\n`;
}

/**
 * Agrega la lección al archivo del agente. Si su huella ya está, no la repite (solo cuenta una vez más que pasó).
 * Con más de MAX_LECCIONES, las más viejas pasan a "Lecciones viejas (resumidas)": una línea por lección y cuántas
 * veces pasó; no se pierde ninguna. Nunca lanza: devuelve "agregada" | "repetida" | "no_se_pudo".
 */
export function anotarLeccion(agente, leccion, { registro = null, maximo = MAX_LECCIONES } = {}) {
  const ruta = agente?.archivoLeccionesAprendidas;
  if (!ruta || !leccion?.huella) return "no_se_pudo";
  try {
    const archivo = leerArchivo(ruta);
    const repetida = archivo.recientes.find((l) => l.huella === leccion.huella);
    const vieja = archivo.viejas.find((v) => v.huella === leccion.huella);
    let estado = "agregada";
    if (repetida) {
      repetida.veces += 1;
      estado = "repetida";
    } else if (vieja) {
      vieja.veces += 1;
      estado = "repetida";
    } else {
      archivo.recientes.push({ ...leccion, veces: leccion.veces ?? 1 });
    }
    while (archivo.recientes.length > Math.max(1, maximo)) {
      const sale = archivo.recientes.shift();
      const igual = archivo.viejas.find((v) => v.huella === sale.huella);
      if (igual) igual.veces += sale.veces;
      else archivo.viejas.push({ huella: sale.huella, fecha: sale.fecha, categoria: sale.categoria, resultado: sale.resultado, regla: unaLinea(sale.regla), veces: sale.veces });
    }
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, textoDelArchivo(agente, archivo), "utf8");
    return estado;
  } catch (error) {
    registro?.aviso?.(`no se pudo anotar la lección del ${agente.nombre}: ${error?.message ?? error}`);
    return "no_se_pudo";
  }
}

/**
 * Las últimas lecciones del agente en texto corto (una línea cada una), listas para las instrucciones. Se lee recortado
 * (pocas entradas y un largo máximo por línea): un archivo dañado no mete texto raro. Vacío si no hay o no se puede leer.
 */
export function leccionesParaElPrompt(agente, { cuantas = LECCIONES_EN_EL_PROMPT } = {}) {
  const ruta = agente?.archivoLeccionesAprendidas;
  if (!ruta) return "";
  try {
    return leerArchivo(ruta)
      .recientes.slice(-Math.max(1, cuantas))
      .map((l) => `- (${l.resultado === "bien" ? "ya arreglada" : "falló"}: ${unaLinea(l.categoria, 30)}) ${unaLinea(l.causa, 160)} → Regla: ${unaLinea(l.regla, 200)}`)
      .join("\n");
  } catch {
    return "";
  }
}

// ───────────────────────────────────────────────────────────────────── lo que el agente escribe ──

const sinTildes = (texto) => String(texto ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Las 3 líneas fijas con que el agente cierra construir: "Qué se hizo:", "Qué se ve ahora:" y "Qué revisar juntos:".
 * Toma la última vez que aparece cada una. -> { hizo, ahora, revisar } (solo las que vienen con texto) o null.
 */
export function tresLineasDe(texto) {
  const claves = { hizo: /^que se hizo\s*:\s*(.+)$/, ahora: /^que se ve ahora\s*:\s*(.+)$/, revisar: /^que revisar juntos\s*:\s*(.+)$/ };
  const salida = {};
  const originales = String(texto ?? "").split(/\r?\n/);
  const normales = sinTildes(texto).split(/\r?\n/);
  originales.forEach((original, i) => {
    const linea = (normales[i] ?? "").replace(/^[\s>*_#-]+/, "").replace(/\*+/g, "").trim().toLowerCase();
    for (const [clave, regla] of Object.entries(claves)) {
      if (!regla.test(linea)) continue;
      // El texto con sus tildes: la misma línea del original, sin la etiqueta.
      const valor = original.replace(/^[\s>*_#-]*\**[^:]*:\s*\**/, "").replace(/\*+/g, "").trim();
      if (valor) salida[clave] = valor.slice(0, 300);
    }
  });
  return Object.keys(salida).length ? salida : null;
}

/** Lo que el agente pide con "NECESITO: <clave|acceso|decisión> …" al comienzo de una línea: { tipo, detalle } o null. */
export function necesitoDe(texto) {
  for (const original of String(texto ?? "").split(/\r?\n/)) {
    const calce = /^[\s>*_#-]*\**NECESITO\**\s*:\s*\**\s*(clave|acceso|decisi[oó]n)(?![a-záéíóúñ])\s*[:\-—–]?\s*(.*)$/i.exec(original);
    if (!calce) continue;
    const tipo = sinTildes(calce[1]).toLowerCase().replace("decision", "decisión");
    return { tipo, detalle: unaLinea(calce[2].replace(/\*+/g, ""), 400) || "(sin detalle)" };
  }
  return null;
}
