// Toda Tarea nueva cae sola en Features (27-nov-2026): el Coordinador solo toma lo que cuelga de Features (T-736).
// Una Tarea nueva sin padre del tablero de Features queda dentro de Features; si trae un padre fuera de Features, se crea
// igual con aviso_features. Prueba la parte pura (reglas-features.ts) y, por texto, que crearTarjeta, crear_tarjeta y
// las instrucciones del servidor MCP la usan. Sin base ni red.
// Correr: npm run test:tareas-a-features
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cargar } from "./supervisor-cargar.mjs";

const f = cargar("src/features/tableros-inteligentes/services/reglas-features.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const TABLERO = f.TABLERO_DE_FEATURES_ID;
const FEATURES = f.TARJETA_AREA_FEATURES_ID;
const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

await prueba("los textos de la regla y del aviso son los de la tarjeta", () => {
  assert.equal(
    f.REGLA_TAREAS_EN_FEATURES,
    "Si es un desarrollo nuevo o una corrección en Gestión o en el CRM, créala como Tarea dentro de Features (T-736), con repo gestion o aizencrm. Las Ideas son solo notas y no van a Features.",
  );
  assert.equal(f.AVISO_TAREA_FUERA_DE_FEATURES, "Esta Tarea no la va a tomar el Coordinador; muévela a Features (T-736).");
  assert.equal(f.NOTA_PUESTA_EN_FEATURES, "puesta dentro de Features sola");
});

await prueba("padreParaTareaNueva: una Tarea sin padre del tablero de Features va a Features", () => {
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Tarea" }, padreId: null }), FEATURES);
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Tarea" }, padreId: undefined }), FEATURES);
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: "tarea", padreId: null }), FEATURES, "por nombre, sin mayúsculas");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: " TAREA " }, padreId: "" }), FEATURES, "padre vacío = sin padre");
});

await prueba("padreParaTareaNueva: otro tablero, Idea, Área o una Tarea con padre no se tocan", () => {
  assert.equal(f.padreParaTareaNueva({ tableroId: "otroTablero", tipo: { nombre: "Tarea" }, padreId: null }), null, "otro tablero");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Idea" }, padreId: null }), null, "Idea");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Área" }, padreId: null }), null, "Área");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Tarea" }, padreId: "otraArea" }), "otraArea", "Tarea con padre");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: { nombre: "Idea" }, padreId: "otraArea" }), "otraArea", "Idea con padre");
  assert.equal(f.padreParaTareaNueva({ tableroId: TABLERO, tipo: null, padreId: null }), null, "sin tipo");
});

await prueba("esTipoTarea y padreEstaEnFeatures", () => {
  assert.equal(f.esTipoTarea({ nombre: "Tarea" }), true);
  assert.equal(f.esTipoTarea({ nombre: "Idea" }), false);
  assert.equal(f.esTipoTarea({ nombre: "Área" }), false);
  assert.equal(f.esTipoTarea(undefined), false);
  assert.equal(f.padreEstaEnFeatures(FEATURES, []), true, "el padre es Features");
  assert.equal(f.padreEstaEnFeatures("idea1", ["sub", FEATURES, "raiz"]), true, "Features más arriba");
  assert.equal(f.padreEstaEnFeatures("otra", ["raiz"]), false, "fuera de Features");
  assert.equal(f.padreEstaEnFeatures("suelta", []), false, "padre suelto");
});

await prueba("la regla está en la descripción de crear_tarjeta y aviso_features sale en su respuesta", () => {
  const mcp = leer("src/lib/mcp/tableros-inteligentes.ts");
  assert.match(mcp, /import \{ REGLA_TAREAS_EN_FEATURES \} from "@\/features\/tableros-inteligentes\/services\/reglas-features";/);
  const definicion = mcp.slice(mcp.indexOf('name: "crear_tarjeta"'), mcp.indexOf("inputSchema", mcp.indexOf('name: "crear_tarjeta"')));
  assert.ok(definicion.includes("REGLA_TAREAS_EN_FEATURES +"), "la descripción de crear_tarjeta usa la regla");
  assert.ok(definicion.includes(f.REGLA_TAREAS_EN_FEATURES), "el texto de la regla queda a la vista en crear_tarjeta (igual a la constante)");
  const respuesta = mcp.slice(mcp.indexOf('case "crear_tarjeta": {'), mcp.indexOf('case "editar_tarjeta": {'));
  assert.ok(respuesta.includes("...(resultado.avisoFeatures ? { aviso_features: resultado.avisoFeatures } : {}),"), "aviso_features solo cuando viene");
});

await prueba("la regla está en las instrucciones del servidor MCP, en la parte del TABLERO IA", () => {
  const ruta = leer("src/app/api/mcp/route.ts");
  assert.match(ruta, /import \{ REGLA_TAREAS_EN_FEATURES \} from "@\/features\/tableros-inteligentes\/services\/reglas-features";/);
  const tablero = ruta.indexOf("TABLERO IA");
  assert.ok(tablero > 0);
  const parte = ruta.slice(tablero, ruta.indexOf("TRABAJADOR (fase 2)", tablero));
  assert.ok(parte.includes("${REGLA_TAREAS_EN_FEATURES}"), "las instrucciones usan la regla");
  assert.ok(parte.includes(f.REGLA_TAREAS_EN_FEATURES), "el texto de la regla queda a la vista (igual a la constante)");
});

await prueba("crearTarjeta usa padreParaTareaNueva, revisarMadre sin fallar, SQL_ANCESTROS, la nota y aviso_features", () => {
  const servicio = leer("src/features/tableros-inteligentes/services/tableros.ts");
  const inicio = servicio.indexOf("export async function crearTarjeta(");
  const crear = servicio.slice(inicio, servicio.indexOf("\n}\n", inicio));
  assert.ok(crear.includes("padreParaTareaNueva({ tableroId: tablero.id, tipo, padreId: padrePedido })"));
  assert.match(crear, /try \{\s*await revisarMadre\(\{[^}]*\}, padreId, tipos\);\s*puestaEnFeatures = true;\s*\} catch \{\s*padreId = null;\s*avisoFeatures = AVISO_TAREA_FUERA_DE_FEATURES;/);
  assert.ok(crear.includes("...(puestaEnFeatures ? { nota: NOTA_PUESTA_EN_FEATURES } : {}),"), "la nota en el historial de la creación");
  assert.ok(crear.includes("!(await padreCuelgaDeFeatures(padreId))"), "Tarea con padre: mira la cadena de madres");
  assert.ok(crear.includes("aprobacionAutomatica: aprobacion.resultado, avisoFeatures }"), "devuelve avisoFeatures");
  const sube = servicio.slice(servicio.indexOf("async function padreCuelgaDeFeatures("));
  assert.ok(sube.slice(0, 600).includes("$queryRawUnsafe<{ id: string; ancestros: string[] }[]>(SQL_ANCESTROS, [padreId])"));
});

console.log(`\n${pruebas} pruebas: todas bien`);
