import assert from "node:assert/strict";
import test from "node:test";

import {
  AVISO_RECUPERACION,
  atenderPedidoDeRecuperacion,
  crearLimitePorIp,
  leerIp,
  type PiezasDeRecuperacion,
  type UsuarioParaRecuperar,
} from "./limite-recuperacion-de-clave";

const MINUTO = 60 * 1000;

// Arma las piezas con base, correo y reloj simulados. Los trabajos de after() se guardan para correrlos a mano.
function simular(usuarios: UsuarioParaRecuperar[] = []) {
  let ahora = Date.parse("2026-11-02T15:00:00Z");
  const enlaces: Array<{ userId: string; creado: number }> = [];
  const pendientes: Array<() => Promise<void>> = [];
  const registro: string[] = [];

  const piezas: PiezasDeRecuperacion = {
    ahora: () => ahora,
    limitePorIp: crearLimitePorIp(),
    buscarUsuario: async (correo) => usuarios.find((u) => u.email.toLowerCase() === correo) ?? null,
    contarEnlacesDesde: async (userId, desde) =>
      enlaces.filter((e) => e.userId === userId && e.creado >= desde.getTime()).length,
    enviarEnlace: async (usuario) => {
      enlaces.push({ userId: usuario.id, creado: ahora });
    },
    despues: (trabajo) => {
      pendientes.push(trabajo);
    },
    registrar: (mensaje) => {
      registro.push(mensaje);
    },
  };

  return {
    piezas,
    enlaces,
    registro,
    avanzar: (ms: number) => {
      ahora += ms;
    },
    async pedir(correo: string, ip = "1.1.1.1") {
      const respuesta = atenderPedidoDeRecuperacion({ correo, ip }, piezas);
      while (pendientes.length) await pendientes.shift()!();
      return respuesta;
    },
  };
}

const alexander = { id: "u1", email: "alexander@ejemplo.com", name: "Alexander" };

test("el aviso es el mismo exista o no el correo", async () => {
  const s = simular([alexander]);
  const existe = await s.pedir("alexander@ejemplo.com");
  const noExiste = await s.pedir("nadie@ejemplo.com", "2.2.2.2");
  assert.deepEqual(existe, noExiste);
  assert.deepEqual(existe, { ok: true, message: AVISO_RECUPERACION });
  assert.match(AVISO_RECUPERACION, /^Si el correo está registrado, te llegó un link/);
  assert.equal(s.enlaces.length, 1);
});

test("el correo se busca sin importar mayúsculas ni espacios", async () => {
  const s = simular([alexander]);
  await s.pedir("  Alexander@Ejemplo.COM ");
  assert.equal(s.enlaces.length, 1);
});

test("el envío va después de responder (after)", () => {
  const s = simular([alexander]);
  atenderPedidoDeRecuperacion({ correo: alexander.email, ip: "1.1.1.1" }, s.piezas);
  assert.equal(s.enlaces.length, 0);
});

test("mismo correo: el 4.º pedido en una hora no crea enlace; pasada la hora sí", async () => {
  const s = simular([alexander]);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await s.pedir(alexander.email, `10.0.0.${i}`), { ok: true, message: AVISO_RECUPERACION });
    s.avanzar(5 * MINUTO);
  }
  assert.equal(s.enlaces.length, 3);

  const cuarto = await s.pedir(alexander.email, "10.0.0.9");
  assert.deepEqual(cuarto, { ok: true, message: AVISO_RECUPERACION });
  assert.equal(s.enlaces.length, 3);
  assert.ok(s.registro.some((linea) => linea.includes("límite por correo")));

  s.avanzar(60 * MINUTO);
  await s.pedir(alexander.email, "10.0.0.10");
  assert.equal(s.enlaces.length, 4);
});

test("misma IP: el 11.º pedido en 15 minutos no crea enlace; pasado el tiempo sí", async () => {
  const usuarios = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, email: `asesora${i}@ejemplo.com`, name: null }));
  const s = simular(usuarios);
  for (let i = 0; i < 10; i++) {
    await s.pedir(`asesora${i}@ejemplo.com`, "9.9.9.9");
    s.avanzar(MINUTO);
  }
  assert.equal(s.enlaces.length, 10);

  const once = await s.pedir("asesora10@ejemplo.com", "9.9.9.9");
  assert.deepEqual(once, { ok: true, message: AVISO_RECUPERACION });
  assert.equal(s.enlaces.length, 10);

  // Otra IP sí puede.
  await s.pedir("asesora10@ejemplo.com", "8.8.8.8");
  assert.equal(s.enlaces.length, 11);

  s.avanzar(15 * MINUTO);
  await s.pedir("asesora11@ejemplo.com", "9.9.9.9");
  assert.equal(s.enlaces.length, 12);
});

test("si falla el correo, la persona ve el mismo aviso y la falla queda en el registro", async () => {
  const s = simular([alexander]);
  s.piezas.enviarEnlace = async () => {
    throw new Error("SMTP caído");
  };
  assert.deepEqual(await s.pedir(alexander.email), { ok: true, message: AVISO_RECUPERACION });
  assert.ok(s.registro.some((linea) => linea.includes("no se pudo enviar")));
});

test("varios pedidos a la vez del mismo correo no se saltan el límite", async () => {
  const s = simular([alexander]);
  const trabajos: Array<() => Promise<void>> = [];
  s.piezas.despues = (trabajo) => {
    trabajos.push(trabajo);
  };
  for (let i = 0; i < 6; i++) atenderPedidoDeRecuperacion({ correo: alexander.email, ip: `7.7.7.${i}` }, s.piezas);
  await Promise.all(trabajos.map((trabajo) => trabajo()));
  assert.ok(s.enlaces.length <= 3, `se crearon ${s.enlaces.length} enlaces`);
});

test("la IP sale del primer valor de x-forwarded-for", () => {
  const encabezados = (valores: Record<string, string>) => ({ get: (nombre: string) => valores[nombre] ?? null });
  assert.equal(leerIp(encabezados({ "x-forwarded-for": "200.1.2.3, 10.0.0.1" })), "200.1.2.3");
  assert.equal(leerIp(encabezados({ "x-real-ip": "200.9.9.9" })), "200.9.9.9");
  assert.equal(leerIp(encabezados({})), "desconocida");
});
