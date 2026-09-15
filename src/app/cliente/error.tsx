"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
  Error de "version vieja": la pestaña quedo abierta desde antes de un despliegue y, al navegar (por
  ejemplo, al elegir un filtro), pide archivos de la version anterior que ya no existen.

  Le paso a Camila el 15-sep-2026 al filtrar "Descartado" (captura sin codigo: fallo del navegador,
  no del servidor). Con la pagina recargada funciona perfecto, y "Reintentar" no alcanzaba: vuelve a
  dibujar con los mismos archivos viejos.
*/
const SEÑALES_DE_VERSION_VIEJA = [
  "chunkloaderror",
  "loading chunk",
  "loading css chunk",
  "failed to fetch dynamically imported module",
  "failed to find server action",
  "importing a module script failed",
];

const CLAVE_ULTIMA_RECARGA = "aizen:recarga-por-version";

function esVersionVieja(error: Error) {
  const texto = `${error.name} ${error.message}`.toLowerCase();
  return SEÑALES_DE_VERSION_VIEJA.some((señal) => texto.includes(señal));
}

/**
 * Pantalla de error del área de cliente (chats, CRM, contactos...).
 *
 * Sin esto, cualquier excepción del servidor dejaba la pantalla EN BLANCO con el texto crudo
 * de Next ("Application error: a server-side exception has occurred"). Para una asesora en
 * medio de una venta eso es indistinguible de "el CRM se cayó": cierra y se va a WhatsApp,
 * que es justo lo que no queremos.
 *
 * Ahora el fallo queda contenido: la barra lateral sigue ahí (esto reemplaza solo el
 * contenido), se explica en castellano y hay un botón para reintentar. El código de error se
 * muestra porque es el ÚNICO dato que conecta lo que vio la asesora con el log del servidor.
 */
export default function ClienteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const versionVieja = esVersionVieja(error);

  useEffect(() => {
    console.error("[cliente] error de pantalla", { digest: error.digest, message: error.message });

    // Version vieja: se recarga sola UNA vez por minuto. Si recargando sigue fallando, se muestra la
    // pantalla en vez de entrar en un bucle de recargas.
    if (!versionVieja) {
      return;
    }
    try {
      const ultima = Number(window.sessionStorage.getItem(CLAVE_ULTIMA_RECARGA) ?? "0");
      if (Date.now() - ultima > 60_000) {
        window.sessionStorage.setItem(CLAVE_ULTIMA_RECARGA, String(Date.now()));
        window.location.reload();
      }
    } catch {
      // Sin sessionStorage (modo privado): queda el boton.
    }
  }, [error, versionVieja]);

  /*
    Un error del navegador (sin codigo) casi siempre se arregla recargando la pagina entera; reset()
    solo vuelve a dibujar con lo mismo que ya fallo. Los del servidor (con codigo) si pueden salir
    bien reintentando sin perder lo que habia en pantalla.
  */
  const reintentar = () => {
    if (versionVieja || !error.digest) {
      window.location.reload();
      return;
    }
    reset();
  };

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 text-center">
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-amber-50">
          <TriangleAlert className="size-5 text-amber-600" />
        </div>

        <h1 className="text-base font-semibold text-foreground">
          {versionVieja ? "Hay una versión nueva de la app" : "No se pudo cargar esta pantalla"}
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          {versionVieja
            ? "Se actualizó mientras la tenías abierta. Recargá para seguir; no se perdió ningún mensaje ni ningún dato."
            : "Fue una falla al cargar, no se perdió ningún mensaje ni ningún dato. Probá de nuevo; si vuelve a pasar, mandá una captura al grupo de errores."}
        </p>

        <Button type="button" className="mt-4 w-full" onClick={reintentar}>
          <RotateCcw className="size-4" />
          {versionVieja ? "Recargar" : "Reintentar"}
        </Button>

        {error.digest ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Código: <span className="font-mono">{error.digest}</span>
          </p>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Detalle: <span className="font-mono">{error.message.slice(0, 120) || error.name}</span>
          </p>
        )}
      </div>
    </div>
  );
}
