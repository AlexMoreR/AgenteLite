// Mide la "Última acción" de Equipo en la base: la consulta vieja (DISTINCT ON sobre todo el equipo en
// 30 días, como estaba antes de la parte 1) contra la nueva (LATERAL por persona, por los índices
// parciales). Imprime el tiempo de cada una y si el plan usa los índices Message_ultima_accion_*.
//
// SOLO LECTURA: todo corre dentro de BEGIN READ ONLY ... ROLLBACK, con statement_timeout de 60 s. Ojo:
// EXPLAIN ANALYZE sí ejecuta la consulta (para medirla), así que la vieja puede cargar la base hasta
// 60 s; correrlo en un momento tranquilo.
//
// Uso:  DATABASE_URL=... node scripts/medir-ultima-accion.mjs [workspaceId] [userId1,userId2,...]
//   Sin workspaceId: el negocio activo con más miembros activos.
//   Sin userIds: los miembros activos de ese negocio.
//   --planes: imprime también los planes completos.

import "dotenv/config";
import pg from "pg";

const INDICES = ["Message_ultima_accion_enviado_idx", "Message_ultima_accion_actor_idx"];

// --- La consulta vieja, tal cual estaba antes de la parte 1 ($1 = workspaceId, $2 = desde). ---
const VIEJA = {
  mensajes: `
      SELECT u."userId", u."createdAt" AS cuando, coalesce(c."name", c."phoneNumber") AS cliente
      FROM (
        SELECT DISTINCT ON (m."rawPayload"->>'enviadoPorUserId')
               m."rawPayload"->>'enviadoPorUserId' AS "userId", m."createdAt", m."contactId"
        FROM "Message" m
        WHERE m."workspaceId" = $1
          AND m."createdAt" >= $2
          AND m."direction" = 'OUTBOUND' AND m."type" <> 'SYSTEM'
          AND m."rawPayload"->>'enviadoPorUserId' IS NOT NULL
        ORDER BY m."rawPayload"->>'enviadoPorUserId', m."createdAt" DESC
      ) u
      LEFT JOIN "Contact" c ON c."id" = u."contactId"
    `,
  notas: `
      SELECT u."userId", u.kind, u."createdAt" AS cuando, coalesce(c."name", c."phoneNumber") AS cliente
      FROM (
        SELECT DISTINCT ON (m."rawPayload"->>'actorUserId')
               m."rawPayload"->>'actorUserId' AS "userId", m."rawPayload"->>'kind' AS kind,
               m."createdAt", m."contactId"
        FROM "Message" m
        WHERE m."workspaceId" = $1
          AND m."createdAt" >= $2
          AND m."type" = 'SYSTEM'
          AND m."rawPayload"->>'actorUserId' IS NOT NULL
          AND m."rawPayload"->>'kind' IN ('assigned', 'unassigned', 'stage_changed')
        ORDER BY m."rawPayload"->>'actorUserId', m."createdAt" DESC
      ) u
      LEFT JOIN "Contact" c ON c."id" = u."contactId"
    `,
  llamadas: `
      SELECT u."userId", u."calledAt" AS cuando, coalesce(c."name", c."phoneNumber") AS cliente
      FROM (
        SELECT DISTINCT ON (a."calledByUserId") a."calledByUserId" AS "userId", a."calledAt", a."contactId"
        FROM "CallAttempt" a
        WHERE a."workspaceId" = $1
          AND a."calledAt" >= $2
          AND a."calledByUserId" IS NOT NULL
        ORDER BY a."calledByUserId", a."calledAt" DESC
      ) u
      LEFT JOIN "Contact" c ON c."id" = u."contactId"
    `,
};

// --- La nueva, la de ultimaAccionPorPersona en actividad.ts ($1 = workspaceId, $2 = desde, $3 = userIds). ---
const NUEVA = {
  mensajes: `
        SELECT p."userId", u."createdAt" AS cuando, coalesce(c."name", c."phoneNumber") AS cliente
        FROM unnest($3::text[]) AS p("userId")
        CROSS JOIN LATERAL (
          SELECT m."createdAt", m."contactId"
          FROM "Message" m
          WHERE m."workspaceId" = $1
            AND m."rawPayload"->>'enviadoPorUserId' = p."userId"
            AND m."createdAt" >= $2
            AND m."direction" = 'OUTBOUND' AND m."type" <> 'SYSTEM'
            AND (m."rawPayload"->>'enviadoPorUserId') IS NOT NULL
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) u
        LEFT JOIN "Contact" c ON c."id" = u."contactId"
      `,
  notas: `
        SELECT p."userId", u.kind, u."createdAt" AS cuando, coalesce(c."name", c."phoneNumber") AS cliente
        FROM unnest($3::text[]) AS p("userId")
        CROSS JOIN LATERAL (
          SELECT m."rawPayload"->>'kind' AS kind, m."createdAt", m."contactId"
          FROM "Message" m
          WHERE m."workspaceId" = $1
            AND m."rawPayload"->>'actorUserId' = p."userId"
            AND m."createdAt" >= $2
            AND m."type" = 'SYSTEM'
            AND (m."rawPayload"->>'actorUserId') IS NOT NULL
            AND m."rawPayload"->>'kind' IN ('assigned', 'unassigned', 'stage_changed')
          ORDER BY m."createdAt" DESC
          LIMIT 1
        ) u
        LEFT JOIN "Contact" c ON c."id" = u."contactId"
      `,
  llamadas: `
        SELECT u."userId", u."calledAt" AS cuando, coalesce(c."name", c."phoneNumber") AS cliente
        FROM (
          SELECT DISTINCT ON (a."calledByUserId") a."calledByUserId" AS "userId", a."calledAt", a."contactId"
          FROM "CallAttempt" a
          WHERE a."workspaceId" = $1
            AND a."calledAt" >= $2
            AND a."calledByUserId" = ANY($3::text[])
          ORDER BY a."calledByUserId", a."calledAt" DESC
        ) u
        LEFT JOIN "Contact" c ON c."id" = u."contactId"
      `,
};

async function explicar(cliente, sql, parametros) {
  const { rows } = await cliente.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, parametros);
  const plan = rows.map((fila) => fila["QUERY PLAN"]).join("\n");
  const tiempo = Number(plan.match(/Execution Time: ([\d.]+) ms/)?.[1] ?? NaN);
  return { plan, tiempo };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }
  const [argWorkspace, argUsuarios] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cliente.connect();
  try {
    await cliente.query("BEGIN READ ONLY");
    await cliente.query("SET LOCAL statement_timeout = '60s'");

    let workspaceId = argWorkspace;
    if (!workspaceId) {
      const { rows } = await cliente.query(`
        SELECT w."id" FROM "Workspace" w
        JOIN "WorkspaceMember" wm ON wm."workspaceId" = w."id" AND wm."isActive"
        WHERE w."isActive"
        GROUP BY w."id" ORDER BY count(*) DESC LIMIT 1
      `);
      workspaceId = rows[0]?.id;
      if (!workspaceId) throw new Error("no hay negocios activos con miembros");
    }

    let userIds = (argUsuarios ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (userIds.length === 0) {
      const { rows } = await cliente.query(
        `SELECT "userId" FROM "WorkspaceMember" WHERE "workspaceId" = $1 AND "isActive"`,
        [workspaceId],
      );
      userIds = rows.map((fila) => fila.userId);
    }

    const desde = new Date(Date.now() - 30 * 24 * 3_600_000);
    console.log(`negocio=${workspaceId} personas=${userIds.length} desde=${desde.toISOString()}\n`);

    for (const [nombre, consultas, parametros] of [
      ["vieja (DISTINCT ON, 30 días)", VIEJA, [workspaceId, desde]],
      ["nueva (LATERAL por persona)", NUEVA, [workspaceId, desde, userIds]],
    ]) {
      let total = 0;
      const planes = [];
      for (const [parte, sql] of Object.entries(consultas)) {
        try {
          const { plan, tiempo } = await explicar(cliente, sql, parametros);
          total += tiempo;
          planes.push(plan);
          console.log(`  ${nombre} / ${parte}: ${tiempo.toFixed(1)} ms`);
        } catch (error) {
          // Un timeout aborta la transacción: se anota y se sigue en una nueva (sigue siendo de solo lectura).
          console.log(`  ${nombre} / ${parte}: FALLÓ (${error.message})`);
          total = Number.POSITIVE_INFINITY;
          await cliente.query("ROLLBACK");
          await cliente.query("BEGIN READ ONLY");
          await cliente.query("SET LOCAL statement_timeout = '60s'");
        }
      }
      const todo = planes.join("\n");
      console.log(`${nombre}: total ${Number.isFinite(total) ? `${total.toFixed(1)} ms` : "más de 60 s o falló"}`);
      for (const indice of INDICES) {
        console.log(`  usa ${indice}: ${todo.includes(indice) ? "sí" : "no"}`);
      }
      if (process.argv.includes("--planes")) console.log(`\n${todo}\n`);
      console.log("");
    }
  } finally {
    await cliente.query("ROLLBACK").catch(() => {});
    await cliente.end();
  }
}

main().catch((error) => {
  console.error("No se pudo medir:", error.message);
  process.exit(1);
});
