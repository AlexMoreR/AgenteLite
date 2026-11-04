/*
  Imagenes que trae el portapapeles al pegar (Ctrl+V) en la caja de escribir del chat.

  En Chrome de computador la MISMA imagen viene en `clipboardData.items` y en
  `clipboardData.files`, y cada copia trae su propia hora (`lastModified`, con milisegundos), asi
  que no se pueden juntar las dos listas y quitar repetidos: la imagen quedaba dos veces. Por eso
  se toman las imagenes de `items` y, SOLO si `items` no trajo ninguna, las de `files` (Android
  Chrome y iPhone Safari suelen traerla solo ahi). No se quitan repetidas por tamano: borraria dos
  imagenes distintas que pesen lo mismo.

  Si falta el nombre (vacio o `image.png` generico) o el tipo, se completan para que la vista
  previa y el envio funcionen igual que con "Fotos y videos".
*/
export function imagenesDelPortapapeles(datos: DataTransfer | null | undefined): File[] {
  if (!datos) {
    return [];
  }
  const deItems: File[] = [];
  for (const item of Array.from(datos.items ?? [])) {
    if (item.kind === "file" && (item.type === "" || item.type.startsWith("image/"))) {
      const archivo = item.getAsFile();
      if (archivo && (archivo.type || "image/png").startsWith("image/")) {
        deItems.push(archivo);
      }
    }
  }
  const candidatos =
    deItems.length > 0
      ? deItems
      : Array.from(datos.files ?? []).filter((archivo) => (archivo.type || "image/png").startsWith("image/"));

  return candidatos.map((archivo, indice) => {
    const tipo = archivo.type || "image/png";
    const extension = tipo.split("/")[1]?.split("+")[0] || "png";
    const sinNombre = !archivo.name || /^image\.\w+$/i.test(archivo.name);
    return sinNombre || !archivo.type
      ? new File([archivo], `imagen-pegada-${Date.now()}-${indice + 1}.${extension}`, {
          type: tipo,
          lastModified: archivo.lastModified,
        })
      : archivo;
  });
}
