// Un `claude` FALSO para las pruebas del trabajador (config comandoClaude). Lee el prompt por stdin y
// se porta según el título de la tarea (las marcas entre corchetes):
//   modo plan:        escribe un plan. [lento] = no contesta nunca (para probar el tiempo máximo);
//                     [medio] = tarda 6 s (para probar el vencimiento por latido); [mod:x] = el plan
//                     dice que toca src/x/cambio.ts (y al construir escribe en src/x/).
//   en los dos modos: [limite] = sale con el aviso del límite de uso de Claude.
//   modo acceptEdits: [zona] edita src/bot/ (zona protegida), [tsc] rompe la verificación, [lint] deja un
//                     error de lint nuevo, [migracion] agrega una migración, [conflicto] escribe un archivo
//                     que después choca con main, [nada] no cambia nada; si no, escribe cambio-<algo>.txt.
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
  fs.appendFileSync(process.env.CLAUDE_FALSO_LOG, `${JSON.stringify({ argumentos, cwd: process.cwd(), titulo, modo })}\n`);
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
  console.log(`PLAN para "${titulo}"\n1. Qué se cambia: un archivo.\n2. Efecto: ninguno para clientes.\n3. Riesgos: bajos.\n4. Migración: no.\n5. Archivos: ${modulo ? `src/${modulo}/cambio.ts` : "cambio.txt"}\n6. Pruebas: verificar.mjs`);
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
if (titulo.includes("[zona]")) escribir("src/bot/respuesta.ts", "export const saludo = 'hola';\n");
else if (titulo.includes("[tsc]")) escribir("ROMPER_TSC", "sí\n");
else if (titulo.includes("[lint]")) escribir("nuevo.txt", "ERROR_LINT\n");
else if (titulo.includes("[migracion]")) {
  escribir(
    "prisma/migrations/20261020130000_nueva/migration.sql",
    'BEGIN;\nCREATE TABLE IF NOT EXISTS "Nueva" ("id" TEXT NOT NULL);\nCOMMIT;\n',
  );
} else if (titulo.includes("[conflicto]")) escribir("conflicto.txt", "lo de la rama\n");
else if (modulo) {
  await dormir(1500); // para que dos construcciones se crucen en el tiempo
  escribir(`src/${modulo}/cambio-${Date.now()}-${process.pid}.ts`, `// ${titulo}\n`);
} else if (!titulo.includes("[nada]")) escribir(`cambio-${Date.now()}.txt`, `${titulo}\n`);
console.log(`RESUMEN: hice "${titulo}".`);
