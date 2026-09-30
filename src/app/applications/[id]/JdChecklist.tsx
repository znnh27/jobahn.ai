import type { JdChecklistItem } from "@/lib/resumes/generateResume";
import { AlertIcon, CheckIcon } from "@/app/icons";

// JD 條件對照，履歷頁（ATS 卡片裡）跟求職信頁共用，兩個區塊：
// - JD 條件：每一項打勾或驚嘆號，要補的排上面、已經寫到的排下面；給了 onDig 的話，
//   沒寫到的項目底下可以直接請 AI 幫忙挖掘這段經驗。
// - 缺口說明：沒寫到的項目各自缺什麼、差在哪、可以怎麼補。
// isCovered 決定「算不算寫到」：履歷頁只算履歷本身，求職信頁履歷＋求職信合起來算。

export function JdChecklist({
  items,
  isCovered,
  legacyGaps = [],
  showSource = false,
  language,
  onDig,
}: {
  items: JdChecklistItem[];
  isCovered: (item: JdChecklistItem) => boolean;
  /** 舊資料的缺口清單（那時候每一項還沒有自己的缺口說明）。 */
  legacyGaps?: string[];
  /** 寫到的項目後面標出是履歷還是求職信寫到的。 */
  showSource?: boolean;
  /** JD 條件是用哪種語言寫的。英文左右對齊時要能自動斷字，字距才不會被拉得很開。 */
  language?: string;
  onDig?: (item: string) => void;
}) {
  const missing = items.filter((i) => !isCovered(i));
  const covered = items.filter((i) => isCovered(i));
  const itemGaps = missing.map((i) => i.gap).filter((g): g is string => !!g);
  const gaps = itemGaps.length > 0 ? itemGaps : legacyGaps;

  return (
    <>
      {items.length > 0 && (
        <div className="ats-block">
          <p className="ats-block-title">
            JD 條件：已寫到 {covered.length} / {items.length} 項
          </p>
          <ul className="ats-checklist-list" lang={language === "en" ? "en" : undefined}>
            {[...missing, ...covered].map((item, i) => {
              const ok = isCovered(item);
              return (
                <li key={i} className={`ats-check ${ok ? "ats-check--ok" : "ats-check--gap"}`}>
                  <span className="ats-check-icon">{ok ? <CheckIcon /> : <AlertIcon />}</span>
                  <div className="ats-check-body">
                    <p className="ats-check-item">
                      {item.item}
                      {ok && showSource && item.source && (
                        <span className="checklist-item-source">（{item.source === "cover_letter" ? "求職信" : "履歷"}）</span>
                      )}
                    </p>
                    {!ok && onDig && (
                      <button type="button" className="link-muted ats-check-dig" onClick={() => onDig(item.item)}>
                        讓 AI 幫你挖掘這段經驗
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {gaps.length > 0 && (
        <div className="ats-block">
          <p className="ats-block-title">缺口說明：</p>
          <ul className="ats-gap-list">
            {gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
