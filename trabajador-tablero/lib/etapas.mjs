// Las tres etapas del trabajador: PLANEAR, CONSTRUIR y SUBIR. Cada una trabaja en un worktree
// temporal (carpetaTrabajo/wt/...), nunca en la copia del repo, y lo borra al terminar.
//
// - planear:   worktree desde origin/main; `claude -p --permission-mode plan` escribe el plan. -> /plan
// - construir: worktree en la rama tablero/<id>-<slug> desde origin/main; Claude edita (acceptEdits y
//              herramientas acotadas, sin push); el TRABAJADOR (no Claude) hace commit, revisa que no
//              toque zonas protegidas, corre la verificación y las pruebas él mismo, compara el lint con
//              el de main, ensaya la migración (PGlite + producción en BEGIN…ROLLBACK) y empuja SOLO la
//              rama. -> /resultado
// - subir:     (después del sí final del dueño) rebase de la rama sobre origin/main, verifica de nuevo,
//              ensaya la migración de nuevo, push a main, espera el CI y comprueba la versión. -> /subida
// Si algo falla se lanza ErrorDeEtapa con el motivo (y las zonas tocadas): el bucle llama /error.
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
  urlDelRemoto,
  webDeGithub,
} from "./git.mjs";
import { comoTexto, correr, ultimasLineas } from "./procesos.mjs";
import { zonasTocadas } from "./zonas.mjs";

export class ErrorDeEtapa extends Error {
  constructor(message, { zonas = [] } = {}) {
    super(message);
    this.zonas = zonas;
  }
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

/** Corre un comando de la etapa; si falla, ErrorDeEtapa con lo último que dijo. */
async function paso(contexto, comando, { cwd, reloj, que, entrada }) {
  const { config, senal } = contexto;
  const timeoutMs = Math.min(reloj.resta(), config.tiempos.comandoMinutos * MINUTO);
  const resultado = await correr(comando, { cwd, env: entornoSeguro(), senal, timeoutMs, entrada });
  if (resultado.cancelado) throw new ErrorDeEtapa(`Se canceló ${que}: la tarjeta venció en el CRM.`);
  if (resultado.vencido) throw new ErrorDeEtapa(`${que} (${comoTexto(comando)}) se pasó del tiempo.`);
  if (resultado.codigo !== 0) {
    throw new ErrorDeEtapa(`Falló ${que} (${comoTexto(comando)}):\n${ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 30)}`);
  }
  return resultado;
}

/** Correr Claude con el prompt por stdin. Devuelve lo que contestó. */
async function claude(contexto, argumentos, prompt, { cwd, timeoutMs, que }) {
  const { config, senal } = contexto;
  const comando = [...config.comandoClaude, ...argumentos];
  const resultado = await correr(comando, { cwd, entrada: prompt, timeoutMs, senal, env: entornoSeguro() });
  if (resultado.cancelado) throw new ErrorDeEtapa(`Se canceló Claude (${que}): la tarjeta venció en el CRM.`);
  if (resultado.vencido) throw new ErrorDeEtapa(`Claude tardó más de ${Math.round(timeoutMs / MINUTO)} min en ${que}: se cortó.`);
  if (resultado.codigo !== 0) {
    throw new ErrorDeEtapa(`Claude falló al ${que} (código ${resultado.codigo}):\n${ultimasLineas(`${resultado.errores}\n${resultado.salida}`, 20)}`);
  }
  const texto = resultado.salida.trim();
  if (!texto) throw new ErrorDeEtapa(`Claude no contestó nada al ${que}.`);
  return texto;
}

const REGLAS_DE_ZONAS =
  "No toques Meta Ads (anuncios, campañas, píxel), el bot de ventas (el agente que atiende WhatsApp) ni el libro del agente V3.";

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
    "Contesta SOLO con el plan.",
  ].join("\n\n");
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
      "- Al final corre tsc, lint (sin errores nuevos), build y las pruebas que correspondan, y arregla lo que falle.",
      "- Termina con un RESUMEN corto en español sencillo: qué cambiaste, qué archivos y cómo lo probaste.",
    ].join("\n"),
  ].join("\n\n");
}

/** Los errores de lint (no avisos) como firmas "archivo|regla|mensaje", contados. */
async function erroresDeLint(contexto, repo, cwd, reloj) {
  const timeoutMs = Math.min(reloj.resta(), contexto.config.tiempos.comandoMinutos * MINUTO);
  const resultado = await correr(repo.lint.comando, { cwd, env: entornoSeguro(), senal: contexto.senal, timeoutMs });
  if (resultado.vencido || resultado.cancelado) throw new ErrorDeEtapa(`El lint (${comoTexto(repo.lint.comando)}) se pasó del tiempo.`);
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
  for (const comando of [...repo.verificar, ...repo.pruebas]) {
    const resultado = await paso(contexto, comando, { cwd, reloj, que: "la verificación" });
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
    if (repo.instalar) await paso(contexto, repo.instalar, { cwd: carpeta, reloj, que: "instalar dependencias" });
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

    // Zonas protegidas: lo que toca y el dueño no aprobó en la pantalla.
    const tocadas = zonasTocadas(archivos, repo.zonasProtegidas);
    const sinAprobar = Object.keys(tocadas).filter((zona) => !(tarjeta.zonasAprobadas ?? []).includes(zona));
    if (sinAprobar.length) {
      throw new ErrorDeEtapa(
        `Toca zona protegida, aprobar en pantalla: ${sinAprobar.map((zona) => `${zona} (${tocadas[zona].slice(0, 5).join(", ")})`).join("; ")}.`,
        { zonas: sinAprobar },
      );
    }

    const pruebas = await verificar(contexto, repo, carpeta, reloj);
    if (lintBase) {
      const nuevos = erroresNuevos(lintBase, await erroresDeLint(contexto, repo, carpeta, reloj));
      if (nuevos.length) throw new ErrorDeEtapa(`El lint tiene ${nuevos.length} error(es) nuevo(s):\n${nuevos.slice(0, 15).join("\n")}`);
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
      throw new ErrorDeEtapa(error.message);
    }
    if (migracion) pruebas.push(`✔ ensayo de la migración: ${migracion}`);

    reloj.resta();
    await pushDeRama(carpeta, repo.remoto, rama);
    const commit = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
    const web = webDeGithub(await urlDelRemoto(repo));
    registro.info(`rama ${rama} empujada (${commit.slice(0, 10)})`);
    return {
      resumen: `${resumenDeClaude.slice(-4000)}\n\nArchivos (${archivos.length}): ${archivos.slice(0, 40).join(", ")}${archivos.length > 40 ? "…" : ""}`,
      pruebas: pruebas.join("\n").slice(0, 7000),
      paso: true,
      rama,
      linkRama: web ? `${web}/compare/${repo.ramaBase}...${encodeURIComponent(rama).replace(/%2F/g, "/")}` : null,
      commit,
      migracion,
    };
  } finally {
    await quitarWorktree(repo, carpeta, rama);
  }
}

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** Reemplaza {commit} y {run} en un comando de la configuración. */
const conValores = (comando, valores) => comando.map((parte) => parte.replace(/\{(\w+)\}/g, (todo, clave) => valores[clave] ?? todo));

/** Espera el CI del commit (si está configurado): busca la corrida y la mira hasta que termine. */
async function esperarCi(contexto, repo, commit, cwd, reloj) {
  const { ciBuscar, ciEsperar, ciMinutos } = repo.subida;
  if (!ciBuscar || !ciEsperar) return "CI: no configurado";
  const limite = Date.now() + Math.min(ciMinutos * MINUTO, reloj.resta());
  let corrida = "";
  while (!corrida) {
    const resultado = await correr(conValores(ciBuscar, { commit }), { cwd, timeoutMs: 60_000, senal: contexto.senal });
    if (resultado.cancelado) throw new ErrorDeEtapa("Se canceló la espera del CI: la tarjeta venció en el CRM.");
    corrida = resultado.codigo === 0 ? resultado.salida.trim().split(/\s+/)[0] ?? "" : "";
    if (corrida) break;
    if (Date.now() > limite) throw new ErrorDeEtapa(`Subió a ${repo.ramaBase} pero no apareció la corrida del CI para ${commit.slice(0, 10)}.`);
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

/** Espera que la URL de versión diga el commit nuevo (= arrancó la versión nueva). */
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
      if (ultima && (ultima === commit || commit.startsWith(ultima) || ultima.startsWith(commit))) break;
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

/** SUBIENDO -> sube a main. Solo después del sí final del dueño. */
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
    const rebase = await git(carpeta, ["rebase", base], { identidad: config.git, permitirFallo: true });
    if (rebase.codigo !== 0) {
      await git(carpeta, ["rebase", "--abort"], { permitirFallo: true });
      throw new ErrorDeEtapa(`La rama ${rama} choca con lo nuevo de ${repo.ramaBase} (conflicto en el rebase). Hay que reintentar (construir de nuevo).`);
    }
    if (repo.instalar) await paso(contexto, repo.instalar, { cwd: carpeta, reloj, que: "instalar dependencias" });
    const pruebas = await verificar(contexto, repo, carpeta, reloj);
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
      throw new ErrorDeEtapa(error.message);
    }

    reloj.resta();
    const commit = (await git(carpeta, ["rev-parse", "HEAD"])).salida.trim();
    try {
      await pushARamaBase(carpeta, repo.remoto, repo.ramaBase);
    } catch (error) {
      throw new ErrorDeEtapa(`No se pudo subir a ${repo.ramaBase} (¿cambió mientras tanto?): ${error.message}`);
    }
    registro.info(`subido a ${repo.ramaBase}: ${commit.slice(0, 10)} (${tarjeta.titulo})`);
    const ci = await esperarCi(contexto, repo, commit, carpeta, reloj);
    const { version, texto } = await esperarVersion(contexto, repo, commit, reloj);
    registro.info(`${ci}; ${texto}`);
    return { commit, version: version ?? commit, pruebas };
  } finally {
    await quitarWorktree(repo, carpeta, ramaLocal);
  }
}
