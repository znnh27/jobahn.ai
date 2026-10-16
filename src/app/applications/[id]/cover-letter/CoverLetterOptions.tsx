"use client";

import { WORD_LIMIT_MAX, isValidWordLimit, letterLengthUnit, wordLimitMin } from "@/lib/text/letterLength";
import { InfoTip } from "@/app/InfoTip";

// 生成求職信前要選的東西：語言、各語言的字數上限（選填）、要不要先上網研究這間公司。
// 履歷頁的「寫求職信」視窗跟求職信頁的空白狀態共用這一組欄位。

export interface CoverLetterChoice {
  languages: string[];
  /** 輸入框的字串，空白 = 不限。 */
  wordLimits: Record<string, string>;
  research: boolean;
}

const LANG_LABEL: Record<string, string> = { en: "英文", zh: "中文" };

export function initialChoice(languages: string[], researchAvailable: boolean): CoverLetterChoice {
  return { languages, wordLimits: {}, research: researchAvailable };
}

/** 只留勾選語言、而且是合理數字的字數上限。 */
export function choiceWordLimits(choice: CoverLetterChoice): Record<string, number> {
  const limits: Record<string, number> = {};
  for (const lang of choice.languages) {
    const n = Number(choice.wordLimits[lang]);
    if (isValidWordLimit(lang, n)) limits[lang] = n;
  }
  return limits;
}

/** 某個語言填的字數上限不合理時的說明（空白 = 不限，不算錯）。 */
function limitError(lang: string, raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const n = Number(raw);
  if (isValidWordLimit(lang, n)) return null;
  if (Number.isFinite(n) && n > WORD_LIMIT_MAX) return `最多 ${WORD_LIMIT_MAX} ${letterLengthUnit(lang)}`;
  return `太短寫不出完整的求職信，至少 ${wordLimitMin(lang)} ${letterLengthUnit(lang)}`;
}

/** 選項有問題（沒選語言、字數上限不合理）就不能按生成。 */
export function choiceInvalid(choice: CoverLetterChoice): boolean {
  return choice.languages.length === 0 || choice.languages.some((lang) => limitError(lang, choice.wordLimits[lang]));
}

/** 從履歷頁跳到求職信頁時帶在網址上（?generate=zh,en&limit_zh=400&research=1）。 */
export function choiceToQuery(choice: CoverLetterChoice): string {
  const params = new URLSearchParams({ generate: choice.languages.join(",") });
  for (const [lang, n] of Object.entries(choiceWordLimits(choice))) params.set(`limit_${lang}`, String(n));
  if (choice.research) params.set("research", "1");
  return params.toString();
}

export function CoverLetterOptionsFields({
  value,
  onChange,
  researchAvailable,
}: {
  value: CoverLetterChoice;
  onChange: (next: CoverLetterChoice) => void;
  researchAvailable: boolean;
}) {
  function toggleLang(lang: string) {
    const languages = value.languages.includes(lang)
      ? value.languages.filter((l) => l !== lang)
      : [...value.languages, lang];
    onChange({ ...value, languages });
  }

  return (
    <div className="cover-options">
      <div className="checkbox-row">
        {["zh", "en"].map((lang) => (
          <label key={lang} className="checkbox-label">
            <input type="checkbox" checked={value.languages.includes(lang)} onChange={() => toggleLang(lang)} />
            {LANG_LABEL[lang]}
          </label>
        ))}
      </div>

      {value.languages.map((lang) => (
        <label key={lang} className="cover-options-limit">
          <span>{LANG_LABEL[lang]}字數上限</span>
          <input
            type="number"
            inputMode="numeric"
            min={wordLimitMin(lang)}
            max={WORD_LIMIT_MAX}
            step={10}
            placeholder="不限"
            className="input cover-options-limit-input"
            value={value.wordLimits[lang] ?? ""}
            onChange={(e) => onChange({ ...value, wordLimits: { ...value.wordLimits, [lang]: e.target.value } })}
          />
          <span className="text-muted">{letterLengthUnit(lang)}以內（選填）</span>
          {limitError(lang, value.wordLimits[lang]) && (
            <span className="text-error cover-options-limit-error">{limitError(lang, value.wordLimits[lang])}</span>
          )}
        </label>
      ))}

      {researchAvailable && (
        <label className="checkbox-label cover-options-research">
          <input
            type="checkbox"
            checked={value.research}
            onChange={(e) => onChange({ ...value, research: e.target.checked })}
          />
          <span>
            先上網研究這間公司
            <InfoTip label="研究公司的說明">
              讓「為什麼想加入」這段寫得更具體。大約多等 15 秒，也會多用一點 AI 和 Firecrawl 額度。
            </InfoTip>
          </span>
        </label>
      )}
    </div>
  );
}
