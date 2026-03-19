import { ImageResponse } from "next/og";
import { getSystemBrandName } from "@/lib/system-settings";

export const runtime = "nodejs";
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function OpenGraphImage() {
  const brandName = await getSystemBrandName();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background:
            "linear-gradient(135deg, #200033 0%, #4b0071 42%, #5e0080 72%, #7b14a7 100%)",
          color: "white",
          fontFamily: "Arial, sans-serif",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 18% 18%, rgba(255,255,255,0.24), transparent 22%), radial-gradient(circle at 85% 24%, rgba(255,255,255,0.14), transparent 18%), radial-gradient(circle at 70% 82%, rgba(255,255,255,0.08), transparent 20%)",
          }}
        />
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            padding: "56px 64px",
            justifyContent: "space-between",
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              maxWidth: 700,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 84,
                  height: 84,
                  borderRadius: 24,
                  background: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 38,
                  fontWeight: 800,
                  letterSpacing: "-0.04em",
                }}
              >
                {brandName.slice(0, 1).toUpperCase()}
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{brandName}</div>
                <div style={{ fontSize: 20, color: "rgba(255,255,255,0.78)" }}>
                  Mobiliario profesional premium
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              <div
                style={{
                  fontSize: 62,
                  fontWeight: 800,
                  lineHeight: 0.96,
                  letterSpacing: "-0.05em",
                  maxWidth: 680,
                }}
              >
                Peluqueria, barberia y salon de belleza
              </div>
              <div
                style={{
                  fontSize: 26,
                  lineHeight: 1.35,
                  color: "rgba(255,255,255,0.84)",
                  maxWidth: 650,
                }}
              >
                Sillas, camillas, tocadores, salas de espera y mobiliario profesional con envio a toda Colombia.
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignSelf: "flex-end",
              marginBottom: 18,
              padding: "18px 24px",
              borderRadius: 28,
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.18)",
              fontSize: 24,
              fontWeight: 700,
              color: "rgba(255,255,255,0.96)",
            }}
          >
            Catalogo online
          </div>
        </div>
      </div>
    ),
    size,
  );
}
