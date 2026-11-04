import { test } from "node:test";
import assert from "node:assert/strict";

import { pesos } from "@/lib/contraentrega";
import {
  APARTADO_VENCE_MS,
  PDF_MAXIMO_BYTES,
  claveAlertaDelMarcado,
  claveAlertaDelRecibo,
  claveModoDelRecibo,
  claveReciboEnviado,
  claveTelefonoDePrueba,
  CUERPO_DEMASIADO_GRANDE,
  debeMarcarClienteGanado,
  leerCuerpoConTope,
  modoDelRecibo,
  nombreDeArchivoSeguro,
  procesarRecibo,
  responderReciboDeCaja,
  resumenDeEnvios,
  taparNumeros,
  textoDelRecibo,
  validarRecibo,
  type DependenciasDelEnvio,
  type EstadoDelRecibo,
  type ModoDelRecibo,
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

const CABEZA = "Hola, *Ana* 😊\n\n✅ Recibimos tu pago de *$500.000*.\n📄 Te adjunto tu recibo de caja.\n\n";
const CIERRE = "\n\n¡Gracias por confiar en Magilus! 💜";

test("con saldo > 0 y en fabricación: el texto exacto aprobado", () => {
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 250000, estadoPedido: "FABRICACION" }),
    "Hola, *Ana* 😊\n\n✅ Recibimos tu pago de *$500.000*.\n📄 Te adjunto tu recibo de caja.\n\n💰 Saldo pendiente: *$250.000*\n🛠️ Tu pedido ya entró a fabricación.\n🚚 Te avisamos cuando esté listo para despacho.\n\n¡Gracias por confiar en Magilus! 💜",
  );
});

test("pago completo (saldo 0): el texto exacto aprobado", () => {
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "FABRICACION" }),
    "Hola, *Ana* 😊\n\n✅ Recibimos tu pago de *$500.000*.\n📄 Te adjunto tu recibo de caja.\n\n💰 Saldo pendiente: *$0*\n🎉 *Pago completo*\n🚚 Te avisamos cuando tu pedido esté listo para despacho.\n\n¡Gracias por confiar en Magilus! 💜",
  );
});

test("DESPACHADO: sin la línea 🛠️ ni la línea 🚚, con saldo y con pago completo", () => {
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 250000, estadoPedido: "DESPACHADO" }),
    CABEZA + "💰 Saldo pendiente: *$250.000*" + CIERRE,
  );
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "DESPACHADO" }),
    CABEZA + "💰 Saldo pendiente: *$0*\n🎉 *Pago completo*" + CIERRE,
  );
  // En minúscula da lo mismo.
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "despachado" }),
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "DESPACHADO" }),
  );
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 250000, estadoPedido: "despachado" }),
    textoDelRecibo({ ...textoBase, saldo: 250000, estadoPedido: "DESPACHADO" }),
  );
});

test("ENTREGADO: igual que despachado, sin línea 🛠️ ni línea 🚚", () => {
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 250000, estadoPedido: "ENTREGADO" }),
    CABEZA + "💰 Saldo pendiente: *$250.000*" + CIERRE,
  );
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "ENTREGADO" }),
    CABEZA + "💰 Saldo pendiente: *$0*\n🎉 *Pago completo*" + CIERRE,
  );
});

test("otro estado del pedido se trata como en fabricación", () => {
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 250000, estadoPedido: "PENDIENTE" }),
    textoDelRecibo({ ...textoBase, saldo: 250000, estadoPedido: "FABRICACION" }),
  );
  assert.equal(
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "PENDIENTE" }),
    textoDelRecibo({ ...textoBase, saldo: 0, estadoPedido: "FABRICACION" }),
  );
});

test("los montos salen con pesos() y en negrita", () => {
  const texto = textoDelRecibo({ ...textoBase, valorAbonado: 1234567, saldo: 89000, estadoPedido: "FABRICACION" });
  assert.ok(texto.includes(`✅ Recibimos tu pago de *${pesos(1234567)}*.`));
  assert.ok(texto.includes(`💰 Saldo pendiente: *${pesos(89000)}*`));
  assert.equal(pesos(1234567), "$1.234.567");
});

test("el texto no menciona el producto y al nombre se le quitan los espacios de los bordes", () => {
  const texto = textoDelRecibo({ ...textoBase, cliente: { nombre: "  Ana  " }, saldo: 250000, estadoPedido: "FABRICACION" });
  assert.ok(!texto.includes("camilla"));
  assert.ok(texto.startsWith("Hola, *Ana* 😊\n"));
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

function falsas(ajustes: Record<string, string>, opciones: { fallaEnvio?: boolean; fallaMarcado?: boolean } = {}) {
  const enviados: { telefono: string; texto: string }[] = [];
  const alertas: { clave: string; titulo: string; detalle: string }[] = [];
  const alertasMedias: { clave: string; titulo: string; detalle: string }[] = [];
  const marcados: { contactId: string; conversationId: string; reciboId: string }[] = [];
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
      return { contactId: `contacto-${telefono}`, conversationId: `chat-admin-${telefono}` };
    },
    alertar: async (a) => {
      alertas.push(a);
    },
    marcarCliente: async ({ contactId, conversationId, recibo: r }) => {
      if (opciones.fallaMarcado) throw new Error("la base no respondió (cliente 573001234567)");
      marcados.push({ contactId, conversationId, reciboId: r.reciboId });
    },
    alertarMedia: async (a) => {
      alertasMedias.push(a);
    },
  };
  return { deps, enviados, alertas, alertasMedias, marcados, ajustes };
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
  assert.ok(f.enviados[0].texto.startsWith("[PRUEBA] para 573001234567\nHola, *Ana* 😊"));
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

/* ───────────── Parte 2: marcar al cliente como Cliente/GANADO ───────────── */

test("debeMarcarClienteGanado: Cliente/GANADO solo con modo ACTIVO y estado enviado (todas las combinaciones)", () => {
  const modos: ModoDelRecibo[] = ["APAGADO", "PRUEBA", "ACTIVO"];
  const estados: EstadoDelRecibo[] = ["enviado", "ya_enviado", "apagado", "fallo"];
  for (const modo of modos) {
    for (const estado of estados) {
      assert.equal(debeMarcarClienteGanado(modo, estado), modo === "ACTIVO" && estado === "enviado", `${modo} + ${estado}`);
    }
  }
});

test("ACTIVO y enviado: marca al cliente como Cliente/GANADO una vez, con el contacto y el chat de la línea Admin", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "ACTIVO" });
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "enviado");
  assert.deepEqual(f.marcados, [{ contactId: "contacto-573001234567", conversationId: "chat-admin-573001234567", reciboId: "RC-1001" }]);
  assert.equal(f.alertasMedias.length, 0);
});

test("PRUEBA: no se marca Cliente/GANADO (el recibo le llegó al dueño, no al cliente)", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "PRUEBA", [claveTelefonoDePrueba(WS)]: "3109998877" });
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "enviado");
  assert.equal(f.marcados.length, 0);
});

test("falla, ya_enviado o apagado: no se marca Cliente/GANADO", async () => {
  const apagado = falsas({});
  assert.equal((await procesarRecibo(WS, recibo(), apagado.deps)).estado, "apagado");
  assert.equal(apagado.marcados.length, 0);

  const falla = falsas({ [claveModoDelRecibo(WS)]: "ACTIVO" }, { fallaEnvio: true });
  assert.equal((await procesarRecibo(WS, recibo(), falla.deps)).estado, "fallo");
  assert.equal(falla.marcados.length, 0);

  const ya = falsas({ [claveModoDelRecibo(WS)]: "ACTIVO" });
  await procesarRecibo(WS, recibo(), ya.deps);
  assert.equal((await procesarRecibo(WS, recibo(), ya.deps)).estado, "ya_enviado");
  assert.equal(ya.marcados.length, 1);
});

test("si marcar Cliente/GANADO falla: contesta enviado, queda la marca ENVIADO y sale la alerta MEDIA (no la ALTA)", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "ACTIVO" }, { fallaMarcado: true });
  const r = await procesarRecibo(WS, recibo(), f.deps);
  assert.equal(r.estado, "enviado");
  assert.equal(r.motivo, undefined);
  assert.equal(JSON.parse(f.ajustes[claveReciboEnviado(WS, "RC-1001")]).estado, "ENVIADO");
  assert.equal(f.alertas.length, 0);
  assert.equal(f.alertasMedias.length, 1);
  assert.equal(f.alertasMedias[0].clave, claveAlertaDelMarcado("RC-1001"));
  assert.ok(f.alertasMedias[0].titulo.includes("V-55"));
  // El teléfono que venía en el error queda tapado.
  assert.ok(!f.alertasMedias[0].detalle.includes("573001234567"));
  // No se reenvía.
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "ya_enviado");
  assert.equal(f.enviados.length, 1);
});

test("si la alerta MEDIA también falla, la respuesta sigue siendo enviado", async () => {
  const f = falsas({ [claveModoDelRecibo(WS)]: "ACTIVO" }, { fallaMarcado: true });
  f.deps.alertarMedia = async () => {
    throw new Error("sin alertas");
  };
  assert.equal((await procesarRecibo(WS, recibo(), f.deps)).estado, "enviado");
});

test("resumenDeEnvios: cuenta solo los ENVIADO de hoy en Bogotá, ignora ENVIANDO y datos rotos, y devuelve el último", () => {
  // 4-nov-2026 a las 3 a. m. en Bogotá (8 a. m. UTC).
  const ahora = new Date("2026-11-04T08:00:00.000Z");
  const marca = (fecha: string, estado: string, modo = "ACTIVO") => JSON.stringify({ fecha, telefono: "573001234567", modo, estado });
  const resumen = resumenDeEnvios(
    [
      marca("2026-11-04T06:00:00.000Z", "ENVIADO"), // 1 a. m. del 4 en Bogotá: hoy
      marca("2026-11-04T07:30:00.000Z", "ENVIADO", "PRUEBA"), // hoy, el último
      marca("2026-11-04T04:00:00.000Z", "ENVIADO"), // 11 p. m. del 3 en Bogotá: ayer
      marca("2026-11-04T07:59:00.000Z", "ENVIANDO"), // apartado: no cuenta
      marca("no es fecha", "ENVIADO"),
      "{roto",
      null,
    ],
    ahora,
  );
  assert.equal(resumen.enviadosHoy, 2);
  assert.deepEqual(resumen.ultimo, { fecha: "2026-11-04T07:30:00.000Z", modo: "PRUEBA" });
  assert.ok(!JSON.stringify(resumen).includes("3001234567"));
  assert.deepEqual(resumenDeEnvios([], ahora), { enviadosHoy: 0, ultimo: null });
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
  let lecturas = 0;
  const cuerpo = (valor: unknown) => async () => {
    lecturas += 1;
    return valor;
  };
  assert.equal((await responderReciboDeCaja({ autorizacion: null, leerCuerpo: cuerpo(cuerpoBueno()) }, deps)).status, 401);
  assert.equal((await responderReciboDeCaja({ autorizacion: "Bearer mala", leerCuerpo: cuerpo(cuerpoBueno()) }, deps)).status, 401);
  // Sin llave buena no se lee el cuerpo.
  assert.equal(lecturas, 0);
  const malo = await responderReciboDeCaja({ autorizacion: "Bearer buena", leerCuerpo: cuerpo({ ...cuerpoBueno(), pdfBase64: "" }) }, deps);
  assert.equal(malo.status, 400);
  assert.equal(malo.body.error, "cuerpo_invalido");
  const grande = await responderReciboDeCaja({ autorizacion: "Bearer buena", leerCuerpo: cuerpo(CUERPO_DEMASIADO_GRANDE) }, deps);
  assert.equal(grande.status, 400);
  const bueno = await responderReciboDeCaja({ autorizacion: "Bearer buena", leerCuerpo: cuerpo(cuerpoBueno()) }, deps);
  assert.equal(bueno.status, 200);
  assert.equal(bueno.body.estado, "apagado");
  // Nunca devuelve el PDF ni el teléfono.
  assert.ok(!JSON.stringify(bueno.body).includes(PDF));
  assert.ok(!JSON.stringify(bueno.body).includes("3001234567"));
});

test("leerCuerpoConTope: corta un cuerpo grande aunque no traiga content-length, y JSON roto es null", async () => {
  const flujo = (...trozos: string[]) =>
    new ReadableStream<Uint8Array>({
      start(control) {
        for (const trozo of trozos) control.enqueue(new TextEncoder().encode(trozo));
        control.close();
      },
    });
  assert.deepEqual(await leerCuerpoConTope(flujo('{"a":', "1}"), 100), { a: 1 });
  assert.equal(await leerCuerpoConTope(flujo("x".repeat(60), "x".repeat(60)), 100), CUERPO_DEMASIADO_GRANDE);
  assert.equal(await leerCuerpoConTope(flujo("{roto"), 100), null);
  assert.equal(await leerCuerpoConTope(null, 100), null);
});
