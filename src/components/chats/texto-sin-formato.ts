/*
  La vista previa de la lista de chats sin los signos de formato de WhatsApp (Alex, 10-11-2026:
  "la vista previa sin asteriscos").

  En el chat, *negrita*, _cursiva_, ~tachado~ y ```monoespaciado``` se ven con su formato; en la fila
  de la lista se veian los signos crudos ("*Precio:* $250.000"). Aca se quitan:
  - Todos los asteriscos: la vista previa va cortada y muchas veces el de cierre ni llega.
  - Los ``` y las comillas invertidas sueltas.
  - _ y ~ solo cuando envuelven texto (los guiones bajos de un correo o un enlace se quedan).
  Y los saltos de linea y espacios repetidos quedan en un solo espacio: la fila pinta una linea.
*/

const ENVUELTO = /(^|[\s(¡¿"'])([_~])(?=\S)([^\n]*?\S)\2(?=$|[\s.,;:!?)"'])/g;

export function textoSinFormato(texto: string | null | undefined): string {
  if (!texto) return "";
  let limpio = texto.replace(/```/g, "").replace(/`/g, "").replace(/\*/g, "");
  // Dos pasadas: "_~ambos~_" queda limpio.
  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    limpio = limpio.replace(ENVUELTO, (_todo, antes: string, _signo: string, adentro: string) => `${antes}${adentro}`);
  }
  return limpio.replace(/\s+/g, " ").trim();
}
