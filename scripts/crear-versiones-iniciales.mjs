// EMBUDO 3: crea la "V1 - embudo inicial" de todos los productos que ya tienen embudo y todavía no
// tienen ninguna versión. Correrlo UNA VEZ al subir la tarea (si no, la V1 se crea sola la primera
// vez que alguien toca o consulta el producto, con lo que tenga en ese momento).
//
// Por defecto SIMULA: solo cuenta. Para escribir hay que pasar --escribir. Solo agrega filas a
// EmbudoVersion; no toca el embudo ni los chats. Se puede correr dos veces: los productos que ya
// tienen versión se saltan.
//
// Uso:
//   node scripts/crear-versiones-iniciales.mjs                    (simula, todos los negocios)
//   node scripts/crear-versiones-iniciales.mjs --escribir
//   node scripts/crear-versiones-iniciales.mjs --workspace <id> --escribir
// Lee DATABASE_URL del entorno (o de .env). Necesita las dependencias de desarrollo (typescript).
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cargar } from "./supervisor-cargar.mjs";

const requireNativo = createRequire(import.meta.url);

const dominio = () => cargar("src/features/embudo/dominio/versiones.ts");
const etapasConocidas = () => cargar("src/lib/product-funnel-stages.ts").PRODUCT_FUNNEL_STAGES.map((etapa) => etapa.stage);

function argumentos(argv) {
  const salida = { escribir: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--escribir") salida.escribir = true;
    else if (argv[i] === "--simular") salida.escribir = false;
    else if (argv[i] === "--workspace") {
      salida.workspace = argv[i + 1];
      i += 1;
    }
  }
  return salida;
}

/**
 * `db` es cualquier cosa con `query(texto, valores)` que devuelva `{ rows, rowCount }` (Pool de pg,
 * PGlite). Devuelve cuántos productos tenían embudo sin versión y cuántas V1 se crearon.
 */
export async function crearVersionesIniciales(db, opciones = {}, log = console.log) {
  const { armarFoto, huellaDeFoto, NOTA_VERSION_INICIAL } = dominio();
  const conocidas = new Set(etapasConocidas());

  const sinVersion = (
    await db.query(
      `SELECT pb."id", pb."workspaceId", pb."productId" FROM "ProductPlaybook" pb
       WHERE NOT EXISTS (SELECT 1 FROM "EmbudoVersion" v WHERE v."productId" = pb."productId")
         ${opciones.workspace ? `AND pb."workspaceId" = $1` : ""}
       ORDER BY pb."createdAt"`,
      opciones.workspace ? [opciones.workspace] : [],
    )
  ).rows;
  log(`${sinVersion.length} producto(s) con embudo y sin versión · ${opciones.escribir ? "ESCRIBIENDO" : "simulación (no escribe)"}`);

  let creadas = 0;
  for (const playbook of sinVersion) {
    const pasos = (
      await db.query(
        `SELECT "id", "stage", "goal", "script", "stuckAfterMessages" FROM "ProductFunnelStage" WHERE "playbookId" = $1 ORDER BY "sortOrder"`,
        [playbook.id],
      )
    ).rows;
    const seguimientos = pasos.length
      ? (
          await db.query(
            `SELECT "stageId", "sortOrder", "timeType", "timeValue", "content", "flowId", "cancelOnActivity", "isActive"
             FROM "ProductStageFollowUp" WHERE "stageId" = ANY($1) ORDER BY "sortOrder"`,
            [pasos.map((paso) => paso.id)],
          )
        ).rows
      : [];
    const fila = (
      await db.query(`SELECT "value" FROM "AppSetting" WHERE "key" = $1`, [`producto:embudo:quitadas:${playbook.productId}`])
    ).rows[0];
    let quitadas = [];
    try {
      const guardado = JSON.parse(fila?.value ?? "[]");
      quitadas = Array.isArray(guardado) ? guardado.filter((etapa) => conocidas.has(etapa)) : [];
    } catch {
      quitadas = [];
    }

    const foto = armarFoto({
      pasos: pasos.map((paso) => ({ ...paso, followUps: seguimientos.filter((s) => s.stageId === paso.id) })),
      quitadas,
    });
    if (!opciones.escribir) continue;
    const resultado = await db.query(
      `INSERT INTO "EmbudoVersion" ("id", "workspaceId", "productId", "numero", "nota", "origen", "huella", "contenido")
       VALUES ($1, $2, $3, 1, $4, 'inicial', $5, $6::jsonb)
       ON CONFLICT ("productId", "numero") DO NOTHING`,
      [randomUUID(), playbook.workspaceId, playbook.productId, NOTA_VERSION_INICIAL, huellaDeFoto(foto), JSON.stringify(foto)],
    );
    creadas += resultado.rowCount ?? resultado.affectedRows ?? 0;
  }
  if (opciones.escribir) log(`V1 creadas: ${creadas}`);
  return { sinVersion: sinVersion.length, creadas };
}

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (esPrincipal) {
  try {
    requireNativo("dotenv/config");
  } catch {
    // sin dotenv: se usa el entorno tal cual
  }
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const { Pool } = requireNativo("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  crearVersionesIniciales(pool, argumentos(process.argv.slice(2)))
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
