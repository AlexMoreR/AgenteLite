import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { etiquetaDeSemana, semanaPedida, semanaPorDefecto, sumarDias } from "@/features/embudo/dominio/semanal";
import { LeadsDeRecuperacionVista, type ChipDeGrupo, type ItemDeLista } from "@/features/recuperacion/components/leads-de-recuperacion";
import { SemanaDeRecuperacionVista } from "@/features/recuperacion/components/semana-de-recuperacion";
import {
  GRUPOS_EN_SEGUIMIENTO,
  leadsEnSeguimiento,
  razonEnSeguimiento,
  resumirEnSeguimiento,
  type EnSeguimientoAhora,
} from "@/features/recuperacion/dominio/en-seguimiento";
import {
  GRUPOS_DE_LEADS,
  GRUPOS_DE_TAREAS,
  PAGINA,
  cuantosVer,
  enviosDelTipo,
  esGrupoDeTareas,
  esGrupoEnSeguimiento,
  estaEnElGrupo,
  explicacionDeGrupo,
  grupoPedido,
  hrefDeRecuperacion,
  leadsDelGrupo,
  nombreDeGrupo,
  ordenarTareas,
  tareasDelGrupo,
  tareasPorAsesora,
  type Grupo,
  type GrupoDeLeads,
  type ParamsDeRecuperacion,
  type TareaVencida,
} from "@/features/recuperacion/dominio/listas";
import {
  resumirSemana,
  type ClaseDeSeguimiento,
  type LeadDeRecuperacion,
  type SemanaDeRecuperacion,
} from "@/features/recuperacion/dominio/semana";
import { leerAlarmaDeHoy, leerTareasVencidas, ultimosMensajesDelCliente } from "@/features/recuperacion/servicios/alarma";
import { leerEnSeguimientoAhora } from "@/features/recuperacion/servicios/en-seguimiento";
import { puedeVerRecuperacion } from "@/features/recuperacion/servicios/permiso";
import { leerSemanaDeRecuperacion } from "@/features/recuperacion/servicios/semana";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function texto(valor: string | string[] | undefined): string {
  return typeof valor === "string" ? valor : "";
}

/**
 * RECUPERACIÓN DE LEADS. Solo dueño / administrador y la supervisora del Supervisor accionable.
 *  - "Semana" (por defecto): la semana pasada completa (lunes a domingo, hora Bogotá);
 *    ?semana=AAAA-MM-DD (un lunes) para otra.
 *  - "Leads" (?vista=leads&grupo=…): los chats detrás de cada número, con "Abrir chat". Usa la
 *    MISMA lectura de la semana (en memoria) y, para tareas vencidas, el mismo filtro de la alarma.
 * Las lecturas quedan 10 min en memoria (la alarma y sus tareas, 5).
 */
export default async function RecuperacionPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!(await puedeVerRecuperacion(access))) {
    redirect("/cliente/crm/mi-dia");
  }

  const params = await searchParams;
  const ahora = new Date();
  const lunes = semanaPedida(texto(params.semana), ahora);
  const lunesAnterior = sumarDias(lunes, -7);
  const porDefecto = semanaPorDefecto(ahora);
  const siguiente = sumarDias(lunes, 7);
  const enLeads = texto(params.vista) === "leads";
  const grupo = grupoPedido(texto(params.grupo));
  const asesora = texto(params.asesora).trim() || null;
  const ver = cuantosVer(texto(params.ver));

  const href = (p: Partial<ParamsDeRecuperacion>) => hrefDeRecuperacion({ semana: lunes, ...p }, porDefecto);
  const hrefGrupo = (destino: Grupo) => href({ vista: "leads", grupo: destino });
  const vistaActual = enLeads ? ({ vista: "leads", grupo } as const) : {};
  const encabezado = {
    etiquetaSemana: etiquetaDeSemana(lunes),
    hrefSemanaAnterior: href({ ...vistaActual, semana: lunesAnterior }),
    hrefSemanaSiguiente: siguiente <= porDefecto ? href({ ...vistaActual, semana: siguiente }) : null,
    hrefVistaSemana: href({}),
    hrefVistaLeads: href({ vista: "leads", grupo: enLeads ? grupo : "llegaron" }),
  };

  if (!enLeads) {
    const [actual, anterior, alarma, enSeguimiento] = await Promise.all([
      leerSemanaDeRecuperacion(access.workspaceId, lunes),
      leerSemanaDeRecuperacion(access.workspaceId, lunesAnterior),
      leerAlarmaDeHoy(access.workspaceId).catch(() => null),
      leerEnSeguimientoAhora(access.workspaceId).catch(() => null),
    ]);
    const semana = resumirSemana(actual.leads, ahora);
    const semanaAnterior = resumirSemana(anterior.leads, ahora);
    return (
      <SemanaDeRecuperacionVista
        encabezado={encabezado}
        etiquetaAnterior={etiquetaDeSemana(lunesAnterior)}
        hrefGrupo={hrefGrupo}
        alarma={alarma}
        enSeguimiento={enSeguimiento ? resumirEnSeguimiento(enSeguimiento) : null}
        semana={semana}
        anterior={semanaAnterior.llegaron > 0 ? semanaAnterior : null}
      />
    );
  }

  const esTareas = esGrupoDeTareas(grupo);
  const [actual, alarma, tareas, enSeguimiento] = await Promise.all([
    leerSemanaDeRecuperacion(access.workspaceId, lunes),
    esTareas ? Promise.resolve(null) : leerAlarmaDeHoy(access.workspaceId).catch(() => null),
    esTareas ? leerTareasVencidas(access.workspaceId) : Promise.resolve(null),
    esGrupoEnSeguimiento(grupo) ? leerEnSeguimientoAhora(access.workspaceId) : leerEnSeguimientoAhora(access.workspaceId).catch(() => null),
  ]);
  const semana = resumirSemana(actual.leads, ahora);
  const chips = armarChips({
    semana,
    leads: actual.leads,
    ahora,
    tareas,
    alarma: alarma ? { vencidas: alarma.vencidas, llamadas72: alarma.llamadas72h } : null,
    enSeguimiento: enSeguimiento ? resumirEnSeguimiento(enSeguimiento) : null,
    hrefGrupo,
  });
  const comun = { encabezado, grupo, titulo: nombreDeGrupo(grupo), chips, ahora };

  if (esGrupoEnSeguimiento(grupo)) {
    const lista = leadsEnSeguimiento(enSeguimiento ?? [], grupo);
    const items = lista.slice(0, ver).map(
      (lead): ItemDeLista => ({
        conversationId: lead.conversationId,
        ...lead.ficha,
        ultimoClienteEn: lead.ultimoClienteEn,
        razon: razonEnSeguimiento(lead, ahora),
      }),
    );
    return (
      <LeadsDeRecuperacionVista
        {...comun}
        explicacion={explicacionDeGrupo(grupo)}
        total={lista.length}
        items={items}
        hrefVerMas={lista.length > ver ? href({ vista: "leads", grupo, ver: ver + PAGINA }) : null}
      />
    );
  }

  if (esGrupoDeTareas(grupo)) {
    const delGrupo = tareasDelGrupo(tareas ?? [], grupo);
    const asesoras = tareasPorAsesora(delGrupo);
    const activa = asesora && asesoras.some((a) => a.asesora === asesora) ? asesora : null;
    const ordenadas = ordenarTareas(delGrupo, activa);
    const visibles = ordenadas.slice(0, ver);
    const ultimos = await ultimosMensajesDelCliente(visibles.map((t) => t.conversationId)).catch(
      () => new Map<string, { texto: string | null; en: Date | null }>(),
    );
    const items = visibles.map((t): ItemDeLista => {
      const ultimo = ultimos.get(t.conversationId);
      return { ...t, ultimoClienteEn: ultimo?.en ?? t.ultimoClienteEn, ultimoTexto: ultimo?.texto ?? null, razon: "" };
    });
    return (
      <LeadsDeRecuperacionVista
        {...comun}
        explicacion={explicacionDeGrupo(grupo)}
        total={ordenadas.length}
        items={items}
        hrefVerMas={ordenadas.length > ver ? href({ vista: "leads", grupo, asesora: activa, ver: ver + PAGINA }) : null}
        asesoras={asesoras.map((a) => ({ ...a, activa: a.asesora === activa, href: href({ vista: "leads", grupo, asesora: a.asesora }) }))}
        hrefTodasLasAsesoras={href({ vista: "leads", grupo })}
      />
    );
  }

  const lista = leadsDelGrupo(actual.leads, grupo, ahora);
  const items = lista.slice(0, ver).map(
    ({ lead, razon, ultimoClienteEn }): ItemDeLista => ({
      conversationId: lead.conversationId,
      nombre: lead.ficha?.nombre ?? null,
      telefono4: lead.ficha?.telefono4 ?? null,
      linea: lead.ficha?.linea ?? null,
      asesora: lead.ficha?.asesora ?? null,
      producto: lead.ficha?.producto ?? null,
      etapa: lead.ficha?.etapa ?? null,
      ultimoClienteEn,
      ultimoTexto: lead.ficha?.ultimoTexto ?? null,
      razon,
    }),
  );
  let explicacion = explicacionDeGrupo(grupo);
  if (grupo.startsWith("tipo:")) {
    const envios = enviosDelTipo(actual.leads, grupo.slice(5) as ClaseDeSeguimiento);
    explicacion = `${explicacion} ${envios.contestaron.toLocaleString("es-CO")} de ${envios.enviados.toLocaleString("es-CO")} envíos contestados.`;
  }
  return (
    <LeadsDeRecuperacionVista
      {...comun}
      explicacion={explicacion}
      total={lista.length}
      items={items}
      hrefVerMas={lista.length > ver ? href({ vista: "leads", grupo, ver: ver + PAGINA }) : null}
    />
  );
}

/** Los chips de arriba con su número: los de la semana salen de resumirSemana (= pantalla Semana). */
function armarChips(input: {
  semana: SemanaDeRecuperacion;
  leads: ReadonlyArray<LeadDeRecuperacion>;
  ahora: Date;
  tareas: ReadonlyArray<TareaVencida> | null;
  alarma: { vencidas: number; llamadas72: number } | null;
  enSeguimiento: EnSeguimientoAhora | null;
  hrefGrupo: (grupo: Grupo) => string;
}): ChipDeGrupo[] {
  const { semana, enSeguimiento } = input;
  const vivos: Record<(typeof GRUPOS_EN_SEGUIMIENTO)[number], number | null> = {
    en_seguimiento: enSeguimiento?.total ?? null,
    en_seguimiento_1: enSeguimiento?.uno ?? null,
    en_seguimiento_2: enSeguimiento?.dos ?? null,
    en_seguimiento_3: enSeguimiento?.tresOMas ?? null,
  };
  const chipsVivos: ChipDeGrupo[] = GRUPOS_EN_SEGUIMIENTO.map((g) => ({ grupo: g, nombre: nombreDeGrupo(g), total: vivos[g], href: input.hrefGrupo(g) }));
  const deLeads: Record<(typeof GRUPOS_DE_LEADS)[number], number> = {
    llegaron: semana.llegaron,
    seguimiento: semana.conSeguimiento,
    recuperados: semana.recuperados,
    callados72: semana.calladosMas72,
    compraron: semana.compraron,
    compraron_recuperados: semana.compraronRecuperados,
  };
  const chips: ChipDeGrupo[] = [...chipsVivos];
  chips.push(...GRUPOS_DE_LEADS.map((g) => ({ grupo: g, nombre: nombreDeGrupo(g), total: deLeads[g], href: input.hrefGrupo(g) })));
  for (const tipo of semana.tipos) {
    const g: GrupoDeLeads = `tipo:${tipo.clase}`;
    const total = input.leads.filter((lead) => estaEnElGrupo(lead, g, input.ahora)).length;
    chips.push({ grupo: g, nombre: nombreDeGrupo(g), total, href: input.hrefGrupo(g) });
  }
  for (const g of GRUPOS_DE_TAREAS) {
    const total = input.tareas
      ? tareasDelGrupo(input.tareas, g).length
      : input.alarma
        ? g === "vencidas"
          ? input.alarma.vencidas
          : input.alarma.llamadas72
        : null;
    chips.push({ grupo: g, nombre: nombreDeGrupo(g), total, href: input.hrefGrupo(g) });
  }
  return chips;
}
