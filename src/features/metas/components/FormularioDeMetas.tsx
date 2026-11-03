"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { guardarMetas } from "@/features/metas/acciones";
import type { MetasDelMes } from "@/features/metas/dominio/calculo";
import { mesEnPalabras, moverMes, type MiembroDelNegocio } from "@/features/metas/dominio/metas-guardadas";
import type { OrigenDeLasMetas } from "@/features/metas/servicios/metas-del-mes";

type FilaDelFormulario = {
  clave: number;
  userId: string;
  nombre: string;
  nombreEnGestion: string;
  meta: string;
  reto: string;
};

type Props = {
  mes: string;
  mesActual: string;
  metas: MetasDelMes;
  origen: OrigenDeLasMetas;
  miembros: MiembroDelNegocio[];
};

const pesos = (valor: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(valor);
const porcentaje = (fraccion: number) => String(Math.round(fraccion * 10_000) / 100).replace(".", ",");

const AVISO_POR_ORIGEN: Record<OrigenDeLasMetas, string | null> = {
  guardadas: null,
  "mes-anterior": "Este mes todavía no tiene metas. Te mostramos las del mes anterior: revísalas y da Guardar.",
  "por-defecto": "Este mes todavía no tiene metas. Te mostramos las de noviembre 2026: revísalas y da Guardar.",
};

/**
 * Formulario de metas del mes para el dueño. Todo queda en la pantalla hasta que da "Guardar": cambiar de mes sin
 * guardar pregunta antes de perder lo escrito.
 */
export function FormularioDeMetas({ mes, mesActual, metas, origen, miembros }: Props) {
  const router = useRouter();
  const [guardando, iniciarGuardado] = useTransition();
  const [cambiado, setCambiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siguienteClave, setSiguienteClave] = useState(metas.asesoras.length);
  const [filas, setFilas] = useState<FilaDelFormulario[]>(() =>
    metas.asesoras.map((asesora, indice) => ({
      clave: indice,
      userId: asesora.userId ?? "",
      nombre: asesora.nombre,
      nombreEnGestion: asesora.nombreEnGestion ?? "",
      meta: pesos(asesora.meta),
      reto: pesos(asesora.reto),
    })),
  );
  const [equipo, setEquipo] = useState({
    metaEquipo: pesos(metas.metaEquipo),
    minimoEquipo: pesos(metas.minimoEquipo),
    bono: pesos(metas.bono),
    porcentajeHastaMeta: porcentaje(metas.porcentajeHastaMeta),
    porcentajeSobreMeta: porcentaje(metas.porcentajeSobreMeta),
  });

  // Del mes actual, 12 meses atrás y 2 adelante; más el que se está viendo, si queda por fuera.
  const meses = useMemo(() => {
    const lista = Array.from({ length: 15 }, (_, indice) => moverMes(mesActual, 2 - indice));
    if (!lista.includes(mes)) lista.push(mes);
    return lista.sort().reverse();
  }, [mes, mesActual]);

  const marcarCambio = () => {
    setCambiado(true);
    setError(null);
  };

  const cambiarFila = (clave: number, cambios: Partial<FilaDelFormulario>) => {
    setFilas((actuales) => actuales.map((fila) => (fila.clave === clave ? { ...fila, ...cambios } : fila)));
    marcarCambio();
  };

  const elegirUsuario = (clave: number, userId: string) => {
    const miembro = miembros.find((uno) => uno.userId === userId);
    setFilas((actuales) =>
      actuales.map((fila) =>
        fila.clave === clave ? { ...fila, userId, nombre: fila.nombre.trim() || miembro?.nombre || "" } : fila,
      ),
    );
    marcarCambio();
  };

  const agregarAsesora = () => {
    setFilas((actuales) => [
      ...actuales,
      { clave: siguienteClave, userId: "", nombre: "", nombreEnGestion: "", meta: "", reto: "" },
    ]);
    setSiguienteClave((clave) => clave + 1);
    marcarCambio();
  };

  const quitarAsesora = (clave: number) => {
    setFilas((actuales) => actuales.filter((fila) => fila.clave !== clave));
    marcarCambio();
  };

  const cambiarMes = (nuevo: string) => {
    if (nuevo === mes) return;
    if (cambiado && !window.confirm("Tienes cambios sin guardar. ¿Cambiar de mes y perderlos?")) return;
    router.push(`/cliente/metas?mes=${nuevo}`);
  };

  const enviar = (formData: FormData) => {
    setError(null);
    iniciarGuardado(async () => {
      try {
        const resultado = await guardarMetas(formData);
        if (!resultado.ok) {
          setError(resultado.error);
          return;
        }
        setCambiado(false);
        toast.success("Metas guardadas", { description: `Quedaron las metas de ${mesEnPalabras(resultado.mes)}.` });
        router.refresh();
      } catch {
        setError("No se pudo guardar. Revisa tu conexión e intenta de nuevo.");
      }
    });
  };

  const usados = new Set(filas.map((fila) => fila.userId).filter(Boolean));
  const aviso = AVISO_POR_ORIGEN[origen];

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <input type="hidden" name="mes" value={mes} />
      <input type="hidden" name="cantidadDeAsesoras" value={filas.length} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mes-de-metas">Mes</Label>
        <NativeSelect
          id="mes-de-metas"
          value={mes}
          onChange={(evento) => cambiarMes(evento.target.value)}
          disabled={guardando}
          className="w-full sm:w-56"
        >
          {meses.map((uno) => (
            <NativeSelectOption key={uno} value={uno}>
              {mesEnPalabras(uno)}
              {uno === mesActual ? " (este mes)" : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {aviso ? (
        <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{aviso}</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Asesoras</CardTitle>
          <CardDescription>
            Meta y reto en pesos. El nombre en Gestión solo hace falta si allá sale distinto.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {filas.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay asesoras en este mes. Agrega una.</p>
          ) : null}
          {filas.map((fila, indice) => {
            const id = (campo: string) => `asesora-${fila.clave}-${campo}`;
            return (
              <div key={fila.clave} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <input type="hidden" name={`asesora.${indice}.userId`} value={fila.userId} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={id("nombre")}>Nombre</Label>
                    <Input
                      id={id("nombre")}
                      name={`asesora.${indice}.nombre`}
                      value={fila.nombre}
                      maxLength={80}
                      required
                      onChange={(evento) => cambiarFila(fila.clave, { nombre: evento.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={id("usuario")}>Usuario del CRM</Label>
                    <NativeSelect
                      id={id("usuario")}
                      value={fila.userId}
                      onChange={(evento) => elegirUsuario(fila.clave, evento.target.value)}
                      className="w-full"
                    >
                      <NativeSelectOption value="">Sin usuario (no verá su meta)</NativeSelectOption>
                      {miembros.map((miembro) => (
                        <NativeSelectOption
                          key={miembro.userId}
                          value={miembro.userId}
                          disabled={usados.has(miembro.userId) && miembro.userId !== fila.userId}
                        >
                          {miembro.nombre}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={id("meta")}>Meta</Label>
                    <Input
                      id={id("meta")}
                      name={`asesora.${indice}.meta`}
                      inputMode="numeric"
                      placeholder="20.000.000"
                      value={fila.meta}
                      required
                      onChange={(evento) => cambiarFila(fila.clave, { meta: evento.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={id("reto")}>Reto</Label>
                    <Input
                      id={id("reto")}
                      name={`asesora.${indice}.reto`}
                      inputMode="numeric"
                      placeholder="26.000.000"
                      value={fila.reto}
                      required
                      onChange={(evento) => cambiarFila(fila.clave, { reto: evento.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <Label htmlFor={id("gestion")}>Nombre en Gestión (opcional)</Label>
                    <Input
                      id={id("gestion")}
                      name={`asesora.${indice}.nombreEnGestion`}
                      value={fila.nombreEnGestion}
                      maxLength={80}
                      onChange={(evento) => cambiarFila(fila.clave, { nombreEnGestion: evento.target.value })}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => quitarAsesora(fila.clave)}>
                    <Trash2 />
                    Quitar
                  </Button>
                </div>
              </div>
            );
          })}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={agregarAsesora}>
              <Plus />
              Agregar asesora
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Equipo y comisión</CardTitle>
          <CardDescription>
            La comisión es sobre la ganancia: un % hasta la meta de cada asesora y otro % por lo que pase la meta.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["metaEquipo", "Meta del equipo", "55.000.000", "numeric"],
              ["minimoEquipo", "Mínimo del equipo", "30.000.000", "numeric"],
              ["bono", "Bono si el equipo llega a la meta", "300.000", "numeric"],
              ["porcentajeHastaMeta", "% hasta la meta", "10", "decimal"],
              ["porcentajeSobreMeta", "% sobre la meta", "20", "decimal"],
            ] as const
          ).map(([campo, etiqueta, ejemplo, modo]) => (
            <div key={campo} className="flex flex-col gap-1.5">
              <Label htmlFor={`equipo-${campo}`}>{etiqueta}</Label>
              <Input
                id={`equipo-${campo}`}
                name={campo}
                inputMode={modo}
                placeholder={ejemplo}
                value={equipo[campo]}
                required
                onChange={(evento) => {
                  const valor = evento.target.value;
                  setEquipo((actual) => ({ ...actual, [campo]: valor }));
                  marcarCambio();
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={guardando} className="w-full sm:w-auto">
          {guardando ? "Guardando…" : `Guardar metas de ${mesEnPalabras(mes)}`}
        </Button>
        {cambiado && !guardando ? (
          <span className="text-sm text-muted-foreground">Tienes cambios sin guardar.</span>
        ) : null}
      </div>
    </form>
  );
}
