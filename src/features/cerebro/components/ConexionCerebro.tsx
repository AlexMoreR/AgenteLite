"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  desconectarCerebroAction,
  elegirCarpetaAction,
  guardarAutorizadosAction,
  listarCarpetasDeGoogleAction,
} from "@/app/actions/cerebro-actions";
import { carpetaPreferida } from "@/features/cerebro/services/reglas";

type Props = {
  puedeAdministrar: boolean;
  googleListo: boolean;
  /** El correo de la cuenta de servicio si el cerebro entra con ella (sin "Conectar Google"); si no, null. */
  cuentaDeServicio: string | null;
  cuenta: string | null;
  tienePermiso: boolean;
  carpeta: string | null;
  ultimoError: string | null;
  miembros: Array<{ userId: string; nombre: string }>;
  autorizados: string[];
};

/** Conectar Google, elegir la carpeta del cerebro, desconectar y autorizar personas. Solo el dueño lo ve completo. */
export function ConexionCerebro({ puedeAdministrar, googleListo, cuentaDeServicio, cuenta, tienePermiso, carpeta, ultimoError, miembros, autorizados }: Props) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [carpetas, setCarpetas] = useState<Array<{ id: string; nombre: string }> | null>(null);
  const [filtro, setFiltro] = useState("");
  const [elegida, setElegida] = useState("");
  const [lista, setLista] = useState(autorizados);
  const conCuentaDeServicio = Boolean(cuentaDeServicio);

  const buscarCarpetas = (texto = filtro) =>
    empezar(async () => {
      const respuesta = await listarCarpetasDeGoogleAction(texto);
      if (respuesta.ok) {
        setCarpetas(respuesta.carpetas);
        setElegida((actual) => (actual && respuesta.carpetas.some((c) => c.id === actual) ? actual : carpetaPreferida(respuesta.carpetas)));
      } else toast.error(respuesta.error);
    });

  // Con la cuenta de servicio, las carpetas compartidas con ella se muestran solas al abrir la pantalla.
  useEffect(() => {
    if (puedeAdministrar && conCuentaDeServicio) buscarCarpetas("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puedeAdministrar, conCuentaDeServicio]);

  if (!puedeAdministrar) return null;

  const elegir = () =>
    empezar(async () => {
      const carpetaElegida = carpetas?.find((c) => c.id === elegida);
      if (!carpetaElegida) return;
      const respuesta = await elegirCarpetaAction(carpetaElegida.id, carpetaElegida.nombre);
      if (respuesta.ok) {
        toast.success(`Carpeta elegida. ${respuesta.resultado.nuevos} documentos copiados.`);
        setCarpetas(null);
        router.refresh();
      } else toast.error(respuesta.error);
    });

  const desconectar = () =>
    empezar(async () => {
      const respuesta = await desconectarCerebroAction();
      if (respuesta.ok) {
        toast.success("Google desconectado. El Drive no se tocó.");
        router.refresh();
      } else toast.error(respuesta.error);
    });

  const alternar = (userId: string, activo: boolean) => {
    const nueva = activo ? [...lista, userId] : lista.filter((id) => id !== userId);
    setLista(nueva);
    empezar(async () => {
      const respuesta = await guardarAutorizadosAction(nueva);
      if (!respuesta.ok) toast.error(respuesta.error);
    });
  };

  const reconectar = !conCuentaDeServicio && (Boolean(ultimoError?.toLowerCase().includes("reconectar")) || (!tienePermiso && Boolean(cuenta)));

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Conexión con Google Drive</h2>
          <p className="text-sm text-muted-foreground">
            {conCuentaDeServicio
              ? `Conectado con la cuenta de servicio ${cuentaDeServicio}${carpeta ? ` · carpeta: ${carpeta}` : " · falta elegir la carpeta"}.`
              : tienePermiso
              ? `Conectado con ${cuenta ?? "la cuenta de Google"}${carpeta ? ` · carpeta: ${carpeta}` : " · falta elegir la carpeta"}.`
              : "Todavía no está conectado. El Drive es el original del cerebro."}
          </p>
        </div>
        <div className="flex gap-2">
          {conCuentaDeServicio ? null : !tienePermiso || reconectar ? (
            <Button render={<a href="/api/cerebro/google/conectar" />} disabled={!googleListo}>
              <Plug />
              {reconectar ? "Reconectar Google" : "Conectar Google"}
            </Button>
          ) : null}
          {tienePermiso && !conCuentaDeServicio ? (
            <Button variant="outline" onClick={desconectar} disabled={pendiente}>
              <Unplug />
              Desconectar
            </Button>
          ) : null}
        </div>
      </div>

      {!googleListo ? (
        <p className="text-sm text-muted-foreground">
          Falta configurar Google en el servidor: la cuenta de servicio (GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) o, como alternativa, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET y CEREBRO_CLAVE_CIFRADO.
        </p>
      ) : null}
      {tienePermiso && !conCuentaDeServicio ? (
        <p className="text-xs text-muted-foreground">
          Google va a mostrar un aviso de &quot;app no verificada&quot;: es normal porque solo la usa tu negocio. Pulsa continuar.
        </p>
      ) : null}
      {ultimoError ? <p className="text-sm text-destructive">Último error: {ultimoError}</p> : null}

      {conCuentaDeServicio && carpetas && !carpetas.length ? (
        <p className="rounded-lg border bg-muted px-3 py-2 text-sm">
          Todavía no hay ninguna carpeta compartida con la cuenta de servicio. En Google Drive, comparte la carpeta del cerebro
          (Magilus) con <strong>{cuentaDeServicio}</strong> como <strong>Editor</strong> y pulsa &quot;Buscar carpetas&quot;.
        </p>
      ) : null}

      {tienePermiso && !reconectar ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{carpeta ? "Cambiar la carpeta del cerebro" : "Elige la carpeta del cerebro"}</p>
          {conCuentaDeServicio ? (
            <p className="text-xs text-muted-foreground">Solo aparecen las carpetas que compartiste con {cuentaDeServicio}.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Input className="h-10 max-w-xs md:h-9" placeholder="Nombre de la carpeta (ej. Empresa Magilus)" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            <Button variant="outline" onClick={() => buscarCarpetas()} disabled={pendiente}>
              {pendiente ? <Loader2 className="animate-spin" /> : null}
              Buscar carpetas
            </Button>
          </div>
          {carpetas?.length || (carpetas && !conCuentaDeServicio) ? (
            <div className="flex flex-wrap gap-2">
              <NativeSelect value={elegida} onChange={(e) => setElegida(e.target.value)} className="max-w-xs">
                <NativeSelectOption value="">{carpetas.length ? "Elige una carpeta" : "No hay carpetas con ese nombre"}</NativeSelectOption>
                {carpetas.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.nombre}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button onClick={elegir} disabled={!elegida || pendiente}>
                Usar esta carpeta
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {miembros.length ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Quién más ve el cerebro</p>
          <p className="text-xs text-muted-foreground">Tú siempre lo ves. Marca a quien quieras autorizar a verlo y a pasarle conclusiones desde el tablero.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {miembros.map((miembro) => (
              <label key={miembro.userId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={lista.includes(miembro.userId)}
                  onChange={(e) => alternar(miembro.userId, e.target.checked)}
                />
                {miembro.nombre}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
