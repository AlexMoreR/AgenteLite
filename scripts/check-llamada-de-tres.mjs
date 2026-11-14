// Pruebas de la llamada de tres, parte 1: la mezcla de sonido
// (src/features/llamadas/components/puente-de-llamadas.ts) y el servidor que marca por otra linea
// (src/app/api/wacalls/llamada/route.ts y src/lib/wacalls.ts).
// Parte 2: el hook (src/features/llamadas/components/useLlamada.ts) maneja dos llamadas y las une.
// Correr: npm run test:llamada-de-tres
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/features/llamadas/components/puente-de-llamadas.ts");
const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const mod = { exports: {} };
new Function("exports", "require", "module", "__filename", "__dirname", transpiled.outputText)(
  mod.exports,
  require,
  mod,
  sourcePath,
  path.dirname(sourcePath),
);
const { sumarPcm, mezclaParaLlamada, mezclaParaParlante } = mod.exports;

const ruta = fs.readFileSync(path.resolve("src/app/api/wacalls/llamada/route.ts"), "utf8");
const wacalls = fs.readFileSync(path.resolve("src/lib/wacalls.ts"), "utf8");
const hook = fs.readFileSync(path.resolve("src/features/llamadas/components/useLlamada.ts"), "utf8");

/** El cuerpo de `const <nombre> = useCallback(` hasta el cierre de esa llamada (por llaves). */
function cuerpoDe(fuente, inicio) {
  const desde = fuente.indexOf(inicio);
  assert.ok(desde >= 0, `no se encontro "${inicio}"`);
  const abre = fuente.indexOf("{", desde);
  let nivel = 0;
  for (let i = abre; i < fuente.length; i += 1) {
    if (fuente[i] === "{") nivel += 1;
    else if (fuente[i] === "}") {
      nivel -= 1;
      if (nivel === 0) return fuente.slice(desde, i + 1);
    }
  }
  throw new Error(`no se cerro "${inicio}"`);
}

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const pcm = (...muestras) => Int16Array.from(muestras);
const lista = (x) => Array.from(x);

prueba("la suma va muestra por muestra", () => {
  const r = sumarPcm(pcm(1, 2, 3, -4), pcm(10, -20, 30, 40));
  assert.ok(r instanceof Int16Array);
  assert.deepEqual(lista(r), [11, -18, 33, 36]);
});

prueba("la suma nunca pasa de 32767 ni de -32768", () => {
  const r = sumarPcm(pcm(32767, 30000, -32768, -30000, 20000), pcm(1, 30000, -1, -30000, -20000));
  assert.deepEqual(lista(r), [32767, 32767, -32768, -32768, 0]);
  const fuerte = sumarPcm(new Int16Array(320).fill(32767), new Int16Array(320).fill(32767));
  assert.ok(lista(fuerte).every((m) => m === 32767), "no da la vuelta a negativo");
});

prueba("si un paquete es mas corto, lo que falta cuenta como silencio", () => {
  assert.deepEqual(lista(sumarPcm(pcm(1, 2, 3, 4), pcm(10))), [11, 2, 3, 4]);
  assert.deepEqual(lista(sumarPcm(pcm(), pcm(5, 6))), [5, 6]);
});

prueba("la suma no cambia los paquetes que recibe", () => {
  const a = pcm(1, 2);
  const b = pcm(3, 4);
  sumarPcm(a, b);
  assert.deepEqual(lista(a), [1, 2]);
  assert.deepEqual(lista(b), [3, 4]);
});

const microfono = pcm(100, 200, 300);
const llamadaA = pcm(1, 2, 3);
const llamadaB = pcm(1000, 2000, 3000);

prueba("la llamada A recibe microfono + B, y la llamada B recibe microfono + A", () => {
  const paraA = mezclaParaLlamada({ microfono, otraLlamada: llamadaB, silenciado: false });
  const paraB = mezclaParaLlamada({ microfono, otraLlamada: llamadaA, silenciado: false });
  assert.deepEqual(lista(paraA), [1100, 2200, 3300]);
  assert.deepEqual(lista(paraB), [101, 202, 303]);
});

prueba("con Alexander silenciado, A sigue recibiendo el sonido de B (y B el de A)", () => {
  const paraA = mezclaParaLlamada({ microfono, otraLlamada: llamadaB, silenciado: true });
  const paraB = mezclaParaLlamada({ microfono, otraLlamada: llamadaA, silenciado: true });
  assert.deepEqual(lista(paraA), lista(llamadaB));
  assert.deepEqual(lista(paraB), lista(llamadaA));
  assert.deepEqual(lista(microfono), [100, 200, 300], "silenciar no borra el microfono original");
});

prueba("el parlante suena A + B", () => {
  assert.deepEqual(lista(mezclaParaParlante(llamadaA, llamadaB)), [1001, 2002, 3003]);
});

prueba("route.ts: el permiso del modulo llamadas se pide antes de cualquier accion", () => {
  const permiso = ruta.indexOf('canAccessClientModule(access, "llamadas")');
  assert.ok(permiso > 0, "falta el control de permiso del modulo llamadas");
  const despues = [
    ruta.indexOf("await request.json()"),
    ruta.indexOf("getLineasDelNegocio(access.workspaceId)"),
    ruta.indexOf("getWaCallsSessionIdForChannel("),
    ruta.indexOf("switch (cuerpo.accion)"),
    ruta.indexOf("waCallsRequest<"),
  ];
  for (const posicion of despues) {
    assert.ok(posicion > permiso, `algo corre antes del permiso (posicion ${posicion})`);
  }
  // Si no tiene permiso, la ruta corta ahi mismo.
  assert.match(ruta.slice(permiso, permiso + 200), /status: 403/);
});

prueba("route.ts: la busqueda de otra linea filtra por el negocio de la sesion", () => {
  const llamadas = ruta.match(/getOtraLineaDelNegocio\(\s*([^,]+),/g) ?? [];
  assert.ok(llamadas.length >= 1, "iniciar no busca otra linea");
  for (const llamada of llamadas) {
    assert.match(llamada, /getOtraLineaDelNegocio\(\s*access\.workspaceId,/);
  }
  assert.ok(ruta.includes("No hay otra línea libre para agregar a alguien"));
  assert.match(ruta, /sessionId: linea/, "la respuesta de iniciar devuelve la linea usada");
  // Una linea que manda el navegador solo se acepta si es de este negocio.
  assert.match(ruta, /getLineasDelNegocio\(access\.workspaceId\)\)\.includes\(sidPedido\)/);
});

prueba("wacalls.ts: las lineas del negocio salen solo de canales de ese workspaceId", () => {
  const inicio = wacalls.indexOf("export async function getLineasDelNegocio(");
  assert.ok(inicio > 0);
  const cuerpo = wacalls.slice(inicio, wacalls.indexOf("\n}\n", inicio));
  assert.match(cuerpo, /where: \{ workspaceId, isActive: true \}/);
  const otra = wacalls.indexOf("export async function getOtraLineaDelNegocio(");
  assert.ok(otra > 0);
  assert.match(wacalls.slice(otra, wacalls.indexOf("\n}\n", otra)), /getLineasDelNegocio\(workspaceId\)/);
});

// --- Parte 2: el hook con dos llamadas ---

prueba("useLlamada.ts: usa las mezclas de puente-de-llamadas.ts", () => {
  assert.match(hook, /import \{[^}]*mezclaParaLlamada[^}]*mezclaParaParlante[^}]*\} from "\.\/puente-de-llamadas"/);
  const puente = cuerpoDe(hook, "const puentear = useCallback(");
  // A recibe microfono + B; B recibe microfono + A; el parlante, A + B.
  assert.match(puente, /enviarPcm\(principal, mezclaParaLlamada\(\{ microfono, otraLlamada: deB, silenciado \}\)/);
  assert.match(puente, /enviarPcm\(segundaLlamada, mezclaParaLlamada\(\{ microfono, otraLlamada: deA, silenciado \}\)/);
  assert.match(puente, /mezclaParaParlante\(deA, deB\)/);
});

prueba("useLlamada.ts: el sonido atrasado de cada llamada se bota con hayQueDescartar", () => {
  assert.match(cuerpoDe(hook, "function enviarPcm("), /hayQueDescartar\(cola\)/);
  assert.match(cuerpoDe(hook, "function guardarParaElPuente("), /hayQueDescartar\(enCola\)/);
});

prueba("useLlamada.ts: colgar la principal cuelga tambien la segunda", () => {
  const colgar = cuerpoDe(hook, "const colgar = useCallback(");
  assert.match(colgar, /soltarSegunda\(/, "colgar no pasa por la segunda llamada");
  assert.match(colgar, /accion: "colgar", callId/, "colgar no cuelga la principal");
  const soltar = cuerpoDe(hook, "const soltarSegunda = useCallback(");
  assert.match(soltar, /accion: "colgar", callId/, "soltarSegunda no cuelga en WaCalls");
  // Y al limpiar (el cliente colgo solo) tambien se va la segunda.
  assert.match(cuerpoDe(hook, "const limpiar = useCallback("), /soltarSegunda\(/);
});

prueba("useLlamada.ts: al cerrar la pestana (pagehide) se cuelgan las dos llamadas", () => {
  const efecto = hook.slice(hook.indexOf("const alCerrarPantalla = () => {"), hook.indexOf('removeEventListener("pagehide"'));
  assert.match(efecto, /colgarAlSalir\(\)/);
  assert.match(efecto, /reportarDiagnostico\(\)/);
  assert.match(cuerpoDe(hook, "const colgarAlSalir = useCallback("), /\[principalRef\.current, segundaRef\.current\]/);
  const diagnostico = cuerpoDe(hook, "const reportarDiagnostico = useCallback(");
  assert.match(diagnostico, /principalRef\.current/);
  assert.match(diagnostico, /segundaRef\.current/);
});

prueba("useLlamada.ts: agregarPersona marca por otra linea, una sola persona extra", () => {
  const agregar = cuerpoDe(hook, "const agregarPersona = useCallback(");
  assert.match(agregar, /accion: "iniciar"/);
  assert.match(agregar, /otraLineaDistintaDe: principal\.linea/);
  assert.match(agregar, /llamada\.linea = iniciada\.sessionId/, "no guarda la linea que devuelve la ruta");
  assert.match(agregar, /estadoSegundaRef\.current === "sonando" \|\| estadoSegundaRef\.current === "hablando"/);
  // Si falla, solo se toca la segunda: nada de colgar ni limpiar la principal.
  const atrapa = agregar.slice(agregar.indexOf("} catch (error) {"));
  assert.ok(!/limpiar\(|colgar\(\)|principal\.callId/.test(atrapa), "un error al agregar toca la llamada principal");
  // La segunda va a SU linea (sessionId), la principal sigue con el canal del chat.
  assert.match(hook, /porSuLinea \? \{ sessionId: llamada\.linea \?\? undefined \} : \{ channelId: llamada\.canalRef\.current \}/);
  assert.match(hook, /principalRef = useRef<Llamada>\(nuevaLlamada\(false\)\)/);
});

prueba("useLlamada.ts: quitarPersona cuelga solo la segunda; el hook expone segunda", () => {
  const quitar = cuerpoDe(hook, "const quitarPersona = useCallback(");
  assert.match(quitar, /soltarSegunda\(\)/);
  assert.ok(!/limpiar\(|cambiarEstado\(/.test(quitar), "quitarPersona toca la llamada principal");
  const devuelve = hook.slice(hook.lastIndexOf("return {"));
  for (const nombre of ["segunda", "agregarPersona", "quitarPersona"]) {
    assert.ok(devuelve.includes(nombre), `el hook no devuelve ${nombre}`);
  }
});

prueba("useLlamada.ts: con el puente andando, silenciar quita solo el microfono", () => {
  const silencio = cuerpoDe(hook, "const alternarSilencio = useCallback(");
  assert.ok(silencio.indexOf("silenciadoRef.current = siguiente") < silencio.indexOf("if (puenteRef.current)"));
  assert.ok(silencio.indexOf("if (puenteRef.current)") < silencio.indexOf('accion: "silenciar"'));
});

console.log(`\n${pruebas} pruebas ok`);
