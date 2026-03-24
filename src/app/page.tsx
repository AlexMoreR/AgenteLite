import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, CheckCircle2, Clock3, Gauge, MessagesSquare, QrCode, ShieldCheck, Workflow } from "lucide-react";
import { getSystemBrandName } from "@/lib/system-settings";

const heroStats = [
  { label: "Respuestas simultaneas", value: "24/7" },
  { label: "Canales activos por negocio", value: "1 panel" },
  { label: "Tiempo de activacion", value: "< 10 min" },
];

const valueCards = [
  {
    icon: MessagesSquare,
    title: "Vende desde WhatsApp sin perder conversaciones",
    description:
      "Centraliza chats, respuestas automaticas, seguimiento comercial y mensajes manuales desde una sola vista.",
  },
  {
    icon: Bot,
    title: "Agentes entrenados para tu negocio",
    description:
      "Configura el tono, la oferta y el flujo del agente para atender clientes, filtrar leads y cerrar oportunidades.",
  },
  {
    icon: Workflow,
    title: "Operacion SaaS lista para escalar",
    description:
      "Cada cliente puede tener su workspace, agentes, conversaciones y configuracion de WhatsApp sin mezclar datos.",
  },
];

const steps = [
  {
    title: "Crea tu workspace",
    description: "Registra tu negocio, define el enfoque comercial y prepara el espacio donde operaran tus agentes.",
  },
  {
    title: "Conecta WhatsApp",
    description: "Genera la instancia, escanea el QR y deja el canal listo para recibir conversaciones reales.",
  },
  {
    title: "Activa tu agente",
    description: "Personaliza prompts, bienvenida, fallback y control operativo para empezar a vender por chat.",
  },
];

const featureGrid = [
  "Panel unificado de conversaciones",
  "Agentes por cliente o negocio",
  "Mensajes manuales desde el dashboard",
  "Conexion de WhatsApp en tiempo real",
  "Estados de conexion en tiempo real",
  "Workspaces separados para SaaS",
  "Cotizaciones y gestion comercial",
  "Permisos y modulos por rol",
];

export async function generateMetadata(): Promise<Metadata> {
  const brandName = await getSystemBrandName();
  const description =
    "Plataforma SaaS para crear agentes de IA en WhatsApp, automatizar ventas, centralizar conversaciones y operar clientes desde un solo panel.";

  return {
    title: `${brandName} | Agentes de IA para WhatsApp`,
    description,
    openGraph: {
      title: `${brandName} | Agentes de IA para WhatsApp`,
      description,
    },
    twitter: {
      title: `${brandName} | Agentes de IA para WhatsApp`,
      description,
    },
  };
}

export default async function HomePage() {
  const brandName = await getSystemBrandName();

  return (
    <div className="relative overflow-hidden bg-[#07111f] text-[#f3f7fb]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(circle_at_top_left,_rgba(46,211,183,0.2),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(64,132,255,0.26),_transparent_34%),linear-gradient(180deg,_rgba(6,12,24,0.2),_rgba(6,12,24,0))]" />
      <div className="pointer-events-none absolute inset-x-0 top-32 mx-auto h-[30rem] max-w-6xl rounded-full bg-[radial-gradient(circle,_rgba(32,89,145,0.18),_transparent_58%)] blur-3xl" />

      <section className="relative">
        <div className="mx-auto grid max-w-7xl gap-14 px-4 pb-18 pt-12 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[minmax(0,1.1fr)_30rem] lg:items-center">
          <div className="space-y-8">
            <div className="space-y-5">
              <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.05em] text-white md:text-6xl lg:text-7xl">
                Convierte WhatsApp en tu equipo comercial automatizado.
              </h1>
              <p className="max-w-2xl text-base leading-8 text-[#b8c6d9] md:text-lg">
                {brandName} te permite crear agentes de IA, conectar canales reales de WhatsApp, responder clientes en
                tiempo real y operar multiples negocios desde una arquitectura SaaS pensada para escalar.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-[#2ed3b7] px-6 text-sm font-semibold text-[#04131d] transition hover:bg-[#58e4cc]"
              >
                Crear workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-13 items-center justify-center gap-2 rounded-full border border-white/14 bg-white/6 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Entrar al panel
              </Link>
            </div>

            <div className="grid gap-3 pt-2 sm:grid-cols-3">
              {heroStats.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[1.6rem] border border-white/10 bg-white/[0.045] px-5 py-4 backdrop-blur-sm"
                >
                  <p className="text-2xl font-semibold tracking-[-0.04em] text-white">{item.value}</p>
                  <p className="mt-1 text-sm text-[#9fb0c5]">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-3 rounded-[2rem] border border-[#2ed3b7]/20 bg-[#2ed3b7]/8 blur-2xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#0c1828] p-5 shadow-[0_30px_80px_-45px_rgba(0,0,0,0.9)]">
              <div className="rounded-[1.4rem] border border-white/8 bg-[#0f2034] p-4">
                <div className="flex items-center justify-between border-b border-white/8 pb-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7ee8d5]">Control Center</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                      Orquesta ventas, automatizacion y soporte.
                    </h2>
                  </div>
                  <div className="rounded-2xl border border-[#2ed3b7]/25 bg-[#0c2c31] px-3 py-2 text-right">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-[#89efdf]">Status</p>
                    <p className="text-sm font-semibold text-white">Activo</p>
                  </div>
                </div>

                <div className="grid gap-3 py-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-[1.2rem] border border-white/8 bg-[#0a1422] p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-[#14344a] p-2.5 text-[#91f2e3]">
                          <QrCode className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Canal WhatsApp listo</p>
                          <p className="text-xs text-[#91a5bc]">Conexion estable y QR sincronizado</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[1.2rem] border border-white/8 bg-[#0a1422] p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-[#1f304e] p-2.5 text-[#9cc8ff]">
                          <Gauge className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">IA con contexto comercial</p>
                          <p className="text-xs text-[#91a5bc]">Prompts, oferta y fallback definidos</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.4rem] border border-white/8 bg-[#08111c] p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-[#92a6ba]">Conversacion activa</p>
                        <p className="mt-2 text-lg font-semibold text-white">Cliente preguntando por planes y demo</p>
                      </div>
                      <div className="rounded-full border border-[#2ed3b7]/30 bg-[#0f2e2f] px-3 py-1 text-xs font-medium text-[#95f4e6]">
                        IA + humano
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="max-w-[85%] rounded-[1.1rem] border border-white/8 bg-white/6 px-4 py-3 text-sm text-[#dce7f5]">
                        Hola, quiero automatizar mi WhatsApp para captar leads y enviar cotizaciones.
                      </div>
                      <div className="ml-auto max-w-[85%] rounded-[1.1rem] bg-[#2ed3b7] px-4 py-3 text-sm font-medium text-[#06202a]">
                        Perfecto. Puedo ayudarte a responder 24/7, filtrar interesados y dejar a tu equipo solo los
                        leads listos para cerrar.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="beneficios" className="relative border-y border-white/7 bg-[#091524]/82">
        <div className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8deedc]">Por que este sistema</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
              No es solo un bot. Es una capa operativa para vender por WhatsApp.
            </h2>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {valueCards.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className="rounded-[1.7rem] border border-white/8 bg-white/[0.045] p-6 backdrop-blur-sm"
                >
                  <div className="inline-flex rounded-2xl border border-white/8 bg-[#0f2338] p-3 text-[#8feedd]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold tracking-[-0.03em] text-white">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-[#9fb1c7]">{item.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="relative">
        <div className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-20">
          <div className="grid gap-10 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8deedc]">Activacion</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
                Desde cero hasta un canal vendiendo en pocos pasos.
              </h2>
              <p className="mt-4 text-sm leading-7 text-[#9fb1c7]">
                El flujo esta pensado para una operacion SaaS: onboarding, conexion, configuracion del agente y salida
                a produccion sin friccion innecesaria.
              </p>
            </div>

            <div className="grid gap-4">
              {steps.map((step, index) => (
                <article
                  key={step.title}
                  className="grid gap-4 rounded-[1.7rem] border border-white/8 bg-[#0a1422]/90 p-5 md:grid-cols-[5.5rem_minmax(0,1fr)] md:items-start"
                >
                  <div className="flex items-center gap-3 md:block">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[#2ed3b7]/24 bg-[#0c2a2e] text-lg font-semibold text-[#92f3e4]">
                      0{index + 1}
                    </div>
                    <div className="mt-3 h-px flex-1 bg-gradient-to-r from-[#2ed3b7]/30 to-transparent md:h-16 md:w-px md:translate-x-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold tracking-[-0.03em] text-white">{step.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-[#9fb1c7]">{step.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-y border-white/7 bg-[#08111b]">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-16 md:px-8 md:py-20 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8deedc]">Capacidades</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
              Hecho para operar como producto, no como demo.
            </h2>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {featureGrid.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-[1.1rem] border border-white/8 bg-white/[0.04] px-4 py-3 text-sm text-[#d8e4f1]"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#72e7d1]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-[1.8rem] border border-white/8 bg-[linear-gradient(180deg,#0f1f31_0%,#0a1524_100%)] p-6">
            <div className="inline-flex rounded-2xl border border-white/8 bg-[#11283c] p-3 text-[#9cefe1]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h3 className="mt-5 text-2xl font-semibold tracking-[-0.04em] text-white">Pensado para SaaS B2B.</h3>
            <p className="mt-4 text-sm leading-7 text-[#9fb1c7]">
              Separa clientes por workspace, controla acceso por roles y mantén el canal comercial listo para crecer
              sin mezclar conversaciones, agentes ni configuraciones.
            </p>

            <div className="mt-6 space-y-3">
              <div className="rounded-[1.1rem] border border-white/8 bg-white/[0.045] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[#90a4bb]">Disponibilidad</p>
                <p className="mt-2 flex items-center gap-2 text-sm font-medium text-white">
                  <Clock3 className="h-4 w-4 text-[#88eddc]" />
                  Atención continua con escalamiento humano
                </p>
              </div>
              <div className="rounded-[1.1rem] border border-white/8 bg-white/[0.045] px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-[#90a4bb]">Operacion</p>
                <p className="mt-2 text-sm font-medium text-white">Mensajes, agentes, QR y conversaciones desde un mismo panel</p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="relative">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#12263f_0%,#0a1220_55%,#0d2b32_100%)] px-6 py-8 md:px-10 md:py-10">
            <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8cefdc]">Lanzamiento</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white md:text-4xl">
                  Empieza hoy a vender con agentes de IA en WhatsApp.
                </h2>
                <p className="mt-4 text-sm leading-7 text-[#b7c5d8]">
                  Activa tu workspace, conecta el canal y convierte cada chat en una oportunidad medible desde una sola
                  plataforma.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#08111b] transition hover:bg-[#dff8f2]"
                >
                  Probar ahora
                </Link>
                <Link
                  href="/login"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/6 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Ver panel
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
