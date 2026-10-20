import { ImageResponse } from "next/og";

export const alt = "TripBoogie — Plan together. Travel easy.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "64px 80px", background: "#f4f6e9", color: "#154d40", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 32 }}>
        <span style={{ fontWeight: 700 }}>TripBoogie</span>
        <span style={{ fontSize: 20 }}>YOUR TRAVEL COMPANION</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 76, fontSize: 78, fontWeight: 700, lineHeight: 1.1, letterSpacing: -3 }}>
        <span>Plan together.</span><span>Travel easy.</span>
      </div>
      <div style={{ display: "flex", marginTop: 40, fontSize: 26 }}>Itineraries · Maps · Expenses · Checklists</div>
      <div style={{ display: "flex", position: "absolute", right: 80, bottom: 64, width: 112, height: 112, borderRadius: 56, background: "#d3ec9d", alignItems: "center", justifyContent: "center", fontSize: 58 }}>↗</div>
    </div>, size,
  );
}
