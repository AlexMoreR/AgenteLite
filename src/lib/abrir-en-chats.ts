// Regla para abrir Chats en vez de Mi día. Las apps instaladas en los últimos meses guardaron el start_url viejo
// "/cliente/crm/mi-dia" y siguen abriendo directo ahí aunque el manifest ya diga "/cliente". Solo una apertura nueva
// (la app o una pestaña que abre esa dirección exacta, sin venir de otra página de la app) se manda al inicio; el menú,
// los enlaces y la navegación interna siguen llegando a Mi día. Si el navegador no manda las marcas Sec-Fetch-*, no
// se redirige: queda como hoy. La sesión no se revisa aquí, la revisa el middleware.

export const RUTA_MI_DIA = "/cliente/crm/mi-dia";
export const COOKIE_INICIO = "aizen_inicio";
export const OPCIONES_COOKIE_INICIO = { maxAge: 60, httpOnly: true, sameSite: "lax", path: "/" } as const;

export type EntradaAbrirEnChats = {
  pathname: string;
  search: string;
  header: (nombre: string) => string | null;
  cookie: (nombre: string) => string | undefined;
};

export function debeMandarAlInicio({ pathname, search, header, cookie }: EntradaAbrirEnChats): boolean {
  if (pathname !== RUTA_MI_DIA) return false;
  if (search !== "") return false;
  if (header("rsc") != null) return false;
  if (header("sec-fetch-mode") !== "navigate") return false;
  if (header("sec-fetch-dest") !== "document") return false;
  if (header("sec-fetch-site") !== "none") return false;
  if (cookie(COOKIE_INICIO) !== undefined) return false;
  return true;
}
