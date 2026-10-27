import assert from "node:assert/strict";
import test from "node:test";

import { esJefeDelNegocio, puedeVerRegistro } from "./permisos-del-crm";

const cuenta = (isOwner: boolean, role: string, membershipRole: string) => ({ isOwner, role, membershipRole });

test("dueño, administrador y miembro OWNER/ADMIN son jefes", () => {
  assert.equal(esJefeDelNegocio(cuenta(true, "CLIENTE", "MEMBER")), true);
  assert.equal(esJefeDelNegocio(cuenta(false, "ADMIN", "MEMBER")), true);
  assert.equal(esJefeDelNegocio(cuenta(false, "CLIENTE", "OWNER")), true);
  assert.equal(esJefeDelNegocio(cuenta(false, "CLIENTE", "ADMIN")), true);
});

test("supervisora, asesora y empleado no son jefes", () => {
  assert.equal(esJefeDelNegocio(cuenta(false, "CLIENTE", "SUPERVISORA")), false);
  assert.equal(esJefeDelNegocio(cuenta(false, "CLIENTE", "MEMBER")), false);
  assert.equal(esJefeDelNegocio(cuenta(false, "EMPLEADO", "MEMBER")), false);
});

test("la monitora conserva el Registro y la asesora no", () => {
  assert.equal(puedeVerRegistro(cuenta(false, "CLIENTE", "MEMBER"), true), true);
  assert.equal(puedeVerRegistro(cuenta(false, "CLIENTE", "MEMBER"), false), false);
  assert.equal(puedeVerRegistro(cuenta(true, "CLIENTE", "OWNER"), false), true);
});
