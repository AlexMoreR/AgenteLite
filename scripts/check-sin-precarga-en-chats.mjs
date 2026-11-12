// Pruebas de "moverse por la bandeja" (P2, 10-11-2026), leyendo el codigo:
//
// - Estando en Chats el menu lateral no precarga: cada pushState de la bandeja (cambiar de pastilla,
//   abrir un chat) hacia que Next volviera a precargar todos los <Link> visibles con mas de 30 s, y
//   eso eran 1-3 pedidos RSC al servidor por toque. Cada <Link> del menu tiene que llevar `prefetch=`.
// - Cambiar de vista ya no termina en router.refresh() (rehacia la pagina entera).
// - Un mensaje que entra envejece las listas guardadas en vez de borrarlas.
// - El efecto de /counts depende de la firma de texto de los filtros que se cuentan.
//
// No necesita base ni red. Correr: node scripts/check-sin-precarga-en-chats.mjs
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const raiz = path.resolve("src");
const leer = (archivo) => fs.readFileSync(path.join(raiz, archivo), "utf8");
/** El codigo sin comentarios (aproximado: alcanza para buscar llamadas). */
const sinComentarios = (texto) =>
  texto
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/** Cada `<Link ...>` del archivo, con sus atributos (hasta el `>` que lo cierra). */
function enlaces(texto) {
  const encontrados = [];
  const re = /<Link\b/g;
  let m;
  while ((m = re.exec(texto))) {
    let profundidad = 0;
    let i = m.index + 1;
    for (; i < texto.length; i += 1) {
      const c = texto[i];
      if (c === "{") profundidad += 1;
      else if (c === "}") profundidad -= 1;
      else if (c === ">" && profundidad === 0) break;
    }
    encontrados.push(texto.slice(m.index, i + 1));
  }
  return encontrados;
}

const MENU = {
  "components/app-sidebar.tsx": /prefetch=\{enChats \? false : undefined\}/,
  "components/nav-chats.tsx": /prefetch=\{isChatsRoute \? false : undefined\}/,
  "components/nav-crm.tsx": /prefetch=\{sinPrecarga \? false : undefined\}/,
  "components/nav-direccion.tsx": /prefetch=\{sinPrecarga \? false : undefined\}/,
};

for (const [archivo, regla] of Object.entries(MENU)) {
  prueba(`menu: cada <Link> de ${archivo} se apaga en Chats`, () => {
    const lista = enlaces(sinComentarios(leer(archivo)));
    assert.ok(lista.length > 0, `${archivo} no tiene <Link>: ¿cambio el menu?`);
    for (const enlace of lista) {
      assert.match(enlace, regla, `${archivo}: este <Link> no lleva prefetch en Chats:\n${enlace}`);
    }
  });
}

prueba("menu: AppSidebar sabe que esta en Chats y se lo pasa a CRM y Direccion", () => {
  const barra = sinComentarios(leer("components/app-sidebar.tsx"));
  assert.match(barra, /const enChats = pathname\.startsWith\("\/cliente\/chats"\)/);
  assert.match(barra, /<NavChats[\s\S]*?isChatsRoute=\{enChats\}/);
  assert.match(barra, /<NavCrm[\s\S]*?sinPrecarga=\{enChats\}/);
  assert.match(barra, /<NavDireccion[^>]*sinPrecarga=\{enChats\}/);
  assert.match(leer("components/nav-crm.tsx"), /sinPrecarga = false/, "fuera de Chats, NavCrm precarga como siempre");
  assert.match(leer("components/nav-direccion.tsx"), /sinPrecarga = false/, "fuera de Chats, NavDireccion precarga como siempre");
});

const bandeja = leer("components/chats/shared-inbox.tsx");
const bandejaSinComentarios = sinComentarios(bandeja);

prueba("bandeja: cambiar de vista no hace router.refresh(); reintenta /list una vez", () => {
  const inicio = bandejaSinComentarios.indexOf("if (vistaCargadaRef.current !== vistaKey) {");
  const fin = bandejaSinComentarios.indexOf("const esLaPrimera = primeraListaRef.current;");
  assert.ok(inicio > 0 && fin > inicio, "no se encontro el cambio de vista en shared-inbox.tsx");
  const cambioDeVista = bandejaSinComentarios.slice(inicio, fin);
  assert.ok(!/\.refresh\(\)/.test(cambioDeVista), "el cambio de vista volvio a usar router.refresh()");
  assert.match(cambioDeVista, /if \(intento === 0\) \{[\s\S]*?REINTENTO_DE_LISTA_MS[\s\S]*?await intentar\(1\)/);
  assert.match(cambioDeVista, /setVistaEnCurso\(false\);\s*\}\s*\};\s*void intentar\(0\);/, "tras el segundo fallo se quita lo atenuado");
  assert.match(bandeja, /const REINTENTO_DE_LISTA_MS = 400;/);
});

prueba("bandeja: un mensaje envejece las listas guardadas; resolver y posponer las borran", () => {
  assert.match(bandejaSinComentarios, /window\.addEventListener\("chat-list-update", envejecer\)/);
  assert.match(bandejaSinComentarios, /window\.addEventListener\(CHAT_STATUS_CHANGED_EVENT, olvidar\)/);
  assert.match(bandejaSinComentarios, /window\.addEventListener\(CHAT_SNOOZED_EVENT, olvidar\)/);
  assert.ok(!/addEventListener\("chat-list-update", olvidar\)/.test(bandejaSinComentarios));
  assert.match(bandejaSinComentarios, /from "\.\/listas-recientes-de-la-bandeja"/);
  assert.ok(!/const listasRecientes = new Map/.test(bandeja), "la memoria vive en listas-recientes-de-la-bandeja.ts");
});

prueba("bandeja: /counts depende de la firma de lo que se cuenta, no de todos los filtros", () => {
  assert.match(bandejaSinComentarios, /const firmaParaContar = paresParaContar\.map\(/);
  assert.match(
    bandejaSinComentarios,
    /\}, \[conversationListApiPath, searchQuery, selectedConnectionKey, assignedFilter, statusFilter, firmaParaContar, pedidoDeConteos\]\);/,
  );
  assert.ok(!/ponerFiltrosParaContar/.test(bandejaSinComentarios));
});

prueba("servidor: /counts y /list leen los permisos a la vez", () => {
  const conteos = sinComentarios(leer("app/api/cliente/chats/counts/route.ts"));
  assert.match(conteos, /const \[esLaSupervisora, snoozedRows, visibleChannelIds, lineasQueMonitorea\] = await Promise\.all\(\[/);
  assert.match(conteos, /const monitoreados = isManager \? \[\] : lineasQueMonitorea;/, "a quien supervisa no se le cuentan las lineas monitoreadas");
  assert.match(
    conteos,
    /const \[idsDeLosFiltros, officialMine, officialUnassigned, officialAll, espera, conSinResponder, conNoLeido\] = await Promise\.all\(\[/,
  );
  assert.ok(!/await idsParaLosFiltros\(filtros, quienPideIds\)/.test(conteos), "los ids ya no se esperan solos");

  const lista = sinComentarios(leer("app/api/cliente/chats/list/route.ts"));
  assert.match(lista, /const \[esLaSupervisora, monitoredChannelIds, visibleChannelIds\] = await Promise\.all\(\[/);
  // Lo oficial sale antes de la lista y se espera despues.
  const lanza = lista.indexOf("oficialEnCurso = pedirOficial();");
  const laLista = lista.indexOf("const data = await getAgentConversationList({");
  assert.ok(lanza > 0 && laLista > lanza, "lo oficial se lanza antes de pedir la lista");
  assert.match(lista, /await \(oficialEnCurso \?\? pedirOficial\(\)\)/);
});

console.log(`\n${pruebas} pruebas ok`);
