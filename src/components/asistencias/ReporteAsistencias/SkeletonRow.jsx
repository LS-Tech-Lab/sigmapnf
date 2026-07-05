import "./index.css";

function SkeletonRow({ cols = 6 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="s-td">
          <div
            className="ra-skeleton-bar"
            style={{ "--skeleton-width": `${[120, 90, 160, 90, 80, 100][i] || 100}px` }}
          />
        </td>
      ))}
    </tr>
  );
}

export default SkeletonRow;
