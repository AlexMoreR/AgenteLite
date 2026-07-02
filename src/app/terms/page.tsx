import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getSystemBrandName } from "@/lib/system-settings";

const termsUrl = "https://app.aizenbot.com/terms";
const effectiveDate = "2 de julio de 2026";

const sections = [
  {
    title: "1. Objeto del servicio",
    items: [
      "Aizenbot ofrece herramientas para gestionar conversaciones, agentes, automatizaciones, integraciones y canales comerciales digitales.",
      "El servicio esta dirigido a negocios y usuarios autorizados que operan cuentas dentro de la plataforma.",
    ],
  },
  {
    title: "2. Uso aceptable",
    items: [
      "El usuario se compromete a utilizar la plataforma de forma licita, responsable y conforme a las politicas aplicables de Meta, WhatsApp y demas proveedores conectados.",
      "No esta permitido usar la plataforma para spam, fraude, suplantacion, actividades ilegales o tratamiento no autorizado de datos personales.",
    ],
  },
  {
    title: "3. Cuentas e integraciones",
    items: [
      "Cada cliente es responsable de la exactitud de la informacion suministrada al configurar su negocio, usuarios, canales e integraciones.",
      "Al conectar servicios de terceros como Meta y WhatsApp, el usuario declara contar con autorizacion suficiente para operar dichas cuentas y activos.",
    ],
  },
  {
    title: "4. Disponibilidad y cambios",
    items: [
      "Podemos actualizar, mejorar o modificar funcionalidades de la plataforma cuando sea necesario por razones tecnicas, operativas, legales o de seguridad.",
      "Haremos esfuerzos razonables para mantener la disponibilidad del servicio, sin garantizar operacion ininterrumpida o libre de errores en todo momento.",
    ],
  },
  {
    title: "5. Datos y privacidad",
    items: [
      "El tratamiento de datos personales y operativos se rige por nuestra Politica de Privacidad publicada en app.aizenbot.com.",
      "El usuario es responsable de informar a sus propios clientes sobre el tratamiento de datos que realice en sus procesos comerciales y de atencion.",
    ],
  },
  {
    title: "6. Limitacion de responsabilidad",
    items: [
      "Aizenbot no sera responsable por caidas, bloqueos, limitaciones, rechazos o cambios de politica aplicados por proveedores externos como Meta o WhatsApp.",
      "Tampoco sera responsable por configuraciones incorrectas, credenciales invalidas o usos de la plataforma contrarios a estas condiciones.",
    ],
  },
  {
    title: "7. Terminacion",
    items: [
      "Podemos suspender o limitar el acceso cuando exista incumplimiento de estas condiciones, riesgo de seguridad, uso abusivo o requerimiento legal.",
      "El usuario puede dejar de usar el servicio en cualquier momento, sujeto a obligaciones pendientes y a la gestion de sus datos e integraciones.",
    ],
  },
];

export async function generateMetadata(): Promise<Metadata> {
  const brandName = await getSystemBrandName();

  return {
    title: `Condiciones del Servicio | ${brandName}`,
    description: `Condiciones del Servicio de ${brandName} para el uso de la plataforma e integraciones comerciales.`,
    alternates: {
      canonical: termsUrl,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: `Condiciones del Servicio | ${brandName}`,
      description: `Consulta las condiciones del servicio aplicables al uso de ${brandName}.`,
      url: termsUrl,
      type: "article",
    },
  };
}

export default async function TermsPage() {
  const brandName = await getSystemBrandName();

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 md:px-6 md:py-14">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Card className="border border-white/10 bg-slate-900/90 py-0 text-slate-100 shadow-2xl shadow-slate-950/40">
          <CardHeader className="gap-4 border-b border-white/10 py-8">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
              <FileText className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight text-white">
                Condiciones del Servicio
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6 text-slate-300">
                Estas condiciones regulan el acceso y uso de la plataforma {brandName}, incluyendo
                sus canales, agentes, automatizaciones e integraciones.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-1 text-sm text-slate-400">
              <span>Fecha de vigencia: {effectiveDate}</span>
              <Link href={termsUrl} className="text-sky-300 underline underline-offset-4">
                {termsUrl}
              </Link>
            </div>
          </CardHeader>

          <CardContent className="space-y-8 py-8">
            <section className="space-y-3 text-sm leading-7 text-slate-300">
              <p>
                Al registrarte, acceder o utilizar {brandName}, aceptas estas Condiciones del
                Servicio y las politicas aplicables del ecosistema de proveedores conectados.
              </p>
              <p>
                Si usas integraciones con Meta o WhatsApp Business Platform, tambien debes cumplir
                con sus terminos, politicas y requisitos de uso.
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
                Si tienes preguntas sobre estas Condiciones del Servicio, puedes comunicarte a
                traves de los canales oficiales publicados en{" "}
                <Link href="https://app.aizenbot.com/" className="text-sky-300 underline underline-offset-4">
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
