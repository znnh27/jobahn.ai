import type { ResumeContact } from "@/lib/resumes/contact";

// 下載檔名：公司-職位_姓名_En/Zh，例如 AcmeLabs-PM_AlexChen_En.pdf。
// - 公司、職位、姓名：每個字第一個字母轉大寫，空格拿掉（Acme Labs → AcmeLabs）；中文沒有空格就照原樣。不縮寫。
// - 姓名一律用英文名（中文版也是），檔名全英文，寄到國外的系統比較不會變亂碼。沒有英文名才用中文名。
// - 檔名裡不適合出現的符號（/ \ : * ? " < > | 逗號、括號等）拿掉。

const UNSAFE = /[\\/:*?"<>|,.;()[\]{}'`!@#$%^&+=~]/g;

function joinWords(text: string | null | undefined): string {
  return (text ?? "")
    .replace(UNSAFE, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

export function resumeFileName(params: {
  companyName: string | null;
  jobTitle: string | null;
  contact: ResumeContact;
  language: string;
  ext: string;
}): string {
  const company = joinWords(params.companyName) || "Resume";
  const title = joinWords(params.jobTitle);
  const name = joinWords(params.contact.name_en) || joinWords(params.contact.name_zh);
  const lang = params.language === "zh" ? "Zh" : "En";
  const head = title ? `${company}-${title}` : company;
  return `${[head, name, lang].filter(Boolean).join("_")}.${params.ext}`;
}
