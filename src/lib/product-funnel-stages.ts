/**
 * Las cinco etapas de una venta, en orden. Son las mismas con las que ya trabaja el motor; aca se
 * les pone el nombre que usa el equipo.
 *
 * Vive en su propio archivo, sin nada del servidor, porque lo usa tambien la pantalla. Cuando
 * estaba junto a las consultas de la base, importarlo desde un componente arrastraba Prisma al
 * navegador y el build se caia.
 */
export const PRODUCT_FUNNEL_STAGES = [
  /*
    Se llama "Bienvenida" y no "Presentacion" para que sea la MISMA palabra que en el constructor
    del agente: alli el primer mensaje es el nodo Bienvenida. Dos nombres para el mismo momento de
    la conversacion obligan a traducir mentalmente cada vez.

    La clave guardada sigue siendo PRESENTACION: cambiarla obligaria a migrar lo que ya esta
    escrito en cada producto, y el nombre que se ve no tiene por que atarse al que se guarda.
  */
  { stage: "PRESENTACION", label: "Bienvenida", ayuda: "El saludo y por qué le conviene seguir." },
  { stage: "IDENTIFICACION", label: "Identificación", ayuda: "Entender qué necesita y si le sirve." },
  { stage: "PRODUCTO", label: "Presentación del producto", ayuda: "Qué es, qué trae y cuánto vale." },
  { stage: "OBJECIONES", label: "Dudas y objeciones", ayuda: "Lo que lo frena antes de decidir." },
  { stage: "CIERRE", label: "Cierre y toma del pedido", ayuda: "Pedir la decisión y los datos." },
] as const;

export type ProductFunnelStageKey = (typeof PRODUCT_FUNNEL_STAGES)[number]["stage"];
