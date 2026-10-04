import { leerArchivoDelChat, transcribirAudioAhora } from "@/lib/transcripcion-de-audios";

/**
 * AUDIOS Y FOTOS PARA EL AGENTE V3 (Alex, 03-10-2026).
 *
 *  - Audio: se transcribe en el momento y se contesta igual que un texto.
 *  - Foto: se mira. Si es de mobiliario de salon (camillas, sillas, lavacabezas, tocadores...) el V3
 *    responde; si es otra cosa -un comprobante de pago, un documento, una foto del local, algo que
 *    no se entiende- no responde y avisa a una asesora.
 *  - Video: no se mira; avisa a una asesora (eso lo decide el webhook).
 *
 * Los archivos se leen de NUESTRO servidor (donde el webhook ya los guardo), no de WhatsApp: leer de
 * la direccion de WhatsApp fue lo que dejo sin respuesta el primer audio de prueba.
 */

export async function transcribirAudioParaElV3(mediaUrl: string | null): Promise<string | null> {
  if (!mediaUrl) return null;
  return transcribirAudioAhora(mediaUrl);
}

export type FotoLeida = {
  /** Es de mobiliario para salon o de un producto nuestro: el V3 la contesta. */
  esMobiliario: boolean;
  /** Que se ve, en una frase. */
  descripcion: string;
};

const MODELO = "gpt-4.1-mini";

/** Mira la foto y dice si es mobiliario de salon. null = no se pudo ver. */
export async function leerFotoParaElV3(mediaUrl: string | null): Promise<FotoLeida | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !mediaUrl) return null;

  const archivo = await leerArchivoDelChat(mediaUrl);
  if (!archivo) return null;
  const tipo = tipoDeImagen(archivo.bytes);
  if (!tipo) return null;
  const imagen = `data:${tipo};base64,${archivo.bytes.toString("base64")}`;

  try {
    const respuesta = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model: MODELO,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Miras una foto que una clienta le mandó por WhatsApp a Magilus, fabricante de mobiliario para peluquerías, barberías, spa, estética y salones de belleza. " +
              'Responde SOLO un JSON: {"es_mobiliario": true|false, "descripcion": "<qué se ve, en una frase corta en español>"}. ' +
              "es_mobiliario es true si lo principal de la foto es un mueble o equipo de salón: camillas, sillas de peluquería o barbería, lavacabezas, tocadores, poltronas, mesas de manicura, butacos, carritos auxiliares, escaleras, biombos, tarimas, o una captura de un producto así. " +
              "Es false si es un comprobante o pantallazo de pago, un documento, un texto, una foto de su local o de un espacio vacío, una persona, o algo que no se entiende.",
          },
          { role: "user", content: [{ type: "image_url", image_url: { url: imagen } }] },
        ],
      }),
    });
    if (!respuesta.ok) {
      console.warn("[agente-v3] foto: el modelo respondio", respuesta.status);
      return null;
    }
    const datos = (await respuesta.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const crudo = JSON.parse(datos.choices?.[0]?.message?.content ?? "{}") as { es_mobiliario?: unknown; descripcion?: unknown };
    return {
      esMobiliario: crudo.es_mobiliario === true,
      descripcion: typeof crudo.descripcion === "string" ? crudo.descripcion.trim().slice(0, 300) : "",
    };
  } catch (error) {
    console.warn("[agente-v3] foto: no se pudo leer", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** El tipo real de la imagen por sus primeros bytes (la extension del archivo no siempre esta). */
function tipoDeImagen(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  return null;
}
