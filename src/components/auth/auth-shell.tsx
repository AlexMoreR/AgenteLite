import Link from "next/link";
import { ArrowLeft, Bot, MessagesSquare, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
};

const authHighlights = [
  {
    icon: Bot,
    title: "Vendedor IA activo",
    description: "Responde clientes incluso cuando tu equipo no esta conectado.",
  },
  {
    icon: MessagesSquare,
    title: "Conversaciones ordenadas",
    description: "Centraliza chats y seguimiento en un mismo lugar.",
  },
  {
    icon: ShieldCheck,
    title: "Acceso seguro",
    description: "Entra y gestiona tu operacion con una experiencia clara y consistente.",
  },
];

export function AuthShell({ eyebrow, title, description, children }: AuthShellProps) {
  return (
    <section className="relative min-h-screen overflow-hidden bg-[#07111f] px-4 py-8 text-[#f3f7fb] md:px-8 md:py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(circle_at_top_left,_rgba(46,211,183,0.2),_transparent_36%),radial-gradient(circle_at_top_right,_rgba(64,132,255,0.18),_transparent_30%),linear-gradient(180deg,_rgba(6,12,24,0.2),_rgba(6,12,24,0))]" />
      <div className="pointer-events-none absolute right-[-10%] top-28 h-72 w-72 rounded-full bg-[#2ed3b7]/10 blur-3xl" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full max-w-xl space-y-6">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="gap-2 rounded-full border-white/12 bg-white/6 text-white hover:bg-white/10 hover:text-white"
          >
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Volver al inicio
            </Link>
          </Button>

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8deedc]">{eyebrow}</p>
            <h1 className="max-w-lg text-4xl font-semibold tracking-[-0.05em] text-white md:text-5xl">{title}</h1>
            <p className="max-w-xl text-base leading-7 text-[#b8c6d9]">{description}</p>
          </div>

          <div className="grid gap-3">
            {authHighlights.map((item) => {
              const Icon = item.icon;

              return (
                <article
                  key={item.title}
                  className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-4 backdrop-blur-sm"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl border border-white/10 bg-[#0f2338] p-2.5 text-[#8feedd]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-white">{item.title}</h2>
                      <p className="mt-1 text-sm leading-6 text-[#9fb1c7]">{item.description}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="w-full max-w-md">{children}</div>
      </div>
    </section>
  );
}
