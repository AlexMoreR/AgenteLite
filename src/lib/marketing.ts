import { z } from "zod";

export const DEFAULT_FACEBOOK_ADS_VISUAL_DIRECTION =
  "Estilo publicitario profesional, realista, limpio y atractivo, con el producto como protagonista y composicion pensada para Facebook Ads.";

export const facebookAdsAspectRatioOptions = [
  {
    value: "1:1",
    label: "1:1 Instagram post",
    imageSize: "1024x1024",
  },
  {
    value: "9:16",
    label: "9:16 Story / WhatsApp",
    imageSize: "1024x1536",
  },
  {
    value: "16:9",
    label: "16:9 Facebook post",
    imageSize: "1536x1024",
  },
] as const;

export type FacebookAdsAspectRatio = (typeof facebookAdsAspectRatioOptions)[number]["value"];

export const facebookAdsObjectiveOptions = [
  "Ventas",
  "Mensajes",
  "Clientes potenciales",
  "Reconocimiento de marca",
  "Promocion de lanzamiento",
] as const;

export const facebookAdsToneOptions = [
  "Directo y vendedor",
  "Cercano y humano",
  "Premium y aspiracional",
  "Urgente y promocional",
  "Educativo y confiable",
] as const;

export const facebookAdsFormSchema = z.object({
  aspectRatio: z
    .string()
    .trim()
    .refine(
      (value) =>
        facebookAdsAspectRatioOptions.some((option) => option.value === value),
      "Formato invalido",
    ),
  campaignObjective: z
    .string()
    .trim()
    .refine(
      (value) =>
        facebookAdsObjectiveOptions.includes(
          value as (typeof facebookAdsObjectiveOptions)[number],
        ),
      "Objetivo invalido",
    ),
  productName: z.string().trim().min(2, "Producto o servicio invalido").max(120, "Nombre demasiado largo"),
  productDescription: z
    .string()
    .trim()
    .min(20, "Describe mejor lo que ofreces")
    .max(1000, "Descripcion demasiado larga"),
  targetAudience: z
    .string()
    .trim()
    .min(10, "Describe mejor el publico objetivo")
    .max(500, "Publico demasiado largo"),
  tone: z
    .string()
    .trim()
    .refine(
      (value) =>
        facebookAdsToneOptions.includes(
          value as (typeof facebookAdsToneOptions)[number],
        ),
      "Tono invalido",
    ),
  offerDetails: z.string().trim().min(4, "La oferta es obligatoria").max(300, "Oferta demasiado larga"),
  callToAction: z.string().trim().min(2, "El CTA es obligatorio").max(120, "CTA demasiado largo"),
  differentiator: z
    .string()
    .trim()
    .min(6, "Cuenta que te hace diferente")
    .max(300, "Diferenciador demasiado largo"),
  visualDirection: z
    .string()
    .trim()
    .max(600, "Direccion visual demasiado larga")
    .transform((value) => value || DEFAULT_FACEBOOK_ADS_VISUAL_DIRECTION),
});

export type FacebookAdsFormInput = z.infer<typeof facebookAdsFormSchema>;

export const facebookAdsOutputSchema = z.object({
  primaryTexts: z.array(z.string().trim().min(1)).length(3),
  headlines: z.array(z.string().trim().min(1)).length(3),
  descriptions: z.array(z.string().trim().min(1)).length(3),
  suggestedCallToAction: z.string().trim().min(1),
  imagePrompt: z.string().trim().min(1),
});

export type FacebookAdsOutput = z.infer<typeof facebookAdsOutputSchema>;

export function collectFacebookAdsFormInput(formData: FormData): FacebookAdsFormInput {
  return {
    aspectRatio: String(formData.get("aspectRatio") || facebookAdsAspectRatioOptions[0].value),
    campaignObjective: String(formData.get("campaignObjective") || ""),
    productName: String(formData.get("productName") || ""),
    productDescription: String(formData.get("productDescription") || ""),
    targetAudience: String(formData.get("targetAudience") || ""),
    tone: String(formData.get("tone") || ""),
    offerDetails: String(formData.get("offerDetails") || ""),
    callToAction: String(formData.get("callToAction") || ""),
    differentiator: String(formData.get("differentiator") || ""),
    visualDirection: String(formData.get("visualDirection") || ""),
  };
}

export function formatFacebookAdsInputForPrompt(workspaceName: string, input: FacebookAdsFormInput) {
  return [
    `Marca o negocio: ${workspaceName}`,
    `Formato objetivo: ${input.aspectRatio}`,
    `Objetivo de campana: ${input.campaignObjective}`,
    `Producto o servicio: ${input.productName}`,
    `Descripcion del producto o servicio: ${input.productDescription}`,
    `Publico objetivo: ${input.targetAudience}`,
    `Tono deseado: ${input.tone}`,
    `Oferta o promocion: ${input.offerDetails}`,
    `CTA solicitado: ${input.callToAction}`,
    `Diferenciador principal: ${input.differentiator}`,
    `Direccion visual: ${input.visualDirection}`,
  ].join("\n");
}

export function getImageSizeForAspectRatio(aspectRatio: FacebookAdsAspectRatio): string {
  return (
    facebookAdsAspectRatioOptions.find((option) => option.value === aspectRatio)?.imageSize ??
    facebookAdsAspectRatioOptions[0].imageSize
  );
}

export function parseFacebookAdsOutput(value: unknown): FacebookAdsOutput | null {
  const parsed = facebookAdsOutputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
