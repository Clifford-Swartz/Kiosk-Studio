import React from "react";

export function Row({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, margin: "6px 0", ...style }}>
      <span style={{ color: "#7185b4", fontSize: 14, fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}
