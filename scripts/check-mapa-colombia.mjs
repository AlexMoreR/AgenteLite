// Pruebas de las reglas del mapa de Colombia de la pauta (src/features/pauta/dominio/departamentos.ts
// y src/features/pauta/dominio/mapa.ts). Con datos de prueba, sin red ni base. Correr: npm run test:mapa-colombia
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const d = cargar("src/features/pauta/dominio/departamentos.ts");
const m = cargar("src/features/pauta/dominio/mapa.ts");
let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("lista fija: 32 departamentos más Bogotá, con claves únicas", () => {
  assert.equal(d.DEPARTAMENTOS.length, 33);
  assert.equal(new Set(d.DEPARTAMENTOS.map((x) => x.clave)).size, 33);
  for (const clave of ["valle-del-cauca", "choco", "bogota", "san-andres", "narino"]) assert.ok(d.esClaveDepartamento(clave), clave);
  assert.equal(d.nombreDelDepartamento("choco"), "Chocó");
});

prueba("limpiar texto: sin tildes, en minúsculas y sin 'departamento' ni 'department'", () => {
  assert.equal(d.limpiarTexto("Chocó Department"), "choco");
  assert.equal(d.limpiarTexto("Departamento de NARIÑO"), "de narino");
  assert.equal(d.limpiarTexto("  Valle   del Cauca "), "valle del cauca");
  assert.equal(d.limpiarTexto(null), "");
});

prueba("ciudades: cada una lleva a su departamento", () => {
  assert.equal(d.departamentoDeCiudad("Cali"), "valle-del-cauca");
  assert.equal(d.departamentoDeCiudad("Quibdó"), "choco");
  assert.equal(d.departamentoDeCiudad("quibdo"), "choco");
  assert.equal(d.departamentoDeCiudad("Istmina"), "choco");
  assert.equal(d.departamentoDeCiudad("Tadó"), "choco");
  assert.equal(d.departamentoDeCiudad("Bogotá D.C."), "bogota");
  assert.equal(d.departamentoDeCiudad("bogota"), "bogota");
  assert.equal(d.departamentoDeCiudad("Medellín"), "antioquia");
  assert.equal(d.departamentoDeCiudad("Soacha"), "cundinamarca");
  assert.equal(d.departamentoDeCiudad("Cúcuta"), "norte-de-santander");
  assert.equal(d.departamentoDeCiudad("Pasto"), "narino");
  assert.equal(d.departamentoDeCiudad("Cali, Valle"), "valle-del-cauca", "ciudad con departamento");
  assert.equal(d.departamentoDeCiudad("Valle"), "valle-del-cauca", "nombre del departamento");
  assert.equal(d.departamentoDeCiudad("Ciudad que no existe"), null);
  assert.equal(d.departamentoDeCiudad(""), null);
  assert.equal(d.departamentoDeCiudad(null), null);
});

prueba("todas las capitales llevan a su departamento", () => {
  const capitales = {
    Leticia: "amazonas", Medellín: "antioquia", Arauca: "arauca", Barranquilla: "atlantico", Bogotá: "bogota",
    Cartagena: "bolivar", Tunja: "boyaca", Manizales: "caldas", Florencia: "caqueta", Yopal: "casanare",
    Popayán: "cauca", Valledupar: "cesar", Quibdó: "choco", Montería: "cordoba", Inírida: "guainia",
    "San José del Guaviare": "guaviare", Neiva: "huila", Riohacha: "la-guajira", "Santa Marta": "magdalena",
    Villavicencio: "meta", Pasto: "narino", Cúcuta: "norte-de-santander", Mocoa: "putumayo", Armenia: "quindio",
    Pereira: "risaralda", "San Andrés": "san-andres", Bucaramanga: "santander", Sincelejo: "sucre", Ibagué: "tolima",
    Cali: "valle-del-cauca", Mitú: "vaupes", "Puerto Carreño": "vichada",
  };
  for (const [ciudad, clave] of Object.entries(capitales)) assert.equal(d.departamentoDeCiudad(ciudad), clave, ciudad);
  // Cundinamarca no tiene capital propia (es Bogotá): se prueba con una ciudad grande.
  assert.equal(d.departamentoDeCiudad("Zipaquirá"), "cundinamarca");
});

prueba("nombres de región de Meta llevan al departamento", () => {
  assert.equal(d.departamentoDeRegionMeta("Valle del Cauca Department"), "valle-del-cauca");
  assert.equal(d.departamentoDeRegionMeta("Bogota"), "bogota");
  assert.equal(d.departamentoDeRegionMeta("Bogotá, D.C."), "bogota");
  assert.equal(d.departamentoDeRegionMeta("Chocó Department"), "choco");
  assert.equal(d.departamentoDeRegionMeta("Archipiélago de San Andrés, Providencia y Santa Catalina"), "san-andres");
  assert.equal(d.departamentoDeRegionMeta("Nariño Department"), "narino");
  assert.equal(d.departamentoDeRegionMeta("Meta Department"), "meta");
  assert.equal(d.departamentoDeRegionMeta("Antioquia"), "antioquia");
  for (const dep of d.DEPARTAMENTOS) assert.equal(d.departamentoDeRegionMeta(`${dep.nombre} Department`), dep.clave, dep.nombre);
  assert.equal(d.departamentoDeRegionMeta("Unknown"), null);
  assert.equal(d.departamentoDeRegionMeta("Florida"), null);
  assert.equal(d.departamentoDeRegionMeta(""), null);
});

prueba("teléfono: solo el fijo 601 dice el departamento; celulares y otros, null", () => {
  assert.equal(d.departamentoDeTelefono("6012345678"), "bogota");
  assert.equal(d.departamentoDeTelefono("+57 601 234 5678"), "bogota");
  assert.equal(d.departamentoDeTelefono("6018512345"), "cundinamarca");
  assert.equal(d.departamentoDeTelefono("573001112233"), null, "celular");
  assert.equal(d.departamentoDeTelefono("6024441122"), null, "602 cubre varios departamentos");
  assert.equal(d.departamentoDeTelefono("123"), null);
  assert.equal(d.departamentoDeTelefono(null), null);
});

prueba("sumas por departamento: cuadran con el total, contando 'sin-ubicar' y 'otras-regiones'", () => {
  const filas = [
    { regionMeta: "Valle del Cauca Department", gasto: 120_000.5 },
    { regionMeta: "Chocó Department", gasto: 80_000 },
    { regionMeta: "Florida", gasto: 5_000 },
    { departamento: "valle-del-cauca", chats: 3, ventas: 1, valorVendido: 989_000 },
    { departamento: "choco", chats: 2 },
    { departamento: null, chats: 4, ventas: 1, valorVendido: 1_200_000 },
    { departamento: "no-es-clave", chats: 1 },
    { departamento: "bogota", ventas: null, valorVendido: undefined },
  ];
  const r = m.sumarPorDepartamento(filas);
  assert.equal(r.departamentos.length, 33, "aparecen todos, aunque estén en 0");
  const valle = r.departamentos.find((x) => x.clave === "valle-del-cauca");
  assert.deepEqual({ ...valle }, { clave: "valle-del-cauca", nombre: "Valle del Cauca", gasto: 120_000.5, chats: 3, ventas: 1, valorVendido: 989_000 });
  const choco = r.departamentos.find((x) => x.clave === "choco");
  assert.equal(choco.gasto, 80_000);
  assert.equal(choco.chats, 2);
  assert.equal(r.otrasRegiones.gasto, 5_000, "región rara de Meta");
  assert.equal(r.sinUbicar.chats, 5, "sin departamento o con una clave que no existe");
  assert.equal(r.sinUbicar.ventas, 1);
  for (const campo of ["gasto", "chats", "ventas", "valorVendido"]) {
    const suma = [...r.departamentos, r.sinUbicar, r.otrasRegiones].reduce((s, x) => s + x[campo], 0);
    assert.equal(Math.round(suma * 100) / 100, r.total[campo], campo);
  }
  assert.deepEqual({ ...r.total }, { gasto: 205_000.5, chats: 10, ventas: 2, valorVendido: 2_189_000 });
  const vacio = m.sumarPorDepartamento([]);
  assert.deepEqual({ ...vacio.total }, { gasto: 0, chats: 0, ventas: 0, valorVendido: 0 });
});

prueba("regla del rojo: gasto sin ventas con datos suficientes", () => {
  assert.equal(m.DIAS_ROJO, 60);
  assert.equal(m.esRojo({ gasto60d: 150_000, ventas60d: 0, datosSuficientes: true }), true, "gasta y no vende");
  assert.equal(m.esRojo({ gasto60d: 0, ventas60d: 0, datosSuficientes: true }), false, "sin gasto");
  assert.equal(m.esRojo({ gasto60d: null, ventas60d: 0, datosSuficientes: true }), false, "gasto desconocido");
  assert.equal(m.esRojo({ gasto60d: 150_000, ventas60d: 1, datosSuficientes: true }), false, "con una venta");
  assert.equal(m.esRojo({ gasto60d: 150_000, ventas60d: 0, datosSuficientes: false }), false, "sin datos suficientes");
});

prueba("venta: manda Gestión; si falta, la ciudad del chat; por último el teléfono", () => {
  assert.equal(m.departamentoDeVenta({ departamentoGestion: "Chocó", ciudadGestion: "Cali", ciudadChat: "Medellín", telefono: "6012345678" }), "choco");
  assert.equal(m.departamentoDeVenta({ departamentoGestion: "valle-del-cauca", ciudadChat: "Quibdó" }), "valle-del-cauca", "la clave también sirve");
  assert.equal(m.departamentoDeVenta({ departamentoGestion: null, ciudadGestion: "Istmina", ciudadChat: "Cali" }), "choco", "ciudad de Gestión");
  assert.equal(m.departamentoDeVenta({ departamentoGestion: "", ciudadGestion: null, ciudadChat: "Cali", telefono: "6012345678" }), "valle-del-cauca", "ciudad del chat");
  assert.equal(m.departamentoDeVenta({ departamentoGestion: "No sé", ciudadChat: "Quibdó" }), "choco", "Gestión trae algo que no se reconoce");
  assert.equal(m.departamentoDeVenta({ ciudadChat: null, telefono: "+57 601 234 5678" }), "bogota", "teléfono fijo");
  assert.equal(m.departamentoDeVenta({ telefono: "3001112233" }), null, "celular: sin ubicar");
  assert.equal(m.departamentoDeVenta({}), null);
});

prueba("rango del mes en hora de Colombia", () => {
  const oct = m.rangoDelMes("2026-10");
  assert.equal(oct.desde, "2026-10-01");
  assert.equal(oct.hasta, "2026-10-31");
  assert.equal(oct.desdeFecha.toISOString(), "2026-10-01T05:00:00.000Z");
  assert.equal(oct.hastaFecha.toISOString(), "2026-11-01T05:00:00.000Z");
  const dic = m.rangoDelMes("2026-12");
  assert.equal(dic.hasta, "2026-12-31");
  assert.equal(dic.hastaFecha.toISOString(), "2027-01-01T05:00:00.000Z");
  assert.equal(m.rangoDelMes("2028-02").hasta, "2028-02-29", "año bisiesto");
  assert.equal(m.rangoDelMes("2026-13"), null);
  assert.equal(m.rangoDelMes("octubre"), null);
});

prueba("ventas de Gestión: lee ciudad y departamento opcionales y no agrega otro método HTTP", () => {
  const fuente = fs.readFileSync(`${RAIZ}/src/features/pauta/servicios/ventas-de-gestion.ts`, "utf8");
  assert.match(fuente, /ciudad\?: string \| null;/);
  assert.match(fuente, /departamento\?: string \| null;/);
  assert.match(fuente, /typeof v\.ciudad === "string"/);
  assert.match(fuente, /typeof v\.departamento === "string"/);
  const metodos = [...fuente.matchAll(/method:\s*"([A-Z]+)"/g)].map((x) => x[1]);
  assert.deepEqual(metodos, ["GET"], "solo lee de Gestión");
  for (const archivo of ["departamentos.ts", "mapa.ts"]) {
    const codigo = fs.readFileSync(`${RAIZ}/src/features/pauta/dominio/${archivo}`, "utf8");
    assert.doesNotMatch(codigo, /@\/lib\/prisma|fetch\(/, `${archivo} es puro`);
  }
});

console.log(`\n${pruebas} pruebas del mapa de Colombia OK`);
