import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  LineRuleType,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import { CONTACT_SEPARATOR, contactParts, getLabels, pickName, type ResumeDocInput } from "./resumeDocContent";
import { resolveMetrics, type ResumeMetrics } from "@/lib/resumes/typography";
import { groupContactLines } from "./contactLines";
import { joinList } from "@/lib/resumes/background";

const PAGE_MARGIN_TWIPS = 720; // 0.5"
const PAGE_WIDTH_TWIPS = 11906; // A4
const RIGHT_TAB_POS = PAGE_WIDTH_TWIPS - PAGE_MARGIN_TWIPS * 2;
const BODY_WIDTH_PT = RIGHT_TAB_POS / 20;

const FONT = "Calibri";

// 字級、行距、段落間距都用 resolveMetrics() 算，跟 PDF（ResumePdfDocument）同一組數字。
// 行距一律用「固定」：英文用「至少」的話，Word 會照 Calibri 自己的行高撐開，跟 PDF 對不上。

// docx 的字級單位是半點（half-point），11pt = 22；間距單位是 1/20 pt（twip）。
const halfPt = (pt: number) => Math.round(pt * 2);
const twip = (pt: number) => Math.round(pt * 20);

/** 跟 PDF 一樣：字級比內文大的段落，行高照內文的行距比例放大。 */
function exactLine(fontPt: number, m: ResumeMetrics) {
  return { line: twip((fontPt * m.line) / m.body), lineRule: LineRuleType.EXACT };
}

function sectionHeader(text: string, m: ResumeMetrics): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "000000" } },
    spacing: { before: twip(m.sectionBefore), after: twip(m.sectionAfter), ...exactLine(m.header, m) },
    children: [new TextRun({ text, bold: true, size: halfPt(m.header), font: FONT })],
  });
}

function orgLine(org: string, location: string | null, m: ResumeMetrics): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB_POS }],
    spacing: { before: twip(m.block) },
    children: [
      new TextRun({ text: org, bold: true, font: FONT }),
      new TextRun({ text: `\t${location ?? ""}`, font: FONT }),
    ],
  });
}

function roleLine(role: string, period: string): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB_POS }],
    children: [
      new TextRun({ text: role, font: FONT }),
      new TextRun({ text: `\t${period}`, font: FONT }),
    ],
  });
}

function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    // 縮排跟 PDF 一樣（bullet 往內 12pt、符號欄 10pt），Word 預設的清單縮排比較寬，一行放的字會變少。
    indent: { left: twip(22), hanging: twip(10) },
    children: [new TextRun({ text, font: FONT })],
  });
}

export async function buildResumeDocx(input: ResumeDocInput): Promise<Buffer> {
  const { contact, resume, language } = input;
  const labels = getLabels(language);
  const t = resolveMetrics(language, resume.layout);
  const name = pickName(contact, language);
  // 聯絡資訊：標籤粗體、內容一般字重，用「 / 」隔開。分行照 PDF 同一套算法（contactLines.ts），
  // 每一行開頭插換行，Word 才不會把一組「標籤: 內容」拆到兩行。
  const lines = groupContactLines(contactParts(contact, language), t.contact, BODY_WIDTH_PT);
  const contactRuns = lines.flatMap(
    (line, li) =>
      line.flatMap((p, i) => [
        ...(i > 0 ? [new TextRun({ text: CONTACT_SEPARATOR, size: halfPt(t.contact), font: FONT })] : []),
        new TextRun({
          text: `${p.label}: `,
          bold: true,
          size: halfPt(t.contact),
          font: FONT,
          break: li > 0 && i === 0 ? 1 : undefined,
        }),
        new TextRun({ text: p.value, size: halfPt(t.contact), font: FONT }),
        // 換行前「/」留在上一行尾端，跟畫布、PDF 一樣。
        ...(i === line.length - 1 && li < lines.length - 1
          ? [new TextRun({ text: CONTACT_SEPARATOR.trimEnd(), size: halfPt(t.contact), font: FONT })]
          : []),
      ]),
  );

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { line: twip(t.name * 1.2), lineRule: LineRuleType.EXACT },
      children: [new TextRun({ text: name, bold: true, size: halfPt(t.name), font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: twip(t.contactBefore), after: twip(t.contactAfter), ...exactLine(t.contact, t) },
      children: contactRuns,
    }),
    sectionHeader(labels.summary, t),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: resume.summary, font: FONT })],
    }),
    sectionHeader(labels.experience, t),
    ...resume.work_experience.flatMap((exp) => [
      orgLine(exp.org, exp.location, t),
      roleLine(exp.role, exp.period),
      ...exp.bullets.map(bulletParagraph),
    ]),
  ];

  if (resume.leadership.length > 0) {
    children.push(
      sectionHeader(labels.leadership, t),
      ...resume.leadership.flatMap((exp) => [
        orgLine(exp.org, exp.location, t),
        roleLine(exp.role, exp.period),
        ...exp.bullets.map(bulletParagraph),
      ]),
    );
  }

  children.push(
    sectionHeader(labels.education, t),
    ...resume.education.flatMap((edu) => {
      const rows = [orgLine(edu.school, edu.location, t)];
      if (edu.detail || edu.period) {
        rows.push(
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB_POS }],
            children: [
              new TextRun({ text: edu.detail ?? "", font: FONT }),
              new TextRun({ text: `\t${edu.period ?? ""}`, font: FONT }),
            ],
          }),
        );
      }
      return rows;
    }),
  );

  children.push(
    sectionHeader(labels.skills, t),
    new Paragraph({
      children: [
        new TextRun({ text: `${labels.computer} `, bold: true, font: FONT }),
        new TextRun({ text: joinList(resume.skills, language), font: FONT }),
      ],
    }),
  );
  if ((resume.languages ?? []).length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${labels.languages} `, bold: true, font: FONT }),
          new TextRun({ text: joinList(resume.languages ?? [], language), font: FONT }),
        ],
      }),
    );
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: halfPt(t.body) },
          paragraph: { spacing: { line: twip(t.line), lineRule: LineRuleType.EXACT } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH_TWIPS, height: 16838 },
            margin: {
              top: PAGE_MARGIN_TWIPS,
              bottom: PAGE_MARGIN_TWIPS,
              left: PAGE_MARGIN_TWIPS,
              right: PAGE_MARGIN_TWIPS,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
