/**
 * Prueba de la migración de tipos de tarjeta del Tablero IA
 * (prisma/migrations/20261019180000_tableros_tipos_tarjeta) contra un Postgres embebido (PGlite),
 * sin tocar ninguna base real:
 *   npm run test:tablero-tipos-migracion
 *
 * 1. Aplica TODAS las migraciones reales en orden sobre una base vacía, hasta la anterior a esta.
 * 2. Inserta datos como los de hoy: un negocio, 2 tableros con tarjetas en varios estados y flechas.
 * 3. Aplica la migración nueva y comprueba el backfill: 3 tipos por tablero (Área, Idea, Tarea) con
 *    sus madres permitidas, todas las tarjetas = Tarea, tipoId NOT NULL, nada perdido.
 * 4. La vuelve a aplicar (no debe fallar ni duplicar) y prueba las restricciones nuevas.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARPETA = path.join(RAIZ, "prisma", "migrations");
const NUEVA = "20261019180000_tableros_tipos_tarjeta";

const migraciones = fs
  .readdirSync(CARPETA, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
assert.ok(migraciones.includes(NUEVA), `falta la migración ${NUEVA}`);
assert.equal(migraciones.at(-1), NUEVA, "la migración nueva tiene que ser la última");

const leer = (nombre) => fs.readFileSync(path.join(CARPETA, nombre, "migration.sql"), "utf8");

const db = new PGlite();
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const filas = async (sql, valores = []) => (await db.query(sql, valores)).rows;

for (const nombre of migraciones) {
  if (nombre === NUEVA) break;
  try {
    await db.exec(leer(nombre));
  } catch (fallo) {
    throw new Error(`La migración ${nombre} falló en PGlite: ${fallo.message}`);
  }
}
console.log(`aplicadas ${migraciones.length - 1} migraciones anteriores`);

// ── Datos de antes de la migración ─────────────────────────────────────────────────────────
await db.exec(`
  INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt") VALUES ('ws1', 'Magilus', 'magilus', now());
  INSERT INTO "TableroInteligente" ("id", "workspaceId", "nombre") VALUES
    ('tab1', 'ws1', 'Ventas'), ('tab2', 'ws1', 'Producción');
  INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "estado", "creadoPor", "actualizadoEn") VALUES
    ('c1', 'tab1', 'Responder en 15 min', 'IDEA', 'u1', now()),
    ('c2', 'tab1', 'Seguimiento a 24 h', 'POR_APROBAR', 'u1', now()),
    ('c3', 'tab1', 'Guion de envío', 'APROBADO', 'u1', now()),
    ('c4', 'tab1', 'Tabla de fletes', 'EN_CURSO', 'u1', now()),
    ('c5', 'tab2', 'Moldes nuevos', 'HECHO', 'u1', now()),
    ('c6', 'tab2', 'Proveedor de espuma', 'FALLIDO', 'u1', now());
  INSERT INTO "ConexionTarjeta" ("id", "tableroId", "origenId", "destinoId") VALUES
    ('f1', 'tab1', 'c1', 'c2'), ('f2', 'tab1', 'c2', 'c3'), ('f3', 'tab2', 'c5', 'c6');
  INSERT INTO "HistorialTarjeta" ("id", "tarjetaId", "quien", "origen", "accion", "despues") VALUES
    ('h1', 'c3', 'u1', 'PANTALLA', 'aprobar', '{"estado":"APROBADO"}');
`);
const estadosAntes = await filas(`SELECT "id", "estado" FROM "TarjetaTablero" ORDER BY "id"`);

// ── La migración nueva ─────────────────────────────────────────────────────────────────────
await db.exec(leer(NUEVA));

await prueba("cada tablero tiene sus 3 tipos: Área (sin estados), Idea, Tarea (solo Tarea pide aprobación)", async () => {
  for (const tablero of ["tab1", "tab2"]) {
    const tipos = await filas(
      `SELECT "nombre", "requiereAprobacion", "usaEstados", "orden", "color", "icono", "id" FROM "TipoTarjeta"
       WHERE "tableroId" = $1 ORDER BY "orden"`,
      [tablero],
    );
    assert.deepEqual(
      tipos.map((t) => [t.nombre, t.requiereAprobacion, t.usaEstados, t.orden]),
      [
        ["Área", false, false, 0],
        ["Idea", false, true, 1],
        ["Tarea", true, true, 2],
      ],
      tablero,
    );
    for (const tipo of tipos) {
      assert.match(tipo.id, /^tt_[0-9a-f]{32}$/);
      assert.match(tipo.color, /^#[0-9a-f]{6}$/);
      assert.ok(tipo.icono);
    }
  }
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "TipoTarjeta"`);
  assert.equal(n, 6);
});

await prueba("madres permitidas: Área <- Área, Idea <- Área y Tarea <- Idea, sin mezclar tableros", async () => {
  const pares = await filas(`
    SELECT h."tableroId" AS tablero, h."nombre" AS hija, m."nombre" AS madre, m."tableroId" AS tablero_madre
    FROM "TipoTarjetaPadre" p
    JOIN "TipoTarjeta" h ON h."id" = p."tipoId"
    JOIN "TipoTarjeta" m ON m."id" = p."tipoPadreId"
    ORDER BY 1, 2, 3`);
  assert.deepEqual(
    pares.map((p) => [p.tablero, p.hija, p.madre]),
    [
      ["tab1", "Idea", "Área"],
      ["tab1", "Tarea", "Idea"],
      ["tab1", "Área", "Área"],
      ["tab2", "Idea", "Área"],
      ["tab2", "Tarea", "Idea"],
      ["tab2", "Área", "Área"],
    ],
  );
  for (const p of pares) assert.equal(p.tablero, p.tablero_madre);
});

await prueba("todas las tarjetas que ya existían quedan como Tarea de SU tablero, sin cambiar de estado", async () => {
  const tarjetas = await filas(`
    SELECT c."id", c."estado", c."tableroId", t."nombre", t."tableroId" AS tablero_tipo,
           c."padreId", c."link", c."linkTexto", c."borradoEn"
    FROM "TarjetaTablero" c JOIN "TipoTarjeta" t ON t."id" = c."tipoId" ORDER BY c."id"`);
  assert.equal(tarjetas.length, 6);
  for (const tarjeta of tarjetas) {
    assert.equal(tarjeta.nombre, "Tarea", tarjeta.id);
    assert.equal(tarjeta.tableroId, tarjeta.tablero_tipo, tarjeta.id);
    assert.equal(tarjeta.padreId, null);
    assert.equal(tarjeta.link, null);
    assert.equal(tarjeta.linkTexto, null);
    assert.equal(tarjeta.borradoEn, null);
  }
  assert.deepEqual(
    tarjetas.map((t) => [t.id, t.estado]),
    estadosAntes.map((t) => [t.id, t.estado]),
  );
});

await prueba("flechas e historial siguen intactos", async () => {
  const [{ f }] = await filas(`SELECT count(*)::int AS f FROM "ConexionTarjeta"`);
  const [{ h }] = await filas(`SELECT count(*)::int AS h FROM "HistorialTarjeta"`);
  assert.equal(f, 3);
  assert.equal(h, 1);
});

await prueba("tipoId quedó NOT NULL; padreId, link, linkTexto y borradoEn aceptan nulo", async () => {
  const columnas = await filas(`
    SELECT column_name, is_nullable, data_type FROM information_schema.columns
    WHERE table_name = 'TarjetaTablero' AND column_name IN ('tipoId', 'padreId', 'link', 'linkTexto', 'borradoEn')
    ORDER BY column_name`);
  const mapa = Object.fromEntries(columnas.map((c) => [c.column_name, c]));
  assert.equal(mapa.tipoId.is_nullable, "NO");
  for (const c of ["padreId", "link", "linkTexto", "borradoEn"]) assert.equal(mapa[c].is_nullable, "YES", c);
  const [usa] = await filas(`SELECT is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'TipoTarjeta' AND column_name = 'usaEstados'`);
  assert.equal(usa.is_nullable, "NO");
  assert.equal(usa.column_default, "true");
  assert.match(mapa.borradoEn.data_type, /timestamp/);
  await assert.rejects(
    db.query(`INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "creadoPor", "actualizadoEn")
              VALUES ('sin-tipo', 'tab1', 'x', 'u1', now())`),
    /null value|not-null/i,
  );
});

await prueba("aplicarla otra vez no falla ni duplica nada", async () => {
  await db.exec(leer(NUEVA));
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "TipoTarjeta"`);
  const [{ p }] = await filas(`SELECT count(*)::int AS p FROM "TipoTarjetaPadre"`);
  assert.equal(n, 6);
  assert.equal(p, 6);
});

await prueba("restricciones: tipo en uso no se borra, madre borrada deja la hija suelta, sin pares repetidos", async () => {
  const [tarea] = await filas(`SELECT "id" FROM "TipoTarjeta" WHERE "tableroId" = 'tab1' AND "nombre" = 'Tarea'`);
  const [idea] = await filas(`SELECT "id" FROM "TipoTarjeta" WHERE "tableroId" = 'tab1' AND "nombre" = 'Idea'`);
  await assert.rejects(db.query(`DELETE FROM "TipoTarjeta" WHERE "id" = $1`, [tarea.id]), /foreign key|violates/i);
  await assert.rejects(
    db.query(`INSERT INTO "TipoTarjetaPadre" ("tipoId", "tipoPadreId") SELECT "tipoId", "tipoPadreId" FROM "TipoTarjetaPadre" LIMIT 1`),
    /unique|duplicate/i,
  );
  await assert.rejects(
    db.query(`INSERT INTO "TipoTarjeta" ("id", "tableroId", "nombre") VALUES ('dup', 'tab1', 'Idea')`),
    /unique|duplicate/i,
  );
  await db.exec(`
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "creadoPor", "actualizadoEn", "tipoId")
      VALUES ('madre', 'tab1', 'Magilus', 'u1', now(), '${idea.id}');
    INSERT INTO "TarjetaTablero" ("id", "tableroId", "titulo", "creadoPor", "actualizadoEn", "tipoId", "padreId")
      VALUES ('hija', 'tab1', 'Ventas', 'u1', now(), '${tarea.id}', 'madre');
    DELETE FROM "TarjetaTablero" WHERE "id" = 'madre';
  `);
  const [hija] = await filas(`SELECT "padreId" FROM "TarjetaTablero" WHERE "id" = 'hija'`);
  assert.equal(hija.padreId, null);
  // Un tipo sin tarjetas sí se borra, y se lleva sus madres permitidas (Área <- Área e Idea <- Área).
  const [area] = await filas(`SELECT "id" FROM "TipoTarjeta" WHERE "tableroId" = 'tab2' AND "nombre" = 'Área'`);
  await db.query(`DELETE FROM "TipoTarjeta" WHERE "id" = $1`, [area.id]);
  const [{ p }] = await filas(`SELECT count(*)::int AS p FROM "TipoTarjetaPadre"`);
  assert.equal(p, 4);
});

await prueba("borrar el tablero se lleva sus tipos y tarjetas (cascada)", async () => {
  await db.exec(`DELETE FROM "TableroInteligente" WHERE "id" = 'tab2'`);
  const [{ n }] = await filas(`SELECT count(*)::int AS n FROM "TipoTarjeta" WHERE "tableroId" = 'tab2'`);
  const [{ c }] = await filas(`SELECT count(*)::int AS c FROM "TarjetaTablero" WHERE "tableroId" = 'tab2'`);
  assert.equal(n, 0);
  assert.equal(c, 0);
});

await db.close();
console.log(`\n${pruebas} pruebas, todas bien`);
