"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Globe, Instagram, Mail, MapPin, Pencil, Phone, PlayCircle, X, Youtube } from "lucide-react";
import { saveAgentBusinessProfileAction } from "@/app/actions/agent-actions";

type BusinessData = {
  agentId: string;
  businessName: string;
  businessSummary: string;
  location: string;
  website: string;
  contactPhone: string;
  contactEmail: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  youtube: string;
};

function Field({ label, icon, value, onChange, placeholder }: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
        {icon}
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field-select h-9 w-full rounded-[14px] border-[rgba(148,163,184,0.14)] bg-white text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_-20px_rgba(15,23,42,0.2)] focus:border-[var(--primary)]"
      />
    </div>
  );
}

function BusinessModal({ data, onSave, onClose }: {
  data: BusinessData;
  onSave: (next: BusinessData) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(data.businessName);
  const [summary, setSummary] = useState(data.businessSummary);
  const [location, setLocation] = useState(data.location);
  const [website, setWebsite] = useState(data.website);
  const [contactPhone, setContactPhone] = useState(data.contactPhone);
  const [contactEmail, setContactEmail] = useState(data.contactEmail);
  const [instagram, setInstagram] = useState(data.instagram);
  const [facebook, setFacebook] = useState(data.facebook);
  const [tiktok, setTiktok] = useState(data.tiktok);
  const [youtube, setYoutube] = useState(data.youtube);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSavingTransition] = useTransition();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>("[data-business-name-input='true']");
      input?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function handleSave() {
    if (name.trim().length < 2) return;
    setError(null);

    const nextData: BusinessData = {
      agentId: data.agentId,
      businessName: name.trim(),
      businessSummary: summary.trim(),
      location: location.trim(),
      website: website.trim(),
      contactPhone: contactPhone.trim(),
      contactEmail: contactEmail.trim(),
      instagram: instagram.trim(),
      facebook: facebook.trim(),
      tiktok: tiktok.trim(),
      youtube: youtube.trim(),
    };

    startSavingTransition(async () => {
      const result = await saveAgentBusinessProfileAction({
        agentId: data.agentId,
        ...nextData,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onSave(nextData);
      router.refresh();
      onClose();
    });
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-[0_32px_64px_-24px_rgba(15,23,42,0.28)]">

        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Building2 className="h-4 w-4 text-[var(--primary)]" />
            Datos del negocio
          </span>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[72vh] space-y-5 overflow-y-auto px-5 py-5">

          {/* Nombre */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-slate-700">Nombre del negocio</label>
            <input
              data-business-name-input="true"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } if (e.key === "Escape" && !isSaving) onClose(); }}
              placeholder="Ej. Aizen Store"
              className="field-select h-11 w-full rounded-[16px] border-[rgba(148,163,184,0.14)] bg-white text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_22px_-28px_rgba(15,23,42,0.28)] focus:border-[var(--primary)]"
            />
          </div>

          {/* Resumen */}
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-slate-700">Resumen del negocio</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              placeholder="Escribe un resumen general del negocio, su enfoque y lo que lo hace especial."
              className="flex w-full resize-none rounded-[16px] border border-[rgba(148,163,184,0.14)] bg-white px-3.5 py-3 text-[13px] leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)]"
            />
            <p className="text-[12px] text-slate-400">Este resumen describe el negocio. No reemplaza la forma comercial en que vendes por WhatsApp.</p>
          </div>

          <div className="h-px bg-slate-100" />

          {/* Contacto y ubicacion */}
          <div className="space-y-3">
            <span className="block text-[13px] font-medium text-slate-700">Contacto y ubicacion</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ubicacion / Direccion" icon={<MapPin className="h-3.5 w-3.5" />} value={location} onChange={setLocation} placeholder="Ej. Calle 10 #45-20, Bogota" />
              <Field label="Sitio web" icon={<Globe className="h-3.5 w-3.5" />} value={website} onChange={setWebsite} placeholder="Ej. www.minegocio.com" />
              <Field label="Numero de contacto" icon={<Phone className="h-3.5 w-3.5" />} value={contactPhone} onChange={setContactPhone} placeholder="Ej. +57 300 000 0000" />
              <Field label="Correo" icon={<Mail className="h-3.5 w-3.5" />} value={contactEmail} onChange={setContactEmail} placeholder="Ej. hola@minegocio.com" />
            </div>
          </div>

          {/* Redes sociales */}
          <div className="space-y-3">
            <span className="block text-[13px] font-medium text-slate-700">Redes sociales</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Instagram" icon={<Instagram className="h-3.5 w-3.5" />} value={instagram} onChange={setInstagram} placeholder="@minegocio" />
              <Field label="Facebook" icon={<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>} value={facebook} onChange={setFacebook} placeholder="@minegocio" />
              <Field label="TikTok" icon={<svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.75a4.84 4.84 0 0 1-1.01-.06z"/></svg>} value={tiktok} onChange={setTiktok} placeholder="@minegocio" />
              <Field label="YouTube" icon={<Youtube className="h-3.5 w-3.5" />} value={youtube} onChange={setYoutube} placeholder="@minegocio" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          {error ? <p className="mr-auto max-w-[55%] text-[12px] text-rose-600">{error}</p> : null}
          <button type="button" disabled={isSaving} onClick={onClose} className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 px-4 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={handleSave} disabled={isSaving || name.trim().length < 2} className="inline-flex h-9 items-center justify-center rounded-xl bg-[var(--primary)] px-4 text-[13px] font-medium text-white transition hover:bg-[var(--primary-strong)] disabled:opacity-50">
            {isSaving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function BusinessNameHeader({
  agentId,
  businessName,
  businessSummary,
  location,
  website,
  contactPhone,
  contactEmail,
  instagram,
  facebook,
  tiktok,
  youtube,
}: {
  agentId: string;
  businessName: string;
  businessSummary: string;
  location: string;
  website: string;
  contactPhone: string;
  contactEmail: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  youtube: string;
}) {
  const [name, setName] = useState(businessName);
  const [summary, setSummary] = useState(businessSummary);
  const [loc, setLoc] = useState(location);
  const [web, setWeb] = useState(website);
  const [phone, setPhone] = useState(contactPhone);
  const [email, setEmail] = useState(contactEmail);
  const [ig, setIg] = useState(instagram);
  const [fb, setFb] = useState(facebook);
  const [tt, setTt] = useState(tiktok);
  const [yt, setYt] = useState(youtube);
  const [modalOpen, setModalOpen] = useState(false);

  const initials = name.slice(0, 2).toUpperCase();

  useEffect(() => {
    setName(businessName);
  }, [businessName]);

  useEffect(() => {
    setSummary(businessSummary);
  }, [businessSummary]);

  useEffect(() => {
    setLoc(location);
    setWeb(website);
    setPhone(contactPhone);
    setEmail(contactEmail);
    setIg(instagram);
    setFb(facebook);
    setTt(tiktok);
    setYt(youtube);
  }, [contactEmail, contactPhone, facebook, instagram, location, tiktok, website, youtube]);

  function handleSave(next: BusinessData) {
    setName(next.businessName);
    setSummary(next.businessSummary);
    setLoc(next.location);
    setWeb(next.website);
    setPhone(next.contactPhone);
    setEmail(next.contactEmail);
    setIg(next.instagram);
    setFb(next.facebook);
    setTt(next.tiktok);
    setYt(next.youtube);
  }

  return (
    <>
      <input type="hidden" name="businessName" value={name} />
      <input type="hidden" name="businessSummary" value={summary} />
      <input type="hidden" name="location" value={loc} />
      <input type="hidden" name="website" value={web} />
      <input type="hidden" name="contactPhone" value={phone} />
      <input type="hidden" name="contactEmail" value={email} />
      <input type="hidden" name="instagram" value={ig} />
      <input type="hidden" name="facebook" value={fb} />
      <input type="hidden" name="tiktok" value={tt} />
      <input type="hidden" name="youtube" value={yt} />
      <div className="overflow-hidden rounded-[20px] border border-[rgba(148,163,184,0.14)]">
        <div className="flex items-center justify-between gap-3 bg-[var(--primary)] px-4 py-3.5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold text-white">
              {initials}
            </div>
            <span className="truncate text-sm font-semibold text-white">{name}</span>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>

          <Link
            href={`/cliente/agentes/${agentId}/probar`}
            className="shrink-0 inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-white px-3.5 text-sm font-medium text-[var(--primary)] transition hover:bg-white/90"
          >
            <PlayCircle className="h-4 w-4" />
            Probar agente
          </Link>
        </div>
      </div>

      {modalOpen && (
        <BusinessModal
          data={{ agentId, businessName: name, businessSummary: summary, location: loc, website: web, contactPhone: phone, contactEmail: email, instagram: ig, facebook: fb, tiktok: tt, youtube: yt }}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
