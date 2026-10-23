/*
  EL ACTA DE UNA REUNIÓN, hecha por un modelo de OpenAI de bajo costo (gpt-4o-mini) a partir de la
  transcripción con nombres. Cuesta centavos.

  Trae: resumen corto, decisiones, tareas con responsable y fecha, puntos de mejora en ventas y
  "qué puede mejorar Alexander como dueño".
*/

export type TareaDelActa = { tarea: string; responsable: string; fecha: string };

export type Acta = {
  resumen: string;
  decisiones: string[];
  tareas: TareaDelActa[];
  mejorasEnVentas: string[];
  mejorasDelDueno: string[];
};

const MODELO = "gpt-4o-mini";
/** gpt-4o-mini lee unas 128 mil fichas: esto alcanza para varias horas de reunión. */
const TOPE_DE_TEXTO = 350_000;

const INSTRUCCIONES = [
  "Eres el secretario de una empresa colombiana. Te paso la transcripción de una reunión, con la hora y el nombre de quien habló.",
  "Escribe el acta en español sencillo, sin inventar nada que no se haya dicho.",
  "Responde SOLO un JSON con estas claves:",
  '- "resumen": 2 a 4 frases con lo más importante.',
  '- "decisiones": lista de textos con lo que se decidió.',
  '- "tareas": lista de { "tarea", "responsable", "fecha" }. Si no se dijo responsable o fecha, pon "Sin definir".',
  '- "mejorasEnVentas": lista de puntos concretos para vender mejor que salgan de la reunión.',
  '- "mejorasDelDueno": lista de lo que puede mejorar Alexander como dueño (cómo dirige, cómo pide las cosas, qué deja sin decidir). Con respeto y concreto.',
  "Si una lista no tiene nada, déjala vacía.",
].join("\n");

const textos = (valor: unknown): string[] =>
  Array.isArray(valor) ? valor.map((uno) => (typeof uno === "string" ? uno.trim() : "")).filter(Boolean) : [];

/** Lo que devuelve el modelo, a la forma del acta (sin romperse si falta algo). */
export function normalizarActa(crudo: unknown): Acta {
  const datos = (crudo && typeof crudo === "object" ? crudo : {}) as Record<string, unknown>;
  const tareas = Array.isArray(datos.tareas) ? datos.tareas : [];
  return {
    resumen: typeof datos.resumen === "string" ? datos.resumen.trim() : "",
    decisiones: textos(datos.decisiones),
    tareas: tareas
      .map((tarea) => {
        const una = (tarea && typeof tarea === "object" ? tarea : {}) as Record<string, unknown>;
        const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : "Sin definir");
        return { tarea: typeof una.tarea === "string" ? una.tarea.trim() : "", responsable: texto(una.responsable), fecha: texto(una.fecha) };
      })
      .filter((tarea) => tarea.tarea),
    mejorasEnVentas: textos(datos.mejorasEnVentas),
    mejorasDelDueno: textos(datos.mejorasDelDueno),
  };
}

/** El acta en texto plano: se guarda para buscar y la lee Claude por el MCP. */
export function actaEnTexto(acta: Acta): string {
  const lista = (titulo: string, items: string[]) => (items.length ? `${titulo}:\n${items.map((item) => `- ${item}`).join("\n")}` : "");
  return [
    acta.resumen ? `Resumen: ${acta.resumen}` : "",
    lista("Decisiones", acta.decisiones),
    lista(
      "Tareas",
      acta.tareas.map((tarea) => `${tarea.tarea} (responsable: ${tarea.responsable}; fecha: ${tarea.fecha})`),
    ),
    lista("Mejoras en ventas", acta.mejorasEnVentas),
    lista("Qué puede mejorar Alexander como dueño", acta.mejorasDelDueno),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const ACTA_SIN_AUDIO: Acta = {
  resumen: "No se oyó a nadie hablar en la grabación.",
  decisiones: [],
  tareas: [],
  mejorasEnVentas: [],
  mejorasDelDueno: [],
};

export async function hacerActa(datos: { titulo: string; transcripcion: string }, apiKey: string): Promise<Acta> {
  if (!datos.transcripcion.trim()) {
    return ACTA_SIN_AUDIO;
  }
  const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODELO,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: INSTRUCCIONES },
        { role: "user", content: `Reunión: ${datos.titulo}\n\n${datos.transcripcion.slice(0, TOPE_DE_TEXTO)}` },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(3 * 60_000),
  });
  if (!respuesta.ok) {
    const detalle = (await respuesta.text().catch(() => "")).slice(0, 200);
    throw new Error(`OpenAI respondió ${respuesta.status} al hacer el acta: ${detalle}`);
  }
  const datosDeOpenAI = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const crudo = datosDeOpenAI.choices?.[0]?.message?.content?.trim();
  if (!crudo) {
    throw new Error("OpenAI no devolvió el acta.");
  }
  try {
    return normalizarActa(JSON.parse(crudo));
  } catch {
    throw new Error("OpenAI devolvió un acta que no se pudo leer.");
  }
}
