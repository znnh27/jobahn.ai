// JD 適配度：直接從 JD 條件對照清單算「已涵蓋條數 ÷ 總條數」，每次都一致，不是 AI 憑感覺給分。
// 下面用小字說明這個分數怎麼算的，不佔標題空間。

export function JdFitScore({
  items,
  note,
}: {
  items: { covered: boolean }[];
  note: string;
}) {
  const total = items.length;
  const covered = items.filter((i) => i.covered).length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : null;

  return (
    <div className="jd-fit">
      <p className="jd-fit-score">
        <span className="jd-fit-label">JD 適配度</span>
        <span className="jd-fit-value">{pct === null ? "—" : `${pct}%`}</span>
        {total > 0 && (
          <span className="jd-fit-count">
            （{covered}/{total}）
          </span>
        )}
      </p>
      <p className="jd-fit-note">{note}</p>
    </div>
  );
}
