"use client";

import * as React from "react";
import { Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { responderCierreDeCompraAction } from "@/app/actions/crm-actions";

/**
 * "Este cliente entregó datos de compra — ¿se cerró?"
 *
 * Aparece en el chat cuando el cliente mandó su nombre y su dirección después de que se le mostró
 * precio y fotos. Esa señal ya se detectaba y solo servía para avisarle por WhatsApp a la asesora:
 * en el CRM no pasaba nada. Medido el 31-ago-2026, de 10 clientes que entregaron datos de compra 9
 * seguían en "Frío", y el CRM tenía 4 ventas registradas en toda su historia.
 *
 * La pregunta va ACÁ, en el chat, y no en el Kanban, porque este es el momento y el lugar donde la
 * asesora sabe la respuesta. Pedirle que se acuerde de ir a arrastrar una tarjeta después es
 * exactamente lo que no pasaba.
 *
 * "Todavía no" NO es "se perdió": solo saca la pregunta y el lead sigue en Caliente.
 */
export function AvisoDeCierre({
  contactId,
  alResponder,
}: {
  contactId: string;
  alResponder: () => void;
}) {
  const [enviando, setEnviando] = React.useState<"si" | "no" | null>(null);

  const responder = async (seCerro: boolean) => {
    setEnviando(seCerro ? "si" : "no");
    try {
      const resultado = await responderCierreDeCompraAction({ contactId, seCerro });
      if (resultado?.error) {
        toast.error(resultado.error);
        setEnviando(null);
        return;
      }
      // Se saca de la vista al instante: la respuesta ya se dio y dejarla ahí invita a
      // responderla dos veces.
      alResponder();
      if (seCerro) {
        toast.success("Marcado como ganado 🎉");
      }
    } catch {
      toast.error("No se pudo guardar");
      setEnviando(null);
    }
  };

  return (
    <div className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/40">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ShoppingCart className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-[13px] leading-5 text-emerald-900 dark:text-emerald-100">
            Este cliente entregó datos de compra. ¿Se cerró la venta?
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={enviando !== null}
            onClick={() => void responder(false)}
            className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60 dark:text-emerald-200 dark:hover:bg-emerald-900"
          >
            {enviando === "no" ? <Loader2 className="size-3.5 animate-spin" /> : "Todavía no"}
          </button>
          <button
            type="button"
            disabled={enviando !== null}
            onClick={() => void responder(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {enviando === "si" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Sí, se cerró
          </button>
        </span>
      </div>
    </div>
  );
}
