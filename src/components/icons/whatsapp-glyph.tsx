import { FaWhatsapp } from "react-icons/fa";

type WhatsAppGlyphProps = {
  className?: string;
};

export function WhatsAppGlyph({ className }: WhatsAppGlyphProps) {
  return (
    <FaWhatsapp aria-hidden="true" className={className} />
  );
}
