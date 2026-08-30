"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Mantiene al dia la lista de conexiones.
 *
 * El estado de cada canal lo escribe el monitor cada minuto, pero esta pantalla se dibujaba una
 * sola vez al abrirla: quedaba una foto vieja. Se daba el caso incomodo de ver los cuatro puntitos
 * en verde mientras la barra de abajo -que si consulta seguido- decia que uno estaba caido. En la
 * pantalla que uno mira JUSTAMENTE para saber si algo se cayo, esa contradiccion es lo peor.
 *
 * Solo con la pestaña a la vista: refrescar una pantalla que nadie esta mirando es gastar por las
 * dudas. Y son pocas filas, asi que el refresco es barato.
 */
const CADA_CUANTO_MS = 45_000;

export function ConexionAutoRefresh() {
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    const refrescar = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      startTransition(() => router.refresh());
    };

    const reloj = window.setInterval(refrescar, CADA_CUANTO_MS);
    // Tambien al volver a la pestaña: es el momento exacto en que uno viene a mirar si ya conecto.
    document.addEventListener("visibilitychange", refrescar);

    return () => {
      window.clearInterval(reloj);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, [router, startTransition]);

  return null;
}
