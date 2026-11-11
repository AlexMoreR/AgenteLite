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
  /*
    Las fotos del catalogo vienen de Gestion (magilus.com) a tamaño completo: PNG de 1 a 2 MB, una
    tardo 19 s. Para una miniatura de 40 px se piden achicadas por el optimizador de Next
    (/_next/image), que solo acepta estos origenes (03-10-2026).
  */
  images: {
    remotePatterns: [{ protocol: "https", hostname: "magilus.com", pathname: "/uploads/**" }],
    /*
      Las miniaturas ya hechas se guardan 31 dias (10-nov-2026). Next toma el mayor entre esto y el
      max-age del original. El cache vive en .next/cache/images dentro del contenedor: se pierde en
      cada deploy y se rehace la primera vez que alguien pide cada miniatura.
    */
    minimumCacheTTL: 2678400,
  },

  /*
    "Tableros inteligentes" pasó a llamarse "Tablero IA" (19-oct-2026). Los links viejos (los que ya
    devolvió el MCP, con ?tablero=<id> o ?tarjeta=<id>) siguen sirviendo: Next pasa la query tal
    cual al destino. Temporal (307) a propósito, para no dejarlo grabado en los navegadores.
  */
  async redirects() {
    return [
      { source: "/cliente/tableros-inteligentes", destination: "/cliente/tablero-ia", permanent: false },
      { source: "/cliente/tableros-inteligentes/:resto*", destination: "/cliente/tablero-ia/:resto*", permanent: false },
      // Dirección (parte 1): las 4 pantallas salieron del CRM; los links viejos (WhatsApp, push, MCP) siguen sirviendo.
      { source: "/cliente/crm/supervisor", destination: "/cliente/direccion/supervisor", permanent: false },
      { source: "/cliente/crm/supervisor/:resto*", destination: "/cliente/direccion/supervisor/:resto*", permanent: false },
      { source: "/cliente/crm/agente-de-ventas", destination: "/cliente/direccion/agente-de-ventas", permanent: false },
      { source: "/cliente/crm/agente-de-ventas/:resto*", destination: "/cliente/direccion/agente-de-ventas/:resto*", permanent: false },
      { source: "/cliente/crm/agente-de-marketing", destination: "/cliente/direccion/agente-de-marketing", permanent: false },
      { source: "/cliente/crm/agente-de-marketing/:resto*", destination: "/cliente/direccion/agente-de-marketing/:resto*", permanent: false },
      { source: "/cliente/crm/agente-de-sistemas", destination: "/cliente/direccion/agente-de-sistemas", permanent: false },
      { source: "/cliente/crm/agente-de-sistemas/:resto*", destination: "/cliente/direccion/agente-de-sistemas/:resto*", permanent: false },
      // Dirección (parte 2): Embudo, Comparar embudos, Pauta, Recuperación e Informe también salieron del CRM.
      { source: "/cliente/crm/embudo", destination: "/cliente/direccion/embudo", permanent: false },
      { source: "/cliente/crm/embudo/:resto*", destination: "/cliente/direccion/embudo/:resto*", permanent: false },
      { source: "/cliente/crm/comparar-embudos", destination: "/cliente/direccion/comparar-embudos", permanent: false },
      { source: "/cliente/crm/comparar-embudos/:resto*", destination: "/cliente/direccion/comparar-embudos/:resto*", permanent: false },
      { source: "/cliente/crm/pauta", destination: "/cliente/direccion/pauta", permanent: false },
      { source: "/cliente/crm/pauta/:resto*", destination: "/cliente/direccion/pauta/:resto*", permanent: false },
      { source: "/cliente/crm/recuperacion", destination: "/cliente/direccion/recuperacion", permanent: false },
      { source: "/cliente/crm/recuperacion/:resto*", destination: "/cliente/direccion/recuperacion/:resto*", permanent: false },
      { source: "/cliente/crm/informe", destination: "/cliente/direccion/informe", permanent: false },
      { source: "/cliente/crm/informe/:resto*", destination: "/cliente/direccion/informe/:resto*", permanent: false },
    ];
  },

  async headers() {
    return [
      /*
        Los archivos subidos: cuanto los guarda el navegador.

        Los sirve el mismo proceso que atiende los chats, y eso se paga caro: en 29 horas salieron
        5,9 GB por ahi, y cuando entra una rafaga de imagenes del catalogo todo lo demas hace cola
        detras. Medido el 8-sep-2026: en el peor minuto, la mediana de TODA la app fue de 14
        segundos y las rutas colgadas eran `/uploads/categories/*.png`.

        Desde el 10-nov-2026 depende del NOMBRE, igual que en `src/app/uploads/[...path]/route.ts`
        (src/lib/archivos-subidos.ts), que sirve los que se suben despues del build:
        - Nombre unico (sha256 del contenido, o marca de tiempo + uuid): un año, `immutable`. Ese
          nombre nunca se reusa con otro contenido.
        - Cualquier otro nombre (fotos de perfil, productos, carta de colores, que se pueden
          reemplazar con el mismo nombre): el navegador pregunta cada vez y recibe un 304 sin bajar
          nada si no cambio. Antes iban `immutable` y un reemplazo se veia viejo por un año.
        Si dos reglas coinciden gana la ULTIMA: por eso la general va primero.
      */
      {
        source: "/uploads/:archivo*",
        headers: [{ key: "Cache-Control", value: "private, max-age=0, must-revalidate" }],
      },
      {
        source: "/uploads/:carpeta*/:archivo([0-9a-f]{64}\\.[A-Za-z0-9]{1,10})",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source:
          "/uploads/:carpeta*/:archivo(\\d{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\.[A-Za-z0-9]{1,10})",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      /*
        El sonido de aviso se servia con `max-age=0`: cada mensaje entrante lo volvia a pedir al
        mismo proceso que atiende los chats (455 veces en un minuto desde un equipo, 05-10-2026).
        Un dia de cache: si se cambia el sonido, llega a todos al dia siguiente.
      */
      {
        source: "/sounds/:archivo*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
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
