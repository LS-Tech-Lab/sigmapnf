import { S } from "../../../constants";

function SkeletonRow({ cols = 6 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={S.td}>
          <div style={{
            height: 14, width: [120, 90, 160, 90, 80, 100][i] || 100, borderRadius: 4,
            background: "linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%)",
            backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite",
          }} />
        </td>
      ))}
    </tr>
  );
}

export default SkeletonRow;
