import type { AdsGeneratorResult, MetaAdOutput } from "../types/ad-output";
import type { AdsGeneratorAiBundle } from "./adsGeneratorAi";
import type { ProductAnalysis } from "./analyzeProduct";
import type { AdStrategy } from "../types/ad-output";
import type { AdCopyVariant } from "../types/ad-output";

function mapCampaignObjective(objective: ProductAnalysis["recommendedObjective"]) {
  const objectiveMap = {
    sales: "Ventas",
    leads: "Generacion de clientes potenciales",
    traffic: "Trafico",
    engagement: "Interaccion",
  } as const;

  return objectiveMap[objective];
}

function buildCampaignStructure(objective: ProductAnalysis["recommendedObjective"]) {
  if (objective === "sales") {
    return "Campana de conversion con 1 conjunto principal y 3 anuncios para testear hooks, prueba social y oferta.";
  }

  if (objective === "leads") {
    return "Campana de leads con 1 conjunto principal, formulario o WhatsApp, y 3 anuncios con mensajes de confianza y respuesta rapida.";
  }

  if (objective === "engagement") {
    return "Campana de interaccion con 1 conjunto principal y 3 anuncios pensados para detener el scroll, generar curiosidad y comentarios.";
  }

  return "Campana de trafico con 1 conjunto principal y 3 anuncios para validar angulo, titular y claridad de la propuesta.";
}

function buildBasicSegmentation(analysis: ProductAnalysis, strategy: AdStrategy) {
  const segments = [strategy.audience, `Categoria relacionada: ${analysis.categoryName}.`];

  if (analysis.primaryPainPoint) {
    segments.push(`Personas que quieren resolver ${analysis.primaryPainPoint.toLowerCase()}.`);
  }

  if (analysis.priceLabel) {
    segments.push(`Usuarios con interes en propuestas de valor comparables a ${analysis.priceLabel}.`);
  }

  return segments;
}

function buildRecommendedFormat(analysis: ProductAnalysis) {
  if (analysis.imageAvailable && analysis.recommendedObjective === "sales") {
    return "Imagen unica con foco en producto, beneficio principal y CTA visible.";
  }

  if (analysis.imageAvailable && analysis.recommendedObjective === "leads") {
    return "Imagen unica con mensaje claro, sello de confianza y CTA para conversar.";
  }

  if (analysis.imageAvailable) {
    return "Imagen unica orientada a captar atencion y validar mensaje.";
  }

  return "Pendiente creativo visual. Primero selecciona una imagen desde Creativos o sube una manual.";
}

function buildCreativeIdea(analysis: ProductAnalysis, strategy: AdStrategy) {
  const proof = analysis.confidenceSignals[0] ?? "Senal visual clara del producto";
  return `Muestra el producto de frente, deja claro el beneficio principal, apoya el mensaje con ${proof.toLowerCase()} y cierra con ${strategy.callToAction.toLowerCase()}.`;
}

function buildBudgetRecommendation(objective: ProductAnalysis["recommendedObjective"]) {
  if (objective === "sales") {
    return "Empieza con un presupuesto diario de prueba entre 30.000 y 60.000 COP por 3 a 5 dias para validar anuncio y oferta.";
  }

  if (objective === "leads") {
    return "Empieza con un presupuesto diario entre 25.000 y 50.000 COP para medir costo por conversacion o lead.";
  }

  if (objective === "engagement") {
    return "Empieza con un presupuesto diario entre 20.000 y 35.000 COP para encontrar mensajes que generen respuesta.";
  }

  return "Empieza con un presupuesto diario entre 20.000 y 40.000 COP para validar CTR y calidad del trafico.";
}

function buildPrimaryMetric(objective: ProductAnalysis["recommendedObjective"]) {
  const metrics = {
    sales: "Costo por compra o inicio de checkout",
    leads: "Costo por lead o por conversacion iniciada",
    traffic: "CTR y costo por clic",
    engagement: "Costo por interaccion y porcentaje de reproduccion/participacion",
  } as const;

  return metrics[objective];
}

function buildPublicationChecklist(meta: Omit<MetaAdOutput, "publicationChecklist" | "copyVariants" | "readyToCopyText">) {
  return [
    "Verifica que el objetivo de campana coincida con la accion que quieres lograr.",
    "Confirma que el formato visual y el copy hablan del mismo beneficio principal.",
    `Revisa que el CTA final sea coherente con "${meta.callToAction}".`,
    "Comprueba que el destino final del anuncio funcione: WhatsApp, web, Instagram o Messenger.",
    "Publica solo una propuesta principal por anuncio para medir mejor el resultado.",
    `Monitorea primero ${meta.primaryMetric.toLowerCase()} durante la fase de prueba.`,
  ];
}

export async function buildMetaOutput(
  analysis: ProductAnalysis,
  strategy: AdStrategy,
  copies: AdCopyVariant[],
  aiBundle?: AdsGeneratorAiBundle | null,
): Promise<AdsGeneratorResult> {
  const callToAction = strategy.callToAction;
  const primaryVariant = copies[0] ?? {
    id: "base",
    primaryText: strategy.hooks[0] ?? analysis.mainOffer,
    headline: analysis.productName,
    description: analysis.primaryBenefit,
  };

  const meta: MetaAdOutput = {
    campaignObjective: mapCampaignObjective(analysis.recommendedObjective),
    strategicSummary:
      analysis.strategicSummary ||
      "La mejor forma de vender esto es abrir con una frase que detenga el scroll, tocar un problema o deseo real del cliente y cerrar con un beneficio claro mas un CTA directo.",
    recommendedSalesAngle: strategy.angle,
    campaignStructure: analysis.campaignStructure || buildCampaignStructure(analysis.recommendedObjective),
    basicSegmentation: analysis.basicSegmentation || buildBasicSegmentation(analysis, strategy),
    recommendedFormat: analysis.recommendedFormat || buildRecommendedFormat(analysis),
    primaryText: primaryVariant.primaryText,
    headline: primaryVariant.headline,
    description: primaryVariant.description,
    callToAction,
    creativeIdea: analysis.creativeIdea || buildCreativeIdea(analysis, strategy),
    budgetRecommendation:
      analysis.budgetRecommendation || buildBudgetRecommendation(analysis.recommendedObjective),
    primaryMetric: analysis.primaryMetric || buildPrimaryMetric(analysis.recommendedObjective),
    creativeNotes: [
      "Usar una imagen principal consistente con el producto o el creativo seleccionado.",
      "Mantener el mensaje alineado con el angulo principal y evitar meter varios beneficios fuertes a la vez.",
      "Validar tono, CTA y destino antes de publicar en Meta Ads Manager.",
    ],
    publicationChecklist: [],
    copyVariants: copies,
    readyToCopyText: copies
      .map((copy, index) =>
        [
          index === 0 ? "Anuncio principal" : `Variante ${index}`,
          `Texto principal:\n${copy.primaryText}`,
          `Titulo: ${copy.headline}`,
          `Descripcion: ${copy.description}`,
          `CTA: ${callToAction}`,
        ].join("\n"),
      )
      .join("\n\n"),
  };

  meta.publicationChecklist =
    analysis.publicationChecklist?.length ? analysis.publicationChecklist : buildPublicationChecklist(meta);
  meta.readyToCopyText = [
    "Anuncio principal",
    `Texto principal:\n${meta.primaryText}`,
    `Titulo: ${meta.headline}`,
    `Descripcion: ${meta.description}`,
    `CTA: ${callToAction}`,
    "",
    "Variantes de copy",
    ...copies.slice(0, 3).map((copy, index) =>
      [
        `Variante ${index + 1}`,
        `Texto principal:\n${copy.primaryText}`,
        `Titulo: ${copy.headline}`,
        `Descripcion: ${copy.description}`,
        `CTA: ${callToAction}`,
      ].join("\n"),
    ),
  ].join("\n\n");

  return {
    summary:
      aiBundle?.summary?.trim() ||
      `Salida inicial generada para ${analysis.productName} con enfoque de venta, copy y estructura lista para revisar antes de publicar en Meta Ads Manager.`,
    strategy,
    meta,
  };
}
