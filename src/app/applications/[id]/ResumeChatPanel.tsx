"use client";

import type { GeneratedResume } from "@/lib/resumes/generateResume";
import { AiChatPanel } from "./AiChatPanel";
import { reviseResumeAction } from "./actions";

type Resume = GeneratedResume["resume"];

// 履歷頁的「跟 AI 聊」：每次 AI 改完就整份換進草稿（可以按「上一步」退回），按「儲存」才會存起來。

const EXAMPLES = ["最新那份工作多加兩條", "摘要改短一點", "把跟 JD 無關的那條拿掉"];

export function ResumeChatPanel({
  applicationId,
  language,
  resume,
  onApply,
  onClose,
}: {
  applicationId: string;
  language: string;
  resume: Resume;
  onApply: (next: Resume) => void;
  onClose: () => void;
}) {
  return (
    <AiChatPanel
      ariaLabel="跟 AI 聊，修改履歷"
      intro="想怎麼改這份履歷？我只會用經歷資料庫裡的事實，改完可以按「上一步」退回。"
      examples={EXAMPLES}
      placeholder="例如：Northwind 那段多加兩條跟數據分析有關的"
      onClose={onClose}
      onSend={async (instruction, history) => {
        const result = await reviseResumeAction(applicationId, language, resume, history, instruction);
        if (result.error || !result.resume) return { error: result.error ?? "修改失敗，請再試一次" };
        onApply(result.resume);
        return { reply: result.reply };
      }}
    />
  );
}
