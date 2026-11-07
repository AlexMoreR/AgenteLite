// Pruebas de la pantalla Mejoras vs ventas (src/features/mejoras-vs-ventas): cálculos de la serie, el candado del
// cliente del MCP de Gestión (solo tres herramientas de lectura) y lo que el servicio entrega a la vista.
// Con datos de prueba, sin red ni base. Correr: npm run test:mejoras-vs-ventas
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

// `cargar` guarda cada módulo la primera vez: los simulados se cargan una sola vez y se cambian con `estado`.
const estado = { conexion: null, tablero: null };
const tarjetasDeSistemas = [
  { codigo: "T-200", titulo: "Bienvenida con foto", estado: "HECHO", terminadaEn: "2026-11-06T18:00:00.000Z", repo: "aizencrm", linkCommit: "https://github.com/x" },
  { codigo: "T-201", titulo: "No salió", estado: "FALLIDO", terminadaEn: "2026-11-06T19:00:00.000Z" },
];
const servicio = cargar("src/features/mejoras-vs-ventas/servicios/leer-mejoras-vs-ventas.ts", {
  "@/lib/prisma": { prisma: { tableroInteligente: { findFirst: async () => estado.tablero } } },
  "@/lib/sincronizacion-gestion": { leerConexionConGestion: async () => estado.conexion },
  "@/features/leads-nuevos/servicios/leads-nuevos-del-dia": { leadsNuevosDelDia: async () => ({ total: 0 }) },
  "@/features/tableros-inteligentes/services/archivadas": {
    terminadasDeLaSemana: async (_alcance, _semana, tableroId) => {
      assert.equal(tableroId, "tab-1");
      return { semana: {}, tarjetas: tarjetasDeSistemas };
    },
  },
  "@/features/tableros-inteligentes/services/tableros": { todoElNegocio: (workspaceId) => ({ workspaceId, soloDe: null }) },
});
const g = cargar("src/features/mejoras-vs-ventas/servicios/leer-gestion.ts");
const s = cargar("src/features/mejoras-vs-ventas/dominio/serie.ts");
let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("30 días en hora de Colombia, hoy incluido", () => {
  // 7-nov 03:00 UTC = 6-nov 22:00 en Colombia: hoy es 6-nov.
  assert.equal(s.hoyEnColombia(new Date("2026-11-07T03:00:00Z")), "2026-11-06");
  assert.equal(s.hoyEnColombia(new Date("2026-11-07T05:00:00Z")), "2026-11-07");
  const dias = s.diasDeLaVentana("2026-11-06");
  assert.equal(dias.length, 30);
  assert.equal(dias[0], "2026-10-08");
  assert.equal(dias[29], "2026-11-06");
  assert.equal(new Set(dias).size, 30);
});

await prueba("día de una fecha de Gestión: AAAA-MM-DD y medianoche UTC valen el día escrito; otras horas en Colombia", () => {
  assert.equal(s.diaDeColombia("2026-11-06"), "2026-11-06");
  assert.equal(s.diaDeColombia("2026-11-06T00:00:00.000Z"), "2026-11-06", "medianoche UTC no cae el día anterior");
  assert.equal(s.diaDeColombia("2026-11-06T00:00:00Z"), "2026-11-06");
  assert.equal(s.diaDeColombia("2026-11-07T02:00:00Z"), "2026-11-06", "9 p. m. del 6 en Colombia");
  assert.equal(s.diaDeColombia("2026-11-06T15:30:00-05:00"), "2026-11-06");
  assert.equal(s.diaDeColombia("no es fecha"), null);
  assert.equal(s.diaDeColombia(null), null);
});

await prueba("cotizaciones por su `fecha`: una con fecha 6-nov que llegó pidiendo el 5-nov cuenta el 6-nov", () => {
  const dias = s.diasDeLaVentana("2026-11-06");
  // Lo que devolvió Gestión al pedir desde=hasta=2026-11-05.
  const pedidoDel5 = [
    { numero: "COT-171", fecha: "2026-11-06T00:00:00.000Z", cliente: "Ana", total: 900000 },
    { numero: "COT-172", fecha: "2026-11-06", cliente: "Luis", total: 500000 },
    { numero: "COT-173", fecha: "2026-11-06T00:00:00Z" },
  ];
  const vistas = new Set();
  const delDia = g.reducirCotizaciones(pedidoDel5, vistas);
  // El mismo tramo repetido no cuenta dos veces.
  delDia.push(...g.reducirCotizaciones(pedidoDel5, vistas));
  const conteo = s.contarPorDia(delDia, dias);
  assert.equal(conteo.get("2026-11-06"), 3);
  assert.equal(conteo.get("2026-11-05"), 0);
  // Fuera de la ventana no cuenta.
  assert.equal(s.contarPorDia(["2026-11-07", "2026-10-07"], dias).get("2026-11-06"), 0);
});

await prueba("tramos de pedido: un día de más a cada lado, contiguos y sin solaparse", () => {
  const dias = s.diasDeLaVentana("2026-11-06");
  const tramos = s.tramosDePedido(dias);
  assert.equal(tramos[0].desde, "2026-10-07");
  assert.equal(tramos[tramos.length - 1].hasta, "2026-11-07");
  for (let i = 1; i < tramos.length; i += 1) assert.equal(tramos[i].desde, s.sumarDias(tramos[i - 1].hasta, 1));
});

await prueba("ventas: solo primeros abonos de ventas no anuladas, por la fecha del abono, con su origen", () => {
  const dias = s.diasDeLaVentana("2026-11-06");
  const abonos = g.reducirAbonos([
    { id: "a1", fecha: "2026-11-06T14:00:00Z", es_primer_abono: true, venta_cancelada: false, venta_codigo: "V-1", monto: 300000 },
    { id: "a2", fecha: "2026-11-06T15:00:00Z", es_primer_abono: false, venta_cancelada: false, venta_codigo: "V-1", monto: 100000 },
    { id: "a3", fecha: "2026-11-06T16:00:00Z", es_primer_abono: true, venta_cancelada: true, venta_codigo: "V-2" },
    { id: "a4", fecha: "2026-11-06T17:00:00Z", es_primer_abono: true, venta_cancelada: false, venta: { codigo: "V-3" } },
    { id: "a5", fecha: "2026-11-05T17:00:00Z", es_primer_abono: true, venta_cancelada: false, codigo_venta: "V-4" },
    { id: "a6", fecha: "2026-11-05T18:00:00Z", es_primer_abono: true, venta_cancelada: false, venta_codigo: "V-9" },
    { id: "a1", fecha: "2026-11-06T14:00:00Z", es_primer_abono: true, venta_cancelada: false, venta_codigo: "V-1" },
  ]);
  const origenes = g.reducirVentas([
    { codigo: "V-1", origen: "Lead nuevo", cliente: "Ana" },
    { codigo: "V-3", origen: "Cliente recurrente" },
    { codigo: "V-4", origen: "recurrente" },
  ]);
  const porDia = s.ventasPorDia(abonos, origenes, dias);
  assert.deepEqual(porDia.get("2026-11-06"), { total: 2, nuevos: 1, recurrentes: 1, sinClasificar: 0 });
  assert.deepEqual(porDia.get("2026-11-05"), { total: 2, nuevos: 0, recurrentes: 1, sinClasificar: 1 });
  // Sin la lista de ventas: cuentan igual, sin clasificar.
  assert.deepEqual(s.ventasPorDia(abonos, null, dias).get("2026-11-06"), { total: 2, nuevos: 0, recurrentes: 0, sinClasificar: 2 });
});

await prueba("clasificar el origen", () => {
  assert.equal(s.clasificarOrigen("nuevo"), "nuevo");
  assert.equal(s.clasificarOrigen("LEAD_NUEVO"), "nuevo");
  assert.equal(s.clasificarOrigen("Recurrente"), "recurrente");
  assert.equal(s.clasificarOrigen("cliente antiguo"), "recurrente");
  assert.equal(s.clasificarOrigen(""), "sin_clasificar");
  assert.equal(s.clasificarOrigen(null), "sin_clasificar");
  assert.equal(s.clasificarOrigen("referido"), "sin_clasificar");
});

await prueba("porcentajes sin dividir por cero, y 'sin dato' (null) distinto de 0", () => {
  assert.equal(s.porcentaje(3, 185), 2);
  assert.equal(s.porcentaje(0, 3), 0);
  assert.equal(s.porcentaje(3, 0), null);
  assert.equal(s.porcentaje(null, 10), null);
  assert.equal(s.porcentaje(5, null), null);
  const dias = ["2026-11-05", "2026-11-06"];
  const filas = s.armarFilas(dias, {
    leads: new Map([["2026-11-05", 0], ["2026-11-06", null]]),
    cotizaciones: new Map([["2026-11-06", 3]]),
    ventas: null,
    cambios: null,
  });
  assert.equal(filas[0].leads, 0, "0 leads es 0");
  assert.equal(filas[1].leads, null, "un día que no se leyó es null");
  assert.equal(filas[0].cotizaciones, 0, "Gestión respondió y ese día no hubo: 0");
  assert.equal(filas[1].cotizaciones, 3);
  assert.equal(filas[1].ventas, null, "Gestión no respondió: sin dato");
  assert.equal(filas[0].porcentajeLeadACotizacion, null, "sin base no se divide");
  assert.equal(filas[1].porcentajeCotizacionAVenta, null);
  const sinGestion = s.armarFilas(dias, { leads: new Map(), cotizaciones: null, ventas: null, cambios: null });
  assert.equal(sinGestion[0].cotizaciones, null);
});

await prueba("cambios: solo HECHO, por su día de terminada en Colombia; FALLIDO no se marca", () => {
  const dias = s.diasDeLaVentana("2026-11-06");
  const porDia = s.cambiosPorDia(
    [
      { codigo: "T-120", titulo: "Bienvenida nueva", estado: "HECHO", terminadaEn: "2026-11-06T20:00:00.000Z" },
      { codigo: "T-121", titulo: "Falló", estado: "FALLIDO", terminadaEn: "2026-11-06T20:00:00.000Z" },
      { codigo: "T-122", titulo: "De noche", estado: "HECHO", terminadaEn: "2026-11-06T03:00:00.000Z" },
      { codigo: "T-120", titulo: "Bienvenida nueva", estado: "HECHO", terminadaEn: "2026-11-06T20:00:00.000Z" },
    ],
    dias,
  );
  assert.deepEqual(porDia.get("2026-11-06"), [{ codigo: "T-120", titulo: "Bienvenida nueva" }]);
  assert.deepEqual(porDia.get("2026-11-05"), [{ codigo: "T-122", titulo: "De noche" }], "10 p. m. del 5 en Colombia");
});

// ---------------------------------------------------------------------------------------------
// El cliente del MCP de Gestión: el candado y la lectura de la respuesta.
// ---------------------------------------------------------------------------------------------

const fetchOriginal = globalThis.fetch;
function simularGestion(responder) {
  const pedidos = [];
  globalThis.fetch = async (url, init) => {
    const cuerpo = JSON.parse(init.body);
    pedidos.push({ url: String(url), cuerpo, headers: init.headers });
    return responder(cuerpo);
  };
  return pedidos;
}
const json = (datos, status = 200, headers = {}) =>
  new Response(JSON.stringify(datos), { status, headers: { "content-type": "application/json", ...headers } });

await prueba("cliente de Gestión: rechaza cualquier herramienta fuera de las tres de lectura, sin tocar la red", async () => {
  assert.deepEqual([...g.HERRAMIENTAS_DE_LECTURA], ["listar_cotizaciones", "listar_abonos", "listar_ventas"]);
  const pedidos = simularGestion(() => json({ jsonrpc: "2.0", id: 1, result: {} }));
  try {
    const cliente = g.clienteDeGestion({ url: "https://gestion.example/api/catalogo/productos", llave: "llave-prueba" });
    for (const nombre of ["crear_cotizacion", "registrar_abono", "anular_venta", "editar_venta", "LISTAR_ABONOS", "", undefined]) {
      await assert.rejects(() => cliente.llamar(nombre, {}), /no es de lectura/, String(nombre));
    }
    assert.equal(pedidos.length, 0, "ningún pedido salió");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await prueba("cliente de Gestión: abre sesión, llama tools/call y lee JSON o eventos", async () => {
  const pedidos = simularGestion((cuerpo) => {
    if (cuerpo.method === "initialize") return json({ jsonrpc: "2.0", id: cuerpo.id, result: { protocolVersion: "2025-03-26" } }, 200, { "mcp-session-id": "s-1" });
    if (cuerpo.method === "notifications/initialized") return new Response(null, { status: 202 });
    const datos = { cotizaciones: [{ numero: "COT-1", fecha: "2026-11-06" }] };
    const evento = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: cuerpo.id, result: { content: [{ type: "text", text: JSON.stringify(datos) }] } })}\n\n`;
    return new Response(evento, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  try {
    const cliente = g.clienteDeGestion({ url: "https://gestion.example/api/catalogo/productos", llave: "llave-prueba" });
    const datos = await cliente.llamar("listar_cotizaciones", { desde: "2026-11-05", hasta: "2026-11-07" });
    assert.deepEqual(g.filasDe(datos, "cotizaciones"), [{ numero: "COT-1", fecha: "2026-11-06" }]);
    assert.equal(pedidos[0].url, "https://gestion.example/api/mcp");
    assert.equal(pedidos[0].headers.Authorization, "Bearer llave-prueba");
    const llamada = pedidos.find((p) => p.cuerpo.method === "tools/call");
    assert.equal(llamada.headers["Mcp-Session-Id"], "s-1");
    assert.deepEqual(llamada.cuerpo.params, { name: "listar_cotizaciones", arguments: { desde: "2026-11-05", hasta: "2026-11-07" } });
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ---------------------------------------------------------------------------------------------
// El servicio completo, con la base y Gestión simuladas.
// ---------------------------------------------------------------------------------------------

function cargarServicio({ conexion = { url: "https://gestion.example/api/catalogo/productos", llave: "llave" }, tablero = { id: "tab-1" } } = {}) {
  estado.conexion = conexion;
  estado.tablero = tablero;
  return servicio;
}
const AHORA = new Date("2026-11-06T22:00:00Z");
const leadsDePrueba = async (_ws, fecha) => ({ total: fecha === "2026-11-06" ? 185 : 100, por_asesora: [{ asesora: "Ingrid" }] });

/** Revisa que en lo que va a la vista no haya clientes, montos ni links. */
function revisarClaves(valor, ruta = "datos") {
  const permitidas = new Set([
    "hoy", "meta", "cotizacionesDeHoy", "filas", "avisos", "base", "fecha", "leads", "cotizaciones", "ventas",
    "porcentajeLeadACotizacion", "porcentajeCotizacionAVenta", "cambios", "total", "nuevos", "recurrentes", "sinClasificar",
    "codigo", "titulo",
  ]);
  if (Array.isArray(valor)) return valor.forEach((v, i) => revisarClaves(v, `${ruta}[${i}]`));
  if (valor && typeof valor === "object") {
    for (const [clave, dentro] of Object.entries(valor)) {
      assert.ok(permitidas.has(clave), `clave no permitida hacia la vista: ${ruta}.${clave}`);
      revisarClaves(dentro, `${ruta}.${clave}`);
    }
    return;
  }
  if (typeof valor === "string") assert.ok(!/https?:\/\//.test(valor) && !/Ana|Luis|900000/.test(valor), `dato sensible en ${ruta}: ${valor}`);
}

await prueba("servicio: 30 filas, cotizaciones de hoy, ventas y marcas; a la vista solo conteos y tarjetas", async () => {
  g.olvidarMemoriaDeGestion();
  const servicio = cargarServicio();
  servicio.olvidarMemoriaDeLeads();
  const llamadas = [];
  const cliente = {
    async llamar(herramienta, args) {
      llamadas.push([herramienta, args]);
      if (herramienta === "listar_cotizaciones") {
        // La trampa: las del 6-nov llegan en el tramo que pide el 5-nov.
        return args.desde <= "2026-11-05" && args.hasta >= "2026-11-05"
          ? { cotizaciones: [1, 2, 3].map((n) => ({ numero: `COT-${n}`, fecha: "2026-11-06T00:00:00.000Z", cliente: "Ana", total: 900000, link: "https://gestion.example/c/1" })) }
          : { cotizaciones: [] };
      }
      if (herramienta === "listar_abonos") {
        return args.desde <= "2026-11-06" && args.hasta >= "2026-11-06"
          ? { abonos: [{ id: "a1", fecha: "2026-11-06T15:00:00Z", es_primer_abono: true, venta_cancelada: false, venta_codigo: "V-1", monto: 900000, cliente: "Luis" }] }
          : { abonos: [] };
      }
      return { ventas: [{ codigo: "V-1", origen: "recurrente", cliente: "Luis" }] };
    },
  };
  const datos = await servicio.leerMejorasVsVentas("ws-1", { ahora: AHORA, clienteDeGestion: cliente, leerLeads: leadsDePrueba });
  assert.equal(datos.filas.length, 30);
  assert.equal(datos.hoy, "2026-11-06");
  assert.equal(datos.meta, 10);
  assert.equal(datos.cotizacionesDeHoy, 3, "la fila del 6-nov muestra 3 cotizaciones");
  const hoy = datos.filas[29];
  assert.equal(hoy.leads, 185);
  assert.deepEqual(hoy.ventas, { total: 1, nuevos: 0, recurrentes: 1, sinClasificar: 0 });
  assert.equal(hoy.porcentajeLeadACotizacion, 2);
  assert.equal(hoy.porcentajeCotizacionAVenta, 33);
  assert.deepEqual(hoy.cambios, [{ codigo: "T-200", titulo: "Bienvenida con foto" }], "FALLIDO no aparece");
  assert.equal(datos.filas[28].cotizaciones, 0, "el 5-nov no se lleva las del 6-nov");
  assert.deepEqual(datos.avisos, []);
  assert.ok(llamadas.every(([h]) => g.HERRAMIENTAS_DE_LECTURA.includes(h)));
  assert.ok(llamadas.some(([h, a]) => h === "listar_ventas" && a.estado === "todas"));
  revisarClaves(datos);
});

await prueba("servicio: Gestión simula un 401 → cotizaciones y ventas sin dato con aviso; leads y cambios completos", async () => {
  g.olvidarMemoriaDeGestion();
  const servicio = cargarServicio();
  servicio.olvidarMemoriaDeLeads();
  const pedidos = simularGestion(() => json({ error: "no autorizado" }, 401));
  try {
    const datos = await servicio.leerMejorasVsVentas("ws-1", { ahora: AHORA, leerLeads: leadsDePrueba });
    assert.ok(pedidos.length > 0, "sí intentó Gestión");
    assert.equal(datos.filas.length, 30);
    assert.equal(datos.cotizacionesDeHoy, null);
    assert.ok(datos.filas.every((f) => f.cotizaciones === null && f.ventas === null), "sin dato, nunca 0");
    assert.ok(datos.filas.every((f) => typeof f.leads === "number"), "leads completos");
    assert.equal(datos.filas[29].cambios.length, 1, "cambios completos");
    assert.ok(datos.avisos.some((a) => /no autorizó/.test(a) && /Cotizaciones sin dato/.test(a)), datos.avisos.join(" | "));
    assert.ok(datos.avisos.some((a) => /Ventas sin dato/.test(a)));
    revisarClaves(datos);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

await prueba("servicio: sin conexión con Gestión, sin tablero y con un día de leads caído: todo con aviso, nada inventado", async () => {
  g.olvidarMemoriaDeGestion();
  const servicio = cargarServicio({ conexion: null, tablero: null });
  servicio.olvidarMemoriaDeLeads();
  const datos = await servicio.leerMejorasVsVentas("ws-1", {
    ahora: AHORA,
    leerLeads: async (_ws, fecha) => {
      if (fecha === "2026-11-01") throw new Error("la base no responde");
      return { total: 7 };
    },
  });
  assert.equal(datos.filas.find((f) => f.fecha === "2026-11-01").leads, null);
  assert.equal(datos.filas.find((f) => f.fecha === "2026-11-02").leads, 7);
  assert.ok(datos.avisos.some((a) => /leads de 1 día/.test(a)));
  assert.ok(datos.avisos.some((a) => /no tiene conexión con Gestión/.test(a)));
  assert.ok(datos.avisos.some((a) => /tablero "Sistemas"/.test(a)));
  assert.ok(datos.filas.every((f) => f.cambios.length === 0));
});

await prueba("pantalla: solo jefes, en el menú de Dirección después de Informe; manual sin tocar, nota pendiente", () => {
  const pagina = fs.readFileSync(`${RAIZ}/src/app/cliente/direccion/mejoras-vs-ventas/page.tsx`, "utf8");
  assert.ok(pagina.includes("esJefeDelNegocio(access)") && pagina.includes('redirect("/cliente/crm/mi-dia")'));
  assert.ok(pagina.includes("leerMejorasVsVentas(access.workspaceId)"));
  const componente = fs.readFileSync(`${RAIZ}/src/features/mejoras-vs-ventas/components/mejoras-vs-ventas.tsx`, "utf8");
  assert.ok(componente.startsWith('"use client";'));
  assert.ok(componente.includes("Cotizaciones de hoy") && componente.includes("de {meta}"));
  const nav = fs.readFileSync(`${RAIZ}/src/components/nav-direccion.tsx`, "utf8");
  assert.ok(nav.includes('{ title: "Mejoras vs ventas", view: "mejoras-vs-ventas", icon: ChartSpline }'));
  assert.ok(nav.indexOf('view: "informe"') < nav.indexOf('view: "mejoras-vs-ventas"') && nav.indexOf('view: "mejoras-vs-ventas"') < nav.indexOf('view: "alertas"'));
  // La nota vive en cambios-pendientes hasta que el Coordinador la junta en el manual (de noche) y
  // la borra: despues la linea se busca en el manual.
  const rutaNota = `${RAIZ}/docs/cambios-pendientes/gdtd74h4.md`;
  const nota = fs.readFileSync(fs.existsSync(rutaNota) ? rutaNota : `${RAIZ}/docs/que-es-esta-aplicacion.md`, "utf8");
  const modulos = nota.split(/^## /m).find((parte) => parte.startsWith("Módulos"));
  assert.ok(modulos && modulos.includes("- `direccion/mejoras-vs-ventas`:"));
  // El servicio que va al navegador no importa el cliente de Gestión en el componente.
  assert.ok(!componente.includes("leer-gestion"));
});

console.log(`\n${pruebas} pruebas de Mejoras vs ventas OK`);
