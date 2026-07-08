import { ImageResponse } from "next/og";
import { getSystemBrandName, getSystemPrimaryColor } from "@/lib/system-settings";

export const contentType = "image/png";
export const size = {
  width: 512,
  height: 512,
};

export default async function Icon() {
  const [brandName, primaryColor] = await Promise.all([
    getSystemBrandName(),
    getSystemPrimaryColor(),
  ]);

  const initial = brandName.trim().charAt(0).toUpperCase() || "A";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #ffffff 0%, #f5f7fb 100%)",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 32,
            borderRadius: 112,
            background: `${primaryColor}12`,
          }}
        />
        <div
          style={{
            display: "flex",
            width: 320,
            height: 320,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 96,
            background: primaryColor,
            color: "#ffffff",
            fontSize: 176,
            fontWeight: 700,
            letterSpacing: "-0.08em",
            boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)",
          }}
        >
          {initial}
        </div>
      </div>
    ),
    size,
  );
}
