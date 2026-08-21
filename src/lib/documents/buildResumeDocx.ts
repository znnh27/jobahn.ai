import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";
import { buildContactLine, getLabels, pickName, type ResumeDocInput } from "./resumeDocContent";

const PAGE_MARGIN_TWIPS = 720; // 0.5"
const PAGE_WIDTH_TWIPS = 11906; // A4
const RIGHT_TAB_POS = PAGE_WIDTH_TWIPS - PAGE_MARGIN_TWIPS * 2;

const FONT = "Calibri";

function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "000000" } },
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, font: FONT })],
  });
}

function orgLine(org: string, location: string | null): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB_POS }],
    spacing: { before: 120 },
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
      new TextRun({ text: role, bold: true, italics: true, font: FONT }),
      new TextRun({ text: `\t${period}`, italics: true, font: FONT }),
    ],
  });
}

function bulletParagraph(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    children: [new TextRun({ text, size: 22, font: FONT })],
  });
}

export async function buildResumeDocx(input: ResumeDocInput): Promise<Buffer> {
  const { contact, resume, language } = input;
  const labels = getLabels(language);
  const name = pickName(contact, language);
  const contactLine = buildContactLine(contact);

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: name, bold: true, size: 36, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: contactLine, size: 16, font: FONT })],
    }),
    sectionHeader(labels.summary),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: resume.summary, size: 22, font: FONT })],
    }),
    sectionHeader(labels.experience),
    ...resume.work_experience.flatMap((exp) => [
      orgLine(exp.org, exp.location),
      roleLine(exp.role, exp.period),
      ...exp.bullets.map(bulletParagraph),
    ]),
  ];

  if (resume.leadership.length > 0) {
    children.push(
      sectionHeader(labels.leadership),
      ...resume.leadership.flatMap((exp) => [
        orgLine(exp.org, exp.location),
        roleLine(exp.role, exp.period),
        ...exp.bullets.map(bulletParagraph),
      ]),
    );
  }

  children.push(
    sectionHeader(labels.education),
    ...resume.education.flatMap((edu) => {
      const rows = [orgLine(edu.school, edu.location)];
      if (edu.detail || edu.period) {
        rows.push(
          new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB_POS }],
            children: [
              new TextRun({ text: edu.detail ?? "", italics: true, font: FONT }),
              new TextRun({ text: `\t${edu.period ?? ""}`, italics: true, font: FONT }),
            ],
          }),
        );
      }
      return rows;
    }),
  );

  children.push(
    sectionHeader(labels.skills),
    new Paragraph({
      children: [
        new TextRun({ text: `${labels.computer} `, bold: true, size: 22, font: FONT }),
        new TextRun({ text: resume.skills.join(", "), size: 22, font: FONT }),
      ],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22 },
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
