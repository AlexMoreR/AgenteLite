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
