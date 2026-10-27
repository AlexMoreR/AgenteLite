// Pruebas de guardarPersonaDelEquipoAction con el nombre visible (CRM: editar el nombre de una asesora).
// Correr: npm run test:equipo-nombre
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

const ruta = path.resolve("src/app/actions/equipo-actions.ts");
const js = ts.transpileModule(fs.readFileSync(ruta, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: ruta,
}).outputText;

function armar(miembro) {
  const escrituras = { user: [], member: [], canal: 0 };
  const prisma = {
    workspaceMember: {
      findFirst: async ({ where }) => (where.workspaceId === "w1" && where.id === miembro?.id ? miembro : null),
      update: async (a) => { escrituras.member.push(a); },
    },
    whatsAppChannel: { findMany: async () => [], update: async () => { escrituras.canal++; } },
    user: { update: async (a) => { escrituras.user.push(a); } },
  };
  const guardados = { avisos: null };
  const fakes = {
    "next/cache": { revalidatePath() {} },
    "@prisma/client": { Prisma: {} },
    "@/lib/channel-collaborators": { leerColaboradores: () => [], leerMonitores: () => [], leerPausadosDeReparto: () => [] },
    "@/lib/client-workspace-access": {
      requireClientWorkspaceAccess: async () => {
        if (miembro?.noDueno) throw new Error("sin permiso");
        return { workspaceId: "w1" };
      },
    },
    "@/lib/client-workspace-modules": { sanitizeClientModuleAccess: (x) => x },
    "@/lib/en-linea": { guardarAsesoraDeRespaldo: async () => {} },
    "@/lib/horario-de-reparto": { guardarHorarioDeReparto: async () => {}, normalizarHorario: (x) => x },
    "@/lib/permisos-del-equipo": { guardarSupervisoras: async () => {}, leerSupervisoras: async () => [] },
    "@/lib/prisma": { prisma },
    "@/features/agente-v3/servicios/avisos": {
      guardarConfigDeAvisos: async (_w, c) => { guardados.avisos = c; },
      leerConfigDeAvisos: async () => ({ canalId: "c", activo: true, destinos: [] }),
      normalizarNumeroDeAviso: (t) => t.replace(/\D/g, ""),
    },
  };
  const mod = { exports: {} };
  new Function("exports", "require", "module", js)(mod.exports, (n) => {
    if (!(n in fakes)) throw new Error(`modulo no previsto: ${n}`);
    return fakes[n];
  }, mod);
  return { accion: mod.exports.guardarPersonaDelEquipoAction, escrituras, guardados };
}

const miembro = () => ({
  id: "m1", userId: "u1", role: "AGENT",
  user: { role: "EMPLEADO", name: "Maria Bautista", email: "a@b.co" },
});
const base = { memberId: "m1", rol: "asesora", modulos: [], lineas: [] };

// Nombre válido: se guarda recortado y solo cambia el nombre.
{
  const t = armar(miembro());
  const r = await t.accion({ ...base, nombre: "  María Camila Ardila " });
  assert.deepEqual(r, { ok: true });
  assert.equal(t.escrituras.user.length, 1);
  assert.deepEqual(t.escrituras.user[0], { where: { id: "u1" }, data: { name: "María Camila Ardila" } });
}
// Nombre igual al guardado o sin campo: no se escribe nada.
for (const nombre of ["Maria Bautista", " Maria Bautista ", undefined]) {
  const t = armar(miembro());
  assert.deepEqual(await t.accion({ ...base, nombre }), { ok: true });
  assert.equal(t.escrituras.user.length, 0);
}
// Nombre corto o largo: se rechaza sin escribir.
for (const nombre of ["", " a ", "x".repeat(101)]) {
  const t = armar(miembro());
  const r = await t.accion({ ...base, nombre });
  assert.ok("error" in r);
  assert.equal(t.escrituras.user.length, 0);
}
// Persona de otro negocio: se rechaza.
{
  const t = armar(miembro());
  const r = await t.accion({ ...base, memberId: "otro", nombre: "María Camila Ardila" });
  assert.deepEqual(r, { error: "Esa persona no es del equipo" });
  assert.equal(t.escrituras.user.length, 0);
}
// Quien no es dueño: la acción lanza antes de tocar nada.
{
  const m = { ...miembro(), noDueno: true };
  const t = armar(m);
  await assert.rejects(() => t.accion({ ...base, nombre: "María Camila Ardila" }));
  assert.equal(t.escrituras.user.length, 0);
}
// El nombre de la lista de avisos queda con el nombre nuevo.
{
  const t = armar(miembro());
  await t.accion({ ...base, nombre: "María Camila Ardila", whatsappDeAvisos: "+57 300 265 6414" });
  assert.equal(t.guardados.avisos.destinos[0].nombre, "María Camila Ardila");
}
console.log("OK: nombre visible de la persona del equipo");
