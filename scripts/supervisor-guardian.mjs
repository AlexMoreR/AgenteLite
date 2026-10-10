// CHANGE GUARDIAN por línea de comandos: ¿este libro V3 rompe algún escenario dorado?
//
// No toca la base ni la red: lee archivos JSON exportados (en solo lectura) del libro y su historial.
//
//   node scripts/supervisor-guardian.mjs --candidato libro.json [--anterior otro.json]
//   node scripts/supervisor-guardian.mjs --historial historial.json --libro libro.json --versiones 178,181
//   node scripts/supervisor-guardian.mjs --historial historial.json --libro libro.json --todas
//
// Opcional: --flujos flujos.json  ({ "<flujoId>": { "pasos": 6, "textos": [...], "fotosOVideos": 4 } })
//           --producto <id del combo>  --flujo-fotos <id del flujo de fotos del combo>  --json
// Sale con código 1 si el veredicto es FALLA.
import { cargar, leerJson } from "./supervisor-cargar.mjs";

const args = process.argv.slice(2);
const opcion = (nombre) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const bandera = (nombre) => args.includes(`--${nombre}`);

const guardian = cargar("src/features/supervisor/dominio/guardian.ts");
const { escenariosDelCombo } = cargar("src/features/supervisor/dominio/escenarios.ts");
const { diffDelLibro } = cargar("src/features/supervisor/dominio/libro-diff.ts");

const flujos = opcion("flujos") ? leerJson(opcion("flujos")) : {};
const PRODUCTO = opcion("producto") ?? "cmp7lojx700bj2hn6z2vrv0i9";
const FLUJO_FOTOS = opcion("flujo-fotos") ?? "evolution:cmre8u9r9002g2gp1fqlzrsdj:workflow-1784124366501-74i1b";
const escenarios = escenariosDelCombo({ productoComboId: PRODUCTO, flujoFotosCombo: FLUJO_FOTOS });

function versiones() {
  const libro = opcion("libro") ? leerJson(opcion("libro")) : null;
  const historial = opcion("historial") ? leerJson(opcion("historial")) : [];
  const mapa = new Map(historial.map((fila) => [fila.version, { ...fila.libro, version: fila.version, vigenteDesde: null }]));
  // La versión N rige desde el `at` de la fila N-1 (el historial guarda la anterior con la hora del cambio).
  for (const fila of historial) {
    const siguiente = mapa.get(fila.version + 1);
    if (siguiente) siguiente.vigenteDesde = fila.at;
  }
  if (libro) {
    const previa = historial.find((fila) => fila.version === libro.version - 1);
    mapa.set(libro.version, { ...libro, vigenteDesde: previa?.at ?? libro.actualizadoEl });
  }
  return mapa;
}

function imprimir(informe, diff) {
  if (bandera("json")) {
    console.log(JSON.stringify({ informe, diff }, null, 2));
    return;
  }
  console.log(`\n=== Guardian v${informe.versionAnterior ?? "—"} → v${informe.versionCandidata}: ${informe.resumen}`);
  if (diff) console.log(`    Cambios: ${diff.resumen}`);
  for (const r of informe.regresiones) console.log(`  ✗ REGRESIÓN${r.critico ? " (crítico)" : ""} ${r.nombre}: antes "${r.antes}", ahora "${r.ahora}" → ${r.fallas.join("; ")}`);
  for (const r of informe.yaFallaban) console.log(`  ! ya fallaba${r.critico ? " (crítico)" : ""} ${r.nombre}: ${r.fallas.join("; ")}`);
  for (const r of informe.arreglados) console.log(`  ✓ arreglado ${r.nombre}`);
  for (const r of informe.cambiosDeRegla) console.log(`  · cambia la regla en "${r.nombre}": "${r.antes}" → "${r.ahora}"`);
}

let codigo = 0;
if (opcion("candidato")) {
  const candidato = leerJson(opcion("candidato"));
  const anterior = opcion("anterior") ? leerJson(opcion("anterior")) : null;
  const informe = guardian.correrGuardian({ candidato, anterior, escenarios, flujos });
  imprimir(informe, anterior ? diffDelLibro(anterior, candidato) : null);
  if (informe.veredicto === "FALLA") codigo = 1;
} else {
  const mapa = versiones();
  const lista = [...mapa.keys()].sort((a, b) => a - b);
  let pares = [];
  if (opcion("versiones")) {
    const [a, b] = opcion("versiones").split(",").map(Number);
    pares = [[a, b]];
  } else if (bandera("todas")) {
    pares = lista.slice(1).map((v, i) => [lista[i], v]);
  } else {
    pares = [[lista.at(-2), lista.at(-1)]];
  }
  for (const [a, b] of pares) {
    const anterior = mapa.get(a);
    const candidato = mapa.get(b);
    if (!anterior || !candidato) {
      console.log(`No están las versiones ${a} y ${b} en el historial.`);
      codigo = 2;
      continue;
    }
    const informe = guardian.correrGuardian({ candidato, anterior, escenarios, flujos });
    imprimir(informe, diffDelLibro(anterior, candidato));
    if (bandera("json")) continue;
    console.log(`    v${b} vigente desde ${candidato.vigenteDesde ?? "?"}`);
    if (informe.veredicto === "FALLA") codigo = 1;
  }
}
process.exit(codigo);
