import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL, E2E_EMAIL, E2E_PASSWORD, FALTAN_SECRETOS } from "./ajustes";

/**
 * Chats, parte 2: abrir un chat desde la copia guardada al instante y refrescar sin mover la vista.
 * Se mide CUADRO POR CUADRO (requestAnimationFrame): en cada cuadro se anota el tiempo desde el
 * toque, la distancia al final del chat y los mensajes que se ven.
 *
 * SOLO lectura y SIN marcar leidos:
 * - No envia nada ni escribe en la caja.
 * - Todo /live que abriria el chat (sin `beforeMessageId`) se pide con `precarga=1`, que trae los
 *   mensajes sin marcarlos leidos (ver src/app/api/cliente/chats/live/route.ts).
 * - El /live de apertura se demora y se le agrega UN mensaje de prueba, solo en este navegador:
 *   no se guarda en ningun lado y simula "llegaron mensajes que la copia no tenia".
 *
 * Solo corre con E2E_MEDIR_CHATS=1: la prueba nocturna contra produccion no la ejecuta.
 *   E2E_MEDIR_CHATS=1 E2E_BASE_URL=<servidor> npx playwright test -c e2e chat-abre-al-instante
 */

const MEDIR = process.env.E2E_MEDIR_CHATS === "1";
const LIMITE_ABRIR_MS = 150;
const LIMITE_FUERA_DEL_FINAL_PX = 10;
const DEMORA_DEL_LIVE_MS = 900;
const ID_DE_PRUEBA = "e2e-medicion";

type Cuadro = { t: number; distancia: number; ids: string[]; chat: string; comoAlTocar: boolean };
/** Cuadros justo despues del toque en que todavia se ve, intacto, lo de antes (React aun no pinto). */
const MARGEN_DEL_TOQUE_MS = 50;

const TAMANOS = [
  { nombre: "PC", viewport: { width: 1366, height: 860 }, movil: false },
  { nombre: "celular 375x812", viewport: { width: 375, height: 812 }, movil: true },
] as const;

for (const tamano of TAMANOS) {
  test.describe(`Abrir chat al instante (${tamano.nombre})`, () => {
    test.describe.configure({ mode: "serial" });
    test.skip(!MEDIR, "Solo con E2E_MEDIR_CHATS=1 (medicion a pedido, no la nocturna).");
    test.skip(FALTAN_SECRETOS, "Faltan E2E_EMAIL y/o E2E_PASSWORD.");

    let contexto: BrowserContext;
    let pagina: Page;
    /** Ids de los mensajes que trajo el servidor, por chat: sirve para ver si se cruzan. */
    const idsPorChat = new Map<string, Set<string>>();
    let chats: string[] = [];

    test.beforeAll(async ({ browser }) => {
      ({ contexto, pagina } = await abrirSesion(browser, tamano, idsPorChat));
      chats = await clavesDeLaLista(pagina);
    });

    test.afterAll(async () => {
      await contexto?.close();
    });

    test("1. abrir un chat ya abierto antes: final en el primer cuadro, sin salirse del final", async () => {
      test.skip(chats.length < 1, "No hay chats en la lista.");
      const chat = chats[0]!;
      // Primera vez: queda guardado en la copia del navegador.
      await abrirChat(pagina, chat, tamano.movil);
      await esperarQuieto(pagina);
      await volverALaLista(pagina, tamano.movil);

      const cuadros = await medirApertura(pagina, chat, tamano.movil);
      revisarApertura(cuadros, chat, idsPorChat);
    });

    test("2. abrir un chat precargado (sin abrir antes): igual de rapido", async () => {
      const chat = chats.find((clave, indice) => indice > 0 && idsPorChat.has(clave));
      test.skip(!chat, "Ningun otro chat de la lista termino su precarga.");
      await volverALaLista(pagina, tamano.movil);
      const cuadros = await medirApertura(pagina, chat!, tamano.movil);
      revisarApertura(cuadros, chat!, idsPorChat);
    });

    test("3. volver a un chat que recibio mensajes: entran sin salto", async () => {
      test.skip(chats.length < 1, "No hay chats en la lista.");
      const chat = chats[0]!;
      await volverALaLista(pagina, tamano.movil);
      const cuadros = await medirApertura(pagina, chat, tamano.movil);
      revisarApertura(cuadros, chat, idsPorChat);
      // El mensaje de prueba (lo que la copia no tenia) termino a la vista y con la vista al final.
      const conPrueba = cuadros.filter((cuadro) => cuadro.ids.some((id) => id.startsWith(ID_DE_PRUEBA)));
      expect(conPrueba.length, "llego el mensaje que la copia no tenia").toBeGreaterThan(0);
      for (const cuadro of conPrueba) {
        expect(cuadro.distancia, `a los ${Math.round(cuadro.t)} ms`).toBeLessThanOrEqual(LIMITE_FUERA_DEL_FINAL_PX);
      }
    });

    test("4. subir y pedir mensajes anteriores: la vista no baja", async () => {
      test.skip(chats.length < 1, "No hay chats en la lista.");
      const pidioHistorial = pagina
        .waitForRequest((pedido) => pedido.url().includes("/api/cliente/chats/live") && pedido.url().includes("beforeMessageId="), {
          timeout: 15_000,
        })
        .then(() => true)
        .catch(() => false);
      // Subir de a poco, como con el dedo, hasta arriba.
      for (let paso = 0; paso < 30; paso += 1) {
        await pagina.locator(".chat-messages-scroll").evaluate((el) => el.scrollBy(0, -400));
        await pagina.waitForTimeout(60);
      }
      const huboHistorial = await pidioHistorial;
      test.skip(!huboHistorial, "El chat no tiene mensajes anteriores para pedir.");
      await esperarQuieto(pagina);
      const distancia = await distanciaAlFinal(pagina);
      // Si hubiera bajado al final, la distancia seria ~0.
      expect(distancia, "la vista se quedo arriba, donde la asesora estaba leyendo").toBeGreaterThan(200);
    });

    test("5. abrir dos chats seguidos: nunca se ve el historial de otro contacto", async () => {
      test.skip(chats.length < 2, "Hacen falta dos chats en la lista.");
      await volverALaLista(pagina, tamano.movil);
      const [primero, segundo] = [chats[1]!, chats[0]!];
      await empezarAMedir(pagina);
      await tocarFila(pagina, primero);
      await pagina.waitForTimeout(120);
      if (tamano.movil) {
        await volverALaLista(pagina, true);
      }
      await tocarFila(pagina, segundo);
      await esperarQuieto(pagina);
      const cuadros = await terminarDeMedir(pagina);
      for (const cuadro of cuadros) {
        const ajenos = idsAjenos(cuadro, idsPorChat);
        expect(ajenos, `a los ${Math.round(cuadro.t)} ms, en ${cuadro.chat}`).toEqual([]);
      }
    });
  });
}

/* ---------------------------------------------------------------- ayudantes */

async function abrirSesion(
  browser: Browser,
  tamano: (typeof TAMANOS)[number],
  idsPorChat: Map<string, Set<string>>,
) {
  const contexto = await browser.newContext({
    baseURL: BASE_URL,
    viewport: tamano.viewport,
    isMobile: tamano.movil,
    hasTouch: tamano.movil,
    locale: "es-CO",
    timezoneId: "America/Bogota",
  });
  await contexto.addInitScript(SCRIPT_DE_MEDICION);
  await contexto.route("**/api/cliente/chats/live?**", async (ruta) => {
    const url = new URL(ruta.request().url());
    const chatKey = url.searchParams.get("chatKey") ?? "";
    const esHistorial = url.searchParams.has("beforeMessageId");
    const esApertura = url.searchParams.get("conLlamada") === "1";
    // Nada de marcar leidos: todo lo que abriria el chat va como precarga.
    if (!esHistorial) {
      url.searchParams.set("precarga", "1");
    }
    const respuesta = await ruta.fetch({ url: url.toString() });
    const cuerpo = (await respuesta.json().catch(() => null)) as {
      conversation?: { messages?: Array<Record<string, unknown>> };
    } | null;
    const mensajes = cuerpo?.conversation?.messages;
    if (Array.isArray(mensajes)) {
      const ids = idsPorChat.get(chatKey) ?? new Set<string>();
      for (const mensaje of mensajes) {
        if (typeof mensaje.id === "string") ids.add(mensaje.id);
      }
      idsPorChat.set(chatKey, ids);
      if (esApertura && mensajes.length > 0) {
        // El refresco trae algo que la copia no tenia. Solo en este navegador.
        const ultimo = mensajes.at(-1)!;
        mensajes.push({
          ...ultimo,
          id: `${ID_DE_PRUEBA}-${Date.now()}`,
          content: "Mensaje de prueba (medicion, no se guarda)",
          direction: "INBOUND",
          authorType: "contact",
          type: "TEXT",
          mediaUrl: null,
          rawPayload: null,
          createdAt: new Date().toISOString(),
        });
        await new Promise((listo) => setTimeout(listo, DEMORA_DEL_LIVE_MS));
      }
    }
    await ruta.fulfill({ response: respuesta, json: cuerpo ?? undefined });
  });

  const pagina = await contexto.newPage();
  await pagina.goto("/login");
  await pagina.getByPlaceholder("correo@empresa.com").fill(E2E_EMAIL);
  await pagina.getByPlaceholder("Tu contrasena").fill(E2E_PASSWORD);
  await pagina.getByRole("button", { name: "Entrar", exact: true }).click();
  await pagina.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await pagina.goto("/cliente/chats");
  await expect(pagina.getByRole("button", { name: "Nueva lista" }).first()).toBeAttached();
  await pagina.locator(FILA).first().waitFor({ state: "visible", timeout: 20_000 });
  // La lista precarga los chats a la vista: se le da un momento.
  await pagina.waitForTimeout(4000);
  return { contexto, pagina };
}

// Filas de la bandeja: <a> con ?chatKey= (conversation-list.tsx).
const FILA = 'a[href*="/cliente/chats?chatKey="]:visible';

async function clavesDeLaLista(pagina: Page) {
  const hrefs = await pagina.locator(FILA).evaluateAll((filas) =>
    filas.map((fila) => fila.getAttribute("href") ?? "").slice(0, 6),
  );
  return hrefs
    .map((href) => new URL(href, "http://x").searchParams.get("chatKey") ?? "")
    .filter((clave) => clave.startsWith("agent:"));
}

async function tocarFila(pagina: Page, chat: string) {
  // El toque lo anota la pagina misma, en el click (ver SCRIPT_DE_MEDICION).
  await pagina.locator(`a[href*="chatKey=${encodeURIComponent(chat)}"]:visible`).first().click();
}

async function abrirChat(pagina: Page, chat: string, movil: boolean) {
  await tocarFila(pagina, chat);
  if (movil) {
    await expect(pagina.getByRole("link", { name: "Volver a chats" })).toBeVisible();
  }
  await expect(pagina.locator(".chat-messages-scroll [data-message-id]").first()).toBeVisible();
}

async function volverALaLista(pagina: Page, movil: boolean) {
  if (!movil) {
    return;
  }
  const volver = pagina.getByRole("link", { name: "Volver a chats" });
  if (await volver.isVisible()) {
    await volver.click();
    await pagina.locator(FILA).first().waitFor({ state: "visible" });
  }
}

async function esperarQuieto(pagina: Page) {
  // El /live demorado, el segundo /live (2,5 s) y las fotos.
  await pagina.waitForTimeout(DEMORA_DEL_LIVE_MS + 3000);
}

async function distanciaAlFinal(pagina: Page) {
  return pagina
    .locator(".chat-messages-scroll")
    .evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));
}

async function empezarAMedir(pagina: Page) {
  await pagina.evaluate(() => (window as unknown as { __medicion: { empezar: () => void } }).__medicion.empezar());
}

async function terminarDeMedir(pagina: Page): Promise<Cuadro[]> {
  return pagina.evaluate(() => (window as unknown as { __medicion: { terminar: () => Cuadro[] } }).__medicion.terminar());
}

async function medirApertura(pagina: Page, chat: string, movil: boolean) {
  await empezarAMedir(pagina);
  await abrirChat(pagina, chat, movil);
  await esperarQuieto(pagina);
  const cuadros = await terminarDeMedir(pagina);
  test.info().annotations.push({
    type: "medicion",
    description: `${chat}: ${cuadros.length} cuadros, primero con mensajes a los ${Math.round(
      primerCuadroConChat(cuadros)?.t ?? -1,
    )} ms, peor distancia ${Math.max(0, ...cuadros.filter((c) => c.ids.length > 0).map((c) => c.distancia))} px`,
  });
  return cuadros;
}

function primerCuadroConChat(cuadros: Cuadro[]) {
  // Mas de un mensaje: la vista previa (el ultimo mensaje de la fila) no cuenta como abierto.
  return cuadros.find((cuadro) => cuadro.ids.length > 1);
}

function revisarApertura(cuadros: Cuadro[], chat: string, idsPorChat: Map<string, Set<string>>) {
  const primero = primerCuadroConChat(cuadros);
  expect(primero, "se pintaron los mensajes").toBeTruthy();
  expect(primero!.t, "abre en menos de 0,15 s desde el toque").toBeLessThan(LIMITE_ABRIR_MS);
  for (const cuadro of cuadros) {
    if (cuadro.ids.length === 0 || (cuadro.comoAlTocar && cuadro.t < MARGEN_DEL_TOQUE_MS)) continue;
    expect(cuadro.distancia, `a los ${Math.round(cuadro.t)} ms queda fuera del final`).toBeLessThanOrEqual(
      LIMITE_FUERA_DEL_FINAL_PX,
    );
    expect(idsAjenos(cuadro, idsPorChat), `a los ${Math.round(cuadro.t)} ms en ${chat}`).toEqual([]);
  }
}

/** Mensajes en pantalla que el servidor dio como de OTRO chat y no de este. */
function idsAjenos(cuadro: Cuadro, idsPorChat: Map<string, Set<string>>) {
  if (cuadro.comoAlTocar && cuadro.t < MARGEN_DEL_TOQUE_MS) {
    return [];
  }
  const propios = idsPorChat.get(cuadro.chat) ?? new Set<string>();
  const ajenos: string[] = [];
  for (const id of cuadro.ids) {
    if (propios.has(id) || id.startsWith(ID_DE_PRUEBA) || id.includes(":preview")) continue;
    for (const [chat, ids] of idsPorChat) {
      if (chat !== cuadro.chat && ids.has(id)) {
        ajenos.push(`${id} (de ${chat})`);
        break;
      }
    }
  }
  return ajenos;
}

/*
  Corre dentro de la pagina: un bucle de requestAnimationFrame que anota cada cuadro desde el toque.
  `chat` es la fila tocada en ultimo lugar; `comoAlTocar`, si se ven los mismos mensajes que en el
  momento del toque.
*/
const SCRIPT_DE_MEDICION = `(() => {
  let cuadros = [];
  let midiendo = false;
  let toqueEn = 0;
  let chat = "";
  let alTocar = "";
  const idsEnPantalla = (el) =>
    el ? Array.from(el.querySelectorAll("[data-message-id]")).map((n) => n.getAttribute("data-message-id") || "") : [];
  document.addEventListener("click", (evento) => {
    const fila = evento.target instanceof Element ? evento.target.closest('a[href*="chatKey="]') : null;
    if (!fila || !midiendo) return;
    chat = new URL(fila.getAttribute("href") || "", location.href).searchParams.get("chatKey") || "";
    toqueEn = performance.now();
    alTocar = idsEnPantalla(document.querySelector(".chat-messages-scroll")).join("|");
  }, true);
  function cuadro() {
    if (!midiendo) return;
    const el = document.querySelector(".chat-messages-scroll");
    if (toqueEn && el) {
      const ids = idsEnPantalla(el);
      cuadros.push({
        comoAlTocar: ids.join("|") === alTocar,
        t: performance.now() - toqueEn,
        distancia: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
        ids,
        chat,
      });
    }
    requestAnimationFrame(cuadro);
  }
  window.__medicion = {
    empezar() { cuadros = []; toqueEn = 0; midiendo = true; requestAnimationFrame(cuadro); },
    terminar() { midiendo = false; return cuadros; },
  };
})();`;
