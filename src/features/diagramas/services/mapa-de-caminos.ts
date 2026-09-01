import type { Edge, Node } from "@xyflow/react";

/**
 * El mapa de los caminos que toman los clientes.
 *
 * Un chat suelto dibujado tal cual son cuarenta cajas ilegibles que no se pueden comparar con
 * ningun otro chat. Lo que sirve es al reves: resumir cada conversacion en unos pocos PASOS y
 * fundirlos todos en un mismo arbol, de modo que dos clientes que preguntaron el precio compartan
 * esa caja. Con treinta chats encima se lee solo: 24 preguntan precio, 18 de esos piden envio, 3
 * compran. Ahi estan los caminos, y sobre todo se ve donde se caen.
 *
 * Por eso el paso que devuelve la IA tiene que ser CORTO y generico ("Pregunta precio"), no la
 * frase del cliente: si cada uno trae su redaccion, nada se funde con nada y el mapa vuelve a ser
 * una lista de conversaciones sueltas.
 */

export type QuienHabla = "cliente" | "nosotros";

export type PasoDelChat = {
  quien: QuienHabla;
  paso: string;
};

/** El humano es el cliente y el robot somos nosotros, como los pidio Alex. */
const ICONO_POR_QUIEN: Record<QuienHabla, string> = {
  cliente: "🧑",
  nosotros: "🤖",
};

/** El color separa de un vistazo quien habla, sin tener que leer el icono. */
const COLOR_POR_QUIEN: Record<QuienHabla, string> = {
  cliente: "azul",
  nosotros: "neutro",
};

const RAIZ = "camino-inicio";

/** Cuantos pasos se le piden a la IA por chat. Mas que esto deja de ser un resumen. */
export const MAXIMO_DE_PASOS = 12;

/**
 * Los pasos que existen. La IA elige de ACA y de ningun otro lado.
 *
 * Probado con tres conversaciones reales el 1-sep-2026: dejando que la IA redactara libre salieron
 * 37 cajas con UN cliente cada una. "Envia catalogo", "Ofrece catálogo" y "Envía catálogo y audio"
 * son el mismo movimiento y quedaron en tres cajas distintas, asi que el mapa no fundio nada y
 * volvio a ser tres conversaciones dibujadas una al lado de la otra —justo lo que no sirve—.
 *
 * Con una lista cerrada el cruce funciona por construccion: si dos clientes preguntan el precio,
 * los dos traen exactamente "Pregunta precio" y caen en la misma caja.
 *
 * La lista sale de lo que de verdad pasa en los chats de Magilus. Agregar un paso es barato;
 * quitarlo parte los mapas ya armados, asi que conviene pecar de completo.
 */
export const PASOS_DEL_CLIENTE = [
  "Saluda",
  "Pide catálogo",
  "Pregunta por un producto",
  "Pregunta precio",
  "Pregunta medidas",
  "Pregunta si hay stock",
  "Pregunta envío",
  "Pregunta dónde quedan",
  "Pregunta formas de pago",
  "Manda fotos o audio",
  "Objeta el precio",
  "Dice que lo va a pensar",
  "Da datos de compra",
  "Manda comprobante de pago",
  "Reclama demora",
  "Agradece",
  "No responde",
] as const;

export const PASOS_NUESTROS = [
  "Da la bienvenida",
  "Pregunta qué busca",
  "Envía catálogo",
  "Envía fotos del producto",
  "Da precio",
  "Pregunta ciudad",
  "Explica el envío",
  "Da datos de pago",
  "Pide los datos de compra",
  "Pasa a un asesor",
  "Hace seguimiento",
  "No contesta",
] as const;

const SISTEMA = `Sos un analista comercial. Te paso una conversacion de WhatsApp entre un negocio de muebles para peluqueria/spa y un cliente.

Devolve JSON: {"pasos":[{"quien":"cliente"|"nosotros","paso":"..."}]}

El campo "paso" SOLO puede ser uno de estos textos, copiado EXACTO (con sus tildes):

Cuando el movimiento lo hace el cliente ("quien":"cliente"):
${PASOS_DEL_CLIENTE.join(" | ")}

Cuando el movimiento lo hace el negocio o el bot ("quien":"nosotros"):
${PASOS_NUESTROS.join(" | ")}

Reglas:
- Si algo no encaja en ninguno, OMITILO. Nunca inventes un paso nuevo.
- Un paso por MOVIMIENTO, no por mensaje: tres mensajes seguidos preguntando lo mismo son un solo paso.
- No repitas el mismo paso dos veces seguidas.
- Maximo ${MAXIMO_DE_PASOS} pasos, en el orden en que pasaron.
- Si la conversacion termina sin respuesta del cliente, cerra con {"quien":"cliente","paso":"No responde"}.`;

/**
 * Resume una conversacion en pasos.
 *
 * Devuelve null si no hay clave de OpenAI o si la respuesta no se entiende: el llamador decide que
 * hacer, y lo que NO hay que hacer es meter basura en el mapa comun —una vez fundida, sacarla es
 * a mano—.
 */
export async function resumirChatEnPasos(input: {
  transcripcion: string;
  model?: string;
}): Promise<PasoDelChat[] | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !input.transcripcion.trim()) {
    return null;
  }

  const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: input.model?.trim() || "gpt-4.1-mini",
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SISTEMA },
        { role: "user", content: input.transcripcion },
      ],
    }),
    cache: "no-store",
  });

  if (!respuesta.ok) {
    throw new Error(`OpenAI respondio ${respuesta.status}`);
  }

  const cuerpo = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const crudo = cuerpo.choices?.[0]?.message?.content?.trim();
  if (!crudo) {
    return null;
  }

  let datos: unknown;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return null;
  }

  const lista = (datos as { pasos?: unknown })?.pasos;
  if (!Array.isArray(lista)) {
    return null;
  }

  const pasos: PasoDelChat[] = [];
  for (const item of lista) {
    const quien = (item as { quien?: unknown })?.quien;
    const paso = (item as { paso?: unknown })?.paso;
    if (typeof paso !== "string" || !paso.trim()) {
      continue;
    }
    const dequien: QuienHabla = quien === "cliente" ? "cliente" : "nosotros";
    const permitidos: readonly string[] =
      dequien === "cliente" ? PASOS_DEL_CLIENTE : PASOS_NUESTROS;
    const limpio = paso.trim();
    // Lo que no este en la lista se DESCARTA. Un solo paso inventado que entre al mapa comun ya no
    // se funde con nada y hay que sacarlo a mano de un diagrama compartido.
    const canonico = permitidos.find(
      (opcion) => llaveDePaso(dequien, opcion) === llaveDePaso(dequien, limpio),
    );
    if (!canonico) {
      continue;
    }

    // Dos veces el mismo paso seguido es el mismo movimiento contado dos veces.
    if (pasos[pasos.length - 1]?.paso === canonico && pasos[pasos.length - 1]?.quien === dequien) {
      continue;
    }

    pasos.push({ quien: dequien, paso: canonico });
    if (pasos.length >= MAXIMO_DE_PASOS) {
      break;
    }
  }

  return pasos.length > 0 ? pasos : null;
}

/** La llave con la que dos pasos se consideran EL MISMO. Sin tildes, sin mayusculas, sin puntos. */
export function llaveDePaso(quien: QuienHabla, paso: string): string {
  const limpio = paso
    .toLowerCase()
    .normalize("NFD")
    // Las tildes se sacan por su rango unicode y no escribiendolas: un acento suelto en el codigo
    // fuente es invisible y se pierde en cualquier copiado.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${quien}:${limpio}`;
}

type DatosDeNodo = {
  texto: string;
  icono: string;
  color: string;
  /** Lo que dice el paso, sin el contador. Es la llave del cruce y NO se toca al editar a mano. */
  paso: string;
  quien: QuienHabla;
  veces: number;
};

function textoDeNodo(paso: string, veces: number): string {
  // El contador va en negrita y en su propio renglon: es el dato que se busca al mirar el mapa.
  return veces > 1 ? `${paso}\n**${veces} clientes**` : paso;
}

function leerDatos(nodo: Node): DatosDeNodo | null {
  const datos = nodo.data as Partial<DatosDeNodo> | undefined;
  if (!datos || typeof datos.paso !== "string") {
    return null;
  }
  return {
    texto: typeof datos.texto === "string" ? datos.texto : datos.paso,
    icono: typeof datos.icono === "string" ? datos.icono : "",
    color: typeof datos.color === "string" ? datos.color : "neutro",
    paso: datos.paso,
    quien: datos.quien === "cliente" ? "cliente" : "nosotros",
    veces: typeof datos.veces === "number" ? datos.veces : 1,
  };
}

/**
 * Mete un chat en el mapa.
 *
 * Se recorre el arbol desde la raiz siguiendo los pasos: si desde donde estoy ya sale una caja con
 * ESE mismo paso, se le suma uno al contador y se sigue por ahi; si no sale, se crea. Asi los
 * caminos compartidos se apilan y las diferencias se abren en ramas.
 *
 * Respeta lo que haya editado una persona: el cruce se hace por `paso` (que no se toca al escribir
 * en la caja) y solo se reescribe el `texto` de las cajas que este recorrido tocó.
 */
export function fundirChatEnMapa(input: {
  nodos: Node[];
  aristas: Edge[];
  pasos: PasoDelChat[];
}): { nodos: Node[]; aristas: Edge[] } {
  const nodos = input.nodos.map((nodo) => ({ ...nodo }));
  const aristas = input.aristas.map((arista) => ({ ...arista }));

  // La raiz existe siempre: es el "todos los chats empiezan aca" que hace que el mapa sea UN arbol
  // y no un monton de cadenas sueltas.
  let raiz = nodos.find((nodo) => nodo.id === RAIZ);
  if (!raiz) {
    raiz = {
      id: RAIZ,
      type: "idea",
      position: { x: 0, y: 0 },
      style: { width: 200 },
      data: {
        texto: "Empieza la conversación",
        icono: "🎯",
        color: "verde",
        paso: "__inicio__",
        quien: "nosotros",
        veces: 0,
      } satisfies DatosDeNodo,
    };
    nodos.push(raiz);
  }
  const datosRaiz = leerDatos(raiz);
  if (datosRaiz) {
    raiz.data = { ...datosRaiz, veces: datosRaiz.veces + 1, texto: "Empieza la conversación" };
  }

  let actual = RAIZ;
  for (const paso of input.pasos) {
    const llave = llaveDePaso(paso.quien, paso.paso);

    const hijo = aristas
      .filter((arista) => arista.source === actual)
      .map((arista) => nodos.find((nodo) => nodo.id === arista.target))
      .find((nodo) => {
        const datos = nodo ? leerDatos(nodo) : null;
        return datos ? llaveDePaso(datos.quien, datos.paso) === llave : false;
      });

    if (hijo) {
      const datos = leerDatos(hijo)!;
      const veces = datos.veces + 1;
      hijo.data = { ...datos, veces, texto: textoDeNodo(datos.paso, veces) };
      actual = hijo.id;
      continue;
    }

    const id = `camino-${llave.replace(/[^a-z0-9]/g, "-")}-${nodos.length}`;
    nodos.push({
      id,
      type: "idea",
      position: { x: 0, y: 0 },
      style: { width: 200 },
      data: {
        texto: textoDeNodo(paso.paso, 1),
        icono: ICONO_POR_QUIEN[paso.quien],
        color: COLOR_POR_QUIEN[paso.quien],
        paso: paso.paso,
        quien: paso.quien,
        veces: 1,
      } satisfies DatosDeNodo,
    });
    aristas.push({
      id: `union-${actual}-${id}`,
      source: actual,
      target: id,
      type: "borrable",
    });
    actual = id;
  }

  return { nodos: acomodar(nodos, aristas), aristas };
}

const SEPARACION_HORIZONTAL = 240;
const SEPARACION_VERTICAL = 150;

/**
 * Acomoda el arbol de arriba hacia abajo.
 *
 * Se reacomoda ENTERO en cada chat nuevo y no solo lo agregado: al aparecer una rama, las que ya
 * estaban tienen que correrse o quedan una encima de la otra. Es un mapa que se genera, no uno que
 * se dibuja a mano, asi que mandar el orden automatico es lo correcto —y si alguien mueve una caja,
 * el proximo chat la vuelve a alinear, que para leer caminos es lo que se quiere.
 */
function acomodar(nodos: Node[], aristas: Edge[]): Node[] {
  const hijosDe = new Map<string, string[]>();
  for (const arista of aristas) {
    const lista = hijosDe.get(arista.source) ?? [];
    lista.push(arista.target);
    hijosDe.set(arista.source, lista);
  }

  const porId = new Map(nodos.map((nodo) => [nodo.id, nodo]));
  const posiciones = new Map<string, { x: number; y: number }>();
  let siguienteColumna = 0;
  const visitados = new Set<string>();

  // Recorrido en profundidad: cada hoja se lleva una columna, y cada padre se centra sobre sus
  // hijos. Es lo que hace que un camino se lea de corrido para abajo.
  const ubicar = (id: string, nivel: number): number => {
    if (visitados.has(id)) {
      return posiciones.get(id)?.x ?? 0;
    }
    visitados.add(id);

    const hijos = (hijosDe.get(id) ?? []).filter((hijo) => porId.has(hijo));
    if (hijos.length === 0) {
      const x = siguienteColumna * SEPARACION_HORIZONTAL;
      siguienteColumna += 1;
      posiciones.set(id, { x, y: nivel * SEPARACION_VERTICAL });
      return x;
    }

    const xs = hijos.map((hijo) => ubicar(hijo, nivel + 1));
    const x = (Math.min(...xs) + Math.max(...xs)) / 2;
    posiciones.set(id, { x, y: nivel * SEPARACION_VERTICAL });
    return x;
  };

  if (porId.has(RAIZ)) {
    ubicar(RAIZ, 0);
  }

  // Lo que quedo suelto (por ejemplo cajas que alguien agrego a mano) se deja donde estaba.
  return nodos.map((nodo) => {
    const posicion = posiciones.get(nodo.id);
    return posicion ? { ...nodo, position: posicion } : nodo;
  });
}
