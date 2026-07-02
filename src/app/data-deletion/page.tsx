import type { Metadata } from "next";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getSystemBrandName } from "@/lib/system-settings";

const dataDeletionUrl = "https://app.aizenbot.com/data-deletion";

export async function generateMetadata(): Promise<Metadata> {
  const brandName = await getSystemBrandName();

  return {
    title: `Eliminacion de Datos | ${brandName}`,
    description: `Instrucciones para solicitar eliminacion de datos en ${brandName}.`,
    alternates: {
      canonical: dataDeletionUrl,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      title: `Eliminacion de Datos | ${brandName}`,
      description: `Consulta como solicitar la eliminacion de datos asociados a ${brandName}.`,
      url: dataDeletionUrl,
      type: "article",
    },
  };
}

export default async function DataDeletionPage() {
  const brandName = await getSystemBrandName();

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 md:px-6 md:py-14">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <Card className="border border-white/10 bg-slate-900/90 py-0 text-slate-100 shadow-2xl shadow-slate-950/40">
          <CardHeader className="gap-4 border-b border-white/10 py-8">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-400/10 text-rose-300">
              <Trash2 className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight text-white">
                Eliminacion de Datos
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6 text-slate-300">
                Aqui explicamos como solicitar la eliminacion de informacion asociada al uso de
                {` ${brandName}.`}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-8 py-8">
            <section className="space-y-3 text-sm leading-7 text-slate-300">
              <p>
                Si deseas solicitar la eliminacion de datos personales u operativos procesados por
                {` ${brandName}, `}envia una solicitud a traves de los canales oficiales publicados
                en{" "}
                <Link href="https://app.aizenbot.com/" className="text-rose-300 underline underline-offset-4">
                  https://app.aizenbot.com/
                </Link>
                .
              </p>
              <p>
                Incluye el correo electronico, telefono o identificador de cuenta relacionado con la
                informacion que deseas eliminar, junto con una descripcion clara de la solicitud.
              </p>
            </section>

            <Separator className="bg-white/10" />

            <section className="space-y-3 text-sm leading-7 text-slate-300">
              <h2 className="text-xl font-semibold tracking-tight text-white">Proceso</h2>
              <p>1. Recibimos la solicitud y validamos la identidad o legitimidad del requerimiento.</p>
              <p>2. Revisamos los datos asociados a la cuenta o negocio indicado.</p>
              <p>3. Eliminamos o anonimizamos la informacion cuando aplique legal y tecnicamente.</p>
              <p>4. Confirmamos el cierre de la solicitud por el mismo canal de contacto.</p>
            </section>

            <Separator className="bg-white/10" />

            <section className="space-y-3 text-sm leading-7 text-slate-300">
              <h2 className="text-xl font-semibold tracking-tight text-white">Excepciones</h2>
              <p>
                Algunos datos pueden conservarse temporalmente cuando exista una obligacion legal,
                contractual, contable, de seguridad o de prevencion de fraude.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
