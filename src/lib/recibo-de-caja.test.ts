import { test } from "node:test";
import assert from "node:assert/strict";

import { pesos } from "@/lib/contraentrega";
import {
  APARTADO_VENCE_MS,
  PDF_MAXIMO_BYTES,
  claveAlertaDelRecibo,
  claveModoDelRecibo,
  claveReciboEnviado,
  claveTelefonoDePrueba,
  modoDelRecibo,
  nombreDeArchivoSeguro,
  procesarRecibo,
  responderReciboDeCaja,
  taparNumeros,
  textoDelRecibo,
  validarRecibo,
  type DependenciasDelEnvio,
  type ReciboDeCaja,
} from "@/lib/recibo-de-caja";

// "%PDF-1.4 prueba" en base64.
const PDF = Buffer.from("%PDF-1.4 prueba").toString("base64");

const cuerpoBueno = () => ({
  reciboId: "RC-1001",
  ventaCodigo: "V-55",
  cliente: { nombre: "Ana", telefono: "300 123 4567" },
  producto: "camilla",
  valorAbonado: 500000,
  saldo: 250000,
  estadoPedido: "FABRICACION",
  asesora: "Ingrid",
  fecha: "2026-11-03",
  pdfBase64: PDF,
  nombreArchivo: "recibo-RC-1001.pdf",
});

const textoBase = { cliente: { nombre: "Ana" }, producto: "camilla", valorAbonado: 500000 };

/* ───────────── El texto ───────────── */

test("con saldo > 0 y en fabricación: el texto exacto aprobado", () => {
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 250000, estadoPedido: "FABRICACION" }),
    "Hola, Ana 😊 Recibimos tu pago de $500.000 por tu camilla. Adjunto tu recibo de caja.\n" +
      "Saldo pendiente: $250.000.\n" +
      "Tu pedido ya entró a fabricación y te avisamos cuando esté listo para despacho.\n" +
      "Gracias por confiar en Magilus.",
  );
});

test("pago completo (saldo 0): el texto exacto aprobado", () => {
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "FABRICACION" }),
    "Hola, Ana 😊 Recibimos tu pago de $500.000 por tu camilla. Adjunto tu recibo de caja.\n" +
      "Pago completo ✅\n" +
      "Te avisamos cuando tu pedido esté listo para despacho.\n" +
      "Gracias por confiar en Magilus.",
  );
});

test("DESPACHADO: se quita la línea de fabricación (con saldo) y la de despacho (pago completo)", () => {
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 250000, estadoPedido: "DESPACHADO" }),
    "Hola, Ana 😊 Recibimos tu pago de $500.000 por tu camilla. Adjunto tu recibo de caja.\nSaldo pendiente: $250.000.\nGracias por confiar en Magilus.",
  );
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "despachado" }),
    "Hola, Ana 😊 Recibimos tu pago de $500.000 por tu camilla. Adjunto tu recibo de caja.\nPago completo ✅\nGracias por confiar en Magilus.",
  );
});

test("ENTREGADO: igual que despachado, sin línea de fabricación ni de despacho", () => {
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "ENTREGADO" }),
    "Hola, Ana 😊 Recibimos tu pago de $500.000 por tu camilla. Adjunto tu recibo de caja.\nPago completo ✅\nGracias por confiar en Magilus.",
  );
  assert.ok(!textoDelRecibo({ ...textoBase, saldo: 10, estadoPedido: "ENTREGADO" }).includes("fabricación"));
});

test("otro estado del pedido se trata como en fabricación", () => {
  assert.ok(textoDelRecibo({ ...textoBase, saldo: 1, estadoPedido: "PENDIENTE" }).includes("ya entró a fabricación"));
});

test("los montos salen con pesos()", () => {
  const texto = textoDelRecibo({ ...textoBase, valorAbonado: 1234567, saldo: 89000, estadoPedido: "FABRICACION" });
  assert.ok(texto.includes(pesos(1234567)));
  assert.ok(texto.includes(`Saldo pendiente: ${pesos(89000)}.`));
  assert.equal(pesos(1234567), "$1.234.567");
});

/* ───────────── La validación ───────────── */

test("un cuerpo bueno pasa y se limpia", () => {
  const r = validarRecibo({ ...cuerpoBueno(), valorAbonado: "500000", pdfBase64: `data:application/pdf;base64,${PDF}`, estadoPedido: "entregado" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.recibo.valorAbonado, 500000);
  assert.equal(r.recibo.pdfBase64, PDF);
  assert.equal(r.recibo.estadoPedido, "ENTREGADO");
  assert.equal(r.recibo.nombreArchivo, "recibo-RC-1001.pdf");
});

test("cuerpo inválido: falta reciboId, monto negativo, PDF vacío, no es PDF, teléfono malo, sin cuerpo", () => {
  const { reciboId: _sin, ...sinRecibo } = cuerpoBueno();
  void _sin;
  const casos: [unknown, string][] = [
    [sinRecibo, "reciboId"],
    [{ ...cuerpoBueno(), reciboId: "   " }, "reciboId"],
    [{ ...cuerpoBueno(), saldo: -1 }, "saldo"],
    [{ ...cuerpoBueno(), valorAbonado: -500 }, "valorAbonado"],
    [{ ...cuerpoBueno(), valorAbonado: 0 }, "valorAbonado"],
    [{ ...cuerpoBueno(), pdfBase64: "" }, "pdfBase64"],
    [{ ...cuerpoBueno(), pdfBase64: Buffer.from("hola").toString("base64") }, "pdfBase64"],
    [{ ...cuerpoBueno(), pdfBase64: "no es base64 !!" }, "pdfBase64"],
    [{ ...cuerpoBueno(), cliente: { nombre: "Ana", telefono: "12" } }, "cliente.telefono"],
    [null, "cuerpo"],
  ];
  for (const [cuerpo, campo] of casos) {
    const r = validarRecibo(cuerpo);
    assert.equal(r.ok, false, `debía fallar: ${campo}`);
    if (!r.ok) assert.ok(r.error.startsWith(campo), `${r.error} debía empezar por ${campo}`);
  }
});

test("PDF de más de 10 MB se rechaza", () => {
  const grande = "JVBER" + "A".repeat(Math.ceil((PDF_MAXIMO_BYTES * 4) / 3) + 8);
  const r = validarRecibo({ ...cuerpoBueno(), pdfBase64: grande });
  assert.equal(r.ok, false);
});

test("el nombre del archivo nunca trae carpetas y siempre termina en .pdf", () => {
  assert.equal(nombreDeArchivoSeguro("../../etc/passwd", "V-1"), "passwd.pdf");
  assert.equal(nombreDeArchivoSeguro(null, "V-1"), "Recibo de caja V-1.pdf");
  assert.equal(nombreDeArchivoSeguro("Recibo <script>.PDF", "V-1"), "Recibo script.pdf");
});

/* ───────────── El modo ───────────── */

test("modoDelRecibo: por defecto APAGADO, y con valores raros también", () => {
  assert.equal(modoDelRecibo(null), "APAGADO");
  assert.equal(modoDelRecibo(undefined), "APAGADO");
  assert.equal(modoDelRecibo(""), "APAGADO");
  assert.equal(modoDelRecibo("si"), "APAGADO");
  assert.equal(modoDelRecibo("on"), "APAGADO");
  assert.equal(modoDelRecibo(1), "APAGADO");
  assert.equal(modoDelRecibo(" prueba "), "PRUEBA");
  assert.equal(modoDelRecibo("ACTIVO"), "ACTIVO");
});

/* ───────────── La decisión de envío (con funciones falsas, sin base) ───────────── */

function recibo(): ReciboDeCaja {
  const r = validarRecibo(cuerpoBueno());
  if (!r.ok) throw new Error(r.error);
  return r.recibo;
}

function falsas(ajustes: Record<string, string>, opciones: { fallaEnvio?: boolean } = {}) {
  const enviados: { telefono: string; texto: string }[] = [];
  const alertas: { clave: string; titulo: string; detalle: string }[] = [];
  const deps: DependenciasDelEnvio = {
    leerAjuste: async (clave) => ajustes[clave] ?? null,
    apartar: async (clave, anterior, nuevo) => {
      if ((ajustes[clave] ?? null) !== anterior) return false;
      ajustes[clave] = nuevo;
      return true;
    },
    guardarAjuste: async (clave, valor) => {
      ajustes[clave] = valor;
    },
    soltar: async (clave, valor) => {
      if (ajustes[clave] === valor) delete ajustes[clave];
    },
    enviar: async ({ telefono, texto }) => {
      if (opciones.fallaEnvio) throw new Error("gateway caído para 573001234567");
      enviados.push({ telefono, texto });
    },
    alertar: async (a) => {
      alertas.push(a);
    },
  };
  return { deps, enviados, alertas, ajustes };
}

const WS = "ws1";

test("APAGADO (nada guardado): contesta apagado y no manda nada", async () => {
  const f = falsas({});
  const r = await procesarRecibo(WS, recibo(), f.deps);
  assert.equal(r.estado, "apagado");
  assert.equal(f.enviados.length, 0);
  assert.equal(f.alertas.length, 0);
});

test("PRUEBA: manda al teléfono de prueba, nunca al del cliente, y marca enviado", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "PRUEBA", [claveTelefonoDePrueba(WS)]: "3109998877" });
  const r = await procesarRecibo(WS, recibo(), f.deps);
  assert.equal(r.estado, "enviado");
  assert.equal(f.enviados.length, 1);
  assert.equal(f.enviados[0].telefono, "573109998877");
  assert.ok(f.enviados[0].texto.startsWith("[PRUEBA] para 573001234567\nHola, Ana 😊"));
  const marca = JSON.parse(f.ajustes[claveReciboEnviado(WS, "RC-1001")]);
  assert.equal(marca.estado, "ENVIADO");
  assert.equal(marca.modo, "PRUEBA");
  assert.equal(marca.telefono, "573109998877");
  assert.ok(marca.fecha);
});

test("PRUEBA sin teléfono de prueba: no manda nada (ni al cliente) y contesta fallo con alerta", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "PRUEBA" });
  const r = await procesarRecibo(WS, recibo(), f.deps);
  assert.equal(r.estado, "fallo");
  assert.equal(f.enviados.length, 0);
  assert.equal(f.alertas.length, 1);
});

test("ACTIVO: manda al cliente con el texto exacto (sin la línea de prueba)", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "ACTIVO", [claveTelefonoDePrueba(WS)]: "3109998877" });
  const r = await procesarRecibo(WS, recibo(), f.deps);
  assert.equal(r.estado, "enviado");
  assert.equal(f.enviados[0].telefono, "573001234567");
  assert.equal(f.enviados[0].texto, textoDelRecibo(recibo()));
});

test("ya_enviado: el mismo reciboId no sale dos veces; otro reciboId sí", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "ACTIVO" });
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "enviado");
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "ya_enviado");
  assert.equal((await procesarRecibo(WS, { ...recibo(), reciboId: "RC-1002" }, f.deps)).estado, "enviado");
  assert.equal(f.enviados.length, 2);
});

test("dos pedidos iguales al mismo tiempo: sale uno solo", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "ACTIVO" });
  const [a, b] = await Promise.all([procesarRecibo(WS, recibo(), f.deps), procesarRecibo(WS, recibo(), f.deps)]);
  assert.deepEqual([a.estado, b.estado].sort(), ["enviado", "ya_enviado"]);
  assert.equal(f.enviados.length, 1);
});

test("lo mandado en PRUEBA no frena el envío real al pasar a ACTIVO", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "PRUEBA", [claveTelefonoDePrueba(WS)]: "3109998877" });
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "enviado");
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "ya_enviado");
  f.ajustes[claveModoDelRecibo(WS)] = "ACTIVO";
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "enviado");
  assert.equal(f.enviados[1].telefono, "573001234567");
});

test("un apartado colgado (más de 10 min) se puede volver a probar", async () => {
  const viejo = new Date(Date.now() - APARTADO_VENCE_MS - 1000).toISOString();
  const f = falsas({
    [claveModoDelRecibo(WS)]: "ACTIVO",
    [claveReciboEnviado(WS, "RC-1001")]: JSON.stringify({ fecha: viejo, telefono: "x", modo: "ACTIVO", estado: "ENVIANDO" }),
  });
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "enviado");
});

test("si el envío falla: alerta ALTA por recibo, no queda marcado y el reintento lo vuelve a probar", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "ACTIVO" }, { fallaEnvio: true });
  const r = await procesarRecibo(WS, recibo(), f.deps);
  assert.equal(r.estado, "fallo");
  assert.equal(f.ajustes[claveReciboEnviado(WS, "RC-1001")], undefined);
  assert.equal(f.alertas.length, 1);
  assert.equal(f.alertas[0].clave, claveAlertaDelRecibo("RC-1001"));
  assert.equal(f.alertas[0].titulo, "No salió el recibo de caja V-55");
  // El teléfono que venía en el error del gateway queda tapado.
  assert.ok(!f.alertas[0].detalle.includes("573001234567"));
  // La respuesta a Gestión no trae el error de adentro.
  assert.equal(r.motivo, "no salió por WhatsApp");
  // Reintento: el gateway ya volvió.
  const g = falsas(f.ajustes);
  assert.equal((await procesarRecibo(WS, recibo(), g.deps)).estado, "enviado");
});

test("taparNumeros deja solo los últimos 4 dígitos", () => {
  assert.equal(taparNumeros("falló 573001234567 ahora"), "falló …4567 ahora");
});

/* ───────────── La puerta ───────────── */

test("la puerta: 401 con llave mala, 400 con cuerpo inválido, 200 con el estado", async () => {
  const deps = {
    workspacePorLlave: async (llave: string) => (llave === "buena" ? WS : null),
    procesar: async () => ({ estado: "apagado" as const, modo: "APAGADO" as const }),
  };
  assert.equal((await responderReciboDeCaja({ autorizacion: null, cuerpo: cuerpoBueno() }, deps)).status, 401);
  assert.equal((await responderReciboDeCaja({ autorizacion: "Bearer mala", cuerpo: cuerpoBueno() }, deps)).status, 401);
  const malo = await responderReciboDeCaja({ autorizacion: "Bearer buena", cuerpo: { ...cuerpoBueno(), pdfBase64: "" } }, deps);
  assert.equal(malo.status, 400);
  assert.equal(malo.body.error, "cuerpo_invalido");
  const bueno = await responderReciboDeCaja({ autorizacion: "Bearer buena", cuerpo: cuerpoBueno() }, deps);
  assert.equal(bueno.status, 200);
  assert.equal(bueno.body.estado, "apagado");
  // Nunca devuelve el PDF ni el teléfono.
  assert.ok(!JSON.stringify(bueno.body).includes(PDF));
  assert.ok(!JSON.stringify(bueno.body).includes("3001234567"));
});
