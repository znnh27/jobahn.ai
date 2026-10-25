import type { ReactNode } from "react";
import { InfoTip } from "@/app/InfoTip";

// JD 適配度：直接從 JD 條件對照清單算「已涵蓋條數 ÷ 總條數」，每次都一致，不是 AI 憑感覺給分。
// 這個分數怎麼算的說明收在標題旁的 ⓘ。

export function JdFitScore({
  items,
  note,
}: {
  items: { covered: boolean }[];
  note: ReactNode;
}) {
  const total = items.length;
  const covered = items.filter((i) => i.covered).length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : null;

  return (
    <div className="jd-fit">
      <p className="jd-fit-score">
        <span className="jd-fit-label">
          JD 適配度
          <InfoTip label="JD 適配度怎麼算">
            {note}
          </InfoTip>
        </span>
        <span className="jd-fit-value">{pct === null ? "—" : `${pct}%`}</span>
        {total > 0 && (
          <span className="jd-fit-count">
            （{covered}/{total}）
          </span>
        )}
      </p>
    </div>
  );
}
