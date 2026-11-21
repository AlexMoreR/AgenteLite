"use client";

import { useEffect, useState } from "react";
import { Bell, Loader2, PhoneIncoming, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia } from "@/components/ui/item";
import { isProbablyIos, isStandalone } from "@/lib/pwa-instalada";
import { isPushSupported, requestPermissionAndSubscribe } from "./push-subscription-client";

/** Cerrada en esta sesión del navegador: no vuelve a salir hasta abrir el CRM de nuevo. */
const CLAVE_CERRADA = "aviso-instalar-pwa:cerrado";

type Estado = "nada" | "instalar" | "permiso" | "bloqueado";

function estaCerrada(): boolean {
  try {
    return window.sessionStorage.getItem(CLAVE_CERRADA) === "1";
  } catch {
    return false;
  }
}

function marcarCerrada() {
  try {
    window.sessionStorage.setItem(CLAVE_CERRADA, "1");
  } catch {
    // Sin almacenamiento (modo privado): se cierra igual, solo que puede volver al recargar.
  }
}

/**
 * Qué tiene que ver la asesora en este iPhone para que le lleguen las llamadas con el CRM cerrado.
 *
 * - Abierto en Safari, sin instalar: en iPhone el aviso con la app cerrada solo llega si está en la
 *   pantalla de inicio, así que se le dice cómo instalarla.
 * - Instalada, sin permiso de notificaciones: se le pide el permiso (con un toque, que iOS exige).
 * - Instalada y con permiso: no sale nada.
 */
function estadoDelDispositivo(): Estado {
  if (!isProbablyIos()) return "nada";
  if (!isStandalone()) return "instalar";
  if (!isPushSupported()) return "nada";
  if (Notification.permission === "granted") return "nada";
  if (Notification.permission === "denied") return "bloqueado";
  return "permiso";
}

/**
 * Franja de iPhone para recibir las llamadas con el CRM cerrado.
 *
 * Solo para quien tiene el permiso de llamadas (lo decide el armazón). Se puede cerrar y no vuelve a
 * salir en la misma sesión.
 */
export function AvisoInstalarPwa() {
  const [estado, setEstado] = useState<Estado>("nada");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    // En el cliente: en el servidor no se sabe qué teléfono es (y así no choca la hidratación).
    if (estaCerrada()) return;
    setEstado(estadoDelDispositivo());
  }, []);

  if (estado === "nada") return null;

  const cerrar = () => {
    marcarCerrada();
    setEstado("nada");
  };

  const activar = async () => {
    setOcupado(true);
    try {
      const resultado = await requestPermissionAndSubscribe();
      if (resultado.ok) {
        toast.success("Listo: te llegarán las llamadas con el CRM cerrado.");
        setEstado("nada");
      } else if (resultado.reason === "denied") {
        setEstado("bloqueado");
      } else if (resultado.reason === "dismissed") {
        toast.error("No se dio el permiso de notificaciones.");
      } else {
        toast.error("No se pudieron activar. Inténtalo de nuevo.");
      }
    } finally {
      setOcupado(false);
    }
  };

  const texto =
    estado === "instalar"
      ? "Para que te lleguen las llamadas con el CRM cerrado, instala la app: Compartir → Agregar a inicio."
      : estado === "permiso"
        ? "Para que te lleguen las llamadas con el CRM cerrado, activa las notificaciones."
        : "Las notificaciones están bloqueadas. Actívalas en Ajustes del iPhone → Notificaciones → esta app.";

  return (
    <div className="px-3 pt-3 md:px-4">
      <Item variant="muted" size="sm" role="status">
        <ItemMedia variant="icon" className="text-primary">
          <PhoneIncoming />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemDescription className="line-clamp-none text-foreground">{texto}</ItemDescription>
        </ItemContent>
        <ItemActions>
          {estado === "permiso" ? (
            <Button type="button" size="sm" onClick={activar} disabled={ocupado}>
              {ocupado ? <Loader2 className="animate-spin" /> : <Bell />}
              Activar
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon-sm" onClick={cerrar} aria-label="Cerrar aviso">
            <X />
          </Button>
        </ItemActions>
      </Item>
    </div>
  );
}
