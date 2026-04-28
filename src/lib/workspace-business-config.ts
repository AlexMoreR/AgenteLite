export type WorkspaceBusinessConfig = {
  businessDescription: string;
  targetAudiences: string[];
  priceRangeMin: string;
  priceRangeMax: string;
  location: string;
  website: string;
  contactPhone: string;
  contactEmail: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  youtube: string;
  newLeadTagName: string;
  autoTagNewLeads: boolean;
};

export const defaultWorkspaceBusinessConfig: WorkspaceBusinessConfig = {
  businessDescription: "",
  targetAudiences: [],
  priceRangeMin: "",
  priceRangeMax: "",
  location: "",
  website: "",
  contactPhone: "",
  contactEmail: "",
  instagram: "",
  facebook: "",
  tiktok: "",
  youtube: "",
  newLeadTagName: "Nuevo lead",
  autoTagNewLeads: true,
};

export function parseWorkspaceBusinessConfig(raw: unknown): WorkspaceBusinessConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...defaultWorkspaceBusinessConfig };
  }
  const r = raw as Record<string, unknown>;
  return {
    businessDescription: typeof r.businessDescription === "string" ? r.businessDescription : "",
    targetAudiences: Array.isArray(r.targetAudiences) ? r.targetAudiences.filter((v): v is string => typeof v === "string") : [],
    priceRangeMin: typeof r.priceRangeMin === "string" ? r.priceRangeMin : "",
    priceRangeMax: typeof r.priceRangeMax === "string" ? r.priceRangeMax : "",
    location: typeof r.location === "string" ? r.location : "",
    website: typeof r.website === "string" ? r.website : "",
    contactPhone: typeof r.contactPhone === "string" ? r.contactPhone : "",
    contactEmail: typeof r.contactEmail === "string" ? r.contactEmail : "",
    instagram: typeof r.instagram === "string" ? r.instagram : "",
    facebook: typeof r.facebook === "string" ? r.facebook : "",
    tiktok: typeof r.tiktok === "string" ? r.tiktok : "",
    youtube: typeof r.youtube === "string" ? r.youtube : "",
    newLeadTagName: typeof r.newLeadTagName === "string" && r.newLeadTagName.trim() ? r.newLeadTagName : defaultWorkspaceBusinessConfig.newLeadTagName,
    autoTagNewLeads: typeof r.autoTagNewLeads === "boolean" ? r.autoTagNewLeads : true,
  };
}
