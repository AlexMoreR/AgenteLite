import type { PendienteDelCoach } from "../../tipos";
import { Etiqueta } from "./piezas";

const TEMPERATURA: Record<PendienteDelCoach["temperatura"], { etiqueta: string; icono: string }> = {
  caliente: { etiqueta: "Caliente", icono: "🔥" },
  tibio: { etiqueta: "Tibio", icono: "🟡" },
  frio: { etiqueta: "Frío", icono: "❄️" },
  cerrado: { etiqueta: "Cerrado", icono: "✅" },
  no_perseguir: { etiqueta: "No perseguir", icono: "💤" },
};

/** La temperatura de un pendiente, igual que en PendientesDelCoach. */
export function PendientesDelCoachTemperatura({ temperatura }: { temperatura: PendienteDelCoach["temperatura"] }) {
  const t = TEMPERATURA[temperatura] ?? TEMPERATURA.frio;
  return (
    <Etiqueta tono={temperatura === "caliente" ? "peligro" : "neutro"}>
      <span aria-hidden className="mr-1">
        {t.icono}
      </span>
      {t.etiqueta}
    </Etiqueta>
  );
}
