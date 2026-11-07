import { expect, test, type Page, type Route } from "@playwright/test";
import { BASE_URL, E2E_EMAIL, E2E_PASSWORD, FALTAN_SECRETOS } from "./ajustes";

/**
 * Chats: la vista no salta al final cuando la asesora sube (pedido de Emanuel, 7-nov-2026).
 *
 * El salto se veia entrando por la LISTA y tocando un chat: el vigilante del scroll se conectaba
 * una sola vez, cuando todavia no habia conversacion en pantalla, y la marca de "esta al final"
 * se quedaba en "si". Al subir, los mensajes de arriba crecian al dibujarse y la vista volvia
 * abajo. Por eso esta prueba entra por la lista (no por un enlace de chat) y sube de a poco, con
 * la rueda en PC y con el dedo en el celular, midiendo cuadro por cuadro la distancia al final.
 *
 * SOLO lectura y SIN marcar leidos: no envia nada, todo /live que abriria el chat va con
 * `precarga=1`, y los medios y el mensaje nuevo de prueba se agregan SOLO en este navegador.
 *
 * Solo corre con E2E_MEDIR_CHATS=1 (no la nocturna):
 *   E2E_MEDIR_CHATS=1 E2E_BASE_URL=<servidor> npx playwright test -c e2e chat-scroll-sin-saltos
 */

const MEDIR = process.env.E2E_MEDIR_CHATS === "1";
const PREFIJO = "e2e-scroll";
const DEMORA_DE_LAS_IMAGENES_MS = 1200;
const DEMORA_DE_LOS_ANTIGUOS_MS = 800;
/** Una vez que subio mas de esto... */
const YA_SUBIO_PX = 200;
/** ...la vista nunca vuelve a estar a menos de esto del final. */
const NUNCA_MAS_CERCA_PX = 100;
const LIMITE_MOVIMIENTO_PX = 10;

const TAMANOS = [
  { nombre: "PC 1366x860", viewport: { width: 1366, height: 860 }, movil: false },
  { nombre: "celular 375x812", viewport: { width: 375, height: 812 }, movil: true },
] as const;

type Cuadro = { distancia: number; scrollTop: number };
type Conversacion = { id?: string; messages?: Array<Record<string, unknown>> } & Record<string, unknown>;

for (const tamano of TAMANOS) {
  test.describe(`Subir en un chat sin saltos (${tamano.nombre})`, () => {
    test.skip(!MEDIR, "Solo con E2E_MEDIR_CHATS=1 (medicion a pedido, no la nocturna).");
    test.skip(FALTAN_SECRETOS, "Faltan E2E_EMAIL y/o E2E_PASSWORD.");

    test("entrar por la lista, subir de a poco: nunca vuelve al final, se ve el boton y un mensaje nuevo no la mueve", async ({
      browser,
    }) => {
      test.setTimeout(120_000);
      const contexto = await browser.newContext({
        baseURL: BASE_URL,
        viewport: tamano.viewport,
        isMobile: tamano.movil,
        hasTouch: tamano.movil,
        locale: "es-CO",
        timezoneId: "America/Bogota",
      });
      let ultimaConversacion: Conversacion | null = null;
      let antiguosPedidos = 0;
      await contexto.route(`**/uploads/${PREFIJO}-*`, (ruta) => responderArchivoDePrueba(ruta));
      await contexto.route("**/api/cliente/chats/live?**", async (ruta) => {
        const url = new URL(ruta.request().url());
        const antiguos = url.searchParams.has("beforeMessageId");
        if (antiguos) {
          antiguosPedidos += 1;
          // Que la carga termine con la asesora quieta: asi se mide solo lo que mueve la carga.
          await new Promise((listo) => setTimeout(listo, DEMORA_DE_LOS_ANTIGUOS_MS));
        } else {
          url.searchParams.set("precarga", "1");
        }
        const respuesta = await ruta.fetch({ url: url.toString() });
        const cuerpo = (await respuesta.json().catch(() => null)) as { conversation?: Conversacion } | null;
        const mensajes = cuerpo?.conversation?.messages;
        if (!antiguos && Array.isArray(mensajes) && mensajes.length > 0) {
          // Los medios van ENTRE los ultimos mensajes: al subir, la asesora pasa por ellos.
          const lugar = Math.max(0, mensajes.length - 3);
          mensajes.splice(lugar, 0, ...mediosDePrueba(mensajes[lugar] ?? mensajes.at(-1)!));
          ultimaConversacion = cuerpo!.conversation!;
        }
        await ruta.fulfill({ response: respuesta, json: cuerpo ?? undefined });
      });

      const pagina = await contexto.newPage();
      await iniciarSesion(pagina);
      // Entrar por la LISTA, no por un enlace de chat: es justo donde se veia la falla.
      const fila = pagina.locator('a[href*="/cliente/chats?chatKey=agent:"]:visible').first();
      await fila.waitFor({ state: "visible", timeout: 20_000 });
      await fila.click();
      const hilo = pagina.locator(".chat-messages-scroll");
      await expect(hilo.locator(`[data-message-id^="${PREFIJO}"]`).first()).toBeAttached({ timeout: 20_000 });
      // Que termine la apertura (pines al final, fotos que cargan).
      await pagina.waitForTimeout(DEMORA_DE_LAS_IMAGENES_MS + 1500);
      const alto = await hilo.evaluate((el) => el.scrollHeight - el.clientHeight);
      test.skip(alto < YA_SUBIO_PX + 300, `El primer chat es muy corto para subir (${alto} px).`);

      await pagina.addScriptTag({ content: SCRIPT_DE_MEDICION });
      await pagina.evaluate(() => (window as unknown as { __scroll: { empezar: () => void } }).__scroll.empezar());

      // 1) Subir de a poco hasta casi el tope (o ~2500 px), y quedarse quieta.
      const caja = await hilo.boundingBox();
      expect(caja, "el hilo esta en pantalla").not.toBeNull();
      const centro = { x: caja!.x + caja!.width / 2, y: caja!.y + caja!.height / 2 };
      const cdp = tamano.movil ? await contexto.newCDPSession(pagina) : null;
      let vioElBoton = false;
      for (let paso = 0; paso < 40; paso += 1) {
        if (cdp) {
          // Con el dedo: un gesto de toque real (dispara touchmove como en el celular).
          await cdp.send("Input.synthesizeScrollGesture", {
            x: Math.round(centro.x),
            y: Math.round(centro.y),
            yDistance: 140,
            gestureSourceType: "touch",
            speed: 1200,
          });
        } else {
          await pagina.mouse.move(centro.x, centro.y);
          await pagina.mouse.wheel(0, -140);
        }
        await pagina.waitForTimeout(140);
        const estado = await hilo.evaluate((el) => ({
          distancia: el.scrollHeight - el.scrollTop - el.clientHeight,
          scrollTop: el.scrollTop,
        }));
        if (estado.distancia > 220 && !vioElBoton) {
          // Criterio 3: subiendo mas de 220 px se ve el boton para bajar.
          await expect(botonParaBajar(pagina)).toBeVisible({ timeout: 2000 });
          vioElBoton = true;
        }
        if (estado.scrollTop < 400 || estado.distancia > 2500) break;
      }
      expect(vioElBoton, "se vio el boton para bajar al subir mas de 220 px").toBe(true);

      // 2) Quieta: las fotos terminan de cargar y, si estaba cerca del tope, llegan los antiguos.
      const anclaAntes = await anclaVisible(pagina);
      const antiguosAntes = antiguosPedidos;
      await pagina.waitForTimeout(DEMORA_DE_LAS_IMAGENES_MS + DEMORA_DE_LOS_ANTIGUOS_MS + 1500);
      const anclaDespues = anclaAntes ? await offsetDe(pagina, anclaAntes.id) : null;
      if (anclaAntes && anclaDespues !== null) {
        // Criterio 5: el primer mensaje visible sigue en su lugar (con o sin antiguos cargados).
        expect(
          Math.abs(anclaDespues - anclaAntes.offset),
          `el mensaje que se leia no se movio (antiguos pedidos: ${antiguosPedidos - antiguosAntes})`,
        ).toBeLessThan(LIMITE_MOVIMIENTO_PX);
      }

      // 3) Entra un mensaje nuevo mientras lee arriba (solo en este navegador).
      expect(ultimaConversacion, "se capturo la conversacion de /live").not.toBeNull();
      const anclaAntesDelNuevo = await anclaVisible(pagina);
      await pagina.evaluate(
        ({ conversacion, prefijo }) => {
          const mensajes = Array.isArray(conversacion.messages) ? conversacion.messages : [];
          const ultimo = mensajes.at(-1) ?? {};
          const nuevo = {
            ...ultimo,
            id: `${prefijo}-nuevo`,
            direction: "INBOUND",
            authorType: "contact",
            type: "TEXT",
            mediaUrl: null,
            rawPayload: {},
            content: "Mensaje de prueba (solo en este navegador, no se guarda)",
            createdAt: new Date().toISOString(),
          };
          const conMensaje = { ...conversacion, messages: [...mensajes, nuevo] };
          const chatKey = new URL(window.location.href).searchParams.get("chatKey");
          window.dispatchEvent(new CustomEvent("chat-live-update", { detail: { conversation: conMensaje, chatKey } }));
        },
        { conversacion: ultimaConversacion!, prefijo: PREFIJO },
      );
      await expect(hilo.locator(`[data-message-id="${PREFIJO}-nuevo"]`)).toBeAttached({ timeout: 5000 });
      await pagina.waitForTimeout(800);
      if (anclaAntesDelNuevo) {
        const offset = await offsetDe(pagina, anclaAntesDelNuevo.id);
        expect(offset, "el mensaje que se leia sigue en pantalla").not.toBeNull();
        // Criterio 4: un mensaje nuevo no la mueve.
        expect(Math.abs(offset! - anclaAntesDelNuevo.offset), "un mensaje nuevo no mueve la vista").toBeLessThan(
          LIMITE_MOVIMIENTO_PX,
        );
      }
      const irAlFinal = pagina.getByRole("button", { name: /^Ir al final \(1 mensaje nuevo\)/ });
      await expect(irAlFinal).toBeVisible();
      await expect(irAlFinal).toContainText("Ir al final");
      await expect(irAlFinal).toContainText("1");

      // Criterio 2: una vez que paso de 200 px, nunca volvio a menos de 100 px del final.
      const cuadros = await pagina.evaluate(
        () => (window as unknown as { __scroll: { terminar: () => Cuadro[] } }).__scroll.terminar(),
      );
      let subio = false;
      const saltos: string[] = [];
      cuadros.forEach((cuadro, indice) => {
        if (cuadro.distancia > YA_SUBIO_PX) subio = true;
        if (subio && cuadro.distancia < NUNCA_MAS_CERCA_PX) {
          saltos.push(`cuadro ${indice}: ${cuadro.distancia} px del final (scrollTop ${cuadro.scrollTop})`);
        }
      });
      expect(subio, "la prueba llego a subir mas de 200 px").toBe(true);
      expect(saltos.slice(0, 5), "la vista no vuelve sola al final al subir").toEqual([]);

      // Al tocar "Ir al final" baja y el boton desaparece.
      await irAlFinal.click();
      await expect
        .poll(() => hilo.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight), { timeout: 5000 })
        .toBeLessThanOrEqual(LIMITE_MOVIMIENTO_PX);
      await expect(irAlFinal).toBeHidden();
      await expect(botonParaBajar(pagina)).toBeHidden();

      test.info().annotations.push({
        type: "medicion",
        description: `${cuadros.length} cuadros, menor distancia tras subir ${Math.min(
          ...cuadros.filter((c) => c.distancia > 0).map((c) => c.distancia),
        )} px, antiguos pedidos ${antiguosPedidos}`,
      });
      await contexto.close();
    });
  });
}

/* ---------------------------------------------------------------- ayudantes */

function botonParaBajar(pagina: Page) {
  return pagina
    .locator(".chat-messages-scroll")
    .locator("xpath=..")
    .getByRole("button", { name: /^Ir al (ultimo mensaje|final)/ });
}

/** El primer mensaje que se ve arriba del hilo y a cuantos px del borde de arriba esta. */
async function anclaVisible(pagina: Page): Promise<{ id: string; offset: number } | null> {
  return pagina.evaluate(() => {
    const hilo = document.querySelector(".chat-messages-scroll");
    if (!hilo) return null;
    const tope = hilo.getBoundingClientRect().top;
    for (const nodo of hilo.querySelectorAll("[data-message-id]")) {
      const caja = nodo.getBoundingClientRect();
      if (caja.bottom > tope + 4) {
        return { id: nodo.getAttribute("data-message-id") || "", offset: Math.round(caja.top - tope) };
      }
    }
    return null;
  });
}

async function offsetDe(pagina: Page, id: string): Promise<number | null> {
  return pagina.evaluate((idBuscado) => {
    const hilo = document.querySelector(".chat-messages-scroll");
    const nodo = hilo?.querySelector(`[data-message-id="${CSS.escape(idBuscado)}"]`);
    if (!hilo || !nodo) return null;
    return Math.round(nodo.getBoundingClientRect().top - hilo.getBoundingClientRect().top);
  }, id);
}

async function iniciarSesion(pagina: Page) {
  await pagina.goto("/login");
  await pagina.getByPlaceholder("correo@empresa.com").fill(E2E_EMAIL);
  await pagina.getByPlaceholder("Tu contrasena").fill(E2E_PASSWORD);
  await pagina.getByRole("button", { name: "Entrar", exact: true }).click();
  await pagina.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await pagina.goto("/cliente/chats");
}

/** Fotos (con y sin tamaño) y un sticker entre los ultimos mensajes, como en el chat de P03. */
function mediosDePrueba(vecino: Record<string, unknown>) {
  const base = { ...vecino, direction: "INBOUND", authorType: "contact", content: "" };
  const nodo = (tipo: string, datos: Record<string, unknown>) => ({ evolution: { data: { Message: { [tipo]: datos } } } });
  const archivo = (nombre: string, ancho: number, alto: number) => `/uploads/${PREFIJO}-${nombre}.svg?w=${ancho}&h=${alto}`;
  return [
    { ...base, id: `${PREFIJO}-foto-vertical`, type: "IMAGE", mediaUrl: archivo("vertical", 1080, 1920),
      rawPayload: nodo("imageMessage", { width: 1080, height: 1920 }) },
    { ...base, id: `${PREFIJO}-foto-sin-tamano`, type: "IMAGE", mediaUrl: archivo("sin-tamano", 900, 1600),
      content: "Foto sin tamaño (medicion, no se guarda)", rawPayload: nodo("imageMessage", {}) },
    { ...base, id: `${PREFIJO}-sticker`, type: "STICKER", mediaUrl: archivo("sticker", 512, 512),
      rawPayload: nodo("stickerMessage", {}) },
    { ...base, id: `${PREFIJO}-foto-horizontal`, type: "IMAGE", mediaUrl: archivo("horizontal", 1600, 1200),
      rawPayload: nodo("imageMessage", { width: 1600, height: 1200 }) },
  ];
}

async function responderArchivoDePrueba(ruta: Route) {
  const url = new URL(ruta.request().url());
  await new Promise((listo) => setTimeout(listo, DEMORA_DE_LAS_IMAGENES_MS));
  const ancho = Number(url.searchParams.get("w")) || 100;
  const alto = Number(url.searchParams.get("h")) || 100;
  return ruta.fulfill({
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}"><rect width="100%" height="100%" fill="#7a9"/></svg>`,
  });
}

// Corre dentro de la pagina: en cada cuadro anota la distancia al final.
const SCRIPT_DE_MEDICION = `(() => {
  let cuadros = [];
  let midiendo = false;
  function cuadro() {
    if (!midiendo) return;
    const el = document.querySelector(".chat-messages-scroll");
    if (el) {
      cuadros.push({ distancia: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight), scrollTop: Math.round(el.scrollTop) });
    }
    requestAnimationFrame(cuadro);
  }
  window.__scroll = {
    empezar() { cuadros = []; midiendo = true; requestAnimationFrame(cuadro); },
    terminar() { midiendo = false; return cuadros; },
  };
})();`;
