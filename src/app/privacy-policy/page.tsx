import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getSystemBrandName } from "@/lib/system-settings";

const privacyPolicyUrl = "https://app.aizenbot.com/privacy-policy";
const effectiveDate = "2 de julio de 2026";

const sections = [
  {
    title: "1. Informacion que recopilamos",
    items: [
      "Datos de cuenta como nombre, correo electronico, telefono y datos del negocio cuando una persona se registra o configura la plataforma.",
      "Informacion operativa relacionada con conversaciones, contactos, mensajes, archivos multimedia, configuraciones y flujos conectados a WhatsApp u otros canales habilitados.",
      "Datos tecnicos como direcciones IP, identificadores de dispositivo, navegador, registros de acceso y eventos necesarios para seguridad, soporte y diagnostico.",
    ],
  },
  {
    title: "2. Como usamos la informacion",
    items: [
      "Prestar, mantener y mejorar las funcionalidades de Aizenbot, incluyendo automatizacion, mensajeria, integraciones, analitica y soporte.",
      "Verificar cuentas, prevenir fraude, proteger la plataforma y cumplir obligaciones legales o regulatorias.",
      "Gestionar integraciones con servicios de terceros solicitadas por el usuario, como Meta y WhatsApp Business Platform.",
    ],
  },
  {
    title: "3. Comparticion de datos",
    items: [
      "No vendemos informacion personal.",
      "Podemos compartir informacion con proveedores que nos ayudan a operar la plataforma, siempre bajo obligaciones de confidencialidad y uso limitado.",
      "Tambien podemos compartir datos cuando sea necesario para cumplir la ley, responder requerimientos validos o proteger derechos, seguridad y operacion del servicio.",
    ],
  },
  {
    title: "4. Uso de Meta y WhatsApp",
    items: [
      "Si conectas servicios de Meta o WhatsApp a Aizenbot, trataremos la informacion estrictamente para habilitar la conexion, administracion del canal, envio y recepcion de mensajes y funciones autorizadas por el usuario.",
      "El uso de datos obtenidos a traves de Meta Platforms Technologies se rige ademas por las politicas y terminos aplicables de Meta y WhatsApp.",
    ],
  },
  {
    title: "5. Conservacion y seguridad",
    items: [
      "Conservamos la informacion durante el tiempo necesario para prestar el servicio, cumplir obligaciones contractuales y legales, resolver disputas y hacer cumplir nuestros acuerdos.",
      "Aplicamos medidas razonables de seguridad administrativas, tecnicas y organizativas para proteger la informacion frente a acceso no autorizado, perdida o alteracion.",
    ],
  },
  {
    title: "6. Derechos y solicitudes",
    items: [
      "Las personas pueden solicitar acceso, actualizacion o eliminacion de su informacion personal cuando la ley aplicable lo permita.",
      "Para solicitudes de privacidad o eliminacion de datos, contactanos a traves de los canales oficiales publicados en app.aizenbot.com e indica el correo o cuenta asociada.",
    ],
  },
  {
    title: "7. Cambios a esta politica",
    items: [
      "Podemos actualizar esta Politica de Privacidad para reflejar cambios legales, tecnicos o del producto.",
      "Cuando publiquemos cambios materiales, actualizaremos la fecha de vigencia de esta pagina.",
    ],
  },
];

export async function generateMetadata(): Promise<Metadata> {
  const brandName = await getSystemBrandName();

  return {
    title: `Politica de Privacidad | ${brandName}`,
    description: `Politica de Privacidad de ${brandName} para el uso de la plataforma, integraciones y servicios de mensajeria.`,
    alternates: {
      canonical: privacyPolicyUrl,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: `Politica de Privacidad | ${brandName}`,
      description: `Consulta como ${brandName} recopila, usa y protege la informacion procesada en la plataforma.`,
      url: privacyPolicyUrl,
      type: "article",
    },
  };
}

export default async function PrivacyPolicyPage() {
  const brandName = await getSystemBrandName();

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 md:px-6 md:py-14">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Card className="border border-white/10 bg-slate-900/90 py-0 text-slate-100 shadow-2xl shadow-slate-950/40">
          <CardHeader className="gap-4 border-b border-white/10 py-8">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight text-white">
                Politica de Privacidad
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6 text-slate-300">
                Esta politica explica como {brandName} recopila, usa, protege y comparte la informacion
                relacionada con el uso de la plataforma y sus integraciones.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-1 text-sm text-slate-400">
              <span>Fecha de vigencia: {effectiveDate}</span>
              <Link href={privacyPolicyUrl} className="text-emerald-300 underline underline-offset-4">
                {privacyPolicyUrl}
              </Link>
            </div>
          </CardHeader>

          <CardContent className="space-y-8 py-8">
            <section className="space-y-3 text-sm leading-7 text-slate-300">
              <p>
                {brandName} ofrece herramientas para administrar conversaciones, automatizaciones, agentes e
                integraciones comerciales. Al usar nuestros servicios, aceptas el tratamiento de datos
                descrito en esta Politica de Privacidad.
              </p>
              <p>
                Esta politica aplica a visitantes, clientes y usuarios autorizados que interactuan con
                <span className="font-medium text-slate-100"> app.aizenbot.com</span> y con los servicios
                relacionados operados por {brandName}.
              </p>
            </section>

            <Separator className="bg-white/10" />

            {sections.map((section) => (
              <section key={section.title} className="space-y-4">
                <h2 className="text-xl font-semibold tracking-tight text-white">{section.title}</h2>
                <div className="space-y-3 text-sm leading-7 text-slate-300">
                  {section.items.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              </section>
            ))}

            <Separator className="bg-white/10" />

            <section className="space-y-3 text-sm leading-7 text-slate-300">
              <h2 className="text-xl font-semibold tracking-tight text-white">8. Contacto</h2>
              <p>
                Si tienes preguntas sobre esta Politica de Privacidad o sobre el tratamiento de datos en
                {` ${brandName}, `}puedes comunicarte a traves de los canales de contacto oficiales publicados
                en{" "}
                <Link href="https://app.aizenbot.com/" className="text-emerald-300 underline underline-offset-4">
                  https://app.aizenbot.com/
                </Link>
                .
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
