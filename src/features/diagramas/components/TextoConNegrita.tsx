/**
 * Muestra el texto de una idea con las partes en negrita ya aplicadas.
 *
 * La negrita se marca con asteriscos, *como en WhatsApp*: es la convención que él ya escribe
 * todos los días, y deja lo guardado como texto plano —sin etiquetas HTML que después haya que
 * limpiar para mostrarlo en otro lado, ni riesgo de pegar marcado raro dentro del diagrama.
 *
 * Se parte con una expresión regular y se dibuja con <strong>: NUNCA se inserta HTML crudo.
 */
export function TextoConNegrita({
  texto,
  vacio,
  className,
}: {
  texto: string;
  /** Qué mostrar cuando la idea todavía no tiene nada escrito. */
  vacio?: string;
  className?: string;
}) {
  if (!texto.trim()) {
    return <p className={`${className ?? ""} text-muted-foreground`}>{vacio ?? ""}</p>;
  }

  return <p className={className}>{partir(texto)}</p>;
}

/**
 * Corta el texto en pedazos normales y pedazos en negrita.
 *
 * El asterisco solo abre negrita si CIERRA: así, escribir "2 * 3" o un asterisco suelto se ve tal
 * cual y no se come el resto del renglón.
 */
function partir(texto: string) {
  const partes: Array<string | { negrita: string }> = [];
  const patron = /\*([^*\n]+)\*/g;
  let ultimo = 0;
  let encontrado: RegExpExecArray | null;

  while ((encontrado = patron.exec(texto)) !== null) {
    if (encontrado.index > ultimo) {
      partes.push(texto.slice(ultimo, encontrado.index));
    }
    partes.push({ negrita: encontrado[1] });
    ultimo = encontrado.index + encontrado[0].length;
  }
  if (ultimo < texto.length) {
    partes.push(texto.slice(ultimo));
  }

  return partes.map((parte, indice) =>
    typeof parte === "string" ? (
      <span key={indice}>{parte}</span>
    ) : (
      <strong key={indice} className="font-semibold">
        {parte.negrita}
      </strong>
    ),
  );
}
