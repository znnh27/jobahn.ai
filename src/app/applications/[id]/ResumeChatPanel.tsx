"use client";

import { useRef } from "react";
import type { ChatRewrite, GeneratedResume } from "@/lib/resumes/generateResume";
import { AiChatPanel } from "./AiChatPanel";
import { checkResumeChatAction, reviseResumeAction } from "./actions";

type Resume = GeneratedResume["resume"];

// 履歷頁的「跟 AI 聊」：每次 AI 改完就整份換進草稿（可以按「上一步」退回），按「儲存」才會存起來。
// 改完的寫法檢查在背景跑（2026-10-31 Z：聊天還是很慢）：先顯示改好的履歷，檢查回來再換掉有問題的條目、補一則說明。
// 檢查還沒回來就送了下一則，舊的檢查結果作廢，不會蓋掉新的修改；但舊那則改到的條目會帶到下一則一起檢查，不會漏掉。
// 檢查跑完之前，畫布的定案、校稿、重新產生先停用（onCheckingChange），免得還沒檢查的內容被定案寫回經歷資料庫。

/** AI 這次新增或改到的 bullet（修改前的履歷裡沒有這段文字）。 */
function newBullets(before: Resume, after: Resume): string[] {
  const all = (r: Resume) => [...(r.work_experience ?? []), ...(r.leadership ?? [])].flatMap((e) => e.bullets ?? []);
  const old = new Set(all(before));
  return all(after).filter((t) => t.trim() && !old.has(t));
}

const EXAMPLES = ["最新那份工作多加兩條", "摘要改短一點", "把跟 JD 無關的那條拿掉"];

export function ResumeChatPanel({
  applicationId,
  language,
  resume,
  onApply,
  onApplyRewrites,
  onCheckingChange,
  onClose,
}: {
  applicationId: string;
  language: string;
  resume: Resume;
  onApply: (next: Resume) => void;
  /** 套用背景檢查的改寫，回傳實際換掉幾條（畫面上那條已經不是原文就不換）。 */
  onApplyRewrites: (rewrites: ChatRewrite[]) => number;
  /** 背景檢查開始、全部跑完時通知畫布。 */
  onCheckingChange: (checking: boolean) => void;
  onClose: () => void;
}) {
  /** 每送出一則加 1；背景檢查回來時不是最新一則就作廢。 */
  const latestSend = useRef(0);
  /** 還沒檢查完的條目跟當時的指令：檢查結果被作廢時留著，下一則一起檢查。 */
  const unchecked = useRef<{ texts: string[]; instructions: string[] }>({ texts: [], instructions: [] });
  const runningChecks = useRef(0);

  return (
    <AiChatPanel
      ariaLabel="跟 AI 聊，修改履歷"
      intro="想怎麼改這份履歷？我只會用經歷資料庫裡的事實，改完可以按「上一步」退回。"
      examples={EXAMPLES}
      placeholder="例如：Northwind 那段多加兩條跟數據分析有關的"
      onClose={onClose}
      onSend={async (instruction, history) => {
        const sendId = ++latestSend.current;
        const before = resume;
        const result = await reviseResumeAction(applicationId, language, before, history, instruction);
        if (result.error || !result.resume) return { error: result.error ?? "修改失敗，請再試一次" };
        const revised = result.resume;
        onApply(revised);
        const carried = unchecked.current;
        if (!result.needsCheck && carried.texts.length === 0) return { reply: result.reply };

        // 這則改到的也先記成「還沒檢查」：萬一這次的結果又被下一則作廢，下一則會一起檢查。
        const instructions = [...carried.instructions, instruction];
        unchecked.current = { texts: [...new Set([...carried.texts, ...newBullets(before, revised)])], instructions };
        runningChecks.current++;
        onCheckingChange(true);
        const followUp = checkResumeChatAction(
          applicationId,
          language,
          before,
          revised,
          instructions.join("；"),
          result.learned ?? [],
          carried.texts,
        )
          .then((check) => {
            if (latestSend.current !== sendId) return null;
            unchecked.current = { texts: [], instructions: [] };
            if (check.error) return null;
            const applied = check.rewrites?.length ? onApplyRewrites(check.rewrites) : 0;
            const lines = [
              applied > 0 ? `另外照寫作規則調整了 ${applied} 條的寫法。` : "",
              check.missingNote ?? "",
            ].filter(Boolean);
            return lines.length > 0 ? lines.join("\n\n") : null;
          })
          .finally(() => {
            runningChecks.current--;
            if (runningChecks.current === 0) onCheckingChange(false);
          });
        return { reply: result.reply, followUp };
      }}
    />
  );
}
