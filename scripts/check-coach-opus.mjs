// Pruebas de las reglas del Coach con Opus (parte 1, 3-nov-2026): src/features/coach/revision-opus/reglas.ts.
// Qué se rechaza al guardar la revisión y cómo salen los avisos a la asesora y al dueño.
// Sin base ni red. Correr: npm run test:coach-opus
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);
const cache = new Map();
function cargar(archivo) {
  const absoluto = path.resolve(archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (pedido.startsWith(".")) {
      const base = path.resolve(path.dirname(absoluto), pedido);
      for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(mod.exports, requerir, mod, absoluto, path.dirname(absoluto));
  return mod.exports;
}

const r = cargar("src/features/coach/revision-opus/reglas.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const chat = (chatId, tipo, causa = "asesora", extra = {}) => ({
  chatId,
  tipo,
  quePaso: `El cliente preguntó el precio en el chat ${chatId}.`,
  momentoCaida: "Después de mandar el precio no se hizo pregunta de cierre.",
  mensajeModelo: "¿Te lo separo para entrega esta semana?",
  causa,
  ...extra,
});
const revision = (chats, extra = {}) => ({
  nombre: "Ingrid Pérez",
  modelo: "opus",
  resumen: "Respondiste rápido y con buena actitud. Falta cerrar con una pregunta.",
  chats,
  chatsLeidos: 14,
  ...extra,
});
const URL = "https://crm.ejemplo.com/";

prueba("CAUSAS es la lista acordada", () => {
  assert.deepEqual([...r.CAUSAS], ["asesora", "bot", "politica", "cliente_sin_intencion"]);
});

prueba("una revisión bien armada no tiene errores", () => {
  const datos = revision([chat("c1", "bien"), chat("c2", "mejorable"), chat("c3", "mejorable", "bot")]);
  assert.deepEqual(r.validarRevision(datos), []);
  assert.deepEqual(r.validarRevision(revision([])), []);
});

prueba("rechaza 2 chats 'bien'", () => {
  const errores = r.validarRevision(revision([chat("c1", "bien"), chat("c2", "bien")]));
  assert.ok(errores.some((e) => /2 chats "bien"/.test(e)), errores.join(" | "));
});

prueba("rechaza 3 chats 'mejorable'", () => {
  const errores = r.validarRevision(
    revision([chat("c1", "mejorable"), chat("c2", "mejorable"), chat("c3", "mejorable")]),
  );
  assert.ok(errores.some((e) => /3 chats "mejorable"/.test(e)), errores.join(" | "));
});

prueba("rechaza una causa inventada y un tipo inventado", () => {
  const errores = r.validarRevision(revision([chat("c1", "mejorable", "mala_suerte")]));
  assert.ok(errores.some((e) => /mala_suerte/.test(e)), errores.join(" | "));
  assert.ok(r.validarRevision(revision([chat("c1", "regular")])).some((e) => /bien o mejorable/.test(e)));
});

prueba("rechaza un teléfono escrito en el texto, con o sin espacios, guiones o +", () => {
  for (const telefono of ["3001234567", "+57 300 123 4567", "300-123-4567", "+573001234567", "300 1234"]) {
    const enChat = r.validarRevision(revision([chat("c1", "mejorable", "asesora", { quePaso: `Le escribió al ${telefono}` })]));
    assert.ok(enChat.some((e) => /teléfono/.test(e)), `no rechazó ${telefono} en quePaso`);
    const enResumen = r.validarRevision(revision([], { resumen: `Llama al ${telefono} mañana` }));
    assert.ok(enResumen.some((e) => /teléfono/.test(e)), `no rechazó ${telefono} en el resumen`);
  }
  // Los últimos 4, un precio con puntos y una fecha AAAA-MM-DD sí se pueden escribir.
  const ok = r.validarRevision(
    revision([chat("c1", "mejorable", "asesora", { quePaso: "El de …4567 pidió la cama de $1.250.000 el 2026-11-03" })]),
  );
  assert.deepEqual(ok, []);
});

prueba("rechaza lo que no es una revisión", () => {
  assert.ok(r.validarRevision(null).length > 0);
  assert.ok(r.validarRevision(revision("no es lista")).some((e) => /lista/.test(e)));
  assert.ok(r.validarRevision(revision([], { chatsLeidos: -1 })).some((e) => /chatsLeidos/.test(e)));
  assert.ok(r.validarRevision(revision([chat("c1", "bien"), chat("c1", "mejorable")])).some((e) => /repetido/.test(e)));
});

prueba("ultimos4 deja solo los últimos 4 dígitos", () => {
  assert.equal(r.ultimos4("+57 300 123 4567"), "4567");
  assert.equal(r.ultimos4("3001234567"), "4567");
  assert.equal(r.ultimos4(null), "");
});

prueba("el texto de la asesora trae su link, es corto y no trae teléfonos", () => {
  const texto = r.textoParaAsesora(
    {
      userId: "user_123",
      ...revision([chat("c1", "bien"), chat("c2", "mejorable")], {
        resumen: `${"Muy buen día de ventas, respondiste rápido. ".repeat(30)} El cliente 3001234567 volvió.`,
      }),
    },
    URL,
  );
  assert.ok(texto.includes("https://crm.ejemplo.com/cliente/equipo/coach/asesora/user_123"), texto);
  assert.ok(texto.length < 600, `largo ${texto.length}`);
  assert.equal(r.tieneTelefono(texto), false, texto);
  assert.match(texto, /Hola Ingrid/);
  assert.match(texto, /1 chat para mejorar/);
  const conTelefono = r.textoParaAsesora(
    { userId: "u9", ...revision([], { resumen: "El cliente +57 300 123 4567 volvió." }) },
    "https://crm.ejemplo.com",
  );
  assert.doesNotMatch(conTelefono, /300 123 4567/);
  assert.match(conTelefono, /…4567/);
  assert.ok(conTelefono.includes("https://crm.ejemplo.com/cliente/equipo/coach/asesora/u9"));
});

prueba("a la asesora no se le mencionan los chats de causa bot o política", () => {
  const conAjenos = r.textoParaAsesora(
    { userId: "u1", ...revision([chat("c1", "mejorable", "bot"), chat("c2", "mejorable", "politica")]) },
    URL,
  );
  assert.doesNotMatch(conAjenos, /para mejorar/);
  assert.doesNotMatch(conAjenos, /c1|c2/);
  const bienDelBot = r.textoParaAsesora({ userId: "u1", ...revision([chat("cX", "bien", "bot")]) }, URL);
  assert.doesNotMatch(bienDelBot, /Bien:/);
});

prueba("lo del dueño trae una línea por asesora", () => {
  const lineas = r.lineasParaDueno([
    { userId: "u1", ...revision([chat("c1", "bien"), chat("c2", "mejorable", "bot")]) },
    { userId: "u2", ...revision([chat("c3", "mejorable")], { nombre: "Génesis" }) },
    { userId: "u3", ...revision([], { nombre: "María Camila", resumen: "Llamó al 300 123 4567" }) },
  ]);
  assert.equal(lineas.length, 3);
  assert.match(lineas[0], /^Ingrid Pérez: 14 chats leídos · 1 bien · 1 para mejorar · 1 por el bot o la política/);
  assert.match(lineas[1], /^Génesis:/);
  assert.match(lineas[2], /^María Camila:/);
  assert.equal(r.tieneTelefono(lineas.join("\n")), false);
  assert.ok(lineas.every((linea) => !linea.includes("\n")));
  // La misma asesora dos veces sale una sola vez.
  assert.equal(r.lineasParaDueno([{ userId: "u1", ...revision([]) }, { userId: "u1", ...revision([]) }]).length, 1);
});

console.log(`\n${pruebas} pruebas ok`);
