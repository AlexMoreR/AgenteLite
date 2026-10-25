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
//                     lanzar y [nube-sin-terminal] sale como si pidiera una terminal real.
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

let prompt = "";
for await (const pedazo of process.stdin) prompt += pedazo;

const titulo = (prompt.match(/^Tarea: (.*)$/m) ?? [])[1] ?? "";
const modo = argumentos[argumentos.indexOf("--permission-mode") + 1];
if (process.env.CLAUDE_FALSO_LOG) {
  fs.appendFileSync(process.env.CLAUDE_FALSO_LOG, `${JSON.stringify({ argumentos, cwd: process.cwd(), titulo, modo, prompt: prompt.slice(0, 8000) })}\n`);
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
  const rama = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  const remoto = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const sesion = `https://claude.ai/code/session_FALSA_${Buffer.from(titulo).toString("hex").slice(0, 24)}`;
  spawn(process.execPath, [fileURLToPath(import.meta.url), "--trabajo-de-la-nube", JSON.stringify({ remoto, rama, titulo, demora: Number(process.env.NUBE_FALSA_DEMORA_MS ?? 2500) })], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  console.log(JSON.stringify({ type: "result", subtype: "success", result: `Sesión de la nube creada: ${sesion}`, session_url: sesion }));
  process.exit(0);
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
