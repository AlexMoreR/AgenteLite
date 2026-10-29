// Pruebas del aprobador de SISTEMAS del Tablero IA (29-oct-2026): Emanuel Díaz aprueba la tarea, el plan y la subida de las
// tarjetas de Tecnología durante el periodo de prueba (hasta el 29-nov-2026), pero no las que tocan dinero de Gestión ni
// Meta Ads. Comprueba la regla pura (puedeAprobarMomento), la lista de palabras de dinero y Meta Ads, el vencimiento y cuándo
// sale el resumen diario. El ruteo de las alertas a Emanuel se prueba en check-tablero-avisos-al-dueno.mjs. No necesita base ni red.
// Correr: npm run test:tablero-aprobador-sistemas
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const trabajo = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const reglasAlertas = cargar("src/features/alertas/dominio/reglas.ts");
const resumen = cargar("src/features/tableros-inteligentes/services/resumen-diario.ts", {
  "@/lib/prisma": { prisma: {} },
  "@prisma/client": { Prisma: {} },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: async () => {} },
  "./coordinador-en-vivo": { ultimoLatido: async () => null },
  "./tableros": { pendientesDelDueno: async () => [], todoElNegocio: () => ({}), linkDeLaTarjeta: () => "", linkDelCoordinador: () => "", linkDeHoy: () => "" },
});

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const dueno = { esDueno: true, esAdminPlataforma: false, aprobador: null };
const emanuel = { esDueno: false, esAdminPlataforma: false, aprobador: { alcance: "SISTEMAS", puedeSubir: false }, sistemasVigente: true };
const emanuelVencido = { ...emanuel, sistemasVigente: false };
const desarrollo = { esDueno: false, esAdminPlataforma: false, aprobador: { alcance: "DESARROLLO", puedeSubir: true }, sistemasVigente: true };
const asesora = { esDueno: false, esAdminPlataforma: false, aprobador: null, sistemasVigente: true };

const pedido = (extra) => ({
  momento: "tarea",
  via: "pantalla",
  origen: "PANTALLA",
  estado: "POR_APROBAR",
  requiereAprobacion: true,
  usaEstados: true,
  repo: "aizencrm",
  zonaProtegida: [],
  tienePlan: false,
  resultadoPaso: false,
  persona: emanuel,
  textoDeLaTarjeta: "Arreglar el botón de la lista de contactos\nQue el botón guarde bien.",
  ...extra,
});
const subir = { momento: "subir", estado: "POR_REVISAR", resultadoPaso: true };
const plan = { momento: "plan", estado: "PLAN_LISTO", tienePlan: true };
const aA = (extra) => trabajo.puedeAprobarMomento(pedido(extra));

prueba("SISTEMAS aprueba la tarea, el plan y la subida de una tarjeta de Tecnología (repo gestion o aizencrm)", () => {
  for (const repo of ["aizencrm", "gestion"]) {
    assert.equal(aA({ repo }).a, "APROBADO", repo);
    assert.equal(aA({ repo, ...plan }).a, "PLAN_APROBADO", repo);
    assert.equal(aA({ repo, ...subir }).a, "SUBIENDO", repo);
  }
  assert.equal(aA({ ...subir, via: "voz", origen: "MCP", textoConfirmacion: "sí, apruebo" }).a, "SUBIENDO", "por voz también");
});

prueba("SISTEMAS no aprueba lo que toca dinero de Gestión ni Meta Ads: la tarea, el plan ni la subida; el mensaje dice que es de Alexander", () => {
  const ejemplos = [
    "Registrar el abono del cliente en el pedido",
    "Corregir el saldo pendiente de la cotización",
    "Calcular la nómina de las asesoras",
    "Comisiones por venta de cada asesora",
    "Facturación electrónica: enviar la factura al cliente",
    "Campañas de Meta Ads: cambiar el presupuesto",
    "Subir el gasto diario de los anuncios",
    "Registrar un pago de proveedor",
    "Cobro contra entrega: ajustar el valor cobrado",
  ];
  for (const textoDeLaTarjeta of ejemplos) {
    for (const extra of [{}, plan, subir]) {
      const veredicto = aA({ ...extra, textoDeLaTarjeta });
      assert.match(veredicto.error ?? "", /toca dinero o Meta Ads: la aprueba Alexander/, `${textoDeLaTarjeta} (${extra.momento ?? "tarea"})`);
    }
  }
  // La zona META_ADS bloquea aunque el texto no lo diga.
  assert.match(aA({ zonaProtegida: ["META_ADS"] }).error, /Alexander/);
  // El dueño sí aprueba esas mismas.
  assert.equal(aA({ persona: dueno, textoDeLaTarjeta: ejemplos[0] }).a, "APROBADO");
  assert.equal(aA({ persona: dueno, ...subir, textoDeLaTarjeta: ejemplos[0] }).a, "SUBIENDO");
});

prueba("SISTEMAS: sin repo (no es de Tecnología) o con otra zona protegida (bot, libro V3, chats) tampoco; eso sigue con Alexander", () => {
  assert.match(aA({ repo: null }).error, /SISTEMAS/);
  for (const zona of ["BOT_VENTAS", "LIBRO_V3", "CHATS"]) {
    for (const extra of [{}, plan, subir]) assert.match(aA({ ...extra, zonaProtegida: [zona] }).error, /zona protegida/, `${zona} ${extra.momento ?? "tarea"}`);
  }
});

prueba("el permiso vence el 29-nov-2026 (fin del día en Bogotá) y vuelve solo a como era", () => {
  assert.equal(trabajo.sistemasVigente(new Date("2026-10-29T15:00:00Z")), true);
  assert.equal(trabajo.sistemasVigente(new Date("2026-11-29T23:59:00-05:00")), true, "el 29-nov todavía");
  assert.equal(trabajo.sistemasVigente(new Date("2026-11-30T00:00:00-05:00")), false, "el 30-nov ya no");
  for (const extra of [{}, plan, subir]) assert.match(aA({ ...extra, persona: emanuelVencido }).error, /venció/);
  // Sin decir si está vigente se asume vencido (más seguro).
  assert.match(aA({ persona: { ...emanuel, sistemasVigente: undefined } }).error, /venció/);
  assert.equal(aA({ persona: dueno }).a, "APROBADO");
});

prueba("las demás personas siguen igual: una asesora no aprueba y un aprobador DESARROLLO no da el sí final", () => {
  assert.match(aA({ persona: asesora }).error, /No puedes aprobar/);
  assert.match(aA({ persona: desarrollo, ...subir }).error, /solo el dueño/);
  assert.equal(aA({ persona: desarrollo }).a, "APROBADO");
  assert.equal(trabajo.SI_FINAL_SOLO_DUENO, true);
  // El Coordinador sigue sin aprobar nunca.
  assert.match(aA({ origen: "TRABAJADOR" }).error, /nunca aprueba/);
});

prueba("el registro de la aprobación puede llevar la marca 'periodo de prueba'", () => {
  const registro = trabajo.registroDeAprobacion({ estado: "APROBADO", momento: "tarea", via: "pantalla", quienNombre: "Emanuel Diaz", userId: "u1", textoConfirmacion: null, marca: trabajo.MARCA_PERIODO_DE_PRUEBA });
  assert.equal(registro.marca, "periodo de prueba");
  assert.equal(registro.quienNombre, "Emanuel Diaz");
});

prueba("tocaDineroOMetaAds: dinero y Meta Ads sí (con o sin tildes y en mayúsculas); lo técnico normal, no", () => {
  for (const si of ["Meta Ads", "META ADS: campaña nueva", "presupuesto", "Gasto de anuncios", "nómina", "NOMINA de noviembre", "abonos", "saldos por cobrar", "comisiones", "facturación", "campañas", "pagos a proveedores", "dinero de la caja"]) {
    assert.equal(reglasAlertas.tocaDineroOMetaAds(si), true, si);
  }
  for (const no of ["Arreglar el botón de la lista de contactos", "Cambiar la pantalla de chats", "Mejorar el SEO del catálogo", "Fichas técnicas por producto: inventario", "Reuniones: transcripción y acta", ""]) {
    assert.equal(reglasAlertas.tocaDineroOMetaAds(no), false, no);
  }
  // esDeDineroMetaOClave sigue sumando claves y accesos, que tocaDineroOMetaAds no incluye.
  assert.equal(reglasAlertas.esDeDineroMetaOClave("falta una clave, un acceso o un permiso"), true);
  assert.equal(reglasAlertas.tocaDineroOMetaAds("falta una clave, un acceso o un permiso"), false);
});

prueba("el resumen diario sale una vez al día entre las 6 y las 9 p. m. de Bogotá; un intento fallido se repite a los 30 minutos", () => {
  const a = (hora, minuto = 0) => new Date(Date.UTC(2026, 9, 29, hora + 5, minuto));
  assert.equal(resumen.tocaMandarElResumen(a(10), null), false, "de mañana no");
  assert.equal(resumen.tocaMandarElResumen(a(17, 59), null), false);
  assert.equal(resumen.tocaMandarElResumen(a(18), null), true);
  assert.equal(resumen.tocaMandarElResumen(a(20, 59), null), true);
  assert.equal(resumen.tocaMandarElResumen(new Date("2026-10-30T02:00:00Z"), null), false, "9 p. m. ya es silencio");
  assert.equal(resumen.tocaMandarElResumen(a(19), `2026-10-29|ok|${a(18).toISOString()}`), false, "ya salió hoy");
  assert.equal(resumen.tocaMandarElResumen(a(19), `2026-10-28|ok|${a(18).toISOString()}`), true, "el de ayer no cuenta");
  assert.equal(resumen.tocaMandarElResumen(a(18, 20), `2026-10-29|fallo|${a(18).toISOString()}`), false, "falló hace 20 min");
  assert.equal(resumen.tocaMandarElResumen(a(18, 31), `2026-10-29|fallo|${a(18).toISOString()}`), true, "falló hace 31 min");
});

console.log(`\n${pruebas} pruebas del aprobador de Sistemas: todas pasaron.`);
