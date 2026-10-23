// Las tres etapas del trabajador: PLANEAR, CONSTRUIR y SUBIR. Cada una trabaja en un worktree
// temporal (carpetaTrabajo/wt/...), nunca en la copia del repo, y lo borra al terminar.
//
// - planear:   worktree desde origin/main; `claude -p --permission-mode plan` escribe el plan. -> /plan
// - construir: worktree en la rama tablero/<id>-<slug> desde origin/main; Claude edita (acceptEdits y
//              herramientas acotadas, sin push); el TRABAJADOR (no Claude) hace commit, marca las zonas
//              protegidas que toca (chats, agentes, libro V3, Meta Ads), corre la verificación y las
//              pruebas él mismo, compara el lint con el de main, ensaya la migración (PGlite + producción
//              en BEGIN…ROLLBACK) y empuja SOLO la rama. -> /resultado, que dice si sube sola (subirSolo
//              del repo y sin zonas: el CRM la pasa a SUBIENDO) o espera el sí del dueño (POR_REVISAR).
// - subir:     rebase de la rama sobre origin/main; si main no cambió desde que se construyó no vuelve
//              a compilar, si cambió verifica y ensaya de nuevo; push a main, espera el CI y comprueba
//              la versión. Si el despliegue falla, revert del commit en main (sin --force). -> /subida
// Si algo falla se lanza ErrorDeEtapa con el motivo en palabras sencillas y el detalle técnico debajo
// (y la reversión, si la hubo): el bucle llama /error.
import fs from "node:fs";
import path from "node:path";

import { ensayarMigraciones, migracionesNuevas } from "./ensayo.mjs";
import {
  archivosCambiados,
  crearWorktree,
  esRamaDelTrabajador,
  git,
  idCorto,
  nombreDeRama,
  pushARamaBase,
  pushDeRama,
  quitarWorktree,
  revertirEnRamaBase,
  urlDelRemoto,
  webDeGithub,
} from "./git.mjs";
import { comoTexto, correr, ultimasLineas } from "./procesos.mjs";
import { zonasTocadas } from "./zonas.mjs";

export class ErrorDeEtapa extends Error {
  constructor(message, { zonas = [], reversion = null, limiteDeUso = false } = {}) {
    super(message);
    this.zonas = zonas;
    this.reversion = reversion;
    // Claude llegó al límite de uso del plan: no es ERROR de la tarjeta, se suelta y se reintenta después.
    this.limiteDeUso = limiteDeUso;
  }
}

/** Lo que dice `claude -p` cuando la suscripción llegó a su límite de uso ("Claude AI usage limit reached|…", "You've hit your session limit · resets 1:20am": 23-10-2026 este no lo reconocía y marcó 3 tarjetas en ERROR). */
const LIMITE_DE_USO = /usage limit|limit reached|hit your (?:\w+ )?limit|session limit|weekly limit|limit · resets|rate[ _-]?limit|overloaded_error|out of (extra )?usage|límite de uso/i;

export function esLimiteDeUso(texto) {
  return LIMITE_DE_USO.test(String(texto ?? ""));
}

const MINUTO = 60_000;

/** El entorno de los comandos: sin acceso a ninguna base real (DATABASE_URL apunta a nada). */
export function entornoSeguro() {
  return {
    ...process.env,
    DATABASE_URL: "postgresql://trabajador:no-usar@127.0.0.1:1/no_usar",
    DIRECT_URL: "postgresql://trabajador:no-usar@127.0.0.1:1/no_usar",
  };
}

/** Un reloj de la etapa: cuánto le queda y un error claro si ya no queda. */
function relojDeEtapa(minutos, nombre) {
  const limite = Date.now() + minutos * MINUTO;
  return {
    resta() {
      const queda = limite - Date.now();
      if (queda <= 0) throw new ErrorDeEtapa(`Se pasó del tiempo de ${nombre} (${minutos} min).`);
      return queda;
    },
  };
}

function configDelRepo(contexto, tarjeta) {
  const repo = contexto.config.repos[tarjeta.repo];
  if (!repo) throw new ErrorDeEtapa(`El repo "${tarjeta.repo}" no está configurado en este PC (config.local.json -> repos).`);
  if (!fs.existsSync(repo.ruta)) throw new ErrorDeEtapa(`No existe la carpeta del repo ${tarjeta.repo}: ${repo.ruta}.`);
  return repo;
}

const carpetaDe = (contexto, tarjeta, etapa) => path.join(contexto.config.carpetaTrabajo, "wt", `${idCorto(tarjeta.id)}-${etapa}`);

/**
 * Corre un comando de la etapa; si falla, ErrorDeEtapa con `motivo` (en palabras sencillas, para el
 * dueño) y debajo el detalle técnico (el comando y lo último que dijo).
 */
async function paso(contexto, comando, { cwd, reloj, que, motivo, entrada }) {
  const { config, senal } = contexto;
  const timeoutMs = Math.min(reloj.resta(), config.tiempos.comandoMinutos * MINUTO);
  const resultado = await correr(comando, { cwd, env: entornoSeguro(), senal, timeoutMs, entrada });
  if (resultado.cancelado) throw new ErrorDeEtapa(`Se canceló ${que}: la tarjeta venció en el CRM.`);
  if (resultado.vencido) throw new ErrorDeEtapa(`${motivo ?? `Falló ${que}`}: se pasó del tiempo (${comoTexto(comando)}).`);
  if (resultado.codigo !== 0) {
    throw new ErrorDeEtapa(
      `${motivo ?? `Falló ${que}`}. No se subió nada.\nDetalle técnico (${comoTexto(comando)}):\n${ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 30)}`,
    );
  }
  return resultado;
}

/** Por qué falló un comando de verificación, en palabras sencillas. */
function motivoDeVerificacion(comando, esPrueba) {
  if (esPrueba) return "Fallaron las pruebas que ya existen";
  const texto = comoTexto(comando);
  if (/\btsc\b/.test(texto)) return "No compiló: el código tiene errores de tipos (TypeScript)";
  if (/\bbuild\b/.test(texto)) return "No compiló: falló el build";
  if (/prisma\s+generate/.test(texto)) return "No compiló: el esquema de la base (Prisma) tiene un error";
  return "No pasó la verificación";
}

/** Correr Claude con el prompt por stdin. Devuelve lo que contestó. */
async function claude(contexto, argumentos, prompt, { cwd, timeoutMs, que }) {
  const { config, senal } = contexto;
  const comando = [...config.comandoClaude, ...argumentos];
  const resultado = await correr(comando, { cwd, entrada: prompt, timeoutMs, senal, env: entornoSeguro() });
  if (resultado.cancelado) throw new ErrorDeEtapa(`Se canceló Claude (${que}): la tarjeta venció en el CRM.`);
  if (resultado.vencido) throw new ErrorDeEtapa(`Claude tardó más de ${Math.round(timeoutMs / MINUTO)} min en ${que}: se cortó.`);
  const cola = ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 20);
  if (resultado.codigo !== 0) {
    throw new ErrorDeEtapa(`Claude falló al ${que} (código ${resultado.codigo}):\n${cola}`, { limiteDeUso: esLimiteDeUso(cola) });
  }
  const texto = resultado.salida.trim();
  if (!texto) throw new ErrorDeEtapa(`Claude no contestó nada al ${que}.`);
  // A veces sale con código 0 y solo el aviso del límite (un texto corto, no un plan ni un resumen).
  if (texto.length < 300 && esLimiteDeUso(texto)) throw new ErrorDeEtapa(`Claude llegó a su límite de uso al ${que}: ${texto}`, { limiteDeUso: true });
  return texto;
}

const MOTIVO_ENSAYO = "El ensayo de la migración falló: la migración no corre bien en la base. No se subió nada.";

const REGLAS_DE_ZONAS =
  "No toques Meta Ads (anuncios, campañas, píxel), el bot de ventas (el agente que atiende WhatsApp) ni el libro del agente V3.";

/** Subagentes (22-oct-2026): más rápido y mejor revisado. Los subagentes siguen las mismas reglas. */
const SUBAGENTES_AL_PLANEAR =
  "Usa subagentes (herramienta Agent) para investigar el código en paralelo: por ejemplo uno que encuentre dónde vive lo que hay que cambiar y otro que busque las pruebas y los usos que se pueden romper. Ellos tampoco cambian archivos.";
const SUBAGENTES_AL_CONSTRUIR = [
  "- Usa subagentes (herramienta Agent), con las mismas reglas de acá:",
  "  · antes de editar, uno o más para investigar el código que toca el plan;",
  "  · uno para escribir o completar las pruebas del cambio;",
  "  · al terminar, uno que REVISE el cambio completo (git diff) buscando errores, casos que faltan y reglas rotas; arregla lo que encuentre antes de entregar.",
].join("\n");

function contextoDeLaTarjeta(tarjeta) {
  const error = tarjeta.resultado?.error?.motivo;
  return [
    `Tarea: ${tarjeta.titulo}`,
    `Tablero: ${tarjeta.tablero}`,
    `Detalle:\n${tarjeta.detalle || "(sin detalle)"}`,
    tarjeta.intentos > 1 ? `Es el intento ${tarjeta.intentos}.${error ? ` El anterior falló así:\n${error}` : ""}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function promptDelPlan(tarjeta, repo) {
  return [
    `Eres el trabajador del Tablero IA de Magilus. Tienes que escribir un PLAN para esta tarea del repositorio "${repo.clave}". Estás en modo plan: NO cambies ningún archivo, solo lee el código y planea.`,
    contextoDeLaTarjeta(tarjeta),
    [
      "Escribe el plan en español sencillo, para el dueño del negocio (no es programador), con estas partes:",
      "1. Qué se cambia.",
      "2. Qué efecto tiene (para el negocio, las asesoras o los clientes).",
      "3. Riesgos.",
      "4. Migración de base de datos: sí o no. Si sí, cuál (solo aditiva y escrita a mano).",
      "5. Archivos que se tocan.",
      "6. Cómo se va a probar.",
    ].join("\n"),
    `Reglas: ${REGLAS_DE_ZONAS} Si la tarea lo requiere, dilo claro al principio del plan: "TOCA ZONA PROTEGIDA: <cuál y por qué>".`,
    SUBAGENTES_AL_PLANEAR,
    "En la parte 5 escribe cada archivo con su ruta completa desde la raíz del repo (por ejemplo src/features/coach/servicio.ts): el trabajador la usa para no construir a la vez dos tareas que tocan lo mismo.",
    fraseAlTerminar(repo),
    "Contesta SOLO con el plan.",
  ].join("\n\n");
}

/** Lo que el plan tiene que decir al principio: si al terminar sube solo o espera el sí del dueño. */
function fraseAlTerminar(repo) {
  if (!repo.subirSolo) {
    return 'Al principio del plan escribe esta frase: "Al terminar: espera tu sí" (en este repositorio el trabajador todavía no sube solo a producción).';
  }
  const rutas = Object.entries(repo.zonasProtegidas ?? {})
    .map(([zona, globs]) => `${zona}: ${(globs ?? []).join(", ")}`)
    .join("\n");
  return [
    "Al principio del plan escribe UNA de estas dos frases:",
    '- "Al terminar: sube solo a producción" si el cambio NO toca ninguna de las rutas de abajo.',
    '- "Al terminar: espera tu sí (toca chats / agentes / Meta Ads)" si toca alguna (di cuál). Esos cambios se construyen y prueban igual, pero no suben sin el sí del dueño.',
    `Las rutas de chats, agentes, libro V3 y Meta Ads:\n${rutas || "(ninguna configurada)"}`,
  ].join("\n");
}

export function promptDeConstruir(tarjeta, repo, rama) {
  const aprobadas = tarjeta.zonasAprobadas?.length ? tarjeta.zonasAprobadas.join(", ") : "ninguna";
  return [
    `Eres el trabajador del Tablero IA de Magilus. Implementa EXACTAMENTE el plan que aprobó el dueño, en este repositorio ("${repo.clave}"). Estás en un worktree aparte, en la rama ${rama}.`,
    contextoDeLaTarjeta(tarjeta),
    `PLAN APROBADO:\n${tarjeta.plan}`,
    [
      "Reglas:",
      "- No hagas git push ni commit, no cambies de rama ni toques el remoto: el trabajador hace el commit y sube la rama él mismo.",
      "- Migraciones: solo aditivas, escritas a mano (una carpeta nueva en prisma/migrations con su migration.sql, con BEGIN/COMMIT y guardas IF NOT EXISTS). NUNCA prisma migrate dev, migrate deploy, db push ni nada contra una base de datos.",
      `- ${REGLAS_DE_ZONAS} Zonas protegidas aprobadas por el dueño para esta tarea: ${aprobadas}.`,
      "- Respeta el estilo del repo y escribe los comentarios en español.",
      SUBAGENTES_AL_CONSTRUIR,
      "- Al final corre tsc, lint (sin errores nuevos), build y las pruebas que correspondan, y arregla lo que falle.",
      "- Termina con un RESUMEN corto en español sencillo: qué cambiaste, qué archivos y cómo lo probaste.",
    ].join("\n"),
  ].join("\n\n");
}

/** Los errores de lint (no avisos) como firmas "archivo|regla|mensaje", contados. */
async function erroresDeLint(contexto, repo, cwd, reloj) {
  const timeoutMs = Math.min(reloj.resta(), contexto.config.tiempos.comandoMinutos * MINUTO);
  const resultado = await correr(repo.lint.comando, { cwd, env: entornoSeguro(), senal: contexto.senal, timeoutMs });
  if (resultado.vencido || resultado.cancelado) throw new ErrorDeEtapa(`El lint (${comoTexto(repo.lint.comando)}) se pasó del tiempo. No se subió nada.`);
  let datos;
  try {
    datos = JSON.parse(resultado.salida.slice(resultado.salida.indexOf("[")));
  } catch {
    throw new ErrorDeEtapa(`El lint no devolvió JSON (${comoTexto(repo.lint.comando)}):\n${ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 20)}`);
  }
  const cuenta = new Map();
  for (const archivo of datos) {
    const relativo = path.relative(cwd, archivo.filePath ?? "").replace(/\\/g, "/");
    for (const mensaje of archivo.messages ?? []) {
      if (mensaje.severity !== 2) continue;
      const firma = `${relativo}|${mensaje.ruleId ?? "?"}|${mensaje.message}`;
      cuenta.set(firma, (cuenta.get(firma) ?? 0) + 1);
    }
  }
  return cuenta;
}

function erroresNuevos(base, despues) {
  const nuevos = [];
  for (const [firma, veces] of despues) if (veces > (base.get(firma) ?? 0)) nuevos.push(firma);
  return nuevos;
}

/** Instalar + verificar + pruebas en el worktree. Devuelve el texto de "pruebas" para el resultado. */
async function verificar(contexto, repo, cwd, reloj) {
  const lineas = [];
  const comandos = [...repo.verificar.map((comando) => [comando, false]), ...repo.pruebas.map((comando) => [comando, true])];
  for (const [comando, esPrueba] of comandos) {
    const resultado = await paso(contexto, comando, { cwd, reloj, que: "la verificación", motivo: motivoDeVerificacion(comando, esPrueba) });
    const cola = ultimasLineas(resultado.salida, 3);
    lineas.push(`✔ ${comoTexto(comando)}${cola ? `\n  ${cola.replace(/\n/g, "\n  ")}` : ""}`);
  }
  return lineas;
}

/** PLANEANDO -> el texto del plan. */
export async function planear(contexto, tarjeta) {
  const repo = configDelRepo(contexto, tarjeta);
  const reloj = relojDeEtapa(contexto.config.tiempos.planMinutos, "escribir el plan");
  const carpeta = carpetaDe(contexto, tarjeta, "plan");
  await git(repo.ruta, ["fetch", repo.remoto]);
  try {
    await crearWorktree(repo, carpeta, `${repo.remoto}/${repo.ramaBase}`, null);
    const plan = await claude(contexto, ["-p", "--permission-mode", "plan", "--output-format", "text"], promptDelPlan(tarjeta, repo), {
      cwd: carpeta,
      timeoutMs: reloj.resta(),
      que: "escribir el plan",
    });
    return { plan };
  } finally {
    await quitarWorktree(repo, carpeta);
  }
}

/** EN_CURSO -> el resultado (rama empujada, todo verificado). */
export async function construir(contexto, tarjeta) {
  const { config, registro } = contexto;
  if (!tarjeta.plan) throw new ErrorDeEtapa("La tarjeta no tiene plan aprobado.");
  const repo = configDelRepo(contexto, tarjeta);
  const reloj = relojDeEtapa(config.tiempos.construirMinutos, "construir");
  const rama = nombreDeRama(tarjeta);
  const base = `${repo.remoto}/${repo.ramaBase}`;
  const carpeta = carpetaDe(contexto, tarjeta, "construir");
  await git(repo.ruta, ["fetch", repo.remoto]);
  try {
    await crearWorktree(repo, carpeta, base, rama);
    const baseSha = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
    if (repo.instalar) await paso(contexto, repo.instalar, { cwd: carpeta, reloj, que: "instalar dependencias", motivo: "No se pudieron instalar las dependencias" });
    // El lint de main, para que solo cuenten los errores NUEVOS.
    const lintBase = repo.lint ? await erroresDeLint(contexto, repo, carpeta, reloj) : null;

    const resumenDeClaude = await claude(
      contexto,
      [
        "-p",
        "--permission-mode",
        "acceptEdits",
        "--output-format",
        "text",
        "--allowedTools",
        ...config.herramientasPermitidas,
        "--disallowedTools",
        ...config.herramientasProhibidas,
      ],
      promptDeConstruir(tarjeta, repo, rama),
      { cwd: carpeta, timeoutMs: reloj.resta(), que: "construir" },
    );

    // El commit lo hace el trabajador (si Claude hizo alguno, queda debajo).
    await git(carpeta, ["add", "-A"]);
    const pendiente = await git(carpeta, ["diff", "--cached", "--quiet"], { permitirFallo: true });
    if (pendiente.codigo !== 0) {
      await git(carpeta, ["commit", "-m", `tablero: ${tarjeta.titulo} (${idCorto(tarjeta.id)})`, "-m", `Tarjeta del Tablero IA: ${tarjeta.link}`], {
        identidad: config.git,
      });
    }
    const cambios = await archivosCambiados(carpeta, base);
    if (!cambios.length) throw new ErrorDeEtapa("Claude no cambió ningún archivo.");
    const archivos = cambios.map((cambio) => cambio.archivo);

    // Zonas protegidas (chats, agentes, libro V3, Meta Ads): ya no es ERROR. Se construye y prueba igual,
    // pero no sube sola: el CRM la deja POR_REVISAR con la zona marcada, esperando el sí del dueño.
    const tocadas = zonasTocadas(archivos, repo.zonasProtegidas);
    const zonas = Object.keys(tocadas);
    const subeSolo = repo.subirSolo === true && zonas.length === 0 && !(tarjeta.zonasAprobadas ?? []).length;
    const zonasTexto = zonas.map((zona) => `${zona} (${tocadas[zona].slice(0, 5).join(", ")}${tocadas[zona].length > 5 ? "…" : ""})`).join("; ");

    const pruebas = await verificar(contexto, repo, carpeta, reloj);
    if (lintBase) {
      const nuevos = erroresNuevos(lintBase, await erroresDeLint(contexto, repo, carpeta, reloj));
      if (nuevos.length) throw new ErrorDeEtapa(`El lint tiene ${nuevos.length} error(es) nuevo(s):\n${nuevos.slice(0, 15).join("\n")}\nNo se subió nada.`);
      pruebas.push("✔ lint sin errores nuevos");
    }
    const migraciones = migracionesNuevas(cambios, repo.carpetaMigraciones);
    let migracion = null;
    try {
      migracion = await ensayarMigraciones({
        migraciones,
        repo,
        ssh: config.ssh,
        cwd: carpeta,
        env: entornoSeguro(),
        senal: contexto.senal,
        timeoutMs: Math.min(reloj.resta(), config.tiempos.comandoMinutos * MINUTO),
      });
    } catch (error) {
      throw new ErrorDeEtapa(`${MOTIVO_ENSAYO}\nDetalle técnico: ${error.message}`);
    }
    if (migracion) pruebas.push(`✔ ensayo de la migración: ${migracion}`);
    const alTerminar = subeSolo
      ? "construido, sube solo"
      : zonas.length
        ? `construido, espera tu sí (zona ${zonasTexto})`
        : "construido, espera tu sí (en este repositorio el trabajador todavía no sube solo)";
    pruebas.push(`→ ${alTerminar}`);

    reloj.resta();
    await pushDeRama(carpeta, repo.remoto, rama);
    const commit = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
    const web = webDeGithub(await urlDelRemoto(repo));
    registro.info(`rama ${rama} empujada (${commit.slice(0, 10)}): ${alTerminar}`);
    return {
      resumen: `${resumenDeClaude.slice(-4000)}\n\nArchivos (${archivos.length}): ${archivos.slice(0, 40).join(", ")}${archivos.length > 40 ? "…" : ""}\n\nAl terminar: ${alTerminar}.`,
      pruebas: pruebas.join("\n").slice(0, 7000),
      paso: true,
      rama,
      linkRama: web ? `${web}/compare/${repo.ramaBase}...${encodeURIComponent(rama).replace(/%2F/g, "/")}` : null,
      commit,
      migracion,
      subeSolo,
      base: baseSha,
      ...(zonas.length ? { zonaProtegida: zonas } : {}),
    };
  } finally {
    await quitarWorktree(repo, carpeta, rama);
  }
}

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** Reemplaza {commit} y {run} en un comando de la configuración. */
const conValores = (comando, valores) => comando.map((parte) => parte.replace(/\{(\w+)\}/g, (todo, clave) => valores[clave] ?? todo));

/**
 * Espera el CI del commit (si está configurado): busca la corrida y la mira hasta que termine.
 * Solo lanza si el CI corrió y FALLÓ. Si no se pudo consultar GitHub (gh sin sesión, que pasa cuando el
 * trabajador corre como tarea programada, o la corrida no aparece) devuelve el motivo y sigue: la prueba
 * de verdad es que /api/version diga el commit nuevo (22-10-2026: por esto se deshizo un cambio bueno).
 */
async function esperarCi(contexto, repo, commit, cwd, reloj) {
  const { ciBuscar, ciEsperar, ciMinutos } = repo.subida;
  if (!ciBuscar || !ciEsperar) return "CI: no configurado";
  const limite = Date.now() + Math.min(ciMinutos * MINUTO, reloj.resta());
  let corrida = "";
  while (!corrida) {
    const resultado = await correr(conValores(ciBuscar, { commit }), { cwd, timeoutMs: 60_000, senal: contexto.senal });
    if (resultado.cancelado) throw new ErrorDeEtapa("Se canceló la espera del CI: la tarjeta venció en el CRM.");
    if (resultado.codigo !== 0 && /gh auth login|GH_TOKEN|authentication/i.test(resultado.errores)) {
      return "CI: no se pudo consultar (gh sin sesión en este PC; poner GH_TOKEN)";
    }
    corrida = resultado.codigo === 0 ? resultado.salida.trim().split(/\s+/)[0] ?? "" : "";
    if (corrida) break;
    if (Date.now() > limite) return `CI: no apareció la corrida de ${commit.slice(0, 10)} (se revisa la versión)`;
    await dormir(10_000);
  }
  const resultado = await correr(conValores(ciEsperar, { commit, run: corrida }), {
    cwd,
    timeoutMs: Math.max(1, limite - Date.now()),
    senal: contexto.senal,
  });
  if (resultado.codigo !== 0) {
    throw new ErrorDeEtapa(
      `Subió a ${repo.ramaBase} (commit ${commit.slice(0, 10)}) pero el CI ${resultado.vencido ? "se pasó del tiempo" : "falló"}: ${ultimasLineas(
        `${resultado.errores}\n${resultado.salida}`,
        20,
      )}`,
    );
  }
  return `CI ${corrida}: ok`;
}

/** ¿`version` (lo que dice /api/version) es el commit subido o uno más nuevo que ya lo incluye? */
async function versionIncluye(repo, version, commit) {
  if (!version) return false;
  if (version === commit || commit.startsWith(version) || version.startsWith(commit)) return true;
  // Otro push llegó justo después y quedó en producción: si ese commit contiene el nuestro, también arrancó.
  await git(repo.ruta, ["fetch", repo.remoto], { permitirFallo: true });
  const ancestro = await git(repo.ruta, ["merge-base", "--is-ancestor", commit, version], { permitirFallo: true });
  return ancestro.codigo === 0;
}

/** Espera que la URL de versión diga el commit nuevo, o uno posterior que lo incluya (= arrancó la versión nueva). */
async function esperarVersion(contexto, repo, commit, reloj) {
  const { urlVersion, campoVersion, versionMinutos, urlArranque } = repo.subida;
  if (!urlVersion) return { version: null, texto: "versión: no configurada" };
  const limite = Date.now() + Math.min(versionMinutos * MINUTO, reloj.resta());
  let ultima = "";
  for (;;) {
    try {
      const respuesta = await fetch(urlVersion, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(15_000) });
      const datos = await respuesta.json();
      ultima = String(datos?.[campoVersion] ?? "");
      if (await versionIncluye(repo, ultima, commit)) break;
    } catch {
      // El servidor puede estar reiniciando: se vuelve a preguntar.
    }
    if (Date.now() > limite) {
      throw new ErrorDeEtapa(
        `Subió a ${repo.ramaBase} y el CI pasó, pero ${urlVersion} sigue diciendo "${ultima || "nada"}" en vez de ${commit.slice(0, 10)}: la versión nueva no arrancó.`,
      );
    }
    await dormir(10_000);
  }
  if (urlArranque) {
    const respuesta = await fetch(urlArranque, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!respuesta || respuesta.status >= 500) {
      throw new ErrorDeEtapa(`La versión nueva arrancó pero ${urlArranque} contesta ${respuesta?.status ?? "nada"}.`);
    }
  }
  return { version: ultima, texto: `versión ${ultima.slice(0, 10)}: ok` };
}

/**
 * SUBIENDO -> sube a main. Llega acá sola (construir pasó todo, subirSolo y sin zona protegida) o con
 * el sí final del dueño (las de zona protegida y las que ya estaban POR_REVISAR).
 */
export async function subir(contexto, tarjeta) {
  const { config, registro } = contexto;
  const repo = configDelRepo(contexto, tarjeta);
  const reloj = relojDeEtapa(config.tiempos.subirMinutos, "subir");
  const rama = tarjeta.resultado?.rama;
  if (!esRamaDelTrabajador(rama)) throw new ErrorDeEtapa(`La tarjeta no tiene una rama del trabajador para subir (rama: ${rama ?? "ninguna"}).`);
  if (tarjeta.resultado?.paso !== true) throw new ErrorDeEtapa("El resultado no dice que todo pasó: no se sube.");
  const base = `${repo.remoto}/${repo.ramaBase}`;
  const carpeta = carpetaDe(contexto, tarjeta, "subir");
  const ramaLocal = `subida/${idCorto(tarjeta.id)}`;
  await git(repo.ruta, ["fetch", repo.remoto]);
  try {
    await crearWorktree(repo, carpeta, `${repo.remoto}/${rama}`, ramaLocal);
    const antes = (await git(carpeta, ["rev-parse", base])).salida.trim();
    const cabeza = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
    // Si main sigue donde estaba al construir y la rama es la que se probó, ya está todo verificado.
    const mainIgual = Boolean(tarjeta.resultado?.base) && tarjeta.resultado.base === antes && tarjeta.resultado?.commit === cabeza;
    const rebase = await git(carpeta, ["rebase", base], { identidad: config.git, permitirFallo: true });
    if (rebase.codigo !== 0) {
      await git(carpeta, ["rebase", "--abort"], { permitirFallo: true });
      throw new ErrorDeEtapa(
        `Choca con lo nuevo de ${repo.ramaBase}: alguien cambió los mismos archivos mientras se construía (conflicto en el rebase de ${rama}). No se subió nada; hay que reintentar (construir de nuevo).`,
      );
    }
    let pruebas;
    if (mainIgual) {
      pruebas = [`✔ ${repo.ramaBase} no cambió desde que se construyó: no se vuelve a compilar`];
    } else {
      if (repo.instalar) await paso(contexto, repo.instalar, { cwd: carpeta, reloj, que: "instalar dependencias", motivo: "No se pudieron instalar las dependencias" });
      pruebas = await verificar(contexto, repo, carpeta, reloj);
      const cambios = await archivosCambiados(carpeta, base);
      const migraciones = migracionesNuevas(cambios, repo.carpetaMigraciones);
      try {
        const migracion = await ensayarMigraciones({
          migraciones,
          repo,
          ssh: config.ssh,
          cwd: carpeta,
          env: entornoSeguro(),
          senal: contexto.senal,
          timeoutMs: Math.min(reloj.resta(), config.tiempos.comandoMinutos * MINUTO),
        });
        if (migracion) pruebas.push(`✔ ensayo de la migración: ${migracion}`);
      } catch (error) {
        throw new ErrorDeEtapa(`${MOTIVO_ENSAYO}\nDetalle técnico: ${error.message}`);
      }
    }

    reloj.resta();
    const commit = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
    try {
      await pushARamaBase(carpeta, repo.remoto, repo.ramaBase);
    } catch (error) {
      throw new ErrorDeEtapa(`No se pudo subir a ${repo.ramaBase} (¿cambió mientras tanto?). No se subió nada.\nDetalle técnico: ${error.message}`);
    }
    registro.info(`subido a ${repo.ramaBase}: ${commit.slice(0, 10)} (${tarjeta.titulo})`);
    let version;
    try {
      const ci = await esperarCi(contexto, repo, commit, carpeta, reloj);
      const comprobada = await esperarVersion(contexto, repo, commit, reloj);
      version = comprobada.version;
      registro.info(`${ci}; ${comprobada.texto}`);
    } catch (error) {
      // Se subió y no arrancó: se deshace lo subido para que producción vuelva a la versión anterior.
      throw await deshacerSubida(contexto, repo, carpeta, { antes, commit, motivo: error instanceof Error ? error.message : String(error) });
    }
    const web = webDeGithub(await urlDelRemoto(repo));
    return { commit, version: version ?? commit, pruebas, linkCommit: web ? `${web}/commit/${commit}` : null };
  } finally {
    await quitarWorktree(repo, carpeta, ramaLocal);
  }
}

/** Revert del commit en main después de un despliegue fallido. Devuelve el ErrorDeEtapa para la tarjeta. */
async function deshacerSubida(contexto, repo, carpeta, { antes, commit, motivo }) {
  const { config, registro } = contexto;
  registro.error(`el despliegue de ${commit.slice(0, 10)} falló; se deshace: ${motivo}`);
  try {
    const revert = await revertirEnRamaBase(carpeta, {
      remoto: repo.remoto,
      ramaBase: repo.ramaBase,
      antes,
      commit,
      carpetaMigraciones: repo.carpetaMigraciones,
      identidad: config.git,
    });
    registro.info(`deshecho: revert ${revert.slice(0, 10)} de ${commit.slice(0, 10)} en ${repo.ramaBase}`);
    return new ErrorDeEtapa(
      `Se subió, no arrancó y se deshizo; producción vuelve a la versión anterior.\nCommit deshecho: ${commit.slice(0, 10)} (revert ${revert.slice(0, 10)}).\nDetalle técnico: ${motivo}`,
      { reversion: { commit, revert, ok: true } },
    );
  } catch (error) {
    registro.error(`URGENTE: no se pudo deshacer ${commit}: ${error.message}`);
    return new ErrorDeEtapa(
      `URGENTE: no se pudo deshacer, revisar a mano. El commit ${commit} quedó en ${repo.ramaBase} y el despliegue falló.\nPor qué falló el despliegue: ${motivo}\nPor qué no se pudo deshacer: ${error.message}`,
      { reversion: { commit, revert: null, ok: false } },
    );
  }
}
