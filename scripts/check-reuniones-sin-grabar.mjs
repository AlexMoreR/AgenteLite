// Revisa la opción "Sin grabar" de Reuniones: el aviso track_published no crea pista ni pide la
// grabación, el cierre de sala pasa directo a Lista (o vuelve a Esperando si nadie entró), la cola
// nunca toma una reunión sin grabar y la migración solo agrega la columna.
// Correr: npm run test:reuniones-sin-grabar
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cargar } from "./supervisor-cargar.mjs";

let casos = 0;
async function prueba(nombre, fn) {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

// `cargar` guarda los módulos en memoria: la base y LiveKit falsos se cargan una vez y leen la reunión actual.
let actual = null;
const modulo = cargar("src/features/reuniones/servicios/avisos-de-livekit.ts", {
  "@/lib/prisma": { prisma: new Proxy({}, { get: (_, clave) => actual.prisma[clave] }) },
  "@/features/reuniones/servicios/livekit": {
    grabarPista: async () => {
      actual.estado.grabaciones += 1;
      return "EG_1";
    },
  },
  "@/features/reuniones/servicios/archivos-de-reuniones": {
    carpetaDeEgress: () => "/egress",
    relativaDesdeEgress: (ruta) => ruta,
    rutaDeArchivo: (ruta) => `/tmp/reuniones-prueba/${ruta}`,
  },
  "node:fs/promises": { chmod: async () => {}, mkdir: async () => {} },
});

/** Una base falsa con una sola reunión; anota lo que se escribe. */
function montar(reunion) {
  const estado = { reunion: { estado: "EN_VIVO", terminoEn: null, participantes: 1, pistas: [], ...reunion }, pistasCreadas: 0, grabaciones: 0, escrituras: [] };
  const prisma = {
    reunion: {
      findUnique: async ({ select }) =>
        select.sala
          ? { id: "r1", sala: "sala1", estado: estado.reunion.estado, sinGrabar: estado.reunion.sinGrabar }
          : {
              estado: estado.reunion.estado,
              terminoEn: estado.reunion.terminoEn,
              sinGrabar: estado.reunion.sinGrabar,
              _count: { participantes: estado.reunion.participantes },
              pistas: estado.reunion.pistas,
            },
      updateMany: async ({ data }) => {
        estado.escrituras.push(data);
        if (data.estado) estado.reunion.estado = data.estado;
        return { count: 1 };
      },
    },
    reunionPista: {
      create: async () => {
        estado.pistasCreadas += 1;
        return { id: "p1" };
      },
      update: async () => ({}),
      delete: async () => ({}),
    },
    reunionParticipante: { upsert: async () => ({ id: "pa1" }), updateMany: async () => ({ count: 1 }) },
    user: { findUnique: async () => null },
  };
  actual = { estado, prisma };
  return { estado, modulo };
}

const aviso = { event: "track_published", room: { name: "sala1" }, participant: { identity: "i_abcdefghij", name: "Ana" }, track: { sid: "TR_1", type: "AUDIO", source: "MICROPHONE" } };

await prueba("reunión normal: track_published crea la pista y pide la grabación", async () => {
  const { estado, modulo } = montar({ sinGrabar: false });
  await modulo.procesarAvisoDeLivekit(aviso, {});
  assert.equal(estado.pistasCreadas, 1);
  assert.equal(estado.grabaciones, 1);
});

await prueba("reunión sin grabar: track_published no crea pista ni pide la grabación", async () => {
  const { estado, modulo } = montar({ sinGrabar: true });
  await modulo.procesarAvisoDeLivekit(aviso, {});
  assert.equal(estado.pistasCreadas, 0);
  assert.equal(estado.grabaciones, 0);
});

await prueba("cierre de sala sin grabar con participantes: pasa a Lista", async () => {
  const { estado, modulo } = montar({ sinGrabar: true, terminoEn: new Date(), participantes: 2 });
  await modulo.revisarSiTermino("r1");
  assert.equal(estado.reunion.estado, "LISTA");
});

await prueba("cierre de sala normal con participantes: pasa a En cola", async () => {
  const { estado, modulo } = montar({ sinGrabar: false, terminoEn: new Date(), participantes: 2 });
  await modulo.revisarSiTermino("r1");
  assert.equal(estado.reunion.estado, "EN_COLA");
});

await prueba("cierre de sala sin grabar y sin participantes: vuelve a Esperando", async () => {
  const { estado, modulo } = montar({ sinGrabar: true, terminoEn: new Date(), participantes: 0 });
  await modulo.revisarSiTermino("r1");
  assert.equal(estado.reunion.estado, "ESPERANDO");
});

await prueba("la cola de transcripción nunca toma una reunión sin grabar", () => {
  const fuente = readFileSync("src/features/reuniones/servicios/cola-de-reuniones.ts", "utf8");
  assert.match(fuente, /where: \{ estado: "EN_COLA", sinGrabar: false \}/);
});

await prueba("crearReunionAction guarda sinGrabar y por defecto queda en no", () => {
  const fuente = readFileSync("src/app/actions/reuniones-actions.ts", "utf8");
  assert.match(fuente, /crearReunionAction\(titulo\?: string, sinGrabar\?: boolean\)/);
  assert.match(fuente, /sinGrabar: sinGrabar === true/);
});

await prueba("la migración solo agrega la columna, con valor por defecto falso", () => {
  const sql = readFileSync("prisma/migrations/20261029120000_reunion_sin_grabar/migration.sql", "utf8");
  const sentencias = sql.split("\n").filter((l) => l.trim() && !l.startsWith("--"));
  assert.deepEqual(sentencias.map((l) => l.trim()), ['BEGIN;', 'ALTER TABLE "Reunion" ADD COLUMN IF NOT EXISTS "sinGrabar" BOOLEAN NOT NULL DEFAULT false;', 'COMMIT;']);
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE/i);
});

console.log(`${casos} pruebas ok`);
