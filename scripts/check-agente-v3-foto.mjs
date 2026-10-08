// Pruebas del Agente V3: foto de la clienta + "¿qué valor tiene así?" y pausa cuando el redactor
// pide una asesora (caso real del 08-10-2026). Correr: npm run test:agente-v3-foto
//
// Carga el motor REAL (decidir, foto-y-precio, reglas, ejecutar, redactor) transpilando el TypeScript,
// y reemplaza solo lo que toca la base o la IA (almacén, estado, catálogo, clasificador, OpenAI).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const SRC = path.resolve("src");

// --- Cargador mínimo de TypeScript con alias "@/" y reemplazos -------------------------------------
const cache = new Map();
function resolver(desde, especificador) {
  let base;
  if (especificador.startsWith("@/")) base = path.join(SRC, especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(desde), especificador);
  else return null;
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return candidato;
  }
  throw new Error(`No encuentro ${especificador} desde ${desde}`);
}
function cargar(archivo, reemplazos) {
  if (reemplazos.has(archivo)) return reemplazos.get(archivo);
  if (cache.has(archivo)) return cache.get(archivo).exports;
  const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: archivo,
  });
  const mod = { exports: {} };
  cache.set(archivo, mod);
  const req = (especificador) => {
    const resuelto = resolver(archivo, especificador);
    return resuelto ? cargar(resuelto, reemplazos) : nodeRequire(especificador);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    req,
    mod,
    archivo,
    path.dirname(archivo),
  );
  return mod.exports;
}
const ruta = (relativa) => path.join(SRC, relativa);

// --- Reemplazos de lo que toca la base o la IA ----------------------------------------------------
const mundo = {
  libro: null,
  estado: null,
  intenciones: [],
  clasificarRecibio: null,
  sugerencia: null,
};
const reemplazos = new Map([
  [ruta("lib/agent-product-flow.ts"), { getFlowReply: async () => ({ steps: [{ kind: "image", url: "/combo.jpg" }] }) }],
  [ruta("features/agente-v3/servicios/almacen.ts"), { leerLibro: async () => mundo.libro }],
  [
    ruta("features/agente-v3/servicios/catalogo.ts"),
    {
      catalogoActivo: async () => [],
      nombreLegible: (n) => n,
      productosInactivos: async () => new Set(),
      reconocerEnElCatalogo: () => null,
      textoDeUnProducto: () => "",
      textoDeVariasOpciones: () => "",
    },
  ],
  [ruta("features/agente-v3/servicios/decisiones.ts"), { anotarDecision: async () => {} }],
  [
    ruta("features/agente-v3/motor/clasificar.ts"),
    {
      clasificarIntenciones: async (entrada) => {
        mundo.clasificarRecibio = entrada;
        return mundo.intenciones;
      },
    },
  ],
  [
    ruta("features/agente-v3/motor/estado.ts"),
    {
      leerEstado: async () => mundo.estado,
      guardarEstado: async (_id, estado) => {
        mundo.estado = estado;
      },
    },
  ],
  [ruta("lib/sugerencia-de-respuesta.ts"), { generarSugerenciaDeRespuesta: async () => mundo.sugerencia }],
]);

const { atenderConAgenteV3 } = cargar(ruta("features/agente-v3/motor/ejecutar.ts"), reemplazos);
const { decidir } = cargar(ruta("features/agente-v3/motor/decidir.ts"), reemplazos);
const fotoYPrecio = cargar(ruta("features/agente-v3/motor/foto-y-precio.ts"), reemplazos);
const { responderConElRedactor } = cargar(ruta("features/agente-v3/servicios/redactor.ts"), reemplazos);

// --- El libro del caso real, reducido ------------------------------------------------------------
const COMBO = "prod-combo-camillas";
const PRECIO_DEL_COMBO = "El *combo* completo tiene un valor de *$989.000*. ¿En qué *ciudad* estás?";
const reglaPrecioGenerica = {
  id: "regla-precio-combo",
  nombre: "Precio del combo (genérica: va SIEMPRE al final del libro)",
  cuando: { tipo: "frase", frases: ["precio", "valor", "cuanto vale", "que valor tiene", "cuanto cuesta"] },
  soloSi: { productoActivo: COMBO },
  entonces: [{ tipo: "mensaje", texto: PRECIO_DEL_COMBO }],
  activa: true,
};
const reglaFotoYPrecio = {
  id: "regla-69aa8115-9a20-4642-a69d-7b1ffe188e54",
  nombre: "Manda foto de un producto y pregunta el precio",
  cuando: {
    tipo: "intencion",
    descripcion: "Manda foto o captura de un producto y pregunta el precio o cuánto vale",
  },
  entonces: [
    { tipo: "mensaje", texto: "Ya te confirmo el valor de esa referencia. ¿En qué *ciudad* estás?" },
    { tipo: "avisar_asesor", motivo: "Foto de un producto + precio (regla del libro)" },
    { tipo: "pausar_ia" },
  ],
  activa: true,
};
const libroCon = (...reglas) => ({ version: 1, actualizadoEl: "2026-10-08T00:00:00.000Z", comoHablamos: "", reglas });
const estadoCombo = () => ({
  productoActivo: COMBO,
  pasoActual: "PRODUCTO",
  flujosEnviados: [],
  esPrimerMensaje: false,
});

const hace = (min) => new Date(Date.now() - min * 60_000);
const fotoDeLaClienta = (min = 1, texto = "") => ({ de: "cliente", tipo: "IMAGE", texto, cuando: hace(min) });
const fotoNuestra = (min = 2) => ({ de: "negocio", tipo: "IMAGE", texto: "", cuando: hace(min) });
const textoDe = (de, texto, min = 0) => ({ de, tipo: "TEXT", texto, cuando: hace(min) });

function herramientasDePrueba() {
  const registro = { enviados: [], avisos: [], pausas: 0, redactor: 0 };
  return {
    registro,
    herramientas: {
      enviarPaso: async (paso) => {
        registro.enviados.push(paso.kind === "text" ? paso.content : `[${paso.kind}]`);
        return true;
      },
      avisarAsesor: async (motivo) => {
        registro.avisos.push(motivo);
      },
      cambiarEtapa: async () => {},
      pausarIa: async () => {
        registro.pausas += 1;
      },
      responderConIa: async () => {
        registro.redactor += 1;
      },
      yaLoDijimos: async () => false,
      responderSinRegla: async () => {
        registro.redactor += 1;
        return "Respondió el redactor";
      },
    },
  };
}

async function atender({ libro, mensaje, recientes, foto = null }) {
  mundo.libro = libro;
  mundo.estado = estadoCombo();
  mundo.clasificarRecibio = null;
  const { registro, herramientas } = herramientasDePrueba();
  const resultado = await atenderConAgenteV3({
    workspaceId: "ws",
    conversationId: "cv",
    mensaje,
    recientes,
    foto,
    herramientas,
  });
  return { resultado, ...registro };
}

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// --- (a) foto de la clienta + "qué valor tiene así" ----------------------------------------------
await prueba("(a) foto de la clienta + 'Qué valor tiene así' sin regla de foto: no da el precio del combo, avisa y pausa", async () => {
  mundo.intenciones = [];
  const r = await atender({
    libro: libroCon(reglaPrecioGenerica),
    mensaje: "Qué valor tiene así",
    recientes: [textoDe("negocio", "¡Perfecto! Ese color rosa queda muy bien", 1), fotoDeLaClienta(1), textoDe("cliente", "Qué valor tiene así")],
  });
  assert.ok(!r.enviados.includes(PRECIO_DEL_COMBO), "no debe mandar el precio del combo");
  assert.deepEqual(r.enviados, [fotoYPrecio.TEXTO_FOTO_Y_PRECIO]);
  assert.deepEqual(r.avisos, [fotoYPrecio.MOTIVO_FOTO_Y_PRECIO]);
  assert.equal(r.pausas, 1);
  assert.match(r.resultado.porque, /mandó una foto/);
});

await prueba("(a) con la regla de intención 'foto + precio' en el libro, gana ella aunque la IA no la marque", async () => {
  mundo.intenciones = [];
  const r = await atender({
    libro: libroCon(reglaPrecioGenerica, reglaFotoYPrecio),
    mensaje: "Qué valor tiene así",
    recientes: [fotoDeLaClienta(2), textoDe("cliente", "Qué valor tiene así")],
  });
  assert.equal(r.resultado.regla, reglaFotoYPrecio.nombre);
  assert.ok(!r.enviados.includes(PRECIO_DEL_COMBO));
  assert.deepEqual(r.avisos, ["Foto de un producto + precio (regla del libro)"]);
  assert.equal(r.pausas, 1);
  // Al clasificador le llega que hubo una foto de la clienta.
  assert.ok(mundo.clasificarRecibio.fotoDelCliente, "el clasificador debe saber de la foto");
});

await prueba("(a) foto con texto en el MISMO mensaje ('y esta?') también se desvía", async () => {
  mundo.intenciones = [];
  const r = await atender({
    libro: libroCon(reglaPrecioGenerica),
    mensaje: "y esta cuanto vale?",
    foto: "una silla de peluquería rosada",
    recientes: [fotoDeLaClienta(0, "y esta cuanto vale?")],
  });
  assert.ok(!r.enviados.includes(PRECIO_DEL_COMBO));
  assert.equal(r.pausas, 1);
  assert.equal(mundo.clasificarRecibio.fotoDelCliente.pie, "y esta cuanto vale?");
});

// --- (b) sin foto: el precio del combo sigue saliendo ---------------------------------------------
await prueba("(b) sin foto, 'qué valor tiene' con combo activo: responde el precio del combo", async () => {
  mundo.intenciones = [];
  const r = await atender({
    libro: libroCon(reglaPrecioGenerica, reglaFotoYPrecio),
    mensaje: "Qué valor tiene",
    recientes: [textoDe("negocio", "Te comparto las fotos", 3), textoDe("cliente", "Qué valor tiene")],
  });
  assert.deepEqual(r.enviados, [PRECIO_DEL_COMBO]);
  assert.equal(r.pausas, 0);
  assert.deepEqual(r.avisos, []);
  assert.equal(mundo.clasificarRecibio.fotoDelCliente, null);
});

await prueba("(b) foto de la clienta de hace más de 10 minutos ya no cuenta", async () => {
  mundo.intenciones = [];
  const r = await atender({
    libro: libroCon(reglaPrecioGenerica),
    mensaje: "Qué valor tiene",
    recientes: [fotoDeLaClienta(25), textoDe("cliente", "Qué valor tiene")],
  });
  assert.deepEqual(r.enviados, [PRECIO_DEL_COMBO]);
  assert.equal(r.pausas, 0);
});

await prueba("(b) foto de la clienta, pero 2 mensajes de ella después: no cuenta", async () => {
  mundo.intenciones = [];
  const r = await atender({
    libro: libroCon(reglaPrecioGenerica),
    mensaje: "Qué valor tiene",
    recientes: [fotoDeLaClienta(3), textoDe("cliente", "Me gusta el combo", 2), textoDe("cliente", "Qué valor tiene")],
  });
  assert.deepEqual(r.enviados, [PRECIO_DEL_COMBO]);
});

// --- (c) fotos que mandamos NOSOTROS ---------------------------------------------------------------
await prueba("(c) fotos del combo que enviamos nosotros + 'qué valor tiene': precio del combo normal", async () => {
  mundo.intenciones = [];
  const r = await atender({
    libro: libroCon(reglaPrecioGenerica, reglaFotoYPrecio),
    mensaje: "Qué valor tiene",
    recientes: [textoDe("cliente", "me interesa el COMBO", 4), fotoNuestra(3), fotoNuestra(3), textoDe("cliente", "Qué valor tiene")],
  });
  assert.deepEqual(r.enviados, [PRECIO_DEL_COMBO]);
  assert.equal(r.pausas, 0);
  assert.deepEqual(r.avisos, []);
});

await prueba("foto reciente pero el mensaje no pregunta por ella ('gracias'): no se desvía", () => {
  const d = decidir({
    libro: libroCon(reglaPrecioGenerica),
    mensaje: "Gracias, lo pienso",
    estado: estadoCombo(),
    fotoDelCliente: { pie: null },
  });
  assert.equal(d.regla, null);
});

await prueba("las palabras se comparan enteras: 'clasico' no es 'asi'", () => {
  assert.equal(fotoYPrecio.preguntaPorLaFoto("me gusta el clásico"), false);
  assert.equal(fotoYPrecio.preguntaPorLaFoto("Qué valor tiene así"), true);
  assert.equal(fotoYPrecio.preguntaPorLaFoto("la tienen?"), true);
});

await prueba("se reconoce la regla de intención de 'foto + precio' del libro por su descripción", () => {
  assert.equal(fotoYPrecio.esReglaDeFotoYPrecio(reglaFotoYPrecio), true);
  assert.equal(fotoYPrecio.esReglaDeFotoYPrecio(reglaPrecioGenerica), false);
});

// --- (d) el redactor pide asesora → la IA queda pausada ------------------------------------------
await prueba("(d) el redactor avisa a una asesora porque falta un dato: la IA queda pausada", async () => {
  mundo.sugerencia = { texto: "Te confirmo el valor de esa referencia. ¿En qué *ciudad* estás?", faltaDato: true, problemas: [] };
  const { registro, herramientas } = herramientasDePrueba();
  const porque = await responderConElRedactor({
    workspaceId: "ws",
    conversationId: "cv",
    foto: "una silla rosada",
    enviarTexto: async (texto) => {
      registro.enviados.push(texto);
      return true;
    },
    avisarAsesor: herramientas.avisarAsesor,
    yaLoDijimos: async () => false,
    pausarIa: herramientas.pausarIa,
  });
  assert.equal(registro.enviados.length, 1);
  assert.equal(registro.avisos.length, 1);
  assert.match(registro.avisos[0], /dato que no está en el libro/);
  assert.equal(registro.pausas, 1);
  assert.match(porque, /pausó la IA/);
});

await prueba("(d) el redactor contesta sin que falte nada: NO pausa", async () => {
  mundo.sugerencia = { texto: "El combo trae camilla, escalera, silla y auxiliar. ¿En qué *ciudad* estás?", faltaDato: false, problemas: [] };
  const { registro, herramientas } = herramientasDePrueba();
  await responderConElRedactor({
    workspaceId: "ws",
    conversationId: "cv",
    enviarTexto: async () => true,
    avisarAsesor: herramientas.avisarAsesor,
    yaLoDijimos: async () => false,
    pausarIa: herramientas.pausarIa,
  });
  assert.equal(registro.avisos.length, 0);
  assert.equal(registro.pausas, 0);
});

console.log(`\n${pruebas} pruebas ok`);
