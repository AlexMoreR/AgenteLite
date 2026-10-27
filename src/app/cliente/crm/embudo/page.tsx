import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { EmbudoSemanalVista } from "@/features/embudo/components/embudo-semanal";
import {
  FAMILIAS,
  armarEmbudo,
  esFamilia,
  etiquetaDeSemana,
  mayorFuga,
  nombreDeFamilia,
  semanaPedida,
  semanaPorDefecto,
  sumarDias,
  type ClaveDeFamilia,
} from "@/features/embudo/dominio/semanal";
import { chatsDeLaFuga, leerEmbudoSemanal } from "@/features/embudo/servicios/leer-embudo-semanal";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";

import { VistaClasicaDelEmbudo } from "./vista-clasica";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const texto = (valor: string | string[] | undefined) => (typeof valor === "string" ? valor : "");

/**
 * EMBUDO (para quien supervisa). Por defecto, el EMBUDO SEMANAL por familia de producto (diseño de
 * Alex del 12-10-2026): semana pasada completa, seis pasos desde los mensajes reales, la mayor
 * fuga con sus chats y la comparación con la semana anterior. Ver dominio/semanal.ts.
 *
 * Parámetros: ?semana=AAAA-MM-DD (un lunes) &familia=combo|marketplace|camillas|manicura|sillas|
 * lavacabezas|otros &ver=fuga (abre la lista de chats). ?vista=clasica = la pantalla anterior
 * completa (períodos libres, señales, "Historia").
 */
export default async function EmbudoPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  if (!esJefeDelNegocio(access)) {
    redirect("/cliente/crm/mi-dia");
  }

  const params = await searchParams;
  if (texto(params.vista) === "clasica") {
    return <VistaClasicaDelEmbudo access={access} params={params} />;
  }

  const ahora = new Date();
  const lunes = semanaPedida(texto(params.semana), ahora);
  const lunesAnterior = sumarDias(lunes, -7);
  const pedida = texto(params.familia);
  const familia: ClaveDeFamilia = esFamilia(pedida) ? pedida : "combo";
  const verFuga = texto(params.ver) === "fuga";

  const [actual, anterior] = await Promise.all([
    leerEmbudoSemanal(access.workspaceId, lunes),
    leerEmbudoSemanal(access.workspaceId, lunesAnterior),
  ]);

  const deFamilia = actual.leads.filter((lead) => lead.familia === familia);
  const embudo = armarEmbudo(deFamilia, ahora);
  const embudoAnterior = armarEmbudo(
    anterior.leads.filter((lead) => lead.familia === familia),
    ahora,
  );
  const fuga = mayorFuga(embudo);
  const chats = verFuga && fuga ? await chatsDeLaFuga(deFamilia, fuga.ids) : verFuga ? [] : null;

  const porDefecto = semanaPorDefecto(ahora);
  const href = (cambios: { semana?: string; familia?: string; ver?: string | null }) => {
    const query = new URLSearchParams();
    const semana = cambios.semana ?? lunes;
    if (semana !== porDefecto) query.set("semana", semana);
    const fam = cambios.familia ?? familia;
    if (fam !== "combo") query.set("familia", fam);
    if (cambios.ver) query.set("ver", cambios.ver);
    const cadena = query.toString();
    return `/cliente/crm/embudo${cadena ? `?${cadena}` : ""}`;
  };
  const siguiente = sumarDias(lunes, 7);

  return (
    <EmbudoSemanalVista
      etiquetaSemana={etiquetaDeSemana(lunes)}
      etiquetaAnterior={etiquetaDeSemana(lunesAnterior)}
      hrefSemanaAnterior={href({ semana: lunesAnterior })}
      hrefSemanaSiguiente={siguiente <= porDefecto ? href({ semana: siguiente }) : null}
      familias={FAMILIAS.map((item) => ({
        clave: item.clave,
        nombre: item.nombre,
        href: href({ familia: item.clave }),
        activa: item.clave === familia,
        leads: actual.leads.filter((lead) => lead.familia === item.clave).length,
      }))}
      nombreFamilia={nombreDeFamilia(familia)}
      embudo={embudo}
      anterior={embudoAnterior.llegaron > 0 ? embudoAnterior : null}
      fuga={fuga}
      hrefVerFuga={`${href({ ver: "fuga" })}#chats`}
      hrefCerrarFuga={href({})}
      chats={chats}
      hrefClasica="/cliente/crm/embudo?vista=clasica"
      ahora={ahora}
    />
  );
}
