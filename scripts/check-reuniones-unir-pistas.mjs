// Pruebas de las partes puras del módulo Reuniones: unir las pistas por hora, limpiar lo que
// devuelve whisper-1, los archivos de audio, el acta y lo que se lee de los avisos de LiveKit.
// Correr: npm run test:reuniones-unir-pistas
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { cargar } from "./supervisor-cargar.mjs";

// avisos-de-livekit importa @/lib/prisma: acá no se usa la base, alcanza con un objeto vacío.
// cargar() transpila sin esModuleInterop: los `import path from "node:path"` de los módulos buscan
// `.default`, así que se les pasa el módulo con su default (en Next eso lo resuelve el compilador).
const conDefault = (modulo) => ({ ...modulo, default: modulo });
const mocks = { "@/lib/prisma": { prisma: {} }, "node:path": conDefault(path), "node:os": conDefault(os) };
const { unirPistas, horaDeLaFrase, transcripcionEnTexto } = cargar("src/features/reuniones/servicios/unir-pistas.ts", mocks);
const { limpiarSegmentos } = cargar("src/features/reuniones/servicios/transcribir-pista.ts", mocks);
const { hayQuePartir, argumentosParaPartir, rutaDeArchivo, relativaDesdeEgress, extensionDeAudio, TOPE_OPENAI_BYTES } = cargar(
  "src/features/reuniones/servicios/archivos-de-reuniones.ts",
  mocks,
);
const { normalizarActa, actaEnTexto } = cargar("src/features/reuniones/servicios/hacer-acta.ts", mocks);
const { fechaDeNanos, esMicrofono, archivoDeEgress } = cargar("src/features/reuniones/servicios/avisos-de-livekit.ts", mocks);

let casos = 0;
const prueba = (nombre, fn) => {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

const INICIO = "2026-10-23T15:00:00.000Z";
const mas = (segundos) => new Date(Date.parse(INICIO) + segundos * 1000).toISOString();
const frase = (inicioS, finS, texto) => ({ inicioMs: inicioS * 1000, finMs: finS * 1000, texto });

// ── unirPistas ───────────────────────────────────────────────────────────────────────────────
prueba("dos personas intercaladas quedan en orden por hora y con su nombre", () => {
  const unidas = unirPistas(
    [
      { nombre: "Ana", empiezaEn: INICIO, frases: [frase(0, 2, "Hola"), frase(10, 12, "¿Cómo van las ventas?")] },
      { nombre: "Beto", empiezaEn: mas(3), frases: [frase(2, 5, "Hola Ana"), frase(12, 14, "Bien")] },
    ],
    INICIO,
  );
  assert.deepEqual(
    unidas.map((una) => [una.inicioMs, una.nombre, una.texto]),
    [
      [0, "Ana", "Hola"],
      [5000, "Beto", "Hola Ana"],
      [10000, "Ana", "¿Cómo van las ventas?"],
      [15000, "Beto", "Bien"],
    ],
  );
});

prueba("sin inicio de la reunión, el cero es la pista que empezó primero", () => {
  const unidas = unirPistas([
    { nombre: "Beto", empiezaEn: mas(30), frases: [frase(0, 1, "Llegué")] },
    { nombre: "Ana", empiezaEn: mas(20), frases: [frase(0, 1, "Empiezo")] },
  ]);
  assert.deepEqual(
    unidas.map((una) => [una.inicioMs, una.nombre]),
    [
      [0, "Ana"],
      [10000, "Beto"],
    ],
  );
});

prueba("una persona que se cae y vuelve: sus dos pistas se ubican bien en la línea de tiempo", () => {
  const unidas = unirPistas(
    [
      { nombre: "Ana", empiezaEn: INICIO, frases: [frase(0, 3, "Primera parte"), frase(60, 63, "Ya me voy a caer")] },
      { nombre: "Carla", empiezaEn: INICIO, frases: [frase(100, 102, "Se fue Ana")] },
      // Ana vuelve a los 2 minutos: su segunda pista empieza en 0 pero va después de Carla.
      { nombre: "Ana", empiezaEn: mas(120), frases: [frase(0, 2, "Volví")] },
    ],
    INICIO,
  );
  assert.deepEqual(
    unidas.map((una) => [una.inicioMs, una.nombre, una.texto]),
    [
      [0, "Ana", "Primera parte"],
      [60000, "Ana", "Ya me voy a caer"],
      [100000, "Carla", "Se fue Ana"],
      [120000, "Ana", "Volví"],
    ],
  );
});

prueba("frases seguidas de la misma persona con pausa <= 1.5 s se juntan", () => {
  const unidas = unirPistas(
    [{ nombre: "Ana", empiezaEn: INICIO, frases: [frase(0, 2, "Hola"), frase(3.5, 5, "a todos"), frase(6.6, 8, "lejos")] }],
    INICIO,
  );
  // 2 -> 3.5 es exactamente 1.5 s: se junta. 5 -> 6.6 es 1.6 s: no.
  assert.deepEqual(unidas, [
    { inicioMs: 0, finMs: 5000, nombre: "Ana", texto: "Hola a todos" },
    { inicioMs: 6600, finMs: 8000, nombre: "Ana", texto: "lejos" },
  ]);
});

prueba("no se juntan si otra persona habló en medio", () => {
  const unidas = unirPistas(
    [
      { nombre: "Ana", empiezaEn: INICIO, frases: [frase(0, 2, "Uno"), frase(2.6, 3, "tres")] },
      { nombre: "Beto", empiezaEn: INICIO, frases: [frase(2.2, 2.5, "dos")] },
    ],
    INICIO,
  );
  assert.deepEqual(
    unidas.map((una) => `${una.nombre}:${una.texto}`),
    ["Ana:Uno", "Beto:dos", "Ana:tres"],
  );
});

prueba("frases vacías se descartan y el texto se recorta", () => {
  const unidas = unirPistas([{ nombre: "Ana", empiezaEn: INICIO, frases: [frase(0, 1, "   "), frase(5, 6, "  hola  ")] }], INICIO);
  assert.deepEqual(unidas, [{ inicioMs: 5000, finMs: 6000, nombre: "Ana", texto: "hola" }]);
});

prueba("audio subido (empiezaEn null) empieza con la reunión", () => {
  const unidas = unirPistas([{ nombre: "Audio subido", empiezaEn: null, frases: [frase(0, 2, "Hola"), frase(30, 32, "Chao")] }], INICIO);
  assert.deepEqual(
    unidas.map((una) => [una.inicioMs, una.texto]),
    [
      [0, "Hola"],
      [30000, "Chao"],
    ],
  );
  // Sin inicio de reunión ni fechas, también arranca en cero.
  assert.equal(unirPistas([{ nombre: "X", empiezaEn: null, frases: [frase(4, 5, "a")] }])[0].inicioMs, 4000);
});

prueba("acepta empiezaEn como Date o como texto", () => {
  const conDate = unirPistas([{ nombre: "Ana", empiezaEn: new Date(mas(7)), frases: [frase(0, 1, "a")] }], new Date(INICIO));
  assert.equal(conDate[0].inicioMs, 7000);
});

prueba("horaDeLaFrase: mm:ss y h:mm:ss", () => {
  assert.equal(horaDeLaFrase(0), "00:00");
  assert.equal(horaDeLaFrase(83_000), "01:23");
  assert.equal(horaDeLaFrase(83_999), "01:23");
  assert.equal(horaDeLaFrase(3_723_000), "1:02:03");
  assert.equal(horaDeLaFrase(-500), "00:00");
});

prueba("transcripcionEnTexto: [hora] Nombre: texto, una por línea", () => {
  const texto = transcripcionEnTexto([
    { inicioMs: 0, finMs: 1000, nombre: "Ana", texto: "hola" },
    { inicioMs: 83_000, finMs: 84_000, nombre: "Beto", texto: "qué tal" },
  ]);
  assert.equal(texto, "[00:00] Ana: hola\n[01:23] Beto: qué tal");
  assert.equal(transcripcionEnTexto([]), "");
});

// ── limpiarSegmentos ─────────────────────────────────────────────────────────────────────────
prueba("limpiarSegmentos quita las frases que whisper-1 inventa en los silencios", () => {
  const frases = limpiarSegmentos([
    { start: 0, end: 2, text: " Hola,  equipo " },
    { start: 2, end: 3, text: "Gracias por ver el video" },
    { start: 3, end: 4, text: "¡Gracias por ver el vídeo!" },
    { start: 4, end: 5, text: "Subtítulos realizados por la comunidad de Amara.org" },
    { start: 5, end: 6, text: "Suscríbete al canal" },
    { start: 6, end: 7, text: "..." },
    { start: 7, end: 8, text: "   " },
    { start: 8, end: 9, text: "Gracias por ver el video de ventas que mandé" },
  ]);
  assert.deepEqual(frases, [
    { inicioMs: 0, finMs: 2000, texto: "Hola, equipo" },
    { inicioMs: 8000, finMs: 9000, texto: "Gracias por ver el video de ventas que mandé" },
  ]);
});

prueba("limpiarSegmentos quita no_speech_prob > 0.8 (0.8 justo se queda)", () => {
  const frases = limpiarSegmentos([
    { start: 0, end: 1, text: "ruido", no_speech_prob: 0.95 },
    { start: 1, end: 2, text: "dudoso", no_speech_prob: 0.8 },
  ]);
  assert.deepEqual(
    frases.map((una) => una.texto),
    ["dudoso"],
  );
});

prueba("limpiarSegmentos aplica el desfase del pedazo y redondea a ms", () => {
  const frases = limpiarSegmentos([{ start: 1.2345, end: 2.5, text: "segundo pedazo" }], 600_000);
  assert.deepEqual(frases, [{ inicioMs: 601_235, finMs: 602_500, texto: "segundo pedazo" }]);
  // Sin end, el fin es el inicio.
  assert.deepEqual(limpiarSegmentos([{ start: 3, text: "a" }]), [{ inicioMs: 3000, finMs: 3000, texto: "a" }]);
});

// ── archivos-de-reuniones ────────────────────────────────────────────────────────────────────
prueba("hayQuePartir: 25 MB exactos no se parte; 25 MB + 1 byte sí", () => {
  assert.equal(TOPE_OPENAI_BYTES, 25 * 1024 * 1024);
  assert.equal(hayQuePartir(25 * 1024 * 1024), false);
  assert.equal(hayQuePartir(25 * 1024 * 1024 + 1), true);
  assert.equal(hayQuePartir(1000), false);
});

prueba("argumentosParaPartir: pedazos de 600 s en pedazo-%03d.mp3", () => {
  const args = argumentosParaPartir("/tmp/entrada.ogg", "/tmp/salida");
  assert.equal(args[args.indexOf("-segment_time") + 1], "600");
  assert.equal(args[args.indexOf("-i") + 1], "/tmp/entrada.ogg");
  assert.equal(args[args.indexOf("-f") + 1], "segment");
  assert.equal(args.at(-1), path.join("/tmp/salida", "pedazo-%03d.mp3"));
});

prueba("rutaDeArchivo deja dentro de la carpeta y rechaza salir con ../", () => {
  const base = path.resolve("/datos/reuniones");
  assert.equal(rutaDeArchivo("sala/x.ogg", base), path.join(base, "sala", "x.ogg"));
  assert.throws(() => rutaDeArchivo("../secreto.txt", base), /fuera de la carpeta/);
  assert.throws(() => rutaDeArchivo("sala/../../otro/x.ogg", base), /fuera de la carpeta/);
  // Una carpeta hermana que empieza igual tampoco vale.
  assert.throws(() => rutaDeArchivo("../reuniones-otra/x.ogg", base), /fuera de la carpeta/);
  assert.equal(rutaDeArchivo("sala/../x.ogg", base), path.join(base, "x.ogg"));
});

prueba("relativaDesdeEgress: /out/sala/x.ogg -> sala/x.ogg", () => {
  assert.equal(relativaDesdeEgress("/out/sala/x.ogg", "/out"), "sala/x.ogg");
  assert.equal(relativaDesdeEgress("/out/sala/x.ogg"), "sala/x.ogg");
  assert.equal(relativaDesdeEgress("sala/x.ogg", "/out"), "sala/x.ogg");
  assert.equal(relativaDesdeEgress("/otra/x.ogg", "/out"), "otra/x.ogg");
});

prueba("extensionDeAudio: solo las admitidas, sin importar mayúsculas", () => {
  assert.equal(extensionDeAudio("reunion.MP3"), "mp3");
  assert.equal(extensionDeAudio("a.m4a"), "m4a");
  assert.equal(extensionDeAudio("a.ogg"), "ogg");
  assert.equal(extensionDeAudio("a.webm"), "webm");
  assert.equal(extensionDeAudio("a.wav"), "wav");
  assert.equal(extensionDeAudio("a.mp4"), null);
  assert.equal(extensionDeAudio("sin-extension"), null);
});

// ── acta ─────────────────────────────────────────────────────────────────────────────────────
prueba("normalizarActa con datos incompletos o basura no se rompe", () => {
  const vacia = { resumen: "", decisiones: [], tareas: [], mejorasEnVentas: [], mejorasDelDueno: [] };
  assert.deepEqual(normalizarActa(null), vacia);
  assert.deepEqual(normalizarActa("texto"), vacia);
  assert.deepEqual(normalizarActa({ decisiones: "no es lista" }), vacia);
  const acta = normalizarActa({
    resumen: "  Se habló de ventas.  ",
    decisiones: ["Subir precios", 3, "  ", null],
    tareas: [
      { tarea: "Llamar a Pedro", responsable: "Ana" },
      { tarea: " Enviar catálogo ", responsable: "  ", fecha: "viernes" },
      { responsable: "Beto" },
      "basura",
    ],
    mejorasEnVentas: ["Responder más rápido"],
  });
  assert.deepEqual(acta, {
    resumen: "Se habló de ventas.",
    decisiones: ["Subir precios"],
    tareas: [
      { tarea: "Llamar a Pedro", responsable: "Ana", fecha: "Sin definir" },
      { tarea: "Enviar catálogo", responsable: "Sin definir", fecha: "viernes" },
    ],
    mejorasEnVentas: ["Responder más rápido"],
    mejorasDelDueno: [],
  });
});

prueba("actaEnTexto arma las secciones y omite las vacías", () => {
  const texto = actaEnTexto({
    resumen: "Corto.",
    decisiones: ["A"],
    tareas: [{ tarea: "T", responsable: "Ana", fecha: "Sin definir" }],
    mejorasEnVentas: [],
    mejorasDelDueno: ["Decidir antes"],
  });
  assert.equal(
    texto,
    [
      "Resumen: Corto.",
      "Decisiones:\n- A",
      "Tareas:\n- T (responsable: Ana; fecha: Sin definir)",
      "Qué puede mejorar Alexander como dueño:\n- Decidir antes",
    ].join("\n\n"),
  );
  assert.equal(actaEnTexto(normalizarActa({})), "");
});

// ── avisos de LiveKit ────────────────────────────────────────────────────────────────────────
prueba("fechaDeNanos: nanosegundos como texto o número; vacío y cero son null", () => {
  const ms = Date.parse(INICIO);
  assert.equal(fechaDeNanos(`${ms}000000`).toISOString(), INICIO);
  assert.equal(fechaDeNanos(`${ms}123456`).toISOString(), INICIO);
  for (const valor of [undefined, null, "", "0", 0, "no-es-numero", "-5000000"]) {
    assert.equal(fechaDeNanos(valor), null, `con ${valor}`);
  }
});

prueba("esMicrofono: AUDIO+MICROPHONE sí; SCREEN_SHARE_AUDIO no; VIDEO no", () => {
  assert.equal(esMicrofono({ sid: "TR_1", type: "AUDIO", source: "MICROPHONE" }), true);
  assert.equal(esMicrofono({ sid: "TR_1", type: 0, source: 2 }), true);
  assert.equal(esMicrofono({ sid: "TR_1", type: "AUDIO" }), true);
  // Así llega de verdad: protojson no manda los valores por defecto y AUDIO es el 0.
  assert.equal(esMicrofono({ sid: "TR_1", source: "MICROPHONE" }), true);
  assert.equal(esMicrofono({ sid: "TR_1", source: "SCREEN_SHARE_AUDIO" }), false);
  assert.equal(esMicrofono({ sid: "TR_1", type: "VIDEO", source: "SCREEN_SHARE" }), false);
  assert.equal(esMicrofono({ sid: "TR_1", type: "AUDIO", source: "SCREEN_SHARE_AUDIO" }), false);
  assert.equal(esMicrofono({ sid: "TR_1", type: "VIDEO", source: "CAMERA" }), false);
  assert.equal(esMicrofono({ sid: "TR_1", type: "VIDEO", source: "MICROPHONE" }), false);
  assert.equal(esMicrofono({ type: "AUDIO", source: "MICROPHONE" }), false);
  assert.equal(esMicrofono(undefined), false);
});

prueba("archivoDeEgress lee fileResults y, si no hay, file", () => {
  const ms = Date.parse(INICIO);
  const nanos = (s) => `${ms + s * 1000}000000`;
  const deResultados = archivoDeEgress({
    startedAt: nanos(0),
    endedAt: nanos(99),
    fileResults: [{ filename: "/out/sala/a.ogg", size: "12345", startedAt: nanos(5), endedAt: nanos(65) }],
    file: { filename: "/out/sala/otro.ogg" },
  });
  assert.deepEqual(deResultados, { ruta: "/out/sala/a.ogg", bytes: 12345, empiezaEn: new Date(mas(5)), terminaEn: new Date(mas(65)) });

  const deFile = archivoDeEgress({ startedAt: nanos(1), endedAt: nanos(2), file: { location: "/out/sala/b.ogg", size: 0 } });
  assert.deepEqual(deFile, { ruta: "/out/sala/b.ogg", bytes: null, empiezaEn: new Date(mas(1)), terminaEn: new Date(mas(2)) });

  assert.equal(archivoDeEgress({}), null);
  assert.equal(archivoDeEgress({ fileResults: [{ size: 5 }] }), null);
  assert.equal(archivoDeEgress({ file: { filename: "x.ogg", size: 9_999_999_999 } }).bytes, 2_147_483_647);
});

console.log(`\n${casos} pruebas de reuniones (unir pistas y partes puras) OK`);
