// Un `claude` FALSO para las pruebas del trabajador (config comandoClaude). Lee el prompt por stdin y
// se porta según el título de la tarea (las marcas entre corchetes):
//   modo plan:        escribe un plan. [lento] = no contesta nunca (para probar el tiempo máximo);
//                     [medio] = tarda 6 s (para probar el vencimiento por latido); [mod:x] = el plan
//                     dice que toca src/x/cambio.ts (y al construir escribe en src/x/).
//   en los dos modos: [limite] = sale con el aviso del límite de uso de Claude.
//   modo acceptEdits: [zona] edita src/bot/ (zona protegida), [tsc] rompe la verificación, [lint] deja un
//                     error de lint nuevo, [migracion] agrega una migración, [conflicto] escribe un archivo
//                     que después choca con main, [migracion-drop] agrega una migración con DROP y UPDATE,
//                     [nada] no cambia nada; si no, escribe cambio-<algo>.txt.
//   la revisión ("Eres el REVISOR"): no cambia nada. `-p /usage`: el uso del plan (CLAUDE_FALSO_USO).
// Anota cada llamada (argumentos y carpeta) en el archivo de CLAUDE_FALSO_LOG.
//   la NUBE (`-p --cloud`, 25-oct-2026): contesta con el link de la sesión y un proceso aparte (la "máquina de la
//                     nube") trabaja en la rama: tras NUBE_FALSA_DEMORA_MS (2500) hace un commit con un archivo y deja el
//                     commit vacío "resultado: build=OK tests=OK segundos=42". [nube-fallo] deja FALLO con 35 líneas de
//                     error en el cuerpo, [nube-fallo-limite] FALLO con el aviso del límite de uso, [nube-sin-resultado]
//                     nunca deja el commit, [nube-env] sube un archivo .env, [nube-limite] sale con el límite de uso al
//                     lanzar y [nube-sin-terminal] sale como si pidiera una terminal real. Con `--cloud "<descripción>"`
//                     (la terminal real) la instrucción es ese argumento; imprime el link con colores y se queda esperando.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argumentos = process.argv.slice(2);

// La "máquina de la nube": clona el remoto, trabaja en la rama y la sube (el Coordinador solo mira GitHub).
if (argumentos[0] === "--trabajo-de-la-nube") {
  const { remoto, rama, titulo, demora } = JSON.parse(argumentos[1]);
  await new Promise((resolver) => setTimeout(resolver, demora));
  const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Nube", "-c", "user.email=nube@x.co", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "nube-falsa-"));
  git(os.tmpdir(), "clone", "--quiet", remoto, carpeta);
  git(carpeta, "checkout", "--quiet", rama);
  if (!titulo.includes("[nube-sin-resultado]")) {
    if (titulo.includes("[nube-env]")) fs.writeFileSync(path.join(carpeta, ".env"), "SECRETO=1\n");
    else if (!titulo.includes("[nube-fallo")) fs.writeFileSync(path.join(carpeta, `cambio-nube-${Date.now()}.txt`), `${titulo}\n`);
    git(carpeta, "add", "-A");
    if (git(carpeta, "status", "--porcelain").trim()) git(carpeta, "commit", "--quiet", "-m", "cambios de la nube");
    if (titulo.includes("[nube-fallo-limite]")) git(carpeta, "commit", "--quiet", "--allow-empty", "-m", "resultado: build=FALLO tests=FALLO segundos=3", "-m", "Claude AI usage limit reached|1761210000");
    else if (titulo.includes("[nube-fallo]")) {
      const lineas = Array.from({ length: 35 }, (_, i) => `linea ${i + 1} del error`).join("\n");
      git(carpeta, "commit", "--quiet", "--allow-empty", "-m", "resultado: build=FALLO tests=OK segundos=7", "-m", lineas);
    } else git(carpeta, "commit", "--quiet", "--allow-empty", "-m", "resultado: build=OK tests=OK segundos=42");
    git(carpeta, "push", "--quiet", "origin", `HEAD:refs/heads/${rama}`);
  }
  try {
    fs.rmSync(carpeta, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows a veces tiene un archivo abierto.
  }
  process.exit(0);
}

// `claude --cloud "<descripción>"` (la terminal real, 25-oct-2026): la instrucción llega como argumento justo después
// de --cloud y NO por stdin (en una terminal real stdin nunca se cierra).
const trasCloud = argumentos[argumentos.indexOf("--cloud") + 1];
const descripcion = argumentos.includes("--cloud") && trasCloud !== undefined && !trasCloud.startsWith("-") ? trasCloud : null;
let prompt = descripcion ?? "";
if (descripcion === null) for await (const pedazo of process.stdin) prompt += pedazo;

const titulo = (prompt.match(/^Tarea: (.*)$/m) ?? [])[1] ?? "";
const modo = argumentos[argumentos.indexOf("--permission-mode") + 1];
if (process.env.CLAUDE_FALSO_LOG) {
  fs.appendFileSync(process.env.CLAUDE_FALSO_LOG, `${JSON.stringify({ argumentos, cwd: process.cwd(), titulo, modo, prompt: prompt.slice(0, 8000), terminal: Boolean(process.stdout.isTTY) })}\n`);
}

// `claude -p --cloud`: lanza la sesión de la nube. El link sale del título (para que la prueba sepa cuál es).
if (argumentos.includes("--cloud")) {
  if (titulo.includes("[nube-limite]")) {
    console.log("Claude AI usage limit reached|1761210000");
    process.exit(1);
  }
  if (titulo.includes("[nube-modelo-no-disponible]")) {
    console.log("API Error: model claude-sonnet is not available");
    process.exit(1);
  }
  // Una versión de --cloud que no acepta --model: rechaza la opción (el Coordinador lo lanza otra vez sin ella).
  if (titulo.includes("[nube-sin-model]") && argumentos.includes("--model")) {
    console.error("error: unknown option '--model'");
    process.exit(1);
  }
  if (titulo.includes("[nube-sin-terminal]")) {
    console.error("Error: Raw mode is not supported on the current process.stdin (not a TTY)");
    process.exit(1);
  }
  // [nube-sin-link]: en la terminal real nunca da el link ni trabaja (para probar el tiempo máximo).
  if (descripcion !== null && titulo.includes("[nube-sin-link]")) await new Promise(() => setInterval(() => {}, 60_000));
  // [nube-confianza] (en la terminal real): ANTES de trabajar y dar el link, la pregunta "¿Confías en esta carpeta?" como
  // la dibuja la CLI 2.1 (marcada "No, exit", sin números, espacios como ESC[1C). Las teclas del primer segundo se pierden
  // (la CLI de verdad tarda en leerlas al arrancar). Flecha abajo/arriba cambia la opción; Enter en "Yes" sigue, en "No"
  // (o Esc) sale con código 1 sin trabajar.
  if (descripcion !== null && titulo.includes("[nube-confianza]")) {
    const conCursor = (texto) => texto.replace(/ /g, "\u001b[1C");
    const marca = "\u001b[38;2;177;185;249m❯";
    const opciones = (enSi) =>
      `\u001b[14;2H${enSi ? " " : marca}\u001b[1C${conCursor("No, exit")}\u001b[m\u001b[15;2H${enSi ? marca : " "}\u001b[1C${conCursor("Yes, I trust this folder")}\u001b[m`;
    process.stdout.write(
      `\u001b[2J\u001b[H\u001b[1m\u001b[3;2H${conCursor("Accessing workspace:")}\u001b[m\u001b[5;2H${process.cwd()}\u001b[7;2H${conCursor("Quick safety check: Is this a project you created or one you trust?")}${opciones(false)}\u001b[17;2H${conCursor("Enter to confirm · Esc to cancel")}\u001b[>0q\u001b[?u`,
    );
    const desde = Date.now();
    let enSi = false;
    const aceptada = await new Promise((resolver) => {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on("data", (dato) => {
        if (Date.now() - desde < 1000) return;
        const tecla = dato.toString("utf8");
        if (tecla.includes("\u001b[B") || tecla.includes("\u001b[A")) {
          enSi = !enSi;
          process.stdout.write(opciones(enSi));
        } else if (tecla.includes("\r")) resolver(enSi);
        else if (tecla === "\u001b") resolver(false);
      });
    });
    if (process.env.CLAUDE_FALSO_LOG) fs.appendFileSync(`${process.env.CLAUDE_FALSO_LOG}.confianza`, `${JSON.stringify({ confianza: aceptada, cwd: process.cwd(), titulo })}\n`);
    if (!aceptada) process.exit(1);
    process.stdin.pause();
    process.stdout.write("\u001b[2J\u001b[H");
  }
  const rama = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  const remoto = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const sesion = `https://claude.ai/code/session_FALSA_${Buffer.from(titulo).toString("hex").slice(0, 24)}`;
  spawn(process.execPath, [fileURLToPath(import.meta.url), "--trabajo-de-la-nube", JSON.stringify({ remoto, rama, titulo, demora: Number(process.env.NUBE_FALSA_DEMORA_MS ?? 2500) })], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  if (descripcion === null) {
    console.log(JSON.stringify({ type: "result", subtype: "success", result: `Sesión de la nube creada: ${sesion}`, session_url: sesion }));
    process.exit(0);
  }
  // En la terminal real: el link con colores (el Coordinador los limpia) y se queda esperando como la CLI de verdad;
  // el Coordinador tiene que cerrar la terminal.
  process.stdout.write(`\u001b[1mCloud session:\u001b[0m \u001b[36m${sesion}\u001b[0m\r\n`);
  setInterval(() => {}, 60_000);
  await new Promise(() => {});
}

// Dividir una tarea (promptDePartir): contesta un JSON con 2 partes.
if (prompt.includes("DIVIDIR en partes pequeñas")) {
  console.log(JSON.stringify({ partes: [{ titulo: "Primera mitad", detalle: "Hacer la primera mitad (archivos a, b)." }, { titulo: "Segunda mitad", detalle: "Hacer la segunda mitad (archivos c, d)." }] }));
  process.exit(0);
}
const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// `claude -p /usage`: contesta lo que diga el archivo de CLAUDE_FALSO_USO (sin archivo, algo ilegible).
if (argumentos.includes("/usage")) {
  const archivo = process.env.CLAUDE_FALSO_USO;
  console.log(archivo && fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : "Unknown command");
  process.exit(0);
}

const modulo = (titulo.match(/\[mod:([a-z]+)\]/) ?? [])[1];
if (titulo.includes("[limite]")) {
  console.log("Claude AI usage limit reached|1761210000");
  process.exit(1);
}

if (modo === "plan") {
  if (titulo.includes("[lento]")) await dormir(10 * 60_000);
  await dormir(titulo.includes("[medio]") ? 6000 : 1500);
  // Como pide el prompt: la línea RIESGO en las primeras líneas (BAJO salvo que el título marque [zona]).
  const riesgo = titulo.includes("[zona]") ? "RIESGO: ALTO — toca el bot de ventas" : "RIESGO: BAJO — un cambio chico sin zonas ni migración destructiva";
  // Regla del dueño 24-oct: el plan dice si pasa solo a construir o espera el sí.
  console.log(`PLAN para "${titulo}"\n${riesgo}\nAPROBAR PLAN: SOLO\n1. Qué se cambia: un archivo.\n2. Efecto: ninguno para clientes.\n3. Riesgos: bajos.\n4. Migración: no.\n5. Archivos: ${modulo ? `src/${modulo}/cambio.ts` : "cambio.txt"}\n6. Pruebas: verificar.mjs`);
  process.exit(0);
}

// La revisión de lo que construyó Codex: no cambia nada.
if (prompt.startsWith("Eres el REVISOR")) {
  console.log("REVISIÓN: todo bien (claude).");
  process.exit(0);
}

// El manual de la noche (manual-nocturno.mjs): pasa las notas al manual. CLAUDE_FALSO_MANUAL: "codigo" cambia un archivo de
// código, "titulo" borra un título `## ...`, "no-pase" deja la primera nota sin pasar; si no, agrega cada nota al manual.
if (prompt.startsWith("MANUAL DE LA NOCHE")) {
  const notas = [...prompt.matchAll(/^- (docs\/cambios-pendientes\/\S+)$/gm)].map((una) => una[1]);
  const manual = "docs/que-es-esta-aplicacion.md";
  const variante = process.env.CLAUDE_FALSO_MANUAL ?? "";
  let texto = fs.readFileSync(manual, "utf8");
  if (variante === "titulo") texto = texto.replace(/^## .*$/m, "");
  else for (const nota of notas.slice(variante === "no-pase" ? 1 : 0)) texto += `- \`${path.basename(nota, ".md")}\`: ${fs.readFileSync(nota, "utf8").trim()}\n`;
  fs.writeFileSync(manual, texto);
  if (variante === "codigo") fs.writeFileSync("src/codigo-ajeno.ts", "// no debería\n");
  console.log(`RESUMEN: pasé ${notas.length} notas.${variante === "no-pase" ? `\nNO_PASE: ${path.basename(notas[0])}` : ""}`);
  process.exit(0);
}

const escribir = (archivo, texto) => {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, texto);
};
if (titulo.includes("[atascado]")) {
  // Lanza "tareas en segundo plano" y se queda esperando sin tocar nada (el atasco del 24-oct-2026).
  console.error("Revisaré de nuevo en unos 30 minutos");
  await dormir(120_000);
} else if (titulo.includes("[muchos-archivos]")) {
  // Cambia muchos archivos y no termina nunca (para probar que una tarea grande se parte).
  for (let i = 1; i <= 9; i += 1) escribir(`src/grande/parte-${i}.ts`, `// ${i}\n`);
  await dormir(120_000);
} else if (titulo.includes("[tsc-una-vez]")) {
  // Rompe tsc la primera vez; en la reparación (el prompt trae "REPARACIÓN") lo arregla.
  if (prompt.includes("REPARACIÓN")) fs.rmSync("ROMPER_TSC", { force: true });
  else escribir("ROMPER_TSC", "sí\n");
  escribir(`cambio-${Date.now()}.txt`, `${titulo}\n`);
} else if (titulo.includes("[solas-bot")) {
  // Zonas que suben solas (24-oct-2026): [solas-bot] deja la prueba de "sin mensajes nuevos"; [solas-bot-sin] no.
  escribir("src/bot/respuesta.ts", `export const saludo = 'hola ${Date.now()}';\n`);
  if (!titulo.includes("[solas-bot-sin]")) console.log("✔ sin mensajes nuevos a clientes");
  if (titulo.includes("[solas-bot-envio]")) escribir("src/bot/aviso.ts", `export const avisar = (x: string) => sendMessage(x); // ${Date.now()}\n`);
} else if (titulo.includes("[solas-v3")) {
  escribir("src/agente-v3/libro.ts", `export const libro = 'v3 ${Date.now()}';\n`);
  if (!titulo.includes("[solas-v3-sin]")) console.log("✔ simulación V3: sin cambios fuera de lo pedido\nversión anterior del libro: 7");
} else if (titulo.includes("[solas-ads-gasto]")) {
  escribir("src/ads/campana.ts", `export const cuerpo = { daily_budget: ${Date.now()}, status: 'ACTIVE' };\n`);
} else if (titulo.includes("[solas-ads")) {
  escribir("src/ads/lectura.ts", `export const leer = () => 'reporte ${Date.now()}';\n`);
} else if (titulo.includes("[solas-chats]")) {
  escribir("src/chats/bandeja.ts", `export const x = ${Date.now()};\n`);
  console.log("✔ sin mensajes nuevos a clientes");
} else if (titulo.includes("[zona]")) escribir("src/bot/respuesta.ts", "export const saludo = 'hola';\n");
else if (titulo.includes("[tsc]")) escribir("ROMPER_TSC", "sí\n");
else if (titulo.includes("[lint]")) escribir("nuevo.txt", "ERROR_LINT\n");
else if (titulo.includes("[migracion]")) {
  escribir(
    "prisma/migrations/20261020130000_nueva/migration.sql",
    'BEGIN;\nCREATE TABLE IF NOT EXISTS "Nueva" ("id" TEXT NOT NULL);\nCOMMIT;\n',
  );
} else if (titulo.includes("[migracion-drop]")) {
  // Una migración con cambios destructivos: un DROP y un UPDATE (más un comentario con DELETE que no cuenta).
  escribir(
    "prisma/migrations/20261020140000_destructiva/migration.sql",
    'BEGIN;\n-- DELETE en un comentario no cuenta\nALTER TABLE "Nueva" DROP COLUMN IF EXISTS "viejo";\nUPDATE "Nueva" SET "id" = \'TRUNCATE\';\nCOMMIT;\n',
  );
} else if (titulo.includes("[conflicto]")) escribir("conflicto.txt", "lo de la rama\n");
else if (modulo) {
  await dormir(1500); // para que dos construcciones se crucen en el tiempo
  escribir(`src/${modulo}/cambio-${Date.now()}-${process.pid}.ts`, `// ${titulo}\n`);
} else if (!titulo.includes("[nada]")) escribir(`cambio-${Date.now()}.txt`, `${titulo}\n`);
console.log(`RESUMEN: hice "${titulo}".`);
