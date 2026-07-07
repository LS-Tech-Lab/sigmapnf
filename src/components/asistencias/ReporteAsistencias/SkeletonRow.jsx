import "./index.css";

function SkeletonRow({ cols = 6 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="s-td">
          <div className="ra-skeleton-bar" />
        </td>
      ))}
    </tr>
  );
}

export default SkeletonRow;
