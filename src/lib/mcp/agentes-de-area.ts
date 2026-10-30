import {
  ETIQUETA_DE_AREA,
  diaAnterior,
  esArea,
  fechaValida,
  hoyEnBogota,
  leerPedidoDeEnvio,
  leerResumenAGuardar,
  type Area,
} from "@/features/agentes-de-area/dominio/reglas";
import { ETIQUETA_DE_AGENTE, leerPedidoDeDatoViejo } from "@/features/agentes-de-area/dominio/cerebro-del-area";
import { anotarAprendizaje, leerCerebroDelArea, marcarDatoViejo } from "@/features/agentes-de-area/servicios/cerebro-del-area";
import { agenteActivo } from "@/features/agentes-de-area/servicios/config";
import { mandarWhatsAppAlEquipo } from "@/features/agentes-de-area/servicios/envios";
import { leadsNuevosDelDia } from "@/features/leads-nuevos/servicios/leads-nuevos-del-dia";
import { numerosDeMarketing } from "@/features/agentes-de-area/servicios/numeros-de-marketing";
import { numerosDeRespuestaBienvenida } from "@/features/agentes-de-area/servicios/numeros-respuesta-bienvenida";
import { avisosDelSupervisor, medirLosSugeridosDe, numerosDelDia } from "@/features/agentes-de-area/servicios/numeros";
import {
  guardarResumenDelDia,
  leerEnviosDelDia,
  leerResumenDelDia,
  leerUltimaEntregaDe,
  leerUltimosResumenes,
} from "@/features/agentes-de-area/servicios/resumenes";
import { datosDeRevision } from "@/features/agentes-de-area/servicios/revision-de-sistemas";
import { puedeVerElSupervisor } from "@/lib/mcp/supervisor";

/*
  EL AGENTE DE VENTAS DESDE EL MCP.

  El agente piensa en aizen1 (Claude Code); el CRM solo da los datos, guarda el resumen, entrega los
  WhatsApp INTERNOS y los muestra en la pantalla. Cuatro herramientas:
    - numeros_de_ventas (lee)       → los números de un día por asesora y los sugeridos de ayer.
    - guardar_resumen_del_dia (escribe) → un resumen por día (se reemplaza si se guarda dos veces).
    - mandar_whatsapp_al_equipo (escribe) → SOLO a números del equipo, por la línea Admin, con el
      interruptor prendido y una vez por persona y por día. Todo se valida en el servidor.
    - agente_de_ventas (lee)        → el estado, el resumen de hoy, los mensajes y los últimos días.

  El Agente de Marketing (segunda área, mismo molde) agrega dos más:
    - numeros_de_marketing (lee)   → conversaciones por anuncio de origen: Tibio/Caliente, ventas, sin respuesta.
    - agente_de_marketing (lee)    → el estado, el resumen de hoy, su línea y su recomendación.
  Su resumen se guarda con guardar_resumen_del_dia (area = "marketing"). Marketing NO manda WhatsApp: su línea
  va dentro del mensaje de las 7:30 que arma Ventas. Solo LEE Meta Ads (eso lo traba aizen1, no el CRM).

  El Agente de Sistemas (tercera área, mismo molde) revisa al día siguiente de cada subida si lo construido funciona. Solo LEE:
    - revision_de_sistemas (lee)   → tarjetas HECHO de 24 h con su commit, atascadas, en ERROR, si el trabajador está vivo y (dias) lo subido y su uso.
    - agente_de_sistemas (lee)     → el estado, el resumen de hoy, su línea, qué falla, lo atascado y el último informe de Uso.
  Su resumen se guarda con guardar_resumen_del_dia (area = "sistemas"); su línea va en el mensaje de las 7:30 si su interruptor está prendido.

  Los tres leen el CEREBRO (la carpeta "Magilus" del Drive) antes de recomendar, SOLO su parte:
    - cerebro_del_area (lee)             → sus carpetas + Decisiones de Magilus + su "Aprendizajes de <área>"; rechaza lo demás.
    - cerebro_anotar_aprendizaje (escribe) → SOLO agrega al final de aprendizajes-AAAA-MM.md en su carpeta de aprendizajes.
    - cerebro_marcar_dato_viejo (escribe)  → alerta Observación en el Supervisor cuando el cerebro choca con el CRM o Gestión.
  Ninguna cambia un dato ni escribe decisiones. Ver features/agentes-de-area/servicios/cerebro-del-area.ts.

  Nunca le escribe a un cliente. No toca el bot, el libro V3, los flujos ni Meta Ads.
*/

type Contexto = { workspaceId: string; userId: string };
type Argumentos = Record<string, unknown>;

const AREA: Area = "ventas";

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const ESCRITURA = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const HERRAMIENTAS_MCP_AGENTES_DE_AREA = [
  {
    name: "numeros_de_ventas",
    title: "Números de ventas del día",
    description:
      "Los números de UN día (por defecto ayer, hora de Colombia) POR ASESORA: chats atendidos, cotizaciones (las REALES: las que se crearon ese día en Gestión por esa vendedora, igual que listar_cotizaciones; null si Gestión no respondió), chats calientes (chats que llegaron a Tibio o Caliente: Propuesta, Negociación o Ganado; NO son cotizaciones), ventas (la venta cuenta en la línea de ventas, a nombre de quien vendió; la línea Admin nunca suma y un teléfono es una sola venta), tasa de cierre y tiempo de respuesta (mediana en minutos), más los avisos que detectó el Supervisor ese día. También MIDE los sugeridos del último resumen guardado: a cuáles les escribió el equipo, cuáles respondieron y cuáles compraron. Trae también `tasa_respuesta_bienvenida`: de los leads nuevos del día (todos los que entraron, sin importar su etapa), qué % mandó al menos un mensaje más después del primero y qué % lo hizo en menos de 2 horas, en total, por línea y por anuncio, con la meta de 60 %, separando los que respondieron la bienvenida, los recuperados por cada seguimiento (15 min, 1 hora, 1 día) y los que nunca respondieron, y la serie de los últimos 14 días (null = sin dato). Así el agente no abre los chats uno por uno. Trae también `leads_nuevos`: los clientes cuyo primer mensaje de la vida cae ese día (un cliente cuenta una vez aunque escriba por dos líneas, y la línea Admin también entra), con el total, por_origen (meta, marketplace con por_texto y por_linea, directo), por_linea (admin, ventas_1, ventas_2, solo_ventas = Ventas 1 + 2; Marketplace por línea = Ventas 2) y por_asesora (más sin_asignar). Las ventas, abonos y saldos de dinero NO salen de aquí: se leen en el MCP de Gestión. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, ayer." },
        sugeridos_de: { type: "string", description: "AAAA-MM-DD del resumen cuyos sugeridos se miden. Por defecto, el último resumen anterior a hoy que tenga sugeridos." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "guardar_resumen_del_dia",
    title: "Guardar el resumen del día del Agente de Ventas",
    description:
      "Guarda el resumen del día: números de ayer, meta de hoy, lo que entregó cada subagente (objeto con una clave por subagente: cerrador, cobrador, analista-de-perdidos), los clientes sugeridos a cada asesora (para medirlos mañana: asesora, conversacionId, numero, cliente), los mensajes que quedan listos para mandar y si la corrida salió tarde. Si ya hay un resumen de ese día, se REEMPLAZA. No manda ningún mensaje. Con es_prueba=true queda marcado como corrida de prueba. Con area=\"marketing\" guarda el resumen del Agente de Marketing: la tabla por campaña y anuncio va en numeros, y se agregan linea (UNA línea para Alexander) y recomendacion (máximo UNA: subir, bajar o cambiar un anuncio, con el dato que la sustenta; nunca pausar para que reaprenda). Con area=\"sistemas\" guarda el resumen del Agente de Sistemas: revisiones (FUNCIONA / FALLA con el error exacto / NO SE PUEDE PROBAR con el porqué), salud, linea y arreglos.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", enum: ["ventas", "marketing", "sistemas"], description: "Por defecto, ventas." },
        revisiones: {
          type: "array",
          description: "Solo sistemas: una por tarjeta HECHO revisada.",
          items: {
            type: "object",
            properties: {
              tarjetaId: { type: "string" },
              titulo: { type: "string" },
              repo: { type: "string" },
              commit: { type: "string" },
              resultado: { type: "string", enum: ["FUNCIONA", "FALLA", "NO SE PUEDE PROBAR"] },
              detalle: { type: "string", description: "FALLA: el error exacto. NO SE PUEDE PROBAR: el porqué." },
            },
            required: ["titulo", "resultado"],
          },
        },
        salud: { description: "Solo sistemas: la salud del sistema (objeto libre)." },
        arreglos: {
          type: "array",
          description: "Solo sistemas: las tarjetas de arreglo POR_APROBAR creadas, o las que 'se crearía' (interruptor apagado o prueba).",
          items: {
            type: "object",
            properties: { titulo: { type: "string" }, commit: { type: "string" }, estado: { type: "string", enum: ["creada", "se_crearia"] }, tarjetaId: { type: "string" } },
            required: ["titulo"],
          },
        },
        linea: { type: "string", description: "Marketing o sistemas: UNA línea para el mensaje de las 7:30 (sistemas: 'Sistemas: todo funciona' o lo roto)." },
        recomendacion: {
          type: "object",
          description: "Solo marketing: máximo UNA recomendación concreta.",
          properties: {
            accion: { type: "string", enum: ["subir", "bajar", "cambiar"] },
            texto: { type: "string" },
            dato: { type: "string", description: "El dato que sustenta la recomendación." },
          },
          required: ["accion", "texto", "dato"],
        },
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hoy." },
        es_prueba: { type: "boolean", description: "true = corrida de prueba." },
        salio_tarde: { type: "boolean", description: "true si la corrida arrancó después de las 7:00 a. m." },
        nota_de_retraso: { type: "string", description: "Ej. 'aizen1 prendió a las 8:12'." },
        numeros: { description: "Números de ayer por asesora y totales (objeto libre)." },
        meta: { description: "Meta de hoy (objeto libre)." },
        subagentes: { type: "object", description: "Lo que entregó cada subagente, una clave por subagente." },
        sugeridos: {
          type: "array",
          description: "Clientes sugeridos a cada asesora.",
          items: {
            type: "object",
            properties: {
              asesora: { type: "string" },
              conversacionId: { type: "string" },
              numero: { type: "string" },
              cliente: { type: "string" },
            },
            required: ["asesora"],
          },
        },
        mensajes: {
          type: "array",
          description: "Los WhatsApp internos que quedan listos: uno a Alexander y uno por asesora.",
          items: {
            type: "object",
            properties: {
              tipo: { type: "string", enum: ["alexander", "asesora"] },
              numero: { type: "string" },
              destinatario: { type: "string" },
              texto: { type: "string" },
            },
            required: ["tipo", "numero", "texto"],
          },
        },
        resumen: { type: "string", description: "Texto del resumen para leer en la pantalla." },
      },
      additionalProperties: false,
    },
    annotations: ESCRITURA,
  },
  {
    name: "mandar_whatsapp_al_equipo",
    title: "Mandar un WhatsApp interno al equipo",
    description:
      "Manda UN WhatsApp interno desde la línea Admin, SOLO a un número de la lista del equipo (Mi empresa → Equipo). El servidor lo valida: un número que no es del equipo se rechaza ('ese número no es del equipo'), con el interruptor del Agente de Ventas apagado no sale nada ('interruptor apagado: no se mandó') y a cada persona le sale un solo mensaje por día ('ya se le mandó hoy'). Nunca a clientes. Lo que va a Alexander se guarda SIEMPRE en la página de Alertas y por WhatsApp solo sale si prioridad = urgente (mensaje corto con el link): el texto completo lo lee en la página. Cada intento queda anotado en la pantalla Agente de Ventas.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["alexander", "asesora"], description: "A quién va: Alexander (7:30) o una asesora (su lista del día)." },
        numero: { type: "string", description: "Número de WhatsApp con indicativo (solo dígitos)." },
        texto: { type: "string", description: "El mensaje, completo." },
        destinatario: { type: "string", description: "Nombre de la persona (solo para la pantalla)." },
        prioridad: { type: "string", enum: ["urgente", "alta", "media", "baja"], description: "Solo \"urgente\" sale por WhatsApp (corto, con el link a la página de Alertas). Sin prioridad o con otra, el mensaje a Alexander queda SOLO en la página de Alertas. No aplica a la lista del día de una asesora." },
        titulo: { type: "string", description: "Título corto de la alerta (máx. 90 caracteres): es lo que sale en el WhatsApp urgente. Sin título se usa la primera línea del texto." },
      },
      required: ["tipo", "numero", "texto"],
      additionalProperties: false,
    },
    annotations: ESCRITURA,
  },
  {
    name: "numeros_de_marketing",
    title: "Números de marketing por anuncio",
    description:
      "Las conversaciones NUEVAS por ANUNCIO de origen de UN día (por defecto ayer, hora de Colombia) o de los últimos 7 días (dias=7): cuántas llegaron, cuántas quedaron en Tibio/Caliente (temperatura del sistema y etapa de la asesora), cuántas son venta (GANADO, con su cotización de Gestión), cuántas NO tuvieron respuesta y en cuánto se respondió la primera vez, y cuántas son de fuera de Colombia. Con un solo día trae además los primeros mensajes cortos de cada cliente (precio, ciudad, envío) para separar clientes reales de curiosos. Dice cuántas conversaciones NO tienen anuncio de origen y el porcentaje. El CRM guarda el anuncio, no la campaña: la campaña se une leyendo Meta. El gasto sale de Meta, no de aquí. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia): último día del rango. Por defecto, ayer." },
        dias: { type: "number", enum: [1, 7], description: "1 = solo ese día (con primeros mensajes); 7 = los últimos 7 días. Por defecto, 1." },
      },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "agente_de_marketing",
    title: "Ver el Agente de Marketing",
    description:
      "Para leer en voz alta: si el interruptor del Agente de Marketing está prendido o apagado, el resumen de hoy (o de la fecha pedida) con su línea para Alexander y su recomendación, la tabla por campaña y anuncio, lo que entregó cada subagente y los últimos días. El Agente de Ventas lo lee para saber qué campañas traen clientes calientes. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: { fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hoy." } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "revision_de_sistemas",
    title: "Datos para la revisión de sistemas",
    description:
      "Los datos del Tablero IA ya cruzados para el Agente de Sistemas: las tarjetas que quedaron HECHO en las últimas 24 horas (de todos los tableros y de los repos aizencrm y gestion) con su título, detalle, repo, commit, rama, la hora en que quedaron HECHO y las pantallas que tocaron; las tarjetas atascadas más de 2 h en PLANEANDO / EN_CURSO / SUBIENDO; las que están en ERROR con su motivo; y si el trabajador está vivo (última vez que usó su clave; 'sin señal desde…' si pasaron más de 30 min). Con dias (7 a 90) agrega lo subido en ese tiempo y lo que se usó de cada cosa (visitas a pantallas y llamadas a herramientas, del contador de uso). Solo lectura.",
    inputSchema: {
      type: "object",
      properties: { dias: { type: "number", description: "7 a 90: agrega lo subido en esos días y su uso. Sin esto, solo las últimas 24 h." } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "agente_de_sistemas",
    title: "Ver el Agente de Sistemas",
    description:
      "Para leer en voz alta: si el interruptor del Agente de Sistemas está prendido o apagado, el resumen de hoy (o de la fecha pedida) con su línea para Alexander, qué falla y qué no se pudo probar, lo atascado, las tarjetas de arreglo, el último informe de Uso y los últimos días. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: { fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hoy." } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "cerebro_del_area",
    title: "Consultar el cerebro de mi área",
    description:
      "El cerebro del negocio (carpeta Magilus del Drive) pero SOLO la parte de tu área, para consultarlo ANTES de recomendar: Ventas lee Ventas, Precios y Equipo; Marketing lee Marketing y Precios; Sistemas lee Tecnología; los tres leen además \"Decisiones de Magilus\" y su propia carpeta \"Aprendizajes de <área>\". Sin más datos devuelve la lista de tus documentos y el texto de las decisiones. Con busqueda trae los mejores fragmentos; con documento_id lee un documento completo. Un documento de otra carpeta se rechaza. Cita el documento (su ruta) en tu recomendación y no contradigas las decisiones. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", enum: ["ventas", "marketing", "sistemas"], description: "Tu área." },
        busqueda: { type: "string", description: "Opcional: palabras a buscar en tus carpetas." },
        documento_id: { type: "string", description: "Opcional: el id de un documento de tu lista, para leerlo completo." },
        desde_drive: { type: "boolean", description: "true = leerlo ahora del Drive. Por defecto, la copia de la última sincronización." },
      },
      required: ["area"],
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
  {
    name: "cerebro_anotar_aprendizaje",
    title: "Anotar un aprendizaje en el cerebro",
    description:
      "Anota lo que descubriste (unas pocas líneas, con fecha) en el cerebro, SOLO en tu carpeta \"Aprendizajes de <área>\": el servidor lo AGREGA al final del archivo aprendizajes-AAAA-MM.md del mes (lo crea si falta). Nunca reemplaza ni borra, nunca escribe en \"Decisiones de Magilus\" ni en otra carpeta, y si la carpeta de aprendizajes no existe en el Drive no la crea: avisa para que el dueño la cree. Cada anotación queda en el registro de cambios del cerebro. Como máximo unas pocas líneas al día.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", enum: ["ventas", "marketing", "sistemas"], description: "Tu área." },
        texto: { type: "string", description: "Lo que descubriste, claro y corto (máximo 1.500 letras). Sin decisiones del negocio." },
      },
      required: ["area", "texto"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "cerebro_marcar_dato_viejo",
    title: "Marcar un posible dato viejo",
    description:
      "Cuando lo que dice el cerebro choca con un dato del CRM o de Gestión, márcalo aquí y NO cambies nada: crea una alerta en la página del Supervisor (familia CEREBRO, nivel Observación, sin push ni WhatsApp) titulada \"Posible dato viejo: …\". Hay una sola alerta abierta por documento y dato: si la vuelves a marcar, solo suma \"vista N veces\". El dueño decide cuál dato está al día. No cambia ningún dato.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", enum: ["ventas", "marketing", "sistemas"], description: "Tu área." },
        documento: { type: "string", description: "La ruta del documento del cerebro, tal como la dio cerebro_del_area (ej. 'Precios/Lista de precios.md')." },
        dato: { type: "string", description: "Nombre corto del dato que choca (ej. 'precio de la camilla'). Por defecto, lo que dice el cerebro." },
        lo_que_dice_el_cerebro: { type: "string", description: "Lo que dice el cerebro." },
        lo_que_dice_el_sistema: { type: "string", description: "Lo que dice el CRM o Gestión." },
        fuente: { type: "string", enum: ["crm", "gestion"], description: "De cuál salió el dato que choca." },
      },
      required: ["area", "documento", "lo_que_dice_el_cerebro", "lo_que_dice_el_sistema", "fuente"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "agente_de_ventas",
    title: "Ver el Agente de Ventas",
    description:
      "Para leer en voz alta: si el interruptor del Agente de Ventas está prendido o apagado, el resumen de hoy (o de la fecha pedida), lo que entregó cada subagente, qué mensajes salieron o se bloquearon (con el motivo) y los últimos días. Solo lectura.",
    inputSchema: {
      type: "object",
      properties: { fecha: { type: "string", description: "AAAA-MM-DD (hora de Colombia). Por defecto, hoy." } },
      additionalProperties: false,
    },
    annotations: SOLO_LECTURA,
  },
] as const;

const NOMBRES = new Set<string>(HERRAMIENTAS_MCP_AGENTES_DE_AREA.map((herramienta) => herramienta.name));

export function esHerramientaDeAgentesDeArea(nombre: string) {
  return NOMBRES.has(nombre);
}

async function exigirPermiso(contexto: Contexto) {
  if (!(await puedeVerElSupervisor(contexto))) {
    throw new Error("Esta clave no tiene permiso para los agentes de área: es solo del dueño, los administradores y la supervisora.");
  }
}

function leerFecha(args: Argumentos, clave: string, porDefecto: string): string {
  const valor = args[clave];
  if (valor === undefined || valor === null || valor === "") return porDefecto;
  if (!fechaValida(valor)) throw new Error(`La fecha "${clave}" tiene que ir como AAAA-MM-DD.`);
  return valor;
}

async function verNumeros(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const hoy = hoyEnBogota();
  const fecha = leerFecha(args, "fecha", diaAnterior(hoy));
  const noSePudoLeer: string[] = [];
  const intentar = async <T>(nombre: string, leer: () => Promise<T>, vacio: T): Promise<T> => {
    try {
      return await leer();
    } catch (error) {
      noSePudoLeer.push(`${nombre}: ${error instanceof Error ? error.message : String(error)}`);
      return vacio;
    }
  };
  const numeros = await intentar("números por asesora", () => numerosDelDia(contexto.workspaceId, fecha), { filas: [], avisos: [] });
  const porAsesora = numeros.filas;
  noSePudoLeer.push(...numeros.avisos);
  const supervisor = await intentar("avisos del Supervisor", () => avisosDelSupervisor(contexto.workspaceId, fecha), null);
  const sugeridosDe = args.sugeridos_de !== undefined && args.sugeridos_de !== "" ? leerFecha(args, "sugeridos_de", hoy) : null;
  const sugeridos = await intentar(
    "sugeridos de ayer",
    async () => {
      if (sugeridosDe) return medirLosSugeridosDe(contexto.workspaceId, AREA, sugeridosDe);
      let dia = diaAnterior(hoy);
      for (let i = 0; i < 7; i += 1) {
        const medida = await medirLosSugeridosDe(contexto.workspaceId, AREA, dia);
        if (medida) return medida;
        dia = diaAnterior(dia);
      }
      return null;
    },
    null,
  );
  const bienvenida = await intentar("tasa de respuesta a la bienvenida", () => numerosDeRespuestaBienvenida(contexto.workspaceId, fecha), null);
  const leadsNuevos = await intentar("leads nuevos", () => leadsNuevosDelDia(contexto.workspaceId, fecha), null);
  // Si Gestión no respondió, las cotizaciones quedan en null: no se muestra el número de chats calientes con esa etiqueta.
  const gestionNoRespondio = numeros.avisos.length > 0;
  const total = porAsesora.reduce(
    (suma, fila) => ({
      chatsAtendidos: suma.chatsAtendidos + fila.chatsAtendidos,
      cotizaciones: suma.cotizaciones === null ? null : suma.cotizaciones + (fila.cotizaciones ?? 0),
      chatsCalientes: suma.chatsCalientes + fila.chatsCalientes,
      ventas: suma.ventas + fila.ventas,
    }),
    { chatsAtendidos: 0, cotizaciones: (gestionNoRespondio ? null : 0) as number | null, chatsCalientes: 0, ventas: 0 },
  );
  return {
    fecha,
    por_asesora: porAsesora,
    total,
    avisos_del_supervisor: supervisor,
    sugeridos_medidos: sugeridos,
    tasa_respuesta_bienvenida: bienvenida
      ? {
          fecha: bienvenida.fecha,
          meta_por_ciento: bienvenida.delDia.metaPorCiento,
          total: bienvenida.delDia,
          por_linea: bienvenida.delDia.porLinea,
          por_anuncio: bienvenida.delDia.porAnuncio,
          como_leerlo: "respondieronLaBienvenida = contestaron antes de cualquier seguimiento; recuperados = escribieron solo después de un seguimiento (recuperadosPorSeguimiento: min15, hora1, dia1); nuncaRespondieron = jamás escribieron. Si dia1 sube de 0, el seguimiento de 1 día sí recupera clientes.",
          serie_14_dias: bienvenida.serie.map(({ porLinea, porAnuncio, ...dia }) => ({ ...dia, por_linea: porLinea })),
          conversaciones_sin_registro: bienvenida.conversacionesSinRegistro,
          advertencias: bienvenida.advertencias,
        }
      : null,
    leads_nuevos: leadsNuevos
      ? {
          total: leadsNuevos.total,
          por_origen: leadsNuevos.por_origen,
          por_linea: leadsNuevos.por_linea,
          por_asesora: leadsNuevos.por_asesora,
          sin_asignar: leadsNuevos.sin_asignar,
          como_leerlo:
            "Lead nuevo = el primer mensaje de la vida del cliente cae ese día (hora de Colombia). Un cliente cuenta una vez aunque escriba por dos líneas, y la línea Admin también cuenta. solo_ventas = Ventas 1 + Ventas 2. Marketplace por línea = Ventas 2.",
          advertencias: leadsNuevos.advertencias,
        }
      : null,
    advertencias: [
      "Las ventas aquí son cambios de etapa a GANADO en el CRM; el dinero (ventas, abonos, saldos) se lee en el MCP de Gestión.",
      "Cotizaciones = las creadas ese día en Gestión por cada vendedora (cruzadas con la asesora por nombre; una vendedora sin asesora en el CRM sale en su propia fila). Si dice null, Gestión no respondió: míralo en no_se_pudo_leer y no lo reemplaces con otro número.",
      "Chats calientes = chats que llegaron a Tibio o Caliente ese día (Propuesta, Negociación o Ganado en el CRM). No son cotizaciones.",
      "Leads nuevos = clientes cuyo primer mensaje de la vida cae ese día, por cualquier línea (Admin incluida); un cliente cuenta una vez aunque escriba por dos líneas. solo_ventas = Ventas 1 + Ventas 2. Marketplace por línea = Ventas 2. Si dice null, la lectura falló: míralo en no_se_pudo_leer.",
      "Chats atendidos = chats con al menos un mensaje saliente humano ese día, por la asesora a la que están asignados HOY.",
    ],
    ...(noSePudoLeer.length ? { no_se_pudo_leer: noSePudoLeer } : {}),
  };
}

async function guardarResumen(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const pedida = args.area === undefined || args.area === null || args.area === "" ? AREA : args.area;
  if (!esArea(pedida)) throw new Error('El área tiene que ser "ventas", "marketing" o "sistemas".');
  const area: Area = pedida;
  const resumen = leerResumenAGuardar(args, hoyEnBogota(), area);
  const guardado = await guardarResumenDelDia(contexto.workspaceId, area, resumen);
  return {
    area,
    guardado: true,
    fecha: resumen.fecha,
    id: guardado.id,
    es_prueba: resumen.esPrueba,
    subagentes: Object.keys(resumen.subagentes),
    sugeridos: resumen.sugeridos.length,
    mensajes_listos: resumen.mensajes.length,
    nota: "No se mandó ningún mensaje: para mandar usar mandar_whatsapp_al_equipo.",
  };
}

async function mandarAlEquipo(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const leido = leerPedidoDeEnvio(args);
  if (!leido.ok) throw new Error(leido.error);
  const resultado = await mandarWhatsAppAlEquipo({ workspaceId: contexto.workspaceId, area: AREA, pedido: leido.pedido });
  return {
    se_mando: resultado.ok,
    estado: resultado.estado,
    ...(resultado.soloEnPagina ? { guardada_en_alertas: true } : {}),
    ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
    mensaje: resultado.ok ? "Mensaje enviado." : resultado.motivo,
  };
}

async function verNumerosDeMarketing(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const fecha = leerFecha(args, "fecha", diaAnterior(hoyEnBogota()));
  const dias = args.dias === 7 || args.dias === "7" ? 7 : 1;
  return numerosDeMarketing(contexto.workspaceId, fecha, dias);
}

/** La línea para Alexander y la recomendación viajan dentro de `meta` del resumen de marketing. */
function lineaYRecomendacion(meta: unknown) {
  const datos = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  return { linea_para_alexander: datos.linea ?? null, recomendacion: datos.recomendacion ?? null };
}

async function verRevisionDeSistemas(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const dias = args.dias === undefined || args.dias === null || args.dias === "" ? null : Number(args.dias);
  if (dias !== null && !Number.isFinite(dias)) throw new Error('"dias" tiene que ser un número de 7 a 90.');
  return datosDeRevision(contexto.workspaceId, { dias });
}

/** Lo propio de Sistemas dentro de `meta`: línea, revisiones, salud y arreglos; y de las revisiones, qué falla y qué no se pudo probar. */
function datosDeSistemas(meta: unknown) {
  const datos = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  const revisiones = Array.isArray(datos.revisiones) ? (datos.revisiones as Array<Record<string, unknown>>) : [];
  return {
    linea_para_alexander: datos.linea ?? null,
    revisiones,
    falla: revisiones.filter((r) => r.resultado === "FALLA"),
    no_se_pudo_probar: revisiones.filter((r) => r.resultado === "NO SE PUEDE PROBAR"),
    salud: datos.salud ?? null,
    tarjetas_de_arreglo: datos.arreglos ?? [],
  };
}

async function verAgente(args: Argumentos, contexto: Contexto, area: Area = "ventas") {
  await exigirPermiso(contexto);
  const ws = contexto.workspaceId;
  const fecha = leerFecha(args, "fecha", hoyEnBogota());
  const [activo, resumen, envios, ultimos, informeDeUso, vivo] = await Promise.all([
    agenteActivo(area, ws),
    leerResumenDelDia(ws, area, fecha),
    leerEnviosDelDia(ws, area, fecha),
    leerUltimosResumenes(ws, area, 14),
    area === "sistemas" ? leerUltimaEntregaDe(ws, area, "uso", 14).catch(() => null) : Promise.resolve(null),
    area === "sistemas" ? datosDeRevision(ws).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    agente: ETIQUETA_DE_AREA[area],
    interruptor: activo ? "prendido" : "apagado",
    fecha,
    resumen_del_dia: resumen
      ? {
          es_prueba: resumen.esPrueba,
          salio_tarde: resumen.salioTarde,
          nota_de_retraso: resumen.notaDeRetraso,
          resumen: resumen.resumen,
          numeros: resumen.numeros,
          meta: resumen.meta,
          ...(area === "marketing" ? lineaYRecomendacion(resumen.meta) : {}),
          ...(area === "sistemas" ? datosDeSistemas(resumen.meta) : {}),
          subagentes: resumen.subagentes,
          sugeridos: resumen.sugeridos,
          guardado_en: resumen.actualizadoEn,
        }
      : null,
    ...(area === "sistemas"
      ? {
          atascadas_ahora: vivo ? (vivo as { atascadas: unknown }).atascadas : null,
          trabajador_ahora: vivo ? (vivo as { trabajador: unknown }).trabajador : null,
          ultimo_informe_de_uso: informeDeUso,
        }
      : {}),
    mensajes: envios.map((envio) => ({
      tipo: envio.tipo,
      destinatario: envio.destinatario,
      estado: envio.estado,
      motivo: envio.motivo,
      texto: envio.texto,
      en: envio.creadoEn,
    })),
    ultimos_dias: ultimos.map((dia) => ({ fecha: dia.fecha, es_prueba: dia.esPrueba, salio_tarde: dia.salioTarde, resumen: dia.resumen })),
    advertencias:
      area === "sistemas"
        ? [
            "El Agente de Sistemas corre en aizen1 y solo LEE: no modifica código, no hace deploy, no aprueba ni cambia estados de tarjetas.",
            "El contador de uso empieza a contar el día que se subió; lo de antes no tiene uso medido.",
            ...(activo ? [] : ["Con el interruptor apagado el agente genera el resumen, pero su línea NO va en el mensaje de las 7:30 y las tarjetas de arreglo solo quedan escritas como 'se crearía'."]),
          ]
        : area === "marketing"
        ? [
            "El Agente de Marketing corre en aizen1 y solo LEE Meta Ads: no pausa, prende, edita ni crea nada.",
            "Si falta el anuncio de origen en muchos chats, el costo por venta sale incompleto.",
            ...(activo ? [] : ["Con el interruptor apagado el agente genera el resumen, pero su línea NO va en el mensaje de las 7:30."]),
          ]
        : [
            "El Agente de Ventas corre en aizen1: si aizen1 está apagado, no hay resumen.",
            ...(activo ? [] : ["Con el interruptor apagado el agente genera el resumen pero el servidor no deja salir ningún WhatsApp."]),
          ],
  };
}

/** El área de las herramientas del cerebro: la dice el agente (los tres usan la misma clave), así que se valida. */
function leerAreaDelCerebro(args: Argumentos): Area {
  if (!esArea(args.area)) throw new Error('El área tiene que ser "ventas", "marketing" o "sistemas".');
  return args.area;
}

const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");

async function verCerebroDelArea(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const area = leerAreaDelCerebro(args);
  return leerCerebroDelArea(contexto.workspaceId, {
    area,
    busqueda: texto(args.busqueda),
    documentoId: texto(args.documento_id),
    desdeDrive: args.desde_drive === true,
  });
}

async function anotarEnElCerebro(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const area = leerAreaDelCerebro(args);
  const resultado = await anotarAprendizaje({ workspaceId: contexto.workspaceId, userId: contexto.userId, area, texto: args.texto });
  return resultado.anotado
    ? { ...resultado, nota: `Anotado por el ${ETIQUETA_DE_AGENTE[area]}. Solo se agregó al final; nada se reemplazó ni se borró.` }
    : resultado;
}

async function marcarDatoViejoDelCerebro(args: Argumentos, contexto: Contexto) {
  await exigirPermiso(contexto);
  const area = leerAreaDelCerebro(args);
  const leido = leerPedidoDeDatoViejo(area, args);
  if (!leido.ok) throw new Error(leido.error);
  return marcarDatoViejo(contexto.workspaceId, leido.pedido);
}

export async function ejecutarHerramientaMcpAgentesDeArea(nombre: string, argumentos: Argumentos, contexto: Contexto): Promise<unknown> {
  switch (nombre) {
    case "numeros_de_ventas":
      return verNumeros(argumentos, contexto);
    case "guardar_resumen_del_dia":
      return guardarResumen(argumentos, contexto);
    case "mandar_whatsapp_al_equipo":
      return mandarAlEquipo(argumentos, contexto);
    case "numeros_de_marketing":
      return verNumerosDeMarketing(argumentos, contexto);
    case "agente_de_marketing":
      return verAgente(argumentos, contexto, "marketing");
    case "revision_de_sistemas":
      return verRevisionDeSistemas(argumentos, contexto);
    case "agente_de_sistemas":
      return verAgente(argumentos, contexto, "sistemas");
    case "agente_de_ventas":
      return verAgente(argumentos, contexto);
    case "cerebro_del_area":
      return verCerebroDelArea(argumentos, contexto);
    case "cerebro_anotar_aprendizaje":
      return anotarEnElCerebro(argumentos, contexto);
    case "cerebro_marcar_dato_viejo":
      return marcarDatoViejoDelCerebro(argumentos, contexto);
    default:
      throw new Error(`No existe la herramienta "${nombre}".`);
  }
}
