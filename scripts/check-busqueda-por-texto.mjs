// La busqueda de chats por texto de mensaje, APARTE de la lista (Alex, 10-11-2026):
//  - la lista (y la pagina, el refresco y el scroll) buscan solo por nombre y numero;
//  - los chats con el texto en un mensaje salen de /list?soloPorMensaje=1, al final;
//  - la consulta de mensajes es un ILIKE sobre `content` y `transcripcion` solas (indices pg_trgm);
//  - la migracion solo asegura la extension y los dos indices.
// Correr: node scripts/check-busqueda-por-texto.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

async function importarTs(relativo) {
  const js = ts.transpileModule(fs.readFileSync(path.resolve(relativo), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}
const leer = (relativo) => fs.readFileSync(path.resolve(relativo), "utf8");

const busqueda = await importarTs("src/lib/busqueda-de-chats.ts");
const { filasDelBuscador } = await importarTs("src/components/chats/filas-del-buscador.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const ahora = new Date("2026-11-10T12:00:00Z");
const tieneMensajes = (where) => JSON.stringify(where).includes('"messages"');

// ---------------------------------------------------------------- el where de la busqueda

prueba("nombreYNumero no mira los mensajes, ni con un texto largo", () => {
  const where = busqueda.whereDeBusquedaDeChats("camiseta roja", ahora, "nombreYNumero");
  assert.equal(tieneMensajes(where), false);
  assert.ok(JSON.stringify(where).includes('"name"'));
  assert.ok(JSON.stringify(where).includes('"phoneNumber"'));
});

prueba("nombreYNumero sigue buscando las cifras del telefono", () => {
  const where = busqueda.whereDeBusquedaDeChats("+57 301 217 5617", ahora, "nombreYNumero");
  const cadenas = where.OR.map((c) => c.contact?.phoneNumber?.contains).filter(Boolean);
  assert.ok(cadenas.includes("3012175617"));
});

prueba("mensajes: solo los mensajes, en content y transcripcion, 90 dias, sin nombre ni numero", () => {
  const where = busqueda.whereDeBusquedaDeChats(" Cali ", ahora, "mensajes");
  assert.equal(JSON.stringify(where).includes('"contact"'), false);
  const some = where.messages.some;
  assert.equal(some.createdAt.gte.toISOString(), "2026-08-12T12:00:00.000Z");
  // Cada columna sola, con contains insensible: Prisma lo escribe `"columna" ILIKE '%cali%'`,
  // que es lo que pueden usar los indices GIN de pg_trgm.
  assert.deepEqual(some.OR, [
    { content: { contains: "Cali", mode: "insensitive" } },
    { transcripcion: { contains: "Cali", mode: "insensitive" } },
  ]);
});

prueba("mensajes con menos de 4 letras no devuelve ningun chat", () => {
  assert.deepEqual(busqueda.whereDeBusquedaDeChats("cal", ahora, "mensajes"), { id: { in: [] } });
  assert.equal(busqueda.buscaEnMensajes("cal"), false);
  assert.equal(busqueda.buscaEnMensajes(" cali "), true);
  assert.equal(busqueda.buscaEnMensajes(undefined), false);
});

prueba("todo (los contadores) sigue con nombre, numero y mensajes", () => {
  const where = busqueda.whereDeBusquedaDeChats("Cali", ahora);
  assert.equal(tieneMensajes(where), true);
  assert.ok(JSON.stringify(where).includes('"name"'));
  assert.equal(tieneMensajes(busqueda.whereDeBusquedaDeChats("Cal", ahora)), false);
});

prueba("sin texto la busqueda no agrega nada en ninguna parte", () => {
  for (const partes of ["todo", "nombreYNumero", "mensajes"]) {
    assert.deepEqual(busqueda.whereDeBusquedaDeChats("  ", ahora, partes), {});
  }
});

prueba("la lista lee la parte: soloPorMensaje=1 o, si no, nombre y numero", () => {
  const de = (qs) => busqueda.partesDeLaBusquedaDeLaLista((clave) => new URLSearchParams(qs).get(clave));
  assert.equal(de("q=cali&soloPorMensaje=1"), "mensajes");
  assert.equal(de("q=cali&soloNombreYNumero=1"), "nombreYNumero");
  // El refresco, el scroll y las pestañas viejas no mandan nada: tampoco miran mensajes.
  assert.equal(de("q=cali"), "nombreYNumero");
  assert.equal(de(""), "nombreYNumero");
});

prueba("la oficial sigue buscando en el texto de sus mensajes (no tiene transcripcion)", () => {
  const where = busqueda.whereDeBusquedaDeChatsOficiales("Cali", ahora);
  const conMensajes = where.OR.find((c) => c.messages);
  assert.deepEqual(conMensajes.messages.some.content, { contains: "Cali", mode: "insensitive" });
  assert.equal(JSON.stringify(where).includes("transcripcion"), false);
});

// ---------------------------------------------------------------- el orden de lo que se muestra

const fila = (id, extra = {}) => ({ id, ...extra });

prueba("primero nombre/numero, despues los de mensaje, sin repetir", () => {
  const filas = filasDelBuscador({
    porNombreYNumero: [fila("a"), fila("b")],
    porMensaje: [fila("c"), fila("b"), fila("d"), fila("c")],
    actuales: new Map(),
    pasa: () => true,
  });
  assert.deepEqual(filas.map((f) => f.id), ["a", "b", "c", "d"]);
});

prueba("sin los de mensaje queda la MISMA lista (no se vuelve a dibujar)", () => {
  const porNombreYNumero = [fila("a")];
  const filas = filasDelBuscador({ porNombreYNumero, porMensaje: [], actuales: new Map(), pasa: () => true });
  assert.equal(filas, porNombreYNumero);
});

prueba("un chat que la bandeja ya tiene sale con su fila de la bandeja", () => {
  const vieja = fila("c", { lastMessage: "viejo" });
  const actual = fila("c", { lastMessage: "nuevo" });
  const filas = filasDelBuscador({
    porNombreYNumero: [],
    porMensaje: [vieja],
    actuales: new Map([["c", actual]]),
    pasa: () => true,
  });
  assert.equal(filas[0], actual);
});

prueba("los de mensaje pasan por el mismo filtro de estado", () => {
  const filas = filasDelBuscador({
    porNombreYNumero: [fila("a")],
    porMensaje: [fila("c", { status: "CLOSED" }), fila("d", { status: "OPEN" })],
    actuales: new Map(),
    pasa: (f) => f.status !== "CLOSED",
  });
  assert.deepEqual(filas.map((f) => f.id), ["a", "d"]);
});

// ---------------------------------------------------------------- quien usa que parte

prueba("la pagina busca solo por nombre y numero", () => {
  assert.match(leer("src/app/cliente/chats/page.tsx"), /whereDeBusquedaDeChats\(searchQuery, new Date\(\), "nombreYNumero"\)/);
});

prueba("/list pasa la parte pedida y no trae la oficial en la parte por mensaje", () => {
  const ruta = leer("src/app/api/cliente/chats/list/route.ts");
  assert.match(ruta, /partesDeLaBusquedaDeLaLista\(/);
  assert.match(ruta, /whereDeBusquedaDeChats\(normalizedSearchQuery, new Date\(\), partesDeLaBusqueda\)/);
  assert.match(ruta, /partesDeLaBusqueda !== "mensajes"/);
  assert.match(ruta, /partesDeLaBusqueda === "mensajes" && !buscaEnMensajes\(searchQuery\)/);
});

prueba("la bandeja pide nombre/numero primero y despues por mensaje, con el mismo AbortController", () => {
  const bandeja = leer("src/components/chats/shared-inbox.tsx");
  const primero = bandeja.indexOf('pedir("soloNombreYNumero")');
  const despues = bandeja.indexOf('pedir("soloPorMensaje")');
  assert.ok(primero > 0 && despues > primero);
  assert.match(bandeja, /signal: controller\.signal/);
  assert.match(bandeja, /if \(!buscaEnMensajes\(q\) \|\| !sigueVigente\(\)\) return;/);
  // La seccion "Mensajes" del buscador se conserva.
  assert.match(bandeja, /\/api\/cliente\/chats\/buscar-mensajes\?q=/);
});

// ---------------------------------------------------------------- la migracion

prueba("la migracion solo asegura pg_trgm y los dos indices, en una transaccion, y no falla sin la extension", () => {
  const sql = leer("prisma/migrations/20261116000100_busqueda_por_texto/migration.sql");
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE)\b/i);
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
  const plano = sql.replace(/--.*$/gm, "").replace(/\s+/g, " ");
  assert.ok(plano.includes("CREATE EXTENSION IF NOT EXISTS pg_trgm;"));
  // Sin la extension (PGlite) no debe fallar: el error se captura y los indices solo se crean si existe.
  assert.ok(plano.includes("EXCEPTION WHEN OTHERS THEN"));
  assert.ok(plano.includes("IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN"));
  assert.ok(
    plano.includes(
      'CREATE INDEX IF NOT EXISTS "Message_content_trgm_idx" ON "Message" USING gin ("content" gin_trgm_ops) WHERE "content" IS NOT NULL;',
    ),
  );
  assert.ok(
    plano.includes(
      'CREATE INDEX IF NOT EXISTS "Message_transcripcion_trgm_idx" ON "Message" USING gin ("transcripcion" gin_trgm_ops) WHERE "transcripcion" IS NOT NULL;',
    ),
  );
});

prueba("schema.prisma no declara los indices de trigramas", () => {
  assert.doesNotMatch(leer("prisma/schema.prisma"), /trgm/i);
});

console.log(`\n${pruebas} pruebas ok`);
