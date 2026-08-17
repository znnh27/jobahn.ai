import "server-only";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

/** 從履歷檔案的二進位內容擷取純文字，依副檔名決定用哪個套件 */
export async function extractResumeText(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop();

  if (ext === "docx" || ext === "doc") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === "pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    return result.text;
  }

  throw new Error(`不支援的檔案格式：${fileName}`);
}
