// P5 (T1 y T5): ponerse al dia sin recargar la pantalla y chats sin acceso fuera del guardado.
// Lee el codigo fuente (como check-chats-celular.mjs); no necesita base ni red. La logica de quitar
// filas se prueba con node:test en src/components/chats/guardado-local/reglas.test.ts.
// Correr: node scripts/check-ponerse-al-dia.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const leer = (ruta) => fs.readFileSync(path.resolve(ruta), "utf8").replace(/\r\n/g, "\n");

const auto = leer("src/components/agents/chats-auto-refresh.tsx");
const bandeja = leer("src/components/chats/shared-inbox.tsx");
const precarga = leer("src/components/chats/chat-conversation-warmup.ts");
const sinAcceso = leer("src/components/chats/guardado-local/sin-acceso.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("el evento es cancelable y, si nadie lo atiende, se recarga como siempre", () => {
  assert.match(auto, /export const EVENTO_PONERSE_AL_DIA = "chats-ponerse-al-dia";/);
  assert.match(
    auto,
    /function ponerseAlDiaSinRecargar\(recargar: \(\) => void\) \{[\s\S]*?!window\.dispatchEvent\(new CustomEvent\(EVENTO_PONERSE_AL_DIA, \{ cancelable: true \}\)\)[\s\S]*?if \(!atendido\) \{\s*refrescarSinRecargar\(recargar\);/,
  );
});

prueba("solo sin API oficial: con API oficial (Magilus) sigue recargando como antes", () => {
  assert.match(auto, /const sinApiOficialRef = useRef\(officialRefreshMs <= 0\);/);
  assert.match(auto, /sinApiOficialRef\.current = officialRefreshMs <= 0;/);
  assert.match(
    auto,
    /const ponerseAlDiaORecargar = \(recargar: \(\) => void\) => \{\s*if \(sinApiOficialRef\.current\) \{\s*ponerseAlDiaSinRecargar\(recargar\);\s*\} else \{\s*refrescarSinRecargar\(recargar\);/,
  );
});

prueba("los tres sitios (tic de 60 s, volver/red/socket y muchos chats al volver) pasan por ponerse al dia", () => {
  const sitios = auto.match(/ponerseAlDiaORecargarRef\.current\(\(\) =>\s*startTransition\(\(\) => \{\s*router\.refresh\(\);/g) ?? [];
  assert.equal(sitios.length, 3);
  // El tic: despues de "listWasRecentlyUpdated".
  assert.match(auto, /if \(realtimeEnabled && listWasRecentlyUpdated\) \{\s*return;\s*\}\s*ponerseAlDiaORecargarRef\.current\(/);
  // Volver a la app / red / socket.
  assert.match(auto, /\/\/ La lista entera \(y el chat oficial\)[^\n]*\n\s*ponerseAlDiaORecargarRef\.current\(/);
  // Mas de 20 chats al volver.
  assert.match(auto, /if \(ids\.length > MAXIMO_FILAS_AL_VOLVER\) \{\s*lastRefreshAt = Date\.now\(\);\s*ponerseAlDiaORecargarRef\.current\(/);
});

prueba("el respaldo de la API oficial y los avisos sin conversacion NO cambian", () => {
  assert.match(auto, /const timer = window\.setInterval\(\(\) => \{\s*refrescarSinRecargar\(\(\) =>\s*startTransition\(\(\) => \{\s*router\.refresh\(\);/);
  assert.match(auto, /lastRefreshAt = now;\s*refrescarSinRecargar\(\(\) =>\s*startTransition\(\(\) => \{\s*router\.refresh\(\);/);
});

prueba("la bandeja atiende el aviso: preventDefault, pide la lista y los numeros, y reconcilia", () => {
  assert.match(bandeja, /import \{ EVENTO_PONERSE_AL_DIA \} from "@\/components\/agents\/chats-auto-refresh";/);
  assert.match(
    bandeja,
    /const alPonerseAlDia = \(evento: Event\) => \{\s*evento\.preventDefault\(\);\s*reconciliarListaRef\.current = true;\s*setPedidoDeLista\(\(actual\) => actual \+ 1\);\s*setPedidoDeConteos\(\(actual\) => actual \+ 1\);/,
  );
  assert.match(bandeja, /window\.addEventListener\(EVENTO_PONERSE_AL_DIA, alPonerseAlDia\);/);
  assert.match(bandeja, /window\.removeEventListener\(EVENTO_PONERSE_AL_DIA, alPonerseAlDia\);/);
  // El efecto de pedidoDeLista lee la marca y, sin busqueda, reconcilia la primera pagina.
  assert.match(bandeja, /const reconciliar = reconciliarListaRef\.current;\s*reconciliarListaRef\.current = false;/);
  assert.match(bandeja, /if \(reconciliar && !isSearchActiveRef\.current\) \{[\s\S]*?reconciliarPrimeraPagina\(next, fresh, hayMasEnElServidor,/);
  // Nunca quita el chat abierto, los fijados ni las filas oficiales.
  assert.match(bandeja, /fila\.id === abierto \|\| fijados\.has\(fila\.id\) \|\| fila\.source === "official"/);
  // La primera lista (recien cargada) se salta, salvo que la pida ponerse al dia.
  assert.match(bandeja, /if \(esLaPrimera && !reconciliar && typeof performance/);
});

prueba("T5: los tres lugares que piden /live atienden el 404", () => {
  assert.match(sinAcceso, /response\.status !== 404/);
  assert.match(sinAcceso, /tipo\.includes\("json"\)/, "solo el 404 en JSON de la ruta");
  assert.match(sinAcceso, /clearConversationFromCache\(chatKey\.trim\(\)\);/);
  assert.match(sinAcceso, /quitarDeLaListaDelCelular\(chatKey\.trim\(\)\);/);
  assert.match(sinAcceso, /export const EVENTO_CHAT_SIN_ACCESO = "chat-sin-acceso";/);
  assert.match(sinAcceso, /new CustomEvent\(EVENTO_CHAT_SIN_ACCESO, \{ detail: \{ chatKey/);

  // 1) La precarga.
  assert.match(precarga, /if \(!response\.ok\) \{[\s\S]*?atenderChatSinAcceso\(response, normalizedChatKey\);\s*return;/);
  // 2) El chat abierto del respaldo y del aviso (publicarChatAbierto).
  assert.match(auto, /async function publicarChatAbierto\(response: Response \| null, chatKey: string\) \{[\s\S]*?atenderChatSinAcceso\(response, chatKey\);\s*if \(!response\?\.ok\) return;/);
  // 3) La apertura del chat en la bandeja.
  assert.match(bandeja, /atenderChatSinAcceso\(response, normalizedSelectedConversationId\);\s*if \(!response\.ok \|\| cancelled\) \{/);
  // Y la bandeja quita la fila.
  assert.match(bandeja, /window\.addEventListener\(EVENTO_CHAT_SIN_ACCESO, alQuedarSinAcceso\);/);
  assert.match(bandeja, /current\.filter\(\(item\) => item\.id !== chatKey\)/);
});

console.log(`\n${pruebas} pruebas OK`);
