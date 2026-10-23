// Un `codex` FALSO para las pruebas del trabajador (config comandoCodex). Se llama como el de verdad:
//   codex exec --cd <worktree> --sandbox <read-only|workspace-write> --skip-git-repo-check --color never
//              --output-last-message <archivo> -
// Lee el prompt por stdin y deja la respuesta final en el archivo de --output-last-message:
//   --sandbox read-only:        escribe un plan.
//   --sandbox workspace-write:  si es la revisión ("Eres el REVISOR") contesta "REVISIÓN: todo bien";
//                               si no, escribe cambio-codex-<algo>.txt en el worktree.
//   [codex-limite] en el título = sale con el aviso del límite de uso de ChatGPT/Codex.
// Anota cada llamada (argumentos y carpeta) en el archivo de CODEX_FALSO_LOG.
import fs from "node:fs";
import path from "node:path";

const argumentos = process.argv.slice(2);
const valor = (opcion) => (argumentos.includes(opcion) ? argumentos[argumentos.indexOf(opcion) + 1] : null);
let prompt = "";
for await (const pedazo of process.stdin) prompt += pedazo;

const titulo = (prompt.match(/^Tarea: (.*)$/m) ?? [])[1] ?? "";
const sandbox = valor("--sandbox");
const carpeta = valor("--cd") ?? process.cwd();
const revision = prompt.startsWith("Eres el REVISOR");
if (process.env.CODEX_FALSO_LOG) {
  fs.appendFileSync(process.env.CODEX_FALSO_LOG, `${JSON.stringify({ argumentos, cwd: process.cwd(), titulo, sandbox, revision })}\n`);
}

if (argumentos[0] !== "exec" || argumentos.includes("--dangerously-bypass-approvals-and-sandbox")) {
  console.error("codex-falso: se esperaba `codex exec` sin --dangerously-bypass-approvals-and-sandbox");
  process.exit(2);
}
if (titulo.includes("[codex-limite]")) {
  console.error("ERROR: You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), or try again in 2 hours.");
  process.exit(1);
}

const responder = (texto) => {
  const archivo = valor("--output-last-message");
  if (archivo) fs.writeFileSync(archivo, `${texto}\n`);
  console.log(texto);
};

if (sandbox === "read-only") {
  responder(`PLAN para "${titulo}" (Codex)\n1. Qué se cambia: un archivo.\n2. Efecto: ninguno.\n3. Riesgos: bajos.\n4. Migración: no.\n5. Archivos: cambio.txt\n6. Pruebas: verificar.mjs`);
  process.exit(0);
}
if (revision) {
  responder("REVISIÓN: todo bien (codex).");
  process.exit(0);
}
fs.writeFileSync(path.join(carpeta, `cambio-codex-${Date.now()}.txt`), `${titulo}\n`);
responder(`RESUMEN: Codex hizo "${titulo}".`);
