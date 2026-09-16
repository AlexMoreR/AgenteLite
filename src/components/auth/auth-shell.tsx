import Link from "next/link";
import { ArrowLeft, Bot, Gauge, MessagesSquare, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
  La entrada a la app (login, registro, recuperar contraseña).

  Antes era una pantalla oscura con acentos verde menta, de cuando esto era una landing de venta.
  Adentro la app es clara -fondo gris muy suave, tarjetas blancas, acento del tema-, asi que entrar
  era pasar por dos productos distintos (Alex, 15-sep-2026). Ahora usa los MISMOS tokens que el
  resto (bg-background, bg-card, border-border, var(--primary)): si mañana cambia el tema de la
  app, esta pantalla cambia con el, sin tocarla.
*/

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  showMetrics?: boolean;
  showShowcase?: boolean;
  showIntro?: boolean;
  centerContent?: boolean;
  showAccentGlow?: boolean;
};

const authMetrics = [
  { label: "Respuesta", value: "24/7" },
  { label: "Activación", value: "menos de 10 min" },
];

const authShowcase = [
  { icono: QrCode, titulo: "Canal listo", detalle: "Conexión activa" },
  { icono: Gauge, titulo: "IA en marcha", detalle: "Lista para vender" },
];

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  showMetrics = true,
  showShowcase = true,
  showIntro = true,
  centerContent = false,
}: AuthShellProps) {
  return (
    <section className="relative min-h-dvh overflow-hidden bg-background px-4 py-8 text-foreground md:px-8 md:py-12">
      {/* Un velo de color del tema arriba: da profundidad sin romper el fondo claro de la app. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_14%,transparent),_transparent_70%)]" />

      <div
        className={`relative mx-auto grid w-full gap-10 ${
          centerContent
            ? "max-w-xl place-items-center"
            : "max-w-5xl lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-center"
        }`}
      >
        <div className={`order-2 w-full space-y-6 lg:order-1 ${centerContent ? "hidden" : ""}`}>
          <Button
            variant="outline"
            size="sm"
            className="hidden gap-2 rounded-full lg:inline-flex"
            render={
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Volver al inicio
              </Link>
            }
          />

          {showIntro ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">{eyebrow}</p>
              <h1 className="max-w-lg text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                {title}
              </h1>
              <p className="max-w-md text-sm leading-6 text-muted-foreground md:text-base">{description}</p>
            </div>
          ) : null}

          {showMetrics ? (
            <div className="grid max-w-md gap-3 sm:grid-cols-2">
              {authMetrics.map((item) => (
                <div key={item.label} className="rounded-2xl border border-border bg-card px-5 py-4">
                  <p className="text-2xl font-semibold tracking-tight text-foreground">{item.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
          ) : null}

          {showShowcase ? (
            <div className="max-w-md space-y-3 rounded-2xl border border-border bg-card p-4 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.35)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Tu panel
              </p>

              <div className="grid gap-2.5 sm:grid-cols-2">
                {authShowcase.map(({ icono: Icono, titulo, detalle }) => (
                  <div key={titulo} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-[var(--primary)]">
                      <Icono className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{titulo}</span>
                      <span className="block truncate text-xs text-muted-foreground">{detalle}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* Dos burbujas, como en Chats: se entiende de un vistazo para qué es la app. */}
              <div className="space-y-2 rounded-xl border border-border bg-background/60 p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Bot className="h-4 w-4" />
                  </span>
                  <p className="rounded-2xl rounded-tl-sm border border-border bg-card px-3 py-2 text-sm text-foreground">
                    Entra un cliente nuevo.
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <p className="rounded-2xl rounded-tr-sm bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)]">
                    Tu panel responde.
                  </p>
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[var(--primary)]">
                    <MessagesSquare className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="order-1 w-full max-w-md justify-self-center space-y-4 lg:order-2 lg:justify-self-end">
          <Button
            variant="outline"
            size="sm"
            className="inline-flex gap-2 rounded-full lg:hidden"
            render={
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Volver al inicio
              </Link>
            }
          />
          {children}
        </div>
      </div>
    </section>
  );
}
