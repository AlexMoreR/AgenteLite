import { IconBrandWhatsapp } from "@tabler/icons-react";

type WhatsAppGlyphProps = {
  className?: string;
};

export function WhatsAppGlyph({ className }: WhatsAppGlyphProps) {
  return <IconBrandWhatsapp aria-hidden="true" className={className} stroke={1.8} />;
}
