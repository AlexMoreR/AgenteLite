// Revisa la sala con varias pantallas y moderar: cuál pantalla se ve en grande, qué pistas se apagan, el
// aviso a la persona y lo que el CRM le pide a LiveKit (sin LiveKit de verdad).
// Correr: npm run test:reuniones-moderar
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cargar } from "./supervisor-cargar.mjs";

let casos = 0;
const prueba = async (nombre, fn) => {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
};

const { siguienteVista, SIN_PANTALLA } = cargar("src/features/reuniones/components/pantallas-compartidas.ts");
const { esQueModerar, pistasParaApagar, textoDelAviso } = cargar("src/features/reuniones/moderacion.ts");
const { apagarPistas } = cargar("src/features/reuniones/servicios/livekit.ts");

const yo = { identidad: "u_yo", propia: true };
const ana = { identidad: "u_ana", propia: false };
const luz = { identidad: "u_luz", propia: false };

// a) Cuál pantalla se ve en grande.
await prueba("sin pantallas no se ve ninguna y no cambia la vista", () => {
  assert.equal(siguienteVista([], SIN_PANTALLA), SIN_PANTALLA);
});
await prueba("si comparte otra persona, se ve la suya", () => {
  assert.deepEqual(siguienteVista([ana], SIN_PANTALLA), { identidad: "u_ana", aMano: false });
});
await prueba("si solo comparto yo, se ve la mía", () => {
  assert.deepEqual(siguienteVista([yo], SIN_PANTALLA), { identidad: "u_yo", aMano: false });
});
await prueba("yo compartiendo: si otra persona comparte, se pasa a la suya (el caso que no se podía ver)", () => {
  assert.deepEqual(siguienteVista([yo, ana], { identidad: "u_yo", aMano: false }), { identidad: "u_ana", aMano: false });
});
await prueba("si escogí mi pantalla a mano, se queda aunque otra persona comparta", () => {
  const vista = { identidad: "u_yo", aMano: true };
  assert.equal(siguienteVista([yo, ana], vista), vista);
});
await prueba("si alguien más empieza a compartir, la vista no salta", () => {
  const vista = { identidad: "u_luz", aMano: false };
  assert.equal(siguienteVista([ana, luz], vista), vista);
});
await prueba("la pantalla escogida a mano se respeta", () => {
  const vista = { identidad: "u_luz", aMano: true };
  assert.equal(siguienteVista([yo, ana, luz], vista), vista);
});
await prueba("si la que veo se deja de compartir, pasa a otra", () => {
  assert.deepEqual(siguienteVista([yo, luz], { identidad: "u_ana", aMano: true }), { identidad: "u_luz", aMano: false });
});
await prueba("si ya nadie comparte, la vista queda vacía", () => {
  assert.deepEqual(siguienteVista([], { identidad: "u_ana", aMano: true }), SIN_PANTALLA);
});

// b) Qué pistas se apagan.
const pistas = [
  { sid: "TR_mic", source: "MICROPHONE", muted: false },
  { sid: "TR_pan", source: "SCREEN_SHARE", muted: false },
  { sid: "TR_paa", source: "SCREEN_SHARE_AUDIO", muted: false },
];
await prueba("silenciar solo toca el micrófono", () => {
  assert.deepEqual(pistasParaApagar("microfono", pistas), ["TR_mic"]);
});
await prueba("quitar la pantalla apaga el video y su audio, no el micrófono", () => {
  assert.deepEqual(pistasParaApagar("pantalla", pistas), ["TR_pan", "TR_paa"]);
});
await prueba("entiende el origen con número", () => {
  assert.deepEqual(pistasParaApagar("microfono", [{ sid: "a", source: 2 }, { sid: "b", source: 3 }]), ["a"]);
});
await prueba("lo que ya está apagado no se vuelve a apagar", () => {
  assert.deepEqual(pistasParaApagar("microfono", [{ sid: "a", source: "MICROPHONE", muted: true }]), []);
  assert.deepEqual(pistasParaApagar("pantalla", undefined), []);
});
await prueba("solo se acepta micrófono o pantalla", () => {
  assert.equal(esQueModerar("microfono"), true);
  assert.equal(esQueModerar("pantalla"), true);
  assert.equal(esQueModerar("sacar"), false);
  assert.equal(esQueModerar(undefined), false);
});

// c) El aviso.
await prueba("el aviso dice quién fue y que se puede volver a prender", () => {
  assert.match(textoDelAviso({ que: "microfono", por: "Alex" }), /^Alex te silenció.*volver a prender/);
  assert.match(textoDelAviso({ que: "pantalla", por: "Alex" }), /^Alex te quitó la pantalla.*volver a compartir/);
  assert.match(textoDelAviso({ que: "pantalla" }), /^Alguien/);
  assert.equal(textoDelAviso({ que: "otra" }), null);
});

// d) Lo que se le pide a LiveKit.
const config = { url: "wss://x", urlApi: "https://x", apiKey: "clave", apiSecret: "secreto" };
function conFetchFalso(respuestas) {
  const llamadas = [];
  globalThis.fetch = async (url, opciones) => {
    const metodo = String(url).split("/").pop();
    const token = opciones.headers.Authorization.replace("Bearer ", "");
    const permisos = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).video;
    llamadas.push({ metodo, cuerpo: JSON.parse(opciones.body), permisos });
    const { estado = 200, cuerpo = {} } = respuestas[metodo] ?? {};
    return { ok: estado < 400, status: estado, text: async () => JSON.stringify(cuerpo) };
  };
  return llamadas;
}
const datos = { sala: "reunion_1", identidad: "u_ana", que: "pantalla", por: "Alex" };

await prueba("apaga cada pista y le avisa solo a esa persona, con permiso de administrar solo esa sala", async () => {
  const llamadas = conFetchFalso({ GetParticipant: { cuerpo: { tracks: pistas } } });
  assert.equal(await apagarPistas(config, datos), 2);
  assert.deepEqual(llamadas.map((uno) => uno.metodo), ["GetParticipant", "MutePublishedTrack", "MutePublishedTrack", "SendData"]);
  assert.deepEqual(llamadas[1].cuerpo, { room: "reunion_1", identity: "u_ana", trackSid: "TR_pan", muted: true });
  for (const { permisos } of llamadas) {
    assert.deepEqual(permisos, { room: "reunion_1", roomAdmin: true });
  }
  const aviso = llamadas[3].cuerpo;
  assert.deepEqual(aviso.destinationIdentities, ["u_ana"]);
  assert.equal(aviso.topic, "moderacion");
  assert.deepEqual(JSON.parse(Buffer.from(aviso.data, "base64").toString()), { que: "pantalla", por: "Alex" });
});
await prueba("si ya estaba apagado no apaga ni avisa", async () => {
  const llamadas = conFetchFalso({ GetParticipant: { cuerpo: { tracks: [] } } });
  assert.equal(await apagarPistas(config, datos), 0);
  assert.deepEqual(llamadas.map((uno) => uno.metodo), ["GetParticipant"]);
});
await prueba("si el aviso falla, la pista igual queda apagada", async () => {
  const errorOriginal = console.error;
  console.error = () => undefined;
  conFetchFalso({ GetParticipant: { cuerpo: { tracks: pistas } }, SendData: { estado: 500 } });
  assert.equal(await apagarPistas(config, datos), 2);
  console.error = errorOriginal;
});
await prueba("si la persona ya salió, el error dice 404 (la acción lo traduce)", async () => {
  conFetchFalso({ GetParticipant: { estado: 404 } });
  await assert.rejects(apagarPistas(config, datos), /404/);
});

// e) Los pases y los permisos no se aflojan: moderar pasa por el servidor del CRM.
const fuenteLivekit = readFileSync("src/features/reuniones/servicios/livekit.ts", "utf8");
const pase = fuenteLivekit.slice(fuenteLivekit.indexOf("export function crearPaseDeEntrada"), fuenteLivekit.indexOf("// Avisos (webhook)"));
await prueba("el pase de la sala sigue sin permiso de administrar", () => {
  assert.doesNotMatch(pase, /roomAdmin/);
});
const fuenteAccion = readFileSync("src/app/actions/reuniones-actions.ts", "utf8");
const accion = fuenteAccion.slice(fuenteAccion.indexOf("export async function moderarEnLaReunionAction"));
await prueba("la acción revisa la sesión y el permiso antes de tocar LiveKit", () => {
  const permiso = accion.indexOf("puedeTerminarLaReunion");
  assert.ok(accion.indexOf("session?.user?.id") >= 0 && accion.indexOf("session?.user?.id") < permiso);
  assert.ok(permiso >= 0 && permiso < accion.indexOf("apagarPistas"));
});
const fuenteSala = readFileSync("src/features/reuniones/components/SalaDeReunion.tsx", "utf8");
await prueba("la sala solo cree el aviso si lo manda el servidor", () => {
  assert.match(fuenteSala, /tema === TEMA_DE_MODERACION && !participante/);
});

console.log(`\n${casos} pruebas OK`);
