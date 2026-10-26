// EL CANDADO DE SOLO LECTURA EN META ADS del Agente de Marketing.
//
// Claude Code (no la buena voluntad del agente) decide qué herramientas puede usar:
//  - PERMITIDAS: únicamente las de LECTURA (entidades, insights, imágenes, vista previa). Lo que no está en esta
//    lista queda bloqueado, así que una herramienta nueva de Meta que escriba nace bloqueada.
//  - PROHIBIDAS: además, una lista explícita de TODAS las que escriben (crear, editar, prender, pausar, borrar...).
//
// El servidor del conector de Meta se llama "meta-ads" en marketing/.mcp.json. Si el conector del dueño usa otro
// nombre, se cambia SERVIDOR_META aquí Y en marketing/.claude/settings.json (la prueba probar-solo-lectura-meta.mjs
// avisa si no coinciden).

export const SERVIDOR_META = "meta-ads";

const meta = (nombre) => `mcp__${SERVIDOR_META}__${nombre}`;

export const META_LECTURA = [
  "get_ad_accounts",
  "get_ad_account_details",
  "get_campaigns",
  "get_campaign_details",
  "get_adsets",
  "get_adset_details",
  "get_ads",
  "get_ad_details",
  "get_ad_creatives",
  "get_ad_images",
  "get_ad_previews",
  "get_insights",
  "get_activity_history",
].map(meta);

export const META_ESCRITURA = [
  "create_campaign",
  "update_campaign",
  "pause_campaign",
  "resume_campaign",
  "enable_campaign",
  "delete_campaign",
  "create_adset",
  "update_adset",
  "pause_adset",
  "resume_adset",
  "enable_adset",
  "delete_adset",
  "create_ad",
  "update_ad",
  "pause_ad",
  "resume_ad",
  "enable_ad",
  "delete_ad",
  "create_ad_creative",
  "update_ad_creative",
  "delete_ad_creative",
  "upload_ad_image",
  "create_custom_audience",
  "update_custom_audience",
  "delete_custom_audience",
  "create_lookalike_audience",
  "create_catalog",
  "update_catalog",
  "create_product_set",
  "update_product_feed",
  "create_pixel",
  "update_pixel",
  "send_conversion_event",
  "create_ab_test",
  "update_ab_test",
  "update_budget",
  "update_bid",
  "set_status",
].map(meta);

/** Verbos que escriben: ninguna herramienta permitida puede tenerlos y toda prohibida tiene que tener uno. */
export const VERBOS_QUE_ESCRIBEN = /(^|_)(create|update|delete|pause|resume|enable|disable|activate|archive|upload|send|set|edit|duplicate|copy|remove|add|publish|launch|start|stop|toggle|replace|write|post)(_|$)/i;

/** Del CRM, el agente de marketing solo puede leer y guardar su resumen. NO manda WhatsApp ni edita el bot o el V3. */
export const CRM_PERMITIDAS_MARKETING = [
  "numeros_de_marketing",
  "guardar_resumen_del_dia",
  "agente_de_marketing",
  "resumen_del_negocio",
  "listar_conversaciones",
  "ver_conversacion",
  "buscar_mensajes",
  "listar_productos",
].map((nombre) => `mcp__aizencrm__${nombre}`);

/** Herramientas que el agente de marketing jamás debe tener (el CRM y el sistema). */
export const PROHIBIDAS_DE_MARKETING = ["Bash", "WebFetch", "WebSearch", "Edit", "mcp__aizencrm__mandar_whatsapp_al_equipo"];
