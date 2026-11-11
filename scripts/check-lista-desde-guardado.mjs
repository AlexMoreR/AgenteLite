// P5 (T2 y T4): el guardado con dueño se fija antes de que la bandeja lo lea, se borra al cerrar
// sesion, tiene interruptor, y la lista guardada se pinta mientras carga (con las siluetas de respaldo).
// Lee el codigo fuente; no necesita base ni red. Las reglas se prueban con node:test (reglas.test.ts,
// dueno.test.ts y chat-history-cache.test.ts).
// Correr: node scripts/check-lista-desde-guardado.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const leer = (ruta) => fs.readFileSync(path.resolve(ruta), "utf8").replace(/\r\n/g, "\n");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("loading.tsx usa la lista guardada con las siluetas de respaldo", () => {
  const cargando = leer("src/app/cliente/chats/loading.tsx");
  assert.match(cargando, /import \{ ListaDesdeGuardado \} from "@\/components\/chats\/lista-desde-guardado";/);
  assert.match(cargando, /<ListaDesdeGuardado fallback=\{Array\.from\(\{ length: FILAS \}[\s\S]*?<Skeleton className="size-12 rounded-full" \/>[\s\S]*?\)\)\} \/>/);
  // El panel del chat sigue siendo silueta.
  assert.match(cargando, /<div className="hidden min-h-0 flex-1 border-y border-r border-border bg-muted\/30 md:block" \/>/);
});

prueba("el componente lee en un efecto, es de solo lectura y sin lista deja las siluetas", () => {
  const lista = leer("src/components/chats/lista-desde-guardado.tsx");
  assert.match(lista, /^"use client";/);
  assert.match(lista, /useEffect\(\(\) => \{[\s\S]*?leerListaDelCelular\(\)[\s\S]*?\}, \[\]\);/);
  const render = lista.slice(lista.indexOf("export function ListaDesdeGuardado"));
  const antesDelEfecto = render.slice(0, render.indexOf("useEffect("));
  assert.ok(!antesDelEfecto.includes("leerListaDelCelular"), "no se lee en el render (chocaria con el servidor)");
  assert.match(lista, /if \(!filas\) \{\s*return <>\{fallback\}<\/>;/);
  assert.match(lista, /aria-busy="true"/);
  assert.match(lista, /pointer-events-none/);
  assert.ok(!/href=|onClick=|<a |<Link/.test(lista), "sin enlaces ni toques");
  // Desde el 10-nov-2026 (Alex: "lista de chats sin brincos") la fila guardada lleva la MISMA foto en
  // miniatura de la lista (casi siempre ya en el navegador), nunca la inicial que despues brincaba a la foto.
  assert.match(lista, /<ContactAvatar[\s\S]*?avatarUrl=\{fila\.avatarUrl\}[\s\S]*?miniatura/, "la foto en miniatura de la lista");
  assert.ok(!/charAt\(0\)/.test(lista), "sin la inicial del nombre");
});

prueba("la bandeja guarda la lista, pero no con busqueda", () => {
  const bandeja = leer("src/components/chats/shared-inbox.tsx");
  assert.match(
    bandeja,
    /useEffect\(\(\) => \{\s*if \(searchInputValue\.trim\(\) \|\| searchQuery\.trim\(\)\) return;\s*guardarListaEnElCelular\(vistaKey, conversationItems\);\s*\}, \[vistaKey, conversationItems, searchInputValue, searchQuery\]\);/,
  );
});

prueba("lista-guardada.ts: solo filas limpias, con dueño, 24 h y version", () => {
  const modulo = leer("src/components/chats/guardado-local/lista-guardada.ts");
  assert.match(modulo, /const limpia = filaParaGuardar\(fila\);/);
  assert.match(modulo, /recortarLista\(filas\)/);
  assert.match(modulo, /esGuardadoVigente\(lista, ahora\)/);
  assert.match(modulo, /requestIdleCallback/);
  assert.match(modulo, /if \(!dueno \|\| dueno !== lista\.dueno\) return;/, "lo pendiente de otro dueño no se escribe");
});

prueba("el dueño se fija en el render del armazon, antes de cualquier return", () => {
  const armazon = leer("src/components/app-shell.tsx");
  const cuerpo = armazon.slice(armazon.indexOf("}: AppShellProps) {"));
  const fijar = cuerpo.indexOf("fijarDuenoDelGuardado({");
  const primerReturn = cuerpo.indexOf("return ");
  assert.ok(fijar > 0 && fijar < primerReturn, "fijarDuenoDelGuardado va antes del primer return");
  assert.ok(fijar < cuerpo.indexOf("useSession()"), "y antes que todo lo demas");
  assert.match(cuerpo, /workspaceId: chatRealtimeWorkspaceId,\s*userId: chatRealtimeUserId,\s*apagado: guardadoLocalApagado,/);
  assert.ok(!/useEffect\(\(\) => \{\s*fijarDuenoDelGuardado/.test(armazon), "no en un efecto");
});

prueba("interruptor CHATS_GUARDADO_LOCAL=apagado en el layout", () => {
  const layout = leer("src/app/layout.tsx");
  assert.match(layout, /guardadoLocalApagado=\{process\.env\.CHATS_GUARDADO_LOCAL === "apagado"\}/);
});

prueba("cerrar sesion borra el guardado antes de signOut", () => {
  const navUser = leer("src/components/nav-user.tsx");
  assert.match(navUser, /borrarTodoElGuardado\(\)\s*void signOut\(\{ callbackUrl: "\/login" \}\)/);
  const navbar = leer("src/components/navbar.tsx");
  assert.match(navbar, /function cerrarSesion\(\) \{\s*borrarTodoElGuardado\(\);\s*void signOut\(\{ callbackUrl: "\/login" \}\);/);
  assert.equal((navbar.match(/onClick=\{cerrarSesion\}/g) ?? []).length, 2);
  assert.ok(!/onClick=\{\(\) => signOut\(/.test(navbar + navUser), "ningun signOut sin borrar");
});

prueba("la cache de chats: llave con dueño, v2 borrada, 24 h tambien con ignoreFreshness, recorte por cuota", () => {
  const cache = leer("src/components/chats/chat-history-cache.ts");
  assert.match(cache, /const PREFIJO_DE_LA_LLAVE = "aglite:chat-history-cache:v3:";/);
  assert.match(cache, /const LEGACY_STORAGE_KEYS = \["aglite:chat-history-cache:v1", "aglite:chat-history-cache:v2"\];/);
  assert.ok(!/"aglite:chat-history-cache:v2";/.test(cache.replace(/LEGACY_STORAGE_KEYS = \[[^\]]*\]/, "")), "la v2 ya no se usa");
  assert.match(cache, /if \(!vigente\(cached\)\) \{\s*return null;\s*\}[\s\S]*?!options\?\.ignoreFreshness/, "la caducidad dura va antes de ignoreFreshness");
  assert.match(cache, /const recortado = recortarALaMitad\(store\);/);
});

console.log(`\n${pruebas} pruebas OK`);
