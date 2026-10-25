"use client";

import { AiChatPanel } from "../AiChatPanel";
import { reviseCoverLetterAction } from "../actions";

// 求職信頁的「跟 AI 聊」：AI 改完整封換進草稿（頁面上可以按「復原上一版」），按「儲存」才會存起來。
// 署名、聯絡方式由系統放，AI 不會改到。

const EXAMPLES = ["第二段寫得更具體一點", "縮短到 300 字", "語氣正式一點"];

export function CoverLetterChatPanel({
  applicationId,
  language,
  letter,
  onApply,
  onClose,
}: {
  applicationId: string;
  language: string;
  letter: string;
  onApply: (next: string) => void;
  onClose: () => void;
}) {
  return (
    <AiChatPanel
      ariaLabel="跟 AI 聊，修改求職信"
      intro="想怎麼改這封求職信？我只會用履歷裡的事實，改完可以按「復原上一版」退回。"
      examples={EXAMPLES}
      placeholder="例如：開頭那段改得自然一點"
      onClose={onClose}
      onSend={async (instruction, history) => {
        const result = await reviseCoverLetterAction(applicationId, language, letter, history, instruction);
        if (result.error || !result.letter) return { error: result.error ?? "修改失敗，請再試一次" };
        onApply(result.letter);
        return { reply: result.reply };
      }}
    />
  );
}
