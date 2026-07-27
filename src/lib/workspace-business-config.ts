export type WorkspaceBusinessConfig = {
  businessDescription: string;
  sectorRubro: string;
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
  // Ubicacion del local para mandarla por WhatsApp con un toque (boton "Ubicacion" del chat).
  // WhatsApp necesita COORDENADAS, no la direccion escrita: se guardan aparte de `location`.
  // Se cargan una vez pegando el link de Google Maps en Negocio.
  locationLatitude: string;
  locationLongitude: string;
  // Nombre y direccion que se ven en la tarjeta del pin (si van vacios, se usa el nombre del
  // negocio y `location`).
  locationLabel: string;
  locationAddress: string;
};

export const defaultWorkspaceBusinessConfig: WorkspaceBusinessConfig = {
  businessDescription: "",
  sectorRubro: "",
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
  locationLatitude: "",
  locationLongitude: "",
  locationLabel: "",
  locationAddress: "",
};

export function parseWorkspaceBusinessConfig(raw: unknown): WorkspaceBusinessConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...defaultWorkspaceBusinessConfig };
  }
  const r = raw as Record<string, unknown>;
  return {
    businessDescription: typeof r.businessDescription === "string" ? r.businessDescription : "",
    sectorRubro: typeof r.sectorRubro === "string" ? r.sectorRubro : "",
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
    locationLatitude: typeof r.locationLatitude === "string" ? r.locationLatitude : "",
    locationLongitude: typeof r.locationLongitude === "string" ? r.locationLongitude : "",
    locationLabel: typeof r.locationLabel === "string" ? r.locationLabel : "",
    locationAddress: typeof r.locationAddress === "string" ? r.locationAddress : "",
  };
}

/**
 * Saca las coordenadas de lo que pegue el usuario: un link de Google Maps (formatos `@lat,lng`,
 * `?q=lat,lng`, `!3dlat!4dlng`) o directamente "lat, lng". Devuelve null si no encuentra nada
 * valido, para poder avisar en vez de guardar una ubicacion rota.
 *
 * OJO: los links CORTOS (maps.app.goo.gl / goo.gl/maps) no traen las coordenadas; hay que
 * resolverlos antes siguiendo la redireccion (lo hace la accion que guarda).
 */
export function parseLatLngFromText(value: string): { latitude: number; longitude: number } | null {
  const text = value.trim();
  if (!text) {
    return null;
  }

  const patterns = [
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/, // .../@10.9878,-74.7889,17z
    /[?&](?:q|query|ll|center|destination)=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/, // ?q=lat,lng
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/, // !3dlat!4dlng
    /^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/, // "lat, lng" pelado
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    ) {
      return { latitude, longitude };
    }
  }

  return null;
}
