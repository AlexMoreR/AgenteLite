// Un `ssh` FALSO para las pruebas (config ssh.comando): no se conecta a nada. Hace de servidor con dos
// bases ("postgres" y "magilus"; solo "magilus" tiene la tabla guía) y anota cada llamada (destino,
// comando remoto y lo que llegó por stdin) en SSH_FALSO_LOG. Un ensayo con FALLA_PROD falla como psql.
import fs from "node:fs";

const [destino, remoto] = process.argv.slice(2);
let entrada = "";
for await (const pedazo of process.stdin) entrada += pedazo;
if (process.env.SSH_FALSO_LOG) fs.appendFileSync(process.env.SSH_FALSO_LOG, `${JSON.stringify({ destino, remoto, entrada })}\n`);

if (entrada.includes("FROM pg_database")) {
  console.log("postgres\nmagilus");
} else if (entrada.includes("to_regclass")) {
  console.log(remoto.includes("-d magilus") ? "t" : "f");
} else if (entrada.includes("FALLA_PROD")) {
  console.error('psql:<stdin>:4: ERROR:  relation "FALLA_PROD" does not exist');
  process.exit(3);
}
