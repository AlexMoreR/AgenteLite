import type { Metadata } from "next";
import Link from "next/link";
import { BellRing } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { ListaDeAlertas } from "@/features/alertas/components/ListaDeAlertas";
import {
  AREAS_DE_ALERTA,
  AREA_POR_DEFECTO,
  areaDeAlerta,
  contarAbiertasPorArea,
  idDeTarjetaDeLaClave,
  ESTADOS_DE_ALERTA,
  ETIQUETA_DE_ESTADO,
  ETIQUETA_DE_PRIORIDAD,
  PRIORIDADES,
  leerPrioridad,
  textoDeRepeticion,
  ultimaVezDe,
  type EstadoDeAlerta,
} from "@/features/alertas/dominio/reglas";
import { contarAlertas, leerAreasDeTarjetas, listarAlertas } from "@/features/alertas/servicios/alertas";
import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { esJefeDelNegocio } from "@/lib/permisos-del-crm";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Alertas", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const uno = (valor: string | string[] | undefined) => (Array.isArray(valor) ? valor[0] : valor)?.trim() || null;

/*
  ALERTAS: todas las alertas internas en un solo lugar, por prioridad (Urgente, Alta, Media, Baja) y, dentro de cada
  una, de la más nueva a la más vieja. Por WhatsApp solo llegan las urgentes, cortas y con el link a esta página.
  Filtros por link: ?estado=abiertas|nueva|vista|resuelta|todas (por defecto abiertas: oculta las resueltas) y
  ?prioridad=urgente|alta|media|baja. ?alerta=<id> abre la lista en "todas" y resalta esa alerta (el link de los WhatsApp al equipo).
  Dueño y administradores ven las del negocio y las suyas; cualquier otra persona del equipo, solo las suyas.
*/
export default async function AlertasPage({ searchParams }: PageProps) {
  const access = await requireClientWorkspaceAccess("crm", { redirectTo: "/cliente" });
  const mirando = { userId: access.userId, esJefe: esJefeDelNegocio(access) };

  const parametros = await searchParams;
  const alertaPedida = uno(parametros.alerta);
  const estadoPedido = uno(parametros.estado)?.toUpperCase() ?? (alertaPedida ? "TODAS" : "ABIERTAS");
  const estado = estadoPedido === "TODAS" || estadoPedido === "ABIERTAS" || (ESTADOS_DE_ALERTA as readonly string[]).includes(estadoPedido) ? estadoPedido : "ABIERTAS";
  const prioridad = leerPrioridad(uno(parametros.prioridad));

  const [alertas, abiertas, cuenta] = await Promise.all([
    listarAlertas(access.workspaceId, { estado: estado as EstadoDeAlerta | "ABIERTAS" | "TODAS", prioridad }, undefined, mirando).catch(() => null),
    // Para los números de los botones de área: todas las abiertas, sin importar el estado ni la prioridad elegidos.
    listarAlertas(access.workspaceId, { estado: "ABIERTAS" }, undefined, mirando).catch(() => []),
    contarAlertas(access.workspaceId, mirando).catch(() => null),
  ]);

  // Área de cada alerta (solo lectura). Si la lectura de tarjetas falla, todo cae en el área por defecto y la página sigue.
  const idsDeTarjetas = [...(alertas ?? []), ...abiertas].map((alerta) => idDeTarjetaDeLaClave(alerta.clave)).filter((id): id is string => !!id);
  const areasDeTarjetas = await leerAreasDeTarjetas(access.workspaceId, idsDeTarjetas).catch(() => new Map());
  const areaDe = (alerta: { clave: string; origen: string }) => {
    try {
      return areaDeAlerta(alerta, areasDeTarjetas);
    } catch {
      return AREA_POR_DEFECTO;
    }
  };
  const conteoPorArea = contarAbiertasPorArea(abiertas.map((alerta) => ({ estado: alerta.estado, area: areaDe(alerta) })));

  const enlace = (cambios: { estado?: string; prioridad?: string | null }) => {
    const query = new URLSearchParams();
    const nuevoEstado = cambios.estado ?? estado.toLowerCase();
    const nuevaPrioridad = cambios.prioridad === undefined ? prioridad?.toLowerCase() : cambios.prioridad;
    if (nuevoEstado !== "abiertas") query.set("estado", nuevoEstado);
    if (nuevaPrioridad) query.set("prioridad", nuevaPrioridad);
    const texto = query.toString();
    return texto ? `/cliente/alertas?${texto}` : "/cliente/alertas";
  };
  const chip = (activo: boolean) =>
    cn("rounded-md border px-2.5 py-1 text-xs font-medium", activo ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted");

  const ahora = new Date();
  const filas = (alertas ?? []).map((alerta) => ({
    id: alerta.id,
    resaltada: alerta.id === alertaPedida,
    prioridad: alerta.prioridad,
    titulo: alerta.titulo,
    detalle: alerta.detalle,
    origen: alerta.origen,
    area: areaDe(alerta),
    tarjetaId: idDeTarjetaDeLaClave(alerta.clave),
    estado: alerta.estado,
    veces: alerta.veces,
    salioPorWhatsApp: alerta.salioPorWhatsApp,
    // La hora que se muestra es la de la ÚLTIMA vez que llegó; la primera queda aparte si se repitió.
    fecha: ultimaVezDe(alerta).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }),
    primeraVez: alerta.creadoEn.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }),
    repeticion: textoDeRepeticion(alerta.veces, ultimaVezDe(alerta), ahora),
  }));

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader icon={BellRing} title="Alertas" />
      <p className="text-sm text-muted-foreground">
        Aquí quedan todas las alertas. Por WhatsApp solo llegan las urgentes, con el link a esta página.
        {cuenta ? ` Nuevas: ${cuenta.NUEVA} · Vistas: ${cuenta.VISTA} · Resueltas: ${cuenta.RESUELTA}.` : ""}
      </p>

      <div className="flex flex-wrap gap-2">
        {[{ valor: "abiertas", texto: "Abiertas" }, ...ESTADOS_DE_ALERTA.map((e) => ({ valor: e.toLowerCase(), texto: ETIQUETA_DE_ESTADO[e] })), { valor: "todas", texto: "Todas" }].map((opcion) => (
          <Link key={opcion.valor} href={enlace({ estado: opcion.valor })} className={chip(estado.toLowerCase() === opcion.valor)}>
            {opcion.texto}
          </Link>
        ))}
        <span className="mx-1 w-px bg-border" />
        <Link href={enlace({ prioridad: null })} className={chip(!prioridad)}>
          Toda prioridad
        </Link>
        {PRIORIDADES.map((p) => (
          <Link key={p} href={enlace({ prioridad: p.toLowerCase() })} className={chip(prioridad === p)}>
            {ETIQUETA_DE_PRIORIDAD[p]}
          </Link>
        ))}
      </div>

      {alertas === null ? <p className="text-sm text-destructive">No se pudieron leer las alertas. Vuelve a intentar en un momento.</p> : <ListaDeAlertas alertas={filas} areas={[...AREAS_DE_ALERTA]} conteoPorArea={conteoPorArea} />}
    </div>
  );
}
