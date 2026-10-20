// Un `gh` FALSO para las pruebas (subida.ciBuscar / ciEsperar): "buscar <commit>" contesta una corrida y
// "esperar <corrida>" termina bien. Anota cada llamada en GH_FALSO_LOG. No habla con GitHub.
import fs from "node:fs";

const [accion, valor] = process.argv.slice(2);
if (process.env.GH_FALSO_LOG) fs.appendFileSync(process.env.GH_FALSO_LOG, `${JSON.stringify({ accion, valor })}\n`);
if (accion === "buscar") console.log("4242");
else if (accion === "esperar") console.log(`corrida ${valor}: completed success`);
else process.exit(2);
