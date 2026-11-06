import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { indiceDePedazoValido, recibirPedazo } from "./chat-upload-pedazos";

/*
  Pruebas de la parte de disco de la subida por pedazos, con carpetas de verdad: lo que importa es
  que el archivo armado sea IDENTICO al original, byte por byte, y que nunca aparezca uno cortado.
*/

const TAMANO = 1000;

async function carpetas() {
  const raiz = await mkdtemp(path.join(tmpdir(), "pedazos-"));
  return { raiz, tmpDir: path.join(raiz, "chat-media-tmp"), destinoDir: path.join(raiz, "chat-media") };
}

function partir(original: Buffer) {
  const pedazos: Buffer[] = [];
  for (let desde = 0; desde < original.length; desde += TAMANO) pedazos.push(original.subarray(desde, desde + TAMANO));
  return pedazos;
}

const sha = (datos: Buffer) => createHash("sha256").update(datos).digest("hex");

const listar = (carpeta: string) => readdir(carpeta).catch(() => [] as string[]);

function mandar(
  dirs: { tmpDir: string; destinoDir: string },
  uploadId: string,
  pedazos: Buffer[],
  indice: number,
  extra: { maxBytes?: number; nombreFinal?: string } = {},
) {
  return recibirPedazo({
    ...dirs,
    uploadId,
    indice,
    total: pedazos.length,
    datos: pedazos[indice],
    maxBytes: extra.maxBytes ?? 100 * 1024 * 1024,
    maxMb: 100,
    nombreFinal: extra.nombreFinal ?? "final.pdf",
  });
}

test("pedazos en desorden y uno repetido arman un archivo identico al original", async () => {
  const dirs = await carpetas();
  try {
    const original = randomBytes(TAMANO * 6 + 321);
    const pedazos = partir(original);
    assert.equal(pedazos.length, 7);

    // Desordenados, con el 2 mandado dos veces (un reintento), y el ultimo al final.
    for (const indice of [4, 1, 2, 5, 0, 2, 3]) {
      const resultado = await mandar(dirs, "subida-desorden", pedazos, indice);
      assert.equal(resultado.estado, "guardado");
    }
    const final = await mandar(dirs, "subida-desorden", pedazos, 6);
    assert.equal(final.estado, "completo");

    const armado = await readFile(path.join(dirs.destinoDir, "final.pdf"));
    assert.equal(armado.length, original.length);
    assert.equal(sha(armado), sha(original));
    assert.deepEqual(await listar(dirs.tmpDir), [], "la carpeta temporal tiene que desaparecer");
    console.log(`  sha256 original=${sha(original).slice(0, 16)}… armado=${sha(armado).slice(0, 16)}… (7 pedazos en desorden, el 2 repetido); chat-media-tmp vacia`);
  } finally {
    await rm(dirs.raiz, { recursive: true, force: true });
  }
});

test("una pestaña vieja que manda de a uno y en orden sigue funcionando", async () => {
  const dirs = await carpetas();
  try {
    const original = randomBytes(TAMANO * 3 + 7);
    const pedazos = partir(original);
    for (let indice = 0; indice < pedazos.length; indice += 1) {
      const resultado = await mandar(dirs, "subida-vieja-1", pedazos, indice);
      assert.equal(resultado.estado, indice === pedazos.length - 1 ? "completo" : "guardado");
    }
    assert.equal(sha(await readFile(path.join(dirs.destinoDir, "final.pdf"))), sha(original));
  } finally {
    await rm(dirs.raiz, { recursive: true, force: true });
  }
});

test("un archivo de un solo pedazo se arma igual", async () => {
  const dirs = await carpetas();
  try {
    const original = randomBytes(500);
    const resultado = await mandar(dirs, "subida-unica-1", [original], 0);
    assert.equal(resultado.estado, "completo");
    assert.equal(sha(await readFile(path.join(dirs.destinoDir, "final.pdf"))), sha(original));
    assert.deepEqual(await listar(dirs.tmpDir), []);
  } finally {
    await rm(dirs.raiz, { recursive: true, force: true });
  }
});

test("si falta un pedazo da 409, no crea archivo y no toca los que llegaron", async () => {
  const dirs = await carpetas();
  try {
    const pedazos = partir(randomBytes(TAMANO * 4));
    // El 0 y el 1 llegan; el 2 se pierde.
    for (const indice of [0, 1]) assert.equal((await mandar(dirs, "subida-falta-2", pedazos, indice)).estado, "guardado");

    // Se manda el ultimo (el 3 de 4) otra vez, como un reintento, con el 2 todavia sin llegar.
    assert.equal(pedazos.length, 4);
    const resultado = await mandar(dirs, "subida-falta-2", pedazos, pedazos.length - 1);
    assert.equal(resultado.estado, "error");
    assert.equal(resultado.estado === "error" && resultado.status, 409);
    assert.match(resultado.estado === "error" ? resultado.error : "", /Faltan partes/);

    assert.deepEqual(await listar(dirs.destinoDir), [], "chat-media tiene que quedar vacia");
    const quedaron = (await listar(path.join(dirs.tmpDir, "subida-falta-2"))).sort();
    assert.deepEqual(quedaron, ["0.part", "1.part", "3.part"]);
    for (const indice of [0, 1, 3]) {
      const guardado = await readFile(path.join(dirs.tmpDir, "subida-falta-2", `${indice}.part`));
      assert.equal(sha(guardado), sha(pedazos[indice]), `el pedazo ${indice} cambio`);
    }
    console.log(`  falta el pedazo 2 -> 409; chat-media vacia; quedaron ${quedaron.join(", ")} intactos`);
  } finally {
    await rm(dirs.raiz, { recursive: true, force: true });
  }
});

test("si el ultimo llega cuando la carpeta ya no existe da 409 y no aparece ningun archivo", async () => {
  const dirs = await carpetas();
  try {
    const pedazos = partir(randomBytes(TAMANO * 3));
    for (let indice = 0; indice < pedazos.length; indice += 1) await mandar(dirs, "subida-repetida", pedazos, indice);
    assert.deepEqual(await listar(dirs.destinoDir), ["final.pdf"]);

    // Se perdio la respuesta y el celular reintenta el ultimo: el archivo ya se armo y la carpeta no esta.
    const reintento = await mandar(dirs, "subida-repetida", pedazos, pedazos.length - 1, { nombreFinal: "segundo.pdf" });
    assert.equal(reintento.estado === "error" && reintento.status, 409);
    assert.deepEqual(await listar(dirs.destinoDir), ["final.pdf"], "no tiene que aparecer un segundo archivo");
    assert.deepEqual(await listar(dirs.tmpDir), [], "tampoco una carpeta con un solo pedazo");
    console.log("  ultimo pedazo reintentado sin carpeta -> 409; chat-media solo tiene el archivo bueno");
  } finally {
    await rm(dirs.raiz, { recursive: true, force: true });
  }
});

test("si el ultimo llega dos veces a la vez solo uno arma el archivo", async () => {
  const dirs = await carpetas();
  try {
    const original = randomBytes(TAMANO * 5);
    const pedazos = partir(original);
    for (let indice = 0; indice < pedazos.length - 1; indice += 1) await mandar(dirs, "subida-doble", pedazos, indice);

    const [a, b] = await Promise.all([
      mandar(dirs, "subida-doble", pedazos, 4, { nombreFinal: "a.pdf" }),
      mandar(dirs, "subida-doble", pedazos, 4, { nombreFinal: "b.pdf" }),
    ]);
    const estados = [a, b].map((r) => (r.estado === "error" ? r.status : r.estado)).sort();
    assert.deepEqual(estados, [409, "completo"]);
    const archivos = await listar(dirs.destinoDir);
    assert.equal(archivos.length, 1);
    assert.equal(sha(await readFile(path.join(dirs.destinoDir, archivos[0]))), sha(original));
    console.log(`  dos ultimos a la vez -> ${estados.join(" y ")}; un solo archivo, identico al original`);
  } finally {
    await rm(dirs.raiz, { recursive: true, force: true });
  }
});

test("si la suma de los pedazos pasa el tope se borra la carpeta y da 400", async () => {
  const dirs = await carpetas();
  try {
    const pedazos = partir(randomBytes(TAMANO * 4));
    assert.equal((await mandar(dirs, "subida-grande", pedazos, 0, { maxBytes: 2500 })).estado, "guardado");
    assert.equal((await mandar(dirs, "subida-grande", pedazos, 1, { maxBytes: 2500 })).estado, "guardado");
    const resultado = await mandar(dirs, "subida-grande", pedazos, 2, { maxBytes: 2500 });
    assert.equal(resultado.estado === "error" && resultado.status, 400);
    assert.match(resultado.estado === "error" ? resultado.error : "", /supera los 100 MB/);
    assert.deepEqual(await listar(dirs.tmpDir), []);
    assert.deepEqual(await listar(dirs.destinoDir), []);
  } finally {
    await rm(dirs.raiz, { recursive: true, force: true });
  }
});

test("un indice fuera de rango se rechaza con 400 sin crear nada", async () => {
  const dirs = await carpetas();
  try {
    for (const [indice, total] of [
      [-1, 3],
      [3, 3],
      [1.5, 3],
      [0, 0],
      [Number.NaN, 3],
    ]) {
      assert.equal(indiceDePedazoValido(indice, total), false, `${indice}/${total}`);
      const resultado = await recibirPedazo({
        ...dirs,
        uploadId: "subida-fuera",
        indice,
        total,
        datos: Buffer.from("x"),
        maxBytes: 1000,
        maxMb: 100,
        nombreFinal: "x.pdf",
      });
      assert.equal(resultado.estado === "error" && resultado.status, 400);
    }
    assert.deepEqual(await listar(dirs.raiz), [], "no se tiene que crear ninguna carpeta");
    assert.equal(indiceDePedazoValido(0, 1), true);
    assert.equal(indiceDePedazoValido(2, 3), true);
  } finally {
    await rm(dirs.raiz, { recursive: true, force: true });
  }
});
