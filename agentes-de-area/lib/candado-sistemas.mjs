// EL CANDADO DE SOLO LECTURA del Agente de Sistemas.
//
// Claude Code (no la buena voluntad del agente) decide qué puede usar:
//  - PERMITIDAS: las herramientas del CRM que LEEN (más guardar el resumen), los tres programas fijos de
//    sistemas/herramientas/ y la lectura de Google Drive. Lo que no está en la lista queda bloqueado.
//  - PROHIBIDAS: además, una lista explícita de todo lo que escribe, aprueba, cambia estados, manda mensajes o
//    toca el código (git, gh, npm...).
//  - `crear_tarjeta` NO está en ninguna lista de aquí: solo la agrega el lanzador, y solo cuando el interruptor está
//    prendido y la corrida no es de prueba (ver argumentosDeClaude en correr-agente.mjs).
//
// La prueba probar-agente-de-sistemas.mjs avisa si sistemas/.claude/settings.json deja de coincidir con esto.

export const SERVIDOR_CRM = "aizencrm";

const crm = (nombre) => `mcp__${SERVIDOR_CRM}__${nombre}`;

/** Lo que el agente lee del CRM. `guardar_resumen_del_dia` es lo único que escribe (su resumen). */
export const CRM_PERMITIDAS_SISTEMAS = [
  "revision_de_sistemas",
  "agente_de_sistemas",
  "guardar_resumen_del_dia",
  "ver_tablero",
  "listar_tableros",
  "listar_tipos",
  "ver_plan_y_resultado",
  "ver_historial_tarjeta",
  "ver_coordinador",
  "resumen_del_negocio",
  "numeros_de_ventas",
  "numeros_de_marketing",
  "listar_productos",
].map(crm);

/** Crear la tarjeta de arreglo: solo con el interruptor prendido, fuera de prueba. */
export const CRM_CREAR_TARJETA = crm("crear_tarjeta");

/** Los tres únicos programas que el agente puede correr. No escriben nada. */
export const PROGRAMAS_PERMITIDOS = [
  "Bash(node herramientas/revisar-pantalla.mjs:*)",
  "Bash(node herramientas/leer-servidor.mjs:*)",
  "Bash(node herramientas/salud-de-aizen1.mjs:*)",
];

/** Google Drive, solo lectura (buscar el archivo de anoche). Se puede ampliar con `herramientasDeDrive` en la configuración. */
export const DRIVE_LECTURA_POR_DEFECTO = ["mcp__google-drive__search_files", "mcp__google-drive__list_recent_files", "mcp__google-drive__get_file_metadata"];

export const CRM_PROHIBIDAS_SISTEMAS = [
  "mandar_whatsapp_al_equipo",
  "aprobar_tarjeta",
  "cambiar_estado_tarjeta",
  "editar_tarjeta",
  "borrar_tarjeta",
  "conectar_tarjetas",
  "deshacer_cambio_tarjeta",
  "crear_tablero",
  "renombrar_tablero",
  "crear_tipo",
  "editar_tipo",
  "deshacer_cambio",
].map(crm);

/** Consola: solo los tres programas de arriba. Todo lo demás está prohibido por nombre y, además, no está permitido. */
export const CONSOLA_PROHIBIDA = ["git", "gh", "npm", "npx", "ssh", "scp", "curl", "wget", "rm", "mv", "cp", "docker", "kubectl", "sudo", "powershell", "pwsh", "cmd"].map((c) => `Bash(${c}:*)`);

// Sistemas no escribe archivos: ni Write ni Edit (su resumen va al CRM, no a disco).
export const PROHIBIDAS_DE_SISTEMAS = ["Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", ...CONSOLA_PROHIBIDA, ...CRM_PROHIBIDAS_SISTEMAS];
