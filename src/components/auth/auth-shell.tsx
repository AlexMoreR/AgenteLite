import Link from "next/link";
import { ArrowLeft, Bot, Gauge, MessagesSquare, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  { label: "Activacion", value: "< 10 min" },
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
  showAccentGlow = true,
}: AuthShellProps) {
  const alignTop = !centerContent && (!showIntro || !showMetrics || !showShowcase);
  const compactVariant = !centerContent && !showIntro && !showMetrics && !showShowcase;

  return (
    <section className="relative min-h-screen overflow-hidden bg-[#07111f] px-4 py-8 text-[#f3f7fb] md:px-8 md:py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(circle_at_top_left,_rgba(46,211,183,0.2),_transparent_36%),radial-gradient(circle_at_top_right,_rgba(64,132,255,0.18),_transparent_30%),linear-gradient(180deg,_rgba(6,12,24,0.2),_rgba(6,12,24,0))]" />
      {showAccentGlow ? (
        <div className="pointer-events-none absolute right-[-10%] top-28 h-72 w-72 rounded-full bg-[#2ed3b7]/10 blur-3xl" />
      ) : null}

      <div
        className={`relative mx-auto grid w-full gap-8 ${
          centerContent
            ? "max-w-6xl lg:min-h-[calc(100vh-5rem)] lg:place-items-center"
            : compactVariant
              ? "max-w-none lg:min-h-[calc(100vh-5rem)] lg:grid-cols-1 lg:items-start"
              : `max-w-6xl lg:grid-cols-[minmax(0,1fr)_24rem] ${alignTop ? "lg:items-start" : "lg:items-center"}`
        }`}
      >
        <div
          className={`order-2 w-full max-w-2xl space-y-6 lg:order-1 ${
            centerContent ? "hidden" : compactVariant ? "lg:absolute lg:left-0 lg:top-0 lg:z-10 lg:max-w-none" : ""
          }`}
        >
          <Button
            asChild
            variant="outline"
            size="sm"
            className="hidden gap-2 rounded-full border-white/12 bg-white/6 text-white hover:bg-white/10 hover:text-white lg:inline-flex"
          >
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Volver al inicio
            </Link>
          </Button>

          {showIntro ? (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8deedc]">{eyebrow}</p>
              <h1 className="max-w-lg text-4xl font-semibold tracking-[-0.05em] text-white md:text-5xl lg:text-[3.4rem]">
                {title}
              </h1>
              <p className="max-w-md text-sm leading-7 text-[#b8c6d9] md:text-base">{description}</p>
            </div>
          ) : null}

          {showMetrics ? (
            <div className="grid max-w-md gap-3 sm:grid-cols-2">
              {authMetrics.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] px-5 py-4 backdrop-blur-sm"
                >
                  <p className="text-2xl font-semibold tracking-[-0.04em] text-white">{item.value}</p>
                  <p className="mt-1 text-sm text-[#9fb0c5]">{item.label}</p>
                </div>
              ))}
            </div>
          ) : null}

          {showShowcase ? (
            <div className="max-w-xl overflow-hidden rounded-[2rem] border border-white/10 bg-[#0c1828] p-5 shadow-[0_30px_80px_-45px_rgba(0,0,0,0.9)]">
              <div className="rounded-[1.4rem] border border-white/8 bg-[#0f2034] p-4">
                <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7ee8d5]">
                      Control Center
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.2rem] border border-white/8 bg-[#0a1422] p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-[#14344a] p-2.5 text-[#91f2e3]">
                          <QrCode className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Canal listo</p>
                          <p className="text-xs text-[#91a5bc]">Conexion activa</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.2rem] border border-white/8 bg-[#0a1422] p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-[#1f304e] p-2.5 text-[#9cc8ff]">
                          <Gauge className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">IA en marcha</p>
                          <p className="text-xs text-[#91a5bc]">Lista para vender</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.4rem] border border-white/8 bg-[#08111c] p-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-[#0f2f30] p-2.5 text-[#95f4e6]">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="rounded-[1.1rem] border border-white/8 bg-white/6 px-4 py-3 text-sm text-[#dce7f5]">
                        <p>Cliente entra. Todo sigue igual.</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-3">
                      <div className="rounded-[1.1rem] bg-[#2ed3b7] px-4 py-3 text-sm font-medium text-[#06202a]">
                        <p>Tu panel responde.</p>
                      </div>
                      <div className="rounded-2xl bg-[#102941] p-2.5 text-[#8feedd]">
                        <MessagesSquare className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div
          className={`order-1 w-full max-w-md justify-self-center space-y-4 lg:order-2 lg:space-y-0 ${
            centerContent
              ? "lg:max-w-xl"
              : compactVariant
                ? "lg:mx-auto lg:max-w-xl lg:w-full lg:justify-self-auto"
                : "lg:mt-10 lg:justify-self-end"
          }`}
        >
          <Button
            asChild
            variant="outline"
            size="sm"
            className="inline-flex gap-2 rounded-full border-white/12 bg-white/6 text-white hover:bg-white/10 hover:text-white lg:hidden"
          >
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Volver al inicio
            </Link>
          </Button>
          {children}
        </div>
      </div>
    </section>
  );
}
