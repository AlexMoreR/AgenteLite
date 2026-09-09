import type { NextConfig } from "next";

function normalizeDeploymentId(value: string | undefined): string {
  return value?.trim().replace(/[^a-zA-Z0-9_-]/g, "") ?? "";
}

const deploymentId = normalizeDeploymentId(
  process.env.DEPLOYMENT_ID ||
    process.env.NEXT_DEPLOYMENT_ID ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA,
);

const nextConfig: NextConfig = {
  // Use a stable deployment identifier when the build pipeline provides one.
  // This helps Next detect version skew during rolling deploys and prevents
  // stale Server Action payloads from trying to hit a newer build.
  ...(deploymentId
    ? {
        deploymentId,
        generateBuildId: async () => deploymentId,
      }
    : {}),

  /**
   * El icono y el manifiesto se guardan en el navegador.
   *
   * Salian con `max-age=0, must-revalidate`, asi que el telefono preguntaba por los dos en CADA
   * carga de la app: medido, 567 ms y 589 ms de ida y vuelta, antes de que se vea nada. Son dos
   * archivos que no cambian nunca.
   *
   * Un dia de cache con una semana de gracia: si algun dia cambia el icono, el peor caso es que
   * alguien vea el viejo hasta mañana.
   */
  async headers() {
    return [
      /*
        Los archivos subidos se guardan para SIEMPRE en el navegador.

        Los sirve el mismo proceso que atiende los chats, y eso se paga caro: en 29 horas salieron
        5,9 GB por ahi, y cuando entra una rafaga de imagenes del catalogo todo lo demas hace cola
        detras. Medido el 8-sep-2026: en el peor minuto, la mediana de TODA la app fue de 14
        segundos y las rutas colgadas eran `/uploads/categories/*.png`.

        Se puede cachear sin miedo porque ningun archivo se pisa: todos nacen con un nombre unico
        -marca de tiempo mas identificador, o el hash del contenido-. Si el contenido cambia, la
        direccion cambia.

        Va `private` y no `public`: aca adentro viven fotos, audios y curriculums de clientes, y
        `private` deja que los guarde el navegador de quien los abrio pero no un intermediario.
        Hoy no hay ninguno en el medio; el dia que se ponga uno, esto ya esta decidido.

        OJO: esto cubre los archivos que ya estaban al construir la imagen, que los entrega el
        manejador estatico con `max-age=0` -son las 15.111 revalidaciones que se veian en el log-.
        Los que se suben despues los sirve `src/app/uploads/[...path]/route.ts`, que pone su
        propia cabecera.
      */
      {
        source: "/uploads/:archivo*",
        headers: [
          { key: "Cache-Control", value: "private, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/icon",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default nextConfig;
