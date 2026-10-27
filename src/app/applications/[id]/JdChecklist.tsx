import type { JdChecklistItem } from "@/lib/resumes/generateResume";
import type { ReactNode } from "react";
import { AlertIcon, CheckCircleIcon, MinusCircleIcon, QuestionCircleIcon } from "@/app/icons";
import { InfoTip } from "@/app/InfoTip";

// JD 條件對照，履歷頁跟求職信頁共用，分三段（2026-10-24 Z 定案）：
// 1. JD 條件（硬實力）：算分。每一條打勾或驚嘆號，要補的排上面、已經寫到的排下面；
//    履歷頁的條件是兩層風琴（2026-10-27 Z 要求）：沒寫到、部分符合的那幾條才能展開、預設收起來，
//    展開是缺口說明跟「讓 AI 幫你挖掘這段經驗」。
//    AI 判斷有問題（判定沒寫到卻說不出缺什麼）的項目標出來、不算分，請使用者重新評分。
//    不顯示 JD 關鍵字（2026-10-27 Z 拿掉「JD 關鍵字」區塊跟「換成 JD 用字」，覺得跟 JD 條件打架）。
// 2. 求職信可以補充的特質（軟實力）：履歷證明不了，履歷頁不算分、用灰色小圓點；求職信頁看求職信有沒有用例子帶出來，
//    跟 JD 條件一樣用打勾／驚嘆號，排在 JD 條件正下方（2026-10-25 Z 要求）。
// 3. 工作條件（出差、外派…）：履歷頁不算分，問使用者能不能配合（給了 onAnswerCondition 才問）；求職信頁跟特質一樣算。
// isCovered 決定「算不算寫到」：履歷頁只算履歷本身，求職信頁履歷＋求職信合起來算。
// 求職信頁：求職信補上的項目跟履歷本身寫到的一樣算已寫到，只分已寫到、部分符合、沒寫到（2026-10-27 Z 要求，拿掉「求職信補上」狀態）；
//    缺口說明是改履歷用的建議，求職信頁不顯示。
// 求職信頁沒寫到、部分符合的條件跟還沒提到的特質，底下有「補充進求職信」、標題旁有「全部補充進求職信」：
// 使用者自己挑要補哪幾項（2026-10-25 Z 要求）；挑了就等於確認自己具備，AI 每項都補，找不到事實的寫成能力陳述、不編造細節（2026-10-27）。
// 部分符合（科系要求商管、使用者輔修商管；或一項綁好幾個條件、做到一半以上）排在沒寫到的後面、已寫到的前面，算一半分數。
// 每一條的狀態只用前面的 icon 表示，滑過 icon 才顯示狀態名稱，不另外標文字（2026-10-24 Z 要求）。
// icon 是同一組圓框：已寫到打勾、部分符合橫線、沒寫到驚嘆號、判斷有問題問號（2026-10-25 Z 要求）。
// 每個區塊的標題只寫名稱、不放統計數字，都可以收起來，預設展開（2026-10-25 Z 要求）。
// 缺口說明一句一點（圓點條列），縮排在條件下面，比較好讀（2026-10-27 Z 要求）。舊資料的缺口清單沒有對應的條件，才另外列一個「缺口說明」區塊。

export function JdChecklist({
  items,
  isCovered,
  scope = "resume",
  legacyGaps = [],
  language,
  onDig,
  onAnswerCondition,
  onAddToLetter,
}: {
  items: JdChecklistItem[];
  isCovered: (item: JdChecklistItem) => boolean;
  /** resume＝履歷頁（軟實力、工作條件不算分）；letter＝求職信頁（全部都算）。 */
  scope?: "resume" | "letter";
  /** 舊資料的缺口清單（那時候每一項還沒有自己的缺口說明）。 */
  legacyGaps?: string[];
  /** JD 條件是用哪種語言寫的。英文左右對齊時要能自動斷字，字距才不會被拉得很開。 */
  language?: string;
  onDig?: (item: string) => void;
  onAnswerCondition?: (item: string, willing: boolean) => void;
  /** 求職信頁「補充進求職信」：把這幾項補進信裡。 */
  onAddToLetter?: (items: JdChecklistItem[]) => void;
}) {
  const requirements = items.filter((i) => (i.kind ?? "requirement") === "requirement");
  const traits = items.filter((i) => i.kind === "trait");
  const conditions = items.filter((i) => i.kind === "condition");

  const letter = scope === "letter";
  /** 每一條的狀態。soft＝履歷頁不算分的特質、工作條件還沒寫到，用灰色小圓點。 */
  const stateOf = (item: JdChecklistItem, scored: boolean): CheckState | "soft" => {
    if (item.invalid) return "invalid";
    if (isCovered(item)) return "ok";
    if (!scored) return "soft";
    return item.partial ? "partial" : "gap";
  };

  // 要補的排上面：判斷有問題、沒寫到、部分符合、已寫到。
  const ORDER: Record<CheckState | "soft", number> = { invalid: 0, gap: 1, partial: 2, soft: 2, ok: 3 };
  const sorted = requirements
    .map((item) => ({ item, state: stateOf(item, true) }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state]);

  // 舊資料的缺口清單：那時候每一條還沒有自己的缺口說明，只能另外列。
  const hasItemGaps = requirements.some((item) => !!item.gap);
  const orphanGaps = hasItemGaps ? [] : legacyGaps;

  const lang = language === "en" ? "en" : undefined;

  // 求職信頁可以補的：沒寫到、部分符合（判斷有問題的不算）。
  const canAdd = (state: CheckState | "soft") => letter && !!onAddToLetter && (state === "gap" || state === "partial");
  const addAll = (list: JdChecklistItem[]) =>
    list.length > 0 &&
    onAddToLetter && (
      <button
        type="button"
        className="link-muted ats-block-action"
        onClick={(e) => {
          // 按鈕在可收合的標題列裡，不要順便把區塊收起來。
          e.preventDefault();
          onAddToLetter(list);
        }}
      >
        全部補充進求職信
      </button>
    );
  const addOne = (item: JdChecklistItem) => (
    <button type="button" className="link-muted ats-check-dig" onClick={() => onAddToLetter?.([item])}>
      補充進求職信
    </button>
  );

  const requirementBlock = requirements.length > 0 && (
    <Block
      title="JD 條件"
      action={letter && addAll(sorted.filter(({ state }) => canAdd(state)).map(({ item }) => item))}
    >
      <ul className="ats-checklist-list" lang={lang}>
        {sorted.map(({ item, state }, i) => {
          const text = (
            <>
              {item.item}
              {state === "invalid" && <span className="ats-check-tag">判斷有問題，請重新檢查評分</span>}
            </>
          );
          // 求職信頁不展開：缺口說明是改履歷用的。
          const showGap = !letter && (state === "gap" || state === "partial");
          const canDig = showGap && !!onDig;
          const expandable = showGap && (!!item.gap || canDig);
          return (
            <li key={i} className={`ats-check ats-check--${state}`}>
              <StatusIcon state={state} />
              <div className="ats-check-body">
                {expandable ? (
                  <details className="ats-check-details">
                    <summary className="ats-check-summary">
                      <span className="ats-check-item">{text}</span>
                      <span className="disclosure-arrow" aria-hidden="true" />
                    </summary>
                    <div className="ats-check-detail">
                      {showGap && item.gap && (
                        <ul className="ats-gap-body">
                          {splitSentences(item.gap).map((line, j) => (
                            <li key={j}>{line}</li>
                          ))}
                        </ul>
                      )}
                      {canDig && (
                        <div className="ats-check-actions">
                          <button type="button" className="link-muted" onClick={() => onDig(item.item)}>
                            讓 AI 幫你挖掘這段經驗
                          </button>
                        </div>
                      )}
                    </div>
                  </details>
                ) : (
                  <p className="ats-check-item">{text}</p>
                )}
                {canAdd(state) && addOne(item)}
              </div>
            </li>
          );
        })}
      </ul>
    </Block>
  );

  const gapBlock = !letter && orphanGaps.length > 0 && (
    <Block title="缺口說明">
      <ul className="ats-gap-list" lang={lang}>
        {orphanGaps.map((gap, i) => (
          <li key={i} className="ats-gap">
            <ul className="ats-gap-body">
              {splitSentences(gap).map((line, j) => (
                <li key={j}>{line}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Block>
  );

  const traitBlock = traits.length > 0 && (
    <Block
      title="求職信可以補充的特質"
      action={letter && addAll(traits.filter((item) => canAdd(stateOf(item, true))))}
    >
      <ul className="ats-checklist-list" lang={lang}>
        {traits.map((item, i) => {
          const state = stateOf(item, letter);
          return (
            <li key={i} className={`ats-check ats-check--${state}`}>
              <StatusIcon state={state} />
              <div className="ats-check-body">
                <p className="ats-check-item">{item.item}</p>
                {canAdd(state) && addOne(item)}
              </div>
            </li>
          );
        })}
      </ul>
    </Block>
  );

  const conditionBlock = conditions.length > 0 && (
    <Block title="工作條件">
      <ul className="ats-checklist-list" lang={lang}>
        {conditions.map((item, i) => {
          const state = stateOf(item, letter);
          const ok = state === "ok";
          return (
            <li key={i} className={`ats-check ats-check--${state}`}>
              <StatusIcon state={state} />
              <div className="ats-check-body">
                <p className="ats-check-item">
                  {item.item}
                  {!ok && item.answer === "no" && <span className="ats-check-tag">無法配合</span>}
                  {!ok && item.answer === "yes" && <span className="ats-check-tag">可以配合</span>}
                </p>
                {!ok && onAnswerCondition && !item.answer && (
                  <div className="ats-check-answer">
                    <span className="ats-check-answer-label">這個條件你可以配合嗎？</span>
                    <div className="btn-wrapper">
                      <button type="button" className="btn btn-secondary" onClick={() => onAnswerCondition(item.item, false)}>
                        無法配合
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => onAnswerCondition(item.item, true)}>
                        可以配合
                      </button>
                    </div>
                  </div>
                )}
                {!ok && onAnswerCondition && item.answer === "no" && (
                  <button type="button" className="link-muted ats-check-dig" onClick={() => onAnswerCondition(item.item, true)}>
                    改成可以配合
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Block>
  );

  // 求職信頁：特質是求職信的主場，緊接在 JD 條件下面；履歷頁特質、工作條件只是參考，排最後。
  return letter ? (
    <>
      {requirementBlock}
      {traitBlock}
      {conditionBlock}
    </>
  ) : (
    <>
      {requirementBlock}
      {gapBlock}
      {traitBlock}
      {conditionBlock}
    </>
  );
}

/** 可以收起來的區塊：標題列整條可以點，最右邊是箭頭；action 是放在標題旁的小按鈕。 */
function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <details className="ats-block" open>
      <summary className="ats-block-title">
        <span className="ats-block-title-text">{title}</span>
        {action}
        <span className="disclosure-arrow" aria-hidden="true" />
      </summary>
      {children}
    </details>
  );
}

type CheckState = "ok" | "gap" | "partial" | "invalid";

const STATUS_TIP: Record<CheckState, string> = {
  ok: "已寫到",
  gap: "沒寫到",
  partial: "部分符合",
  invalid: "判斷有問題，請重新評分",
};

const STATUS_ICON: Record<CheckState, ReactNode> = {
  ok: <CheckCircleIcon />,
  gap: <AlertIcon />,
  partial: <MinusCircleIcon />,
  invalid: <QuestionCircleIcon />,
};

/** 每一條前面的狀態 icon，滑過（手機點一下）說明是什麼狀態。 */
function StatusIcon({ state }: { state: CheckState | "soft" }) {
  if (state === "soft") {
    return (
      <span className="ats-check-icon">
        <span className="ats-check-dot" />
      </span>
    );
  }
  return (
    <span className="ats-check-icon">
      <InfoTip icon={STATUS_ICON[state]} label={STATUS_TIP[state]} className="info-tip--status">
        {STATUS_TIP[state]}
      </InfoTip>
    </span>
  );
}

/** 缺口說明一句一點（照句號切）。 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？])/)
    .map((t) => t.trim())
    .filter(Boolean);
}
