// Revision estatica del orden de la bandeja (`?orden=antiguos`, parte 2 de 3).
//
// La primera pagina (page.tsx), el scroll y los refrescos (/api/cliente/chats/list) y el canal
// oficial (getOfficialApiChatsData) tienen que ordenar IGUAL. Si uno vuelve a un orden fijo de
// lastMessageAt, la segunda pagina repite o salta chats con `orden=antiguos`.
//
// Solo lee el codigo: no corre la ruta ni toca la base.
// Correr: npm run test:orden-bandeja  (o: node scripts/check-orden-bandeja.mjs [carpeta-raiz])
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(process.argv[2] ?? ".");
const leer = (relativo) => fs.readFileSync(path.join(raiz, relativo), "utf8");

const PAGINA = "src/app/cliente/chats/page.tsx";
const RUTA = "src/app/api/cliente/chats/list/route.ts";
const OFICIAL = "src/features/official-api/services/getOfficialApiChatsData.ts";

const fallas = [];
let pruebas = 0;
function prueba(nombre, fn) {
  pruebas += 1;
  try {
    fn();
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.error(`FALLA - ${nombre}: ${error.message}`);
  }
}
function exige(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
const veces = (texto, buscado) => texto.split(buscado).length - 1;
// Un orderBy de Prisma armado a mano con lastMessageAt (el de antes de `ordenDeBandeja`).
const ORDER_BY_FIJO = /orderBy:\s*\[?\s*\{\s*lastMessageAt:\s*["'](?:asc|desc)["']/;

const pagina = leer(PAGINA);
const ruta = leer(RUTA);
const oficial = leer(OFICIAL);

// --- page.tsx: la primera pagina -------------------------------------------------------------
prueba("page.tsx: la lista no usa un orderBy fijo de lastMessageAt", () => {
  exige(!ORDER_BY_FIJO.test(pagina), "hay un orderBy fijo de lastMessageAt; tiene que ser ordenDeBandeja(...)");
});
prueba("page.tsx: la lista ordena con ordenDeBandeja(ordenDeLaLista)", () => {
  exige(pagina.includes("orderBy: ordenDeBandeja(ordenDeLaLista)"), "falta orderBy: ordenDeBandeja(ordenDeLaLista)");
});
prueba("page.tsx: buscando o en Esperando el orden no cuenta", () => {
  exige(
    /const ordenDeLaLista = searchQuery \|\| pideEspera \? undefined : filtros\.orden;/.test(pagina),
    "ordenDeLaLista tiene que ser undefined con busqueda o con espera=1",
  );
});
prueba("page.tsx: la mezcla de las dos fuentes recibe el mismo orden", () => {
  exige(
    /dedupeAndSortConversationListRows\(\[[\s\S]*?\],\s*ordenDeLaLista\s*\)/.test(pagina),
    "dedupeAndSortConversationListRows no recibe ordenDeLaLista",
  );
});

// --- list/route.ts: scroll y refrescos -------------------------------------------------------
prueba("route.ts: la lista no usa un orden fijo", () => {
  exige(!ORDER_BY_FIJO.test(ruta), "hay un orderBy fijo de lastMessageAt");
  exige(!/orderBy:\s*ORDEN_DE_BANDEJA\b/.test(ruta), "orderBy: ORDEN_DE_BANDEJA es fijo; tiene que ser ordenDeBandeja(orden)");
});
prueba("route.ts: ordena con ordenDeBandeja(orden)", () => {
  exige(ruta.includes("orderBy: ordenDeBandeja(orden)"), "falta orderBy: ordenDeBandeja(orden)");
});
prueba("route.ts: el cursor sigue el mismo orden", () => {
  exige(
    ruta.includes("whereDespuesDelCursor(input.cursor, orden)"),
    "falta whereDespuesDelCursor(input.cursor, orden)",
  );
});
prueba("route.ts: buscando el orden no cuenta", () => {
  exige(
    /const orden = searchQuery \? undefined : filtros\.orden;/.test(ruta),
    "orden tiene que ser undefined con texto en el buscador",
  );
});
prueba("route.ts: las dos mezclas reciben el orden", () => {
  exige(/dedupeAndSortConversationListRows\(agentRows, orden\)/.test(ruta), "la mezcla de la lista no recibe orden");
  exige(
    /dedupeAndSortConversationListRows\(\s*\[\.\.\.datosDeLista\.conversations, \.\.\.filasOficiales\][\s\S]*?,\s*orden,?\s*\)/.test(
      ruta,
    ),
    "la mezcla con incluirOficial no recibe orden",
  );
});
prueba("route.ts: Esperando sigue con su propio orden", () => {
  const inicio = ruta.indexOf("async function responderEsperando(");
  exige(inicio >= 0, "no se encontro responderEsperando");
  const cuerpo = ruta.slice(inicio);
  exige(cuerpo.includes("filtros: SIN_FILTROS"), "responderEsperando tiene que seguir con SIN_FILTROS");
  exige(!/\borden\b\s*[,:]/.test(cuerpo.slice(0, cuerpo.indexOf("\n}\n"))), "responderEsperando no debe pasar orden");
});

// --- getOfficialApiChatsData.ts: el canal oficial --------------------------------------------
const DESC_C = 'c."lastMessageAt" DESC NULLS LAST, c."updatedAt" DESC';
const ASC_C = 'c."lastMessageAt" ASC NULLS FIRST, c."updatedAt" ASC';
const DESC_FC = 'fc."lastMessageAt" DESC NULLS LAST, fc."updatedAt" DESC';
const ASC_FC = 'fc."lastMessageAt" ASC NULLS FIRST, fc."updatedAt" ASC';

prueba('oficial: esta la variante "lastMessageAt" ASC NULLS FIRST', () => {
  exige(oficial.includes('"lastMessageAt" ASC NULLS FIRST'), 'falta "lastMessageAt" ASC NULLS FIRST');
  exige(oficial.includes(`Prisma.sql\`${ASC_C}\``), `falta Prisma.sql\`${ASC_C}\``);
  exige(oficial.includes(`Prisma.sql\`${ASC_FC}\``), `falta Prisma.sql\`${ASC_FC}\``);
});
prueba("oficial: sin orden queda el texto de hoy (DESC NULLS LAST, ... DESC)", () => {
  exige(oficial.includes(`Prisma.sql\`${DESC_C}\``), `falta Prisma.sql\`${DESC_C}\``);
  exige(oficial.includes(`Prisma.sql\`${DESC_FC}\``), `falta Prisma.sql\`${DESC_FC}\``);
});
prueba("oficial: se elige entre dos textos fijos segun filtros.orden", () => {
  exige(/const pideAntiguos = input\.filtros\?\.orden === "antiguos";/.test(oficial), "falta pideAntiguos");
  exige(/const ordenDeLaListaOficial = pideAntiguos\s*\?\s*Prisma\.sql`/.test(oficial), "ordenDeLaListaOficial no es un Prisma.sql fijo");
  exige(/const ordenDeLaListaOficialFc = pideAntiguos\s*\?\s*Prisma\.sql`/.test(oficial), "ordenDeLaListaOficialFc no es un Prisma.sql fijo");
  exige(!oficial.includes("Prisma.raw"), "no se usa Prisma.raw");
});
prueba("oficial: las consultas sin busqueda usan el orden elegido", () => {
  exige(oficial.includes("ORDER BY ${ordenDeLaListaOficial}\n"), "la consulta de filtered_conversations no usa ordenDeLaListaOficial");
  exige(oficial.includes("ORDER BY ${ordenDeLaListaOficialFc}\n"), "el SELECT final no usa ordenDeLaListaOficialFc");
});
prueba("oficial: la consulta con busqueda sigue con su orden fijo", () => {
  exige(veces(oficial, `ORDER BY ${DESC_C}\n`) === 1, "la consulta con busqueda tiene que quedar con su ORDER BY de hoy (una sola vez)");
  exige(!oficial.includes(`ORDER BY ${DESC_FC}`), "el SELECT final no debe quedar con el orden fijo");
  exige(!oficial.includes(`ORDER BY ${ASC_C}`) && !oficial.includes(`ORDER BY ${ASC_FC}`), "ASC no va escrito fijo en un ORDER BY");
});

if (fallas.length) {
  console.error(`\n${fallas.length} de ${pruebas} revisiones fallaron.`);
  process.exit(1);
}
console.log(`\n${pruebas} revisiones ok.`);
