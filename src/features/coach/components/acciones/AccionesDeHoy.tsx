import { type AccionesDeHoy as Acciones } from "../../dominio/acciones-de-hoy";
import { TarjetaDeAccionCoach, type AccionDeEstado } from "./TarjetaDeAccionCoach";

/**
 * "Acciones de hoy": lo primero al entrar al Coach. Una tarjeta por asesora; en el celular una
 * debajo de otra, en escritorio en columnas (2 en tablet, 3 en pantallas grandes).
 */
export function AccionesDeHoy({
  acciones,
  rotuloDelDia,
  puedeMarcar,
  accionDeEstado,
}: {
  acciones: Acciones;
  rotuloDelDia: string;
  /** userId -> puede marcar el estado de esa tarjeta. */
  puedeMarcar: (userId: string) => boolean;
  accionDeEstado: AccionDeEstado;
}) {
  return (
    <section aria-labelledby="titulo-acciones" className="space-y-3">
      <div className="space-y-0.5">
        <h2 id="titulo-acciones" className="text-base font-semibold text-foreground">
          Acciones de hoy
        </h2>
      </div>
      {acciones.tarjetas.length ? (
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {acciones.tarjetas.map((tarjeta) => (
            <TarjetaDeAccionCoach
              key={tarjeta.userId}
              tarjeta={tarjeta}
              dia={acciones.dia}
              rotuloDelDia={rotuloDelDia}
              accionDeEstado={puedeMarcar(tarjeta.userId) ? accionDeEstado : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Ninguna asesora tuvo chats ese día.
        </p>
      )}
    </section>
  );
}
