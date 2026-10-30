// LA REVISIÓN CON 4 REVISORES (29-oct-2026, pedido de Alexander). Idea tomada de la "software factory" de zazencodes
// (season 3): después de construir y ANTES de subir, cuatro revisores miran el diff — seguridad, experiencia, diseño y
// código — y cada uno contesta APROBADO o CAMBIOS con una lista corta (archivo: qué cambiar). Si alguno pide cambios, el
// MISMO que construyó corrige y se vuelve a revisar (solo los que pidieron), máximo 2 correcciones. Si sigue sin pasar, la
// tarjeta va a ERROR con la categoría `revision_no_paso` (diagnostico.mjs): no se repara ni se reintenta sola.
//
// Dónde corre:
//   - NUBE (casi todo): la MISMA sesión de `claude --cloud` lanza los 4 revisores como subagentes (seguridad en Opus, los
//     demás en Sonnet) antes de su commit "resultado:" y deja `revision=OK` o `revision=FALLO revisor=<x> motivo=<…>`
//     (textoParaLaNube; nube.mjs lo lee).
//   - aizen1: el Coordinador corre cada revisor con `claude -p --model <modelos.revisar | revisarSeguridad> --permission-mode plan` (solo lee)
//     y el corrector con el mismo motor y modelo de construir (revisarConCuatro, con las funciones que le pasa etapas.mjs).
//
// Este archivo es puro (no corre procesos ni toca disco): las pruebas lo usan sin nada.

/** Cuántas correcciones como mucho (después de la 1ª revisión). */
export const VUELTAS_DE_CORRECCION = 2;

/** Lo que cada revisor ve de un diff muy largo (el resto lo lee él en los archivos). */
export const LARGO_DEL_DIFF = 30_000;

/** Cuántos cambios pedidos se guardan por revisor (los revisores tienen que ser concretos). */
const MAX_CAMBIOS = 5;

/**
 * Los 4 revisores. `soloPantallas`: si el cambio no toca pantallas (tocaPantallas), ni se lanzan: "no aplica".
 * Los criterios son cortos a propósito: la instrucción de la nube tiene un tope de ~24 000 caracteres.
 */
export const REVISORES = [
  {
    clave: "seguridad",
    nombre: "seguridad",
    criterios:
      "permisos y dueño de los datos en cada ruta o acción nueva o cambiada; entradas sin validar que llegan a SQL, comandos, rutas de archivos o HTML; datos, claves o errores internos que se filtran (respuestas, logs, commits); mensajes a clientes o gasto que el plan no pide.",
  },
  {
    clave: "experiencia",
    nombre: "experiencia",
    soloPantallas: true,
    criterios:
      "el flujo hace lo que promete el plan, sin callejones sin salida; estados de carga, vacío y error que dicen algo útil; textos cortos en español sencillo; botones y enlaces de verdad; sirve en el celular.",
  },
  {
    clave: "diseno",
    nombre: "diseño",
    soloPantallas: true,
    criterios:
      "se ve como el resto de la app (los mismos componentes, colores, tamaños y espacios; nada de colores o CSS sueltos si ya hay uno del tema); nada se desborda en el celular; el texto se lee bien.",
  },
  {
    clave: "codigo",
    nombre: "código",
    criterios:
      "hace lo que pide el plan, sin errores (casos borde, un await que falta, errores tragados, ramas equivocadas); usa lo que ya existe en vez de duplicarlo; sigue el estilo del repo; tiene pruebas del cambio; si el plan trae CRITERIOS DE ACEPTACIÓN, CAMBIOS si alguno no se cumple o no tiene evidencia.",
  },
];

/** Las claves que acepta el commit de la nube en `revisor=` (con o sin tilde, en mayúsculas o no). */
export function revisorPorClave(texto) {
  const limpio = String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  return REVISORES.find((revisor) => revisor.clave === limpio || limpio.startsWith(revisor.clave)) ?? null;
}

/** ¿El cambio toca pantallas? (componentes, páginas, estilos). Si no, experiencia y diseño no aplican. */
export function tocaPantallas(archivos) {
  return (archivos ?? []).some((archivo) => /\.(?:tsx|jsx|css|scss|sass|less|html|vue|svelte)$/i.test(String(archivo)));
}

/** El diff para el prompt: entero si cabe; si no, el principio y una nota (el revisor lee el resto en los archivos). */
export function diffParaElRevisor(diff, max = LARGO_DEL_DIFF) {
  const texto = String(diff ?? "");
  if (texto.length <= max) return texto;
  return `${texto.slice(0, max)}\n[… el diff sigue (${texto.length - max} caracteres más): lee los archivos cambiados para ver el resto …]`;
}

/** Las reglas comunes de todos los revisores (las mismas en aizen1 y en la nube). */
const REGLAS_DEL_REVISOR =
  "Solo problemas REALES de este cambio y dentro del plan aprobado: nada de gustos, \"mejoras\" ni cosas fuera del plan, y nada que ya estaba mal antes y el cambio no empeora. No edites archivos.";
const FORMATO_DEL_REVISOR = `Contesta en la PRIMERA línea solo APROBADO o CAMBIOS. Si es CAMBIOS, debajo como mucho ${MAX_CAMBIOS} líneas "- <archivo>: <qué cambiar>", concretas.`;

/**
 * La instrucción de UN revisor en aizen1. `anterior`: lo que pidió en la vuelta anterior (para mirar si se corrigió).
 * Empieza con "Eres un REVISOR" (el claude falso de las pruebas lo reconoce así).
 */
export function promptDeRevisor(revisor, { tarjeta, repo, rama, diff, vuelta = 1, anterior = null, evidencia = [], contexto = "" }) {
  return [
    `Eres un REVISOR DE ${revisor.nombre.toUpperCase()} del Coordinador del Tablero IA de Magilus, en el repositorio "${repo.clave}" (rama ${rama}). Revisión, vuelta ${vuelta}.`,
    contexto || `Tarea: ${tarjeta.titulo}`,
    `PLAN APROBADO:\n${tarjeta.plan ?? "(sin plan)"}`,
    `Qué miras (${revisor.nombre}): ${revisor.criterios}`,
    REGLAS_DEL_REVISOR,
    evidencia.length ? `EVIDENCIA de los criterios de aceptación (la dejó quien construyó):\n${evidencia.join("\n")}` : "",
    anterior?.cambios?.length ? `En la vuelta anterior pediste esto; mira si quedó corregido:\n${anterior.cambios.map((cambio) => `- ${cambio}`).join("\n")}` : "",
    `EL CAMBIO (git diff contra main):\n${diffParaElRevisor(diff)}`,
    FORMATO_DEL_REVISOR,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Lo que contestó un revisor -> { estado: "APROBADO" | "CAMBIOS" | "sin respuesta", cambios: [...] }.
 * El veredicto es la primera línea que dice APROBADO o CAMBIOS (con o sin "VEREDICTO:", negritas o viñeta). Si no dice
 * ninguna de las dos, "sin respuesta" (no frena: lo dice el log y el resumen).
 */
export function veredictoDeLaRespuesta(texto) {
  const lineas = String(texto ?? "").split(/\r?\n/);
  const donde = lineas.findIndex((linea) => /^[\s>*_#-]*(?:VEREDICTO|VERDICT)?\s*:?\s*\**\s*(APROBADO|CAMBIOS)\b/i.test(linea));
  if (donde < 0) return { estado: "sin respuesta", cambios: [] };
  const estado = lineas[donde].match(/(APROBADO|CAMBIOS)/i)[1].toUpperCase();
  if (estado === "APROBADO") return { estado, cambios: [] };
  const cambios = lineas
    .slice(donde + 1)
    .map((linea) => linea.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
    .slice(0, MAX_CAMBIOS)
    .map((cambio) => cambio.replace(/\s+/g, " ").slice(0, 300));
  return { estado, cambios: cambios.length ? cambios : ["(no dijo qué cambiar)"] };
}

/**
 * La instrucción para el que construyó: corregir SOLO lo que pidieron los revisores. `pendientes`: [{ revisor, cambios }].
 * Lleva "CORRECCIÓN DE LA REVISIÓN" (el claude falso de las pruebas lo reconoce así) y la línea "Tarea:".
 */
export function promptDeCorregir({ tarjeta, repo, rama, pendientes, vuelta, de = VUELTAS_DE_CORRECCION, identidad = "", reglas = "" }) {
  return [
    `${identidad ? `${identidad} ` : ""}CORRECCIÓN DE LA REVISIÓN ${vuelta} de ${de}, en el repositorio "${repo.clave}" (worktree aparte, rama ${rama}). Tú construiste este cambio (está en los archivos, sin commit: míralo con git status y git diff) y los revisores pidieron cambios.`,
    `Tarea: ${tarjeta.titulo}`,
    `PLAN APROBADO:\n${tarjeta.plan ?? "(sin plan)"}`,
    `Lo que pidieron:\n${pendientes.map(({ revisor, cambios }) => `${revisor.nombre}:\n${cambios.map((cambio) => `- ${cambio}`).join("\n")}`).join("\n")}`,
    [
      "Reglas:",
      "- Corrige SOLO eso. No rehagas lo demás ni agregues cosas que el plan no pide. Si un pedido sale del plan o es un gusto, no lo hagas y dilo en tu resumen.",
      "- No hagas git push ni commit, no cambies de rama ni toques el remoto.",
      "- Haz todo tú, en primer plano: sin subagentes ni nada en segundo plano.",
      "- Al final corre `npx tsc --noEmit`, el lint de los archivos que cambiaste y las pruebas del módulo, y arregla lo que falle. NO corras `npm run build`.",
      reglas ? `- ${reglas}` : "",
      "- Termina con un resumen corto: qué corregiste.",
    ]
      .filter(Boolean)
      .join("\n"),
  ].join("\n\n");
}

/** "seguridad APROBADO · experiencia no aplica · código CAMBIOS (2)": cómo quedó cada revisor, en una línea. */
export function lineaDeEstados(informes) {
  return REVISORES.filter((revisor) => informes[revisor.clave])
    .map((revisor) => {
      const informe = informes[revisor.clave];
      return `${revisor.nombre} ${informe.estado}${informe.estado === "CAMBIOS" ? ` (${informe.cambios.length})` : ""}`;
    })
    .join(" · ");
}

/** El motivo de una revisión que no pasó: la 1ª línea es el titular que reconoce diagnostico.mjs ("La revisión no pasó…"). */
export function motivoDeRevisionQueNoPaso(pendientes, { vueltas = VUELTAS_DE_CORRECCION, link = null } = {}) {
  const [primero] = pendientes;
  const titular = `La revisión no pasó tras ${vueltas} vuelta${vueltas === 1 ? "" : "s"} de corrección: ${primero.revisor.nombre} pidió: ${primero.cambios[0] ?? "(sin detalle)"}`;
  return [
    titular,
    "Lo que siguen pidiendo los revisores:",
    ...pendientes.map(({ revisor, cambios }) => `${revisor.nombre}:\n${cambios.map((cambio) => `- ${cambio}`).join("\n")}`),
    link ? `Sesión de la nube: ${link}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * La revisión completa en aizen1 (pura: lo que corre procesos llega en las funciones).
 *   archivos   los archivos que cambió la tarea (para saber si toca pantallas)
 *   revisar    async (revisor, { vuelta, anterior }) -> texto de su respuesta. Si lanza un error con `limiteDeUso`, se
 *              propaga (la tarjeta se suelta sin error); cualquier otro error cuenta como "sin respuesta" (no frena).
 *   corregir   async (pendientes, vuelta) -> lo que contestó el que construyó
 *   registro   { info, aviso }
 *   alAvanzar  (opcional) ({ vuelta, revisores }) -> el progreso para el panel "Coordinador en vivo" (estadoParaElPanel)
 * -> { paso, informes, correcciones, pendientes, texto }
 *   `texto`: una línea para el resumen de la tarjeta.
 */
export async function revisarConCuatro({ archivos, revisar, corregir, registro = null, vueltas = VUELTAS_DE_CORRECCION, alAvanzar = null }) {
  const informes = {};
  const pantallas = tocaPantallas(archivos);
  for (const revisor of REVISORES) if (revisor.soloPantallas && !pantallas) informes[revisor.clave] = { estado: "no aplica", cambios: [] };
  let pendientes = REVISORES.filter((revisor) => !informes[revisor.clave]);
  let correcciones = 0;
  const avisar = (vuelta, revisando = []) => {
    try {
      alAvanzar?.({ vuelta, revisores: estadoParaElPanel(informes, revisando) });
    } catch {
      // El panel solo informa: nunca frena la revisión.
    }
  };
  for (let vuelta = 1; ; vuelta += 1) {
    avisar(vuelta, pendientes);
    const respuestas = await Promise.all(
      pendientes.map(async (revisor) => {
        try {
          return [revisor, veredictoDeLaRespuesta(await revisar(revisor, { vuelta, anterior: informes[revisor.clave] ?? null }))];
        } catch (error) {
          if (error?.limiteDeUso) throw error;
          registro?.aviso?.(`revisor de ${revisor.nombre} no respondió (no frena): ${String(error?.message ?? error).split("\n")[0]}`);
          return [revisor, { estado: "sin respuesta", cambios: [] }];
        }
      }),
    );
    for (const [revisor, informe] of respuestas) informes[revisor.clave] = informe;
    avisar(vuelta);
    registro?.info?.(`revisión vuelta ${vuelta}: ${lineaDeEstados(informes)}`);
    const conCambios = REVISORES.filter((revisor) => informes[revisor.clave]?.estado === "CAMBIOS").map((revisor) => ({ revisor, cambios: informes[revisor.clave].cambios }));
    if (!conCambios.length) {
      const texto = `Revisión (4 revisores): APROBADA${correcciones ? ` tras ${correcciones} corrección${correcciones === 1 ? "" : "es"}` : " a la primera"} — ${lineaDeEstados(informes)}.`;
      registro?.info?.(texto);
      return { paso: true, informes, correcciones, pendientes: [], texto };
    }
    if (correcciones >= vueltas) {
      const texto = `Revisión (4 revisores): NO PASÓ tras ${correcciones} correcciones — ${lineaDeEstados(informes)}.`;
      registro?.aviso?.(texto);
      return { paso: false, informes, correcciones, pendientes: conCambios, texto };
    }
    correcciones += 1;
    registro?.info?.(`corrijo lo que pidió la revisión (corrección ${correcciones} de ${vueltas}): ${conCambios.map(({ revisor, cambios }) => `${revisor.nombre}: ${cambios[0]}`).join(" | ").slice(0, 400)}`);
    await corregir(conCambios, correcciones);
    pendientes = conCambios.map(({ revisor }) => revisor);
  }
}

/**
 * La parte de la instrucción de la NUBE (un bloque, corto: la instrucción tiene tope). La sesión lanza los 4 revisores
 * como subagentes (seguridad en `modeloSeguridad`, Opus; los otros 3 en `modelo`, Sonnet) en primer plano, corrige ella
 * misma y deja el campo `revision=` en su commit "resultado:" (con FALLO, las 2 líneas para el dueño en el cuerpo).
 */
export function textoParaLaNube({ modelo = "sonnet", modeloSeguridad = "opus", vueltas = VUELTAS_DE_CORRECCION, rama = "<tu rama>" } = {}) {
  const modeloDe = (revisor) => (revisor.clave === "seguridad" ? modeloSeguridad : modelo);
  return [
    `REVISIÓN (obligatoria, cuando build y pruebas ya pasaron y ANTES del commit "resultado:"): lanza a la vez 4 subagentes (herramienta Agent o Task, cada uno con el model que dice abajo) y ESPERA aquí sus respuestas (en primer plano). Cada uno mira \`git diff origin/main...HEAD\` (y los archivos sin commit) contra el PLAN APROBADO. ${REGLAS_DEL_REVISOR} ${FORMATO_DEL_REVISOR}`,
    ...REVISORES.map((revisor) => `- ${revisor.clave} (model "${modeloDe(revisor)}"): ${revisor.criterios}`),
    'Si el cambio no toca pantallas (.tsx, .jsx, .css), NO lances experiencia ni diseno: cuentan como APROBADO ("no aplica").',
    `PROGRESO para el panel, al lanzar cada vuelta N y al tener sus veredictos: git commit --allow-empty -m "revision: R<N> seguridad=<OK|CAMBIOS|REVISANDO> experiencia=<…|NA> diseno=<…|NA> codigo=<…>" && git push origin ${rama}`,
    "Dales también tu evidencia de los CRITERIOS DE ACEPTACIÓN (si el plan los trae).",
    `Si alguno pide CAMBIOS: corrígelo TÚ, vuelve a correr build y pruebas, y lanza otra vez solo a los que pidieron cambios, con lo que pidió cada uno para que compruebe que se arregló. Máximo ${vueltas} correcciones.`,
    `Al final de la 1ª línea del commit "resultado:" agrega revision=OK; o, si tras ${vueltas} correcciones alguno sigue en CAMBIOS, revision=FALLO revisor=<seguridad|experiencia|diseno|codigo> motivo=<lo que pide, en una línea>. En el CUERPO del commit, una línea por revisor: "<revisor>: <APROBADO|CAMBIOS|no aplica> — <lo que pidió>".`,
    `Con revision=FALLO, al final del CUERPO 2 líneas para el dueño, en español sencillo: "${MARCA_DUENO_1} <por qué se paró: qué revisor no aprobó y qué pidió, en concreto>" y "${MARCA_DUENO_2} <la decisión que necesita, como pregunta cerrada con opciones, p. ej. ${PREGUNTA_POR_DEFECTO}>".`,
  ].join("\n");
}

/* ── Las 2 líneas para el dueño cuando la revisión no pasa (29-oct-2026) ── */

export const MARCA_DUENO_1 = "DUEÑO 1:";
export const MARCA_DUENO_2 = "DUEÑO 2:";
/** La pregunta cerrada por defecto (la decisión que necesita del dueño). */
export const PREGUNTA_POR_DEFECTO = "¿Lo subo así, lo corrijo con tu indicación o lo cierro?";
const LARGO_DE_LA_LINEA = 280;

/** ¿Son 2 líneas con la forma pedida? La 1ª dice por qué se paró; la 2ª es una pregunta cerrada (¿…?) con opciones (" o "). */
export function sonDosLineasParaElDueno(lineas) {
  if (!Array.isArray(lineas) || lineas.length !== 2) return false;
  const [porque, pregunta] = lineas.map((linea) => String(linea ?? "").trim());
  return porque.length >= 15 && !porque.includes("\n") && /^¿[^\n]+\?$/.test(pregunta) && /\so\s/.test(pregunta);
}

const unaLinea = (texto) => {
  const limpio = String(texto ?? "").replace(/\s+/g, " ").trim();
  return limpio.length > LARGO_DE_LA_LINEA ? `${limpio.slice(0, LARGO_DE_LA_LINEA - 1)}…` : limpio;
};

/**
 * Las 2 líneas que armó el Coordinador con el informe de los revisores (cuando la sesión no las dejó).
 * `pendientes`: [{ revisor, cambios }] (los que siguen pidiendo cambios).
 */
export function dosLineasDelCoordinador(pendientes) {
  const [primero, ...otros] = pendientes ?? [];
  const nombre = primero?.revisor?.nombre ?? "un revisor";
  const pedido = (primero?.cambios ?? []).slice(0, 2).join("; ") || "cambios que no dijo";
  const mas = otros.length ? ` (también ${otros.map((otro) => otro.revisor?.nombre ?? "otro").join(" y ")})` : "";
  return [unaLinea(`Se paró porque el revisor de ${nombre}${mas} no aprobó tras 2 correcciones: pide ${pedido.replace(/[.\s]+$/, "")}.`), PREGUNTA_POR_DEFECTO];
}

/** Las 2 líneas que dejó la sesión en el cuerpo del commit ("DUEÑO 1: …" / "DUEÑO 2: …"), o null si no las dejó bien. */
export function dosLineasDeLaSesion(cuerpo) {
  const buscar = (marca) => {
    const linea = String(cuerpo ?? "")
      .split(/\r?\n/)
      .find((texto) => texto.trim().toUpperCase().startsWith(marca.toUpperCase()));
    return linea ? unaLinea(linea.trim().slice(marca.length)) : "";
  };
  const lineas = [buscar(MARCA_DUENO_1), buscar(MARCA_DUENO_2)];
  return sonDosLineasParaElDueno(lineas) ? lineas : null;
}

/* ── El progreso para el panel "Coordinador en vivo" (29-oct-2026) ── */

/** Los estados que ve el panel por revisor: revisando (gris), aprobado (verde), cambios (rojo), no_aplica. */
export const ESTADOS_DEL_PANEL = ["revisando", "aprobado", "cambios", "no_aplica"];

/** De un informe ("APROBADO", "CAMBIOS", "no aplica", "sin respuesta") al estado del panel. */
function estadoDelPanel(informe) {
  if (!informe) return "revisando";
  if (informe.estado === "CAMBIOS") return "cambios";
  if (informe.estado === "no aplica") return "no_aplica";
  return "aprobado";
}

/** { seguridad, experiencia, diseno, codigo } con el estado de cada uno; los de `revisando` (revisores) van en "revisando". */
export function estadoParaElPanel(informes, revisando = []) {
  const ahora = new Set(revisando.map((revisor) => revisor.clave));
  return Object.fromEntries(REVISORES.map((revisor) => [revisor.clave, ahora.has(revisor.clave) ? "revisando" : estadoDelPanel(informes[revisor.clave])]));
}

/** Un valor del commit de progreso ("OK", "CAMBIOS", "NA", "REVISANDO"…) al estado del panel; null si no se entiende. */
function valorDelProgreso(texto) {
  const valor = String(texto ?? "").toUpperCase().replace(/[^A-Z_]/g, "");
  if (["OK", "APROBADO", "PASS"].includes(valor)) return "aprobado";
  if (["CAMBIOS", "CHANGES", "FALLO"].includes(valor)) return "cambios";
  if (["NA", "NOAPLICA", "NO_APLICA"].includes(valor)) return "no_aplica";
  if (["REVISANDO", "PENDIENTE", "..."].includes(valor) || valor === "") return "revisando";
  return null;
}

/**
 * El commit de PROGRESO que deja la nube en cada vuelta: "revision: R1 seguridad=OK ux=CAMBIOS diseno=NA codigo=REVISANDO".
 * -> { vuelta, revisores: { seguridad, experiencia, diseno, codigo } } (los que no nombra quedan "revisando"), o null si el
 * commit no es de progreso. "ux" vale por experiencia y "ui" por diseño. Un commit "resultado: … revision=OK" NO es progreso.
 */
export function progresoDelCommit(mensaje) {
  const primera = String(mensaje ?? "").split(/\r?\n/)[0].trim();
  const coincide = primera.match(/^revisi[oó]n:\s*R?(\d+)\b(.*)$/i);
  if (!coincide) return null;
  const revisores = Object.fromEntries(REVISORES.map((revisor) => [revisor.clave, "revisando"]));
  for (const [, nombre, valor] of coincide[2].matchAll(/(\p{L}+)\s*=\s*([^\s,;]+)/gu)) {
    const alias = { ux: "experiencia", ui: "diseno" }[nombre.toLowerCase()];
    const revisor = alias ? REVISORES.find((r) => r.clave === alias) : revisorPorClave(nombre);
    const estado = valorDelProgreso(valor);
    if (revisor && estado) revisores[revisor.clave] = estado;
  }
  return { vuelta: Math.max(1, Math.min(9, Number(coincide[1]))), revisores };
}
