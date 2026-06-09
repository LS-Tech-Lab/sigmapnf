function StatCard({ label, value, icon, color = "#2563EB" }) {
return (
<div style={{ ...S.card, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
<div style={{ width: 44, height: 44, borderRadius: 10, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{icon}</div>
<div><div style={{ fontSize: 24, fontWeight: 700, color: "#111827", lineHeight: 1.1 }}>{value}</div><div style={{ fontSize: 12, color: "#6B7280", marginTop: 2, fontWeight: 500 }}>{label}</div></div>
</div>
);
}
