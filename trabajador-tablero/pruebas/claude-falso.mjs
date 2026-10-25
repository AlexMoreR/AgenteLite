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
import fs from "node:fs";
import path from "node:path";

const argumentos = process.argv.slice(2);
let prompt = "";
for await (const pedazo of process.stdin) prompt += pedazo;

const titulo = (prompt.match(/^Tarea: (.*)$/m) ?? [])[1] ?? "";
const modo = argumentos[argumentos.indexOf("--permission-mode") + 1];
if (process.env.CLAUDE_FALSO_LOG) {
  fs.appendFileSync(process.env.CLAUDE_FALSO_LOG, `${JSON.stringify({ argumentos, cwd: process.cwd(), titulo, modo, prompt: prompt.slice(0, 8000) })}\n`);
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
