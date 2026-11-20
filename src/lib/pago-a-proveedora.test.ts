import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  COMPROBANTE_MAXIMO_BYTES,
  claveAlertaDelPago,
  claveAlertaSinTelefono,
  claveModoDelPago,
  clavePagoEnviado,
  claveTelefonoDePrueba,
  comoSeManda,
  modoDelPago,
  nombreDeArchivoSeguro,
  procesarPago,
  responderPagoAProveedora,
  textoDelPago,
  textoDePrueba,
  tipoDeComprobante,
  validarPago,
  type DependenciasDelEnvio,
  type ModoDelPago,
  type PagoAProveedora,
} from "@/lib/pago-a-proveedora";
import { APARTADO_VENCE_MS, CUERPO_DEMASIADO_GRANDE } from "@/lib/recibo-de-caja";

/* ───────────── Archivos de mentira (solo los primeros bytes importan) ───────────── */

const PDF = Buffer.from("%PDF-1.4 comprobante").toString("base64");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString("base64");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]).toString("base64");
const GIF = Buffer.from("GIF89a de mentira").toString("base64");

const cuerpoBueno = (cambios: Record<string, unknown> = {}) => ({
  pagoId: "PP-2001",
  ofCodigo: "OF-120",
  proveedora: { nombre: "Marta Tapicería", telefono: "310 555 1234" },
  productos: ["Camilla Spa", "Silla Barbera"],
  valorPagado: 800000,
  saldo: 400000,
  comprobanteBase64: JPG,
  nombreArchivo: "comprobante.jpg",
  ...cambios,
});

function pagoBueno(cambios: Record<string, unknown> = {}): PagoAProveedora {
  const resultado = validarPago(cuerpoBueno(cambios));
  assert.ok(resultado.ok, resultado.ok ? "" : resultado.error);
  return resultado.pago;
}

/* ───────────── El texto ───────────── */

const datosDelTexto = { proveedora: { nombre: "Marta" }, ofCodigo: "OF-120", productos: ["Camilla Spa", "Silla Barbera"], valorPagado: 800000 };

test("con saldo > 0: el texto exacto que dictó el dueño", () => {
  assert.equal(
    textoDelPago({ ...datosDelTexto, saldo: 400000 }),
    "Hola, Marta 😊 Te enviamos un pago de $800.000 por la OF-120 (Camilla Spa, Silla Barbera). Adjunto el comprobante.\nSaldo pendiente de esta orden: $400.000\nGracias, Magilus.",
  );
});

test("con saldo 0: dice «Orden pagada completa ✅» y no habla de saldo", () => {
  const texto = textoDelPago({ ...datosDelTexto, saldo: 0 });
  assert.equal(
    texto,
    "Hola, Marta 😊 Te enviamos un pago de $800.000 por la OF-120 (Camilla Spa, Silla Barbera). Adjunto el comprobante.\nOrden pagada completa ✅\nGracias, Magilus.",
  );
  assert.ok(!texto.includes("Saldo pendiente"));
});

test("en los dos casos empieza con «Hola, <nombre> 😊» y termina con «Gracias, Magilus.»", () => {
  for (const saldo of [0, 1, 400000]) {
    const texto = textoDelPago({ ...datosDelTexto, saldo });
    assert.ok(texto.startsWith("Hola, Marta 😊"), texto);
    assert.ok(texto.endsWith("Gracias, Magilus."), texto);
    assert.equal(texto.includes("Saldo pendiente de esta orden:"), saldo > 0);
    assert.equal(texto.includes("Orden pagada completa ✅"), saldo === 0);
  }
});

test("el texto de prueba dice [PRUEBA] y el número de la proveedora tapado", () => {
  const texto = textoDePrueba("Hola", "573105551234");
  assert.equal(texto, "[PRUEBA] para …1234\nHola");
  assert.ok(!texto.includes("3105551234"));
});

/* ───────────── Datos de la clienta: nunca ───────────── */

test("lo que llega de más (datos de la clienta) se descarta y no aparece en el texto", () => {
  const resultado = validarPago(
    cuerpoBueno({
      cliente: { nombre: "Clienta Secreta", telefono: "3009998877", direccion: "Calle Oculta 12" },
      clienteNombre: "Clienta Secreta",
      ventaCodigo: "V-777",
      direccion: "Calle Oculta 12",
    }),
  );
  assert.ok(resultado.ok);
  const pago = resultado.pago as unknown as Record<string, unknown>;
  for (const clave of ["cliente", "clienteNombre", "ventaCodigo", "direccion"]) assert.ok(!(clave in pago), clave);
  const texto = textoDelPago(resultado.pago);
  for (const dato of ["Clienta Secreta", "3009998877", "Calle Oculta", "V-777"]) assert.ok(!texto.includes(dato), dato);
});

test("lo que se manda por WhatsApp tampoco lleva datos de la clienta", async () => {
  const falsa = dependenciasFalsas({ modo: "ACTIVO" });
  const resultado = validarPago(cuerpoBueno({ cliente: { nombre: "Clienta Secreta", telefono: "3009998877" } }));
  assert.ok(resultado.ok);
  await procesarPago("ws1", resultado.pago, falsa.deps);
  assert.equal(falsa.enviados.length, 1);
  const enviado = JSON.stringify(falsa.enviados[0]);
  assert.ok(!enviado.includes("Clienta Secreta") && !enviado.includes("3009998877"));
});

/* ───────────── La validación ───────────── */

test("acepta PDF, JPG, PNG y WEBP; rechaza otro tipo", () => {
  assert.equal(tipoDeComprobante(PDF), "PDF");
  assert.equal(tipoDeComprobante(JPG), "JPG");
  assert.equal(tipoDeComprobante(PNG), "PNG");
  assert.equal(tipoDeComprobante(WEBP), "WEBP");
  assert.equal(tipoDeComprobante(GIF), null);
  for (const [archivo, tipo] of [[PDF, "PDF"], [JPG, "JPG"], [PNG, "PNG"], [WEBP, "WEBP"]] as const) {
    const resultado = validarPago(cuerpoBueno({ comprobanteBase64: archivo }));
    assert.ok(resultado.ok && resultado.pago.tipoComprobante === tipo, tipo);
  }
  const gif = validarPago(cuerpoBueno({ comprobanteBase64: GIF }));
  assert.ok(!gif.ok && gif.error.startsWith("comprobanteBase64:"));
});

test("acepta el comprobante con «data:...;base64,» adelante", () => {
  const resultado = validarPago(cuerpoBueno({ comprobanteBase64: `data:image/jpeg;base64,${JPG}` }));
  assert.ok(resultado.ok && resultado.pago.comprobanteBase64 === JPG);
});

test("el PDF sale como documento y la foto como imagen", () => {
  assert.deepEqual(comoSeManda("PDF"), { mediatype: "document", mimetype: "application/pdf", tipoMensaje: "DOCUMENT" });
  assert.deepEqual(comoSeManda("JPG"), { mediatype: "image", mimetype: "image/jpeg", tipoMensaje: "IMAGE" });
  assert.deepEqual(comoSeManda("PNG"), { mediatype: "image", mimetype: "image/png", tipoMensaje: "IMAGE" });
  assert.deepEqual(comoSeManda("WEBP"), { mediatype: "image", mimetype: "image/webp", tipoMensaje: "IMAGE" });
});

test("el envío usa la forma del tipo: el PDF por documento y la foto por imagen", () => {
  const codigo = readFileSync("src/lib/pago-a-proveedora-envio.ts", "utf8");
  assert.match(codigo, /comoSeManda\(pago\.tipoComprobante\)/);
  assert.match(codigo, /forma\.mediatype === "document"\s*\?\s*await sendEvolutionDocumentMessage/);
  assert.match(codigo, /mediatype: "image",\s*mimetype: forma\.mimetype/);
  assert.match(codigo, /type: forma\.tipoMensaje/);
});

test("el nombre del archivo queda seguro y con la extensión del tipo de verdad", () => {
  assert.equal(nombreDeArchivoSeguro("../../etc/foto.png", "OF-1", "JPG"), "foto.jpg");
  assert.equal(nombreDeArchivoSeguro("comprobante.pdf", "OF-1", "PDF"), "comprobante.pdf");
  assert.equal(nombreDeArchivoSeguro(null, "OF-1", "WEBP"), "Comprobante OF-1.webp");
  assert.equal(nombreDeArchivoSeguro("<script>", "OF-1", "PNG"), "script.png");
});

test("datos malos: dice qué campo falla", () => {
  const casos: [Record<string, unknown>, string][] = [
    [{ pagoId: "" }, "pagoId"],
    [{ ofCodigo: undefined }, "ofCodigo"],
    [{ proveedora: { telefono: "3105551234" } }, "proveedora.nombre"],
    [{ productos: [] }, "productos"],
    [{ valorPagado: 0 }, "valorPagado"],
    [{ saldo: -1 }, "saldo"],
    [{ comprobanteBase64: "" }, "comprobanteBase64"],
    [{ comprobanteBase64: "esto no es base64!!" }, "comprobanteBase64"],
  ];
  for (const [cambio, campo] of casos) {
    const resultado = validarPago(cuerpoBueno(cambio));
    assert.ok(!resultado.ok && resultado.error.startsWith(`${campo}:`), `${campo}: ${JSON.stringify(resultado)}`);
  }
  assert.ok(!validarPago(null).ok);
});

test("los montos pueden venir como texto", () => {
  const pago = pagoBueno({ valorPagado: "800000", saldo: "0" });
  assert.equal(pago.valorPagado, 800000);
  assert.equal(pago.saldo, 0);
});

test("comprobante de más de 10 MB: no pasa", () => {
  const grande = Buffer.concat([Buffer.from("%PDF-1.4 "), Buffer.alloc(COMPROBANTE_MAXIMO_BYTES)]).toString("base64");
  const resultado = validarPago(cuerpoBueno({ comprobanteBase64: grande }));
  assert.ok(!resultado.ok && resultado.error.includes("10 MB"));
});

test("el teléfono de la proveedora puede venir vacío (pasa la validación)", () => {
  for (const telefono of [undefined, null, "", "   "]) {
    assert.ok(validarPago(cuerpoBueno({ proveedora: { nombre: "Marta", telefono } })).ok, String(telefono));
  }
});

/* ───────────── El modo ───────────── */

test("sin modo guardado, o con un valor raro, queda en APAGADO", () => {
  assert.equal(modoDelPago(undefined), "APAGADO");
  assert.equal(modoDelPago(null), "APAGADO");
  assert.equal(modoDelPago(""), "APAGADO");
  assert.equal(modoDelPago("encendido"), "APAGADO");
  assert.equal(modoDelPago(" prueba "), "PRUEBA");
  assert.equal(modoDelPago("ACTIVO"), "ACTIVO");
});

test("las claves de AppSetting", () => {
  assert.equal(claveModoDelPago("ws1"), "pago-proveedora:modo:ws1");
  assert.equal(claveTelefonoDePrueba("ws1"), "pago-proveedora:telefono-prueba:ws1");
  assert.equal(clavePagoEnviado("ws1", "PP-1"), "pago-proveedora:enviado:ws1:PP-1");
});

/* ───────────── La decisión con base y WhatsApp de mentira ───────────── */

function dependenciasFalsas(opciones: { modo?: ModoDelPago | null; telefonoPrueba?: string | null; fallaEnvio?: boolean; demoraMs?: number }) {
  const ajustes = new Map<string, string>();
  if (opciones.modo) ajustes.set(claveModoDelPago("ws1"), opciones.modo);
  if (opciones.telefonoPrueba) ajustes.set(claveTelefonoDePrueba("ws1"), opciones.telefonoPrueba);
  const enviados: { telefono: string; texto: string; modo: ModoDelPago; tipo: string }[] = [];
  const alertas: { clave: string; titulo: string; detalle: string }[] = [];
  const deps: DependenciasDelEnvio = {
    leerAjuste: async (clave) => ajustes.get(clave) ?? null,
    // Compara y cambia en un solo paso, como el updateMany/create de la base.
    apartar: async (clave, anterior, nuevo) => {
      if ((ajustes.get(clave) ?? null) !== anterior) return false;
      ajustes.set(clave, nuevo);
      return true;
    },
    guardarAjuste: async (clave, valor) => {
      ajustes.set(clave, valor);
    },
    soltar: async (clave, valor) => {
      if (ajustes.get(clave) === valor) ajustes.delete(clave);
    },
    enviar: async ({ telefono, texto, modo, pago }) => {
      if (opciones.demoraMs) await new Promise((resolve) => setTimeout(resolve, opciones.demoraMs));
      if (opciones.fallaEnvio) throw new Error("La línea Admin está desconectada (573105551234)");
      enviados.push({ telefono, texto, modo, tipo: comoSeManda(pago.tipoComprobante).mediatype });
    },
    alertar: async (alerta) => {
      alertas.push(alerta);
    },
  };
  return { deps, ajustes, enviados, alertas };
}

test("APAGADO: no manda nada ni alerta", async () => {
  for (const modo of [null, "APAGADO"] as const) {
    const falsa = dependenciasFalsas({ modo });
    const resultado = await procesarPago("ws1", pagoBueno(), falsa.deps);
    assert.deepEqual(resultado, { estado: "apagado", modo: "APAGADO" });
    assert.equal(falsa.enviados.length, 0);
    assert.equal(falsa.alertas.length, 0);
  }
});

test("APAGADO sin teléfono de la proveedora: tampoco alerta (no sale nada)", async () => {
  const falsa = dependenciasFalsas({ modo: null });
  await procesarPago("ws1", pagoBueno({ proveedora: { nombre: "Marta", telefono: "" } }), falsa.deps);
  assert.equal(falsa.alertas.length, 0);
});

test("ACTIVO: le llega a la proveedora con el texto aprobado", async () => {
  const falsa = dependenciasFalsas({ modo: "ACTIVO", telefonoPrueba: "3001112222" });
  const resultado = await procesarPago("ws1", pagoBueno(), falsa.deps);
  assert.deepEqual(resultado, { estado: "enviado", modo: "ACTIVO" });
  assert.equal(falsa.enviados.length, 1);
  assert.equal(falsa.enviados[0].telefono, "573105551234");
  assert.ok(falsa.enviados[0].texto.startsWith("Hola, Marta Tapicería 😊"));
  assert.equal(falsa.enviados[0].tipo, "image");
  assert.equal(JSON.parse(falsa.ajustes.get(clavePagoEnviado("ws1", "PP-2001"))!).estado, "ENVIADO");
});

test("ACTIVO con PDF: sale como documento", async () => {
  const falsa = dependenciasFalsas({ modo: "ACTIVO" });
  await procesarPago("ws1", pagoBueno({ comprobanteBase64: PDF }), falsa.deps);
  assert.equal(falsa.enviados[0].tipo, "document");
});

test("PRUEBA: solo le llega al número del dueño, con [PRUEBA] y el de la proveedora tapado", async () => {
  const falsa = dependenciasFalsas({ modo: "PRUEBA", telefonoPrueba: "3001112222" });
  const resultado = await procesarPago("ws1", pagoBueno(), falsa.deps);
  assert.deepEqual(resultado, { estado: "enviado", modo: "PRUEBA" });
  assert.equal(falsa.enviados.length, 1);
  assert.equal(falsa.enviados[0].telefono, "573001112222");
  assert.ok(falsa.enviados[0].texto.startsWith("[PRUEBA] para …1234\nHola, Marta Tapicería 😊"));
  assert.ok(!falsa.enviados.some((envio) => envio.telefono.endsWith("3105551234")));
});

test("PRUEBA sin teléfono de prueba: no le manda a la proveedora, falla con alerta", async () => {
  const falsa = dependenciasFalsas({ modo: "PRUEBA" });
  const resultado = await procesarPago("ws1", pagoBueno(), falsa.deps);
  assert.equal(resultado.estado, "fallo");
  assert.equal(falsa.enviados.length, 0);
  assert.equal(falsa.alertas[0].clave, claveAlertaDelPago("PP-2001"));
});

test("la prueba no frena el envío de verdad cuando el modo pasa a ACTIVO", async () => {
  const falsa = dependenciasFalsas({ modo: "PRUEBA", telefonoPrueba: "3001112222" });
  await procesarPago("ws1", pagoBueno(), falsa.deps);
  assert.equal((await procesarPago("ws1", pagoBueno(), falsa.deps)).estado, "ya_enviado");
  falsa.ajustes.set(claveModoDelPago("ws1"), "ACTIVO");
  assert.equal((await procesarPago("ws1", pagoBueno(), falsa.deps)).estado, "enviado");
  assert.equal((await procesarPago("ws1", pagoBueno(), falsa.deps)).estado, "ya_enviado");
  assert.equal(falsa.enviados.length, 2);
  assert.equal(falsa.enviados[1].telefono, "573105551234");
});

test("el mismo pago dos veces: un solo mensaje y la segunda contesta «ya_enviado»", async () => {
  const falsa = dependenciasFalsas({ modo: "ACTIVO" });
  assert.equal((await procesarPago("ws1", pagoBueno(), falsa.deps)).estado, "enviado");
  assert.equal((await procesarPago("ws1", pagoBueno(), falsa.deps)).estado, "ya_enviado");
  assert.equal(falsa.enviados.length, 1);
  // Otro pago (otro pagoId) sí sale.
  assert.equal((await procesarPago("ws1", pagoBueno({ pagoId: "PP-2002" }), falsa.deps)).estado, "enviado");
  assert.equal(falsa.enviados.length, 2);
});

test("dos llamadas al mismo tiempo con el mismo pago: un solo mensaje", async () => {
  const falsa = dependenciasFalsas({ modo: "ACTIVO", demoraMs: 20 });
  const resultados = await Promise.all([procesarPago("ws1", pagoBueno(), falsa.deps), procesarPago("ws1", pagoBueno(), falsa.deps)]);
  assert.deepEqual(resultados.map((r) => r.estado).sort(), ["enviado", "ya_enviado"]);
  assert.equal(falsa.enviados.length, 1);
});

test("un apartado viejo (se cayó el servidor a mitad) se puede volver a probar", async () => {
  const falsa = dependenciasFalsas({ modo: "ACTIVO" });
  const viejo = new Date(Date.now() - APARTADO_VENCE_MS - 1000).toISOString();
  falsa.ajustes.set(clavePagoEnviado("ws1", "PP-2001"), JSON.stringify({ fecha: viejo, telefono: "x", modo: "ACTIVO", estado: "ENVIANDO" }));
  assert.equal((await procesarPago("ws1", pagoBueno(), falsa.deps)).estado, "enviado");
});

test("sin teléfono (o con uno malo): no se manda y queda la alerta ALTA «Proveedora sin WhatsApp»", async () => {
  for (const modo of ["ACTIVO", "PRUEBA"] as const) {
    for (const telefono of [undefined, "", "123"]) {
      const falsa = dependenciasFalsas({ modo, telefonoPrueba: "3001112222" });
      const resultado = await procesarPago("ws1", pagoBueno({ proveedora: { nombre: "Marta", telefono } }), falsa.deps);
      assert.equal(resultado.estado, "sin_telefono");
      assert.equal(falsa.enviados.length, 0);
      assert.equal(falsa.alertas.length, 1);
      assert.equal(falsa.alertas[0].clave, claveAlertaSinTelefono("PP-2001"));
      assert.equal(falsa.alertas[0].titulo, "Proveedora sin WhatsApp: Marta (OF-120)");
      // No queda marcado: cuando le pongan el número, el reintento sí sale.
      assert.ok(!falsa.ajustes.has(clavePagoEnviado("ws1", "PP-2001")));
    }
  }
});

test("si falla el envío: alerta con el número tapado, se suelta la marca y el reintento sí sale", async () => {
  const opciones = { modo: "ACTIVO" as const, fallaEnvio: true };
  const falsa = dependenciasFalsas(opciones);
  const resultado = await procesarPago("ws1", pagoBueno(), falsa.deps);
  assert.equal(resultado.estado, "fallo");
  assert.equal(resultado.motivo, "no salió por WhatsApp");
  assert.equal(falsa.alertas.length, 1);
  assert.equal(falsa.alertas[0].clave, claveAlertaDelPago("PP-2001"));
  assert.ok(!falsa.alertas[0].detalle.includes("3105551234"), falsa.alertas[0].detalle);
  assert.ok(!falsa.ajustes.has(clavePagoEnviado("ws1", "PP-2001")));
  opciones.fallaEnvio = false;
  assert.equal((await procesarPago("ws1", pagoBueno(), falsa.deps)).estado, "enviado");
  assert.equal(falsa.enviados.length, 1);
});

test("si la alerta misma falla, la respuesta sale igual", async () => {
  const falsa = dependenciasFalsas({ modo: "ACTIVO", fallaEnvio: true });
  falsa.deps.alertar = async () => {
    throw new Error("base caída");
  };
  assert.equal((await procesarPago("ws1", pagoBueno(), falsa.deps)).estado, "fallo");
});

/* ───────────── La puerta ───────────── */

const puertaDeps = (procesados: PagoAProveedora[] = []) => ({
  workspacePorLlave: async (llave: string) => (llave === "llave-buena" ? "ws1" : null),
  procesar: async (_ws: string, pago: PagoAProveedora) => {
    procesados.push(pago);
    return { estado: "apagado" as const, modo: "APAGADO" as const };
  },
});

test("sin llave o con llave mala: 401 y no se lee el cuerpo", async () => {
  let leido = false;
  const leerCuerpo = async () => {
    leido = true;
    return cuerpoBueno();
  };
  for (const autorizacion of [null, "", "Bearer llave-mala", "llave-buena"]) {
    const respuesta = await responderPagoAProveedora({ autorizacion, leerCuerpo }, puertaDeps());
    assert.equal(respuesta.status, 401, String(autorizacion));
    assert.deepEqual(respuesta.body, { error: "no_autorizado" });
  }
  assert.equal(leido, false);
});

test("datos malos: 400 con el campo; cuerpo demasiado grande: 400", async () => {
  const malo = await responderPagoAProveedora({ autorizacion: "Bearer llave-buena", leerCuerpo: async () => ({ pagoId: "x" }) }, puertaDeps());
  assert.equal(malo.status, 400);
  assert.equal(malo.body.error, "cuerpo_invalido");
  const roto = await responderPagoAProveedora({ autorizacion: "Bearer llave-buena", leerCuerpo: async () => null }, puertaDeps());
  assert.equal(roto.status, 400);
  const grande = await responderPagoAProveedora(
    { autorizacion: "Bearer llave-buena", leerCuerpo: async () => CUERPO_DEMASIADO_GRANDE },
    puertaDeps(),
  );
  assert.equal(grande.status, 400);
  assert.match(String(grande.body.detalle), /10 MB/);
});

test("llave buena y datos buenos: 200 con estado, modo y pagoId (sin teléfono ni archivo)", async () => {
  const procesados: PagoAProveedora[] = [];
  const respuesta = await responderPagoAProveedora(
    { autorizacion: "Bearer llave-buena", leerCuerpo: async () => cuerpoBueno() },
    puertaDeps(procesados),
  );
  assert.equal(respuesta.status, 200);
  assert.deepEqual(respuesta.body, { estado: "apagado", modo: "APAGADO", pagoId: "PP-2001" });
  assert.equal(procesados.length, 1);
  assert.ok(!JSON.stringify(respuesta.body).includes("3105551234"));
});

test("la ruta usa la llave de Gestión y el envío por la línea Admin", () => {
  const ruta = readFileSync("src/app/api/gestion/pago-proveedora/route.ts", "utf8");
  assert.match(ruta, /workspacePorLlave: workspacePorLlaveDeGestion, procesar: enviarPagoAProveedora/);
  assert.match(ruta, /export async function POST/);
});
