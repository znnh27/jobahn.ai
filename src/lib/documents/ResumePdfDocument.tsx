import "server-only";
import path from "node:path";
import type { ReactNode } from "react";
import { Document, Font, Page, StyleSheet, Text, View, type DocumentProps, type ViewProps } from "@react-pdf/renderer";
import { CONTACT_SEPARATOR, contactParts, getLabels, pickName, type ResumeDocInput } from "./resumeDocContent";
import { wrapCjkText } from "./wrapCjkText";
import { groupContactLines } from "./contactLines";
import { joinList } from "@/lib/resumes/background";
import { pdfKey, resolveMetrics, type ResumeMetrics, type ResumeSectionKey } from "@/lib/resumes/typography";

export const PAGE_WIDTH_PT = 595.28; // A4
export const PAGE_HEIGHT_PT = 841.89;
export const PAGE_PADDING_PT = 36; // 0.5"
export const BODY_WIDTH_PT = PAGE_WIDTH_PT - PAGE_PADDING_PT * 2;
const BULLET_INDENT_PT = 12;
const BULLET_DOT_PT = 10;
const BULLET_WIDTH_PT = BODY_WIDTH_PT - BULLET_INDENT_PT - BULLET_DOT_PT;

// 英文用 Carlito（跟 Word 的 Calibri 字寬一樣，換行位置才會跟 Word 接近），中文字 Carlito 沒有，
// 自動改用 Noto Sans TC。畫布也是同一組字型（globals.css）。
const FONT_FAMILY = ["Carlito", "NotoSansTC"];
let fontRegistered = false;

function registerFontOnce() {
  if (fontRegistered) return;
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  // Carlito 要用 .ttf：react-pdf 嵌入 woff2 字型時會出錯（fontkit 無法對 woff2 做字型子集）。
  Font.register({
    family: "Carlito",
    fonts: [
      { src: path.join(fontsDir, "carlito", "Carlito-Regular.ttf") },
      { src: path.join(fontsDir, "carlito", "Carlito-Bold.ttf"), fontWeight: "bold" },
      { src: path.join(fontsDir, "carlito", "Carlito-Italic.ttf"), fontStyle: "italic" },
      { src: path.join(fontsDir, "carlito", "Carlito-BoldItalic.ttf"), fontWeight: "bold", fontStyle: "italic" },
    ],
  });
  // Noto Sans TC 沒有斜體，但英文履歷的職稱列是斜體，裡面如果夾中文字，react-pdf 找不到斜體的 Noto 會直接噴錯，
  // 所以斜體也指到正體的檔案。
  const noto = path.join(fontsDir, "NotoSansTC-Regular.otf");
  const notoBold = path.join(fontsDir, "NotoSansTC-Bold.otf");
  Font.register({
    family: "NotoSansTC",
    fonts: [
      { src: noto },
      { src: notoBold, fontWeight: "bold" },
      { src: noto, fontStyle: "italic" },
      { src: notoBold, fontWeight: "bold", fontStyle: "italic" },
    ],
  });
  // react-pdf 的自動斷字是英文邏輯，中文字之間沒有空白可用，用內建邏輯斷行時每個斷點都會被
  // 硬插入一個「-」，中文完全不該出現這種符號。所以整個關掉自動斷字，中文段落改成用
  // wrapCjkText() 自己先量字寬、算好斷行位置，用真正的換行字元交給 react-pdf（見下方使用處）。
  Font.registerHyphenationCallback((word) => [word]);
  fontRegistered = true;
}

function createStyles(m: ResumeMetrics) {
  const lineHeight = m.line / m.body;
  return StyleSheet.create({
    page: {
      fontFamily: FONT_FAMILY,
      fontSize: m.body,
      lineHeight,
      paddingTop: PAGE_PADDING_PT,
      paddingBottom: PAGE_PADDING_PT,
      paddingLeft: PAGE_PADDING_PT,
      paddingRight: PAGE_PADDING_PT,
    },
    name: { fontSize: m.name, fontWeight: "bold", textAlign: "center", lineHeight: 1.2 },
    contact: { marginTop: m.contactBefore, marginBottom: m.contactAfter },
    contactLine: { fontSize: m.contact, lineHeight: m.line / m.body, textAlign: "center" },
    sectionHeader: {
      fontSize: m.header,
      fontWeight: "bold",
      borderBottomWidth: 0.75,
      borderBottomColor: "#000000",
      paddingBottom: 1,
      marginTop: m.sectionBefore,
      marginBottom: m.sectionAfter,
    },
    bodyText: { fontSize: m.body },
    block: { marginTop: m.block },
    row: { flexDirection: "row", justifyContent: "space-between" },
    // 左邊（公司名／職稱）文字有時很長（例如公司名後面接一長串括號說明），一定要限制寬度讓它自己
    // 換行，不然預設 flex 版面會讓左右兩欄文字疊在一起，而不是把右邊往下推。用 flex:1（等於
    // flexBasis:0）而不是只設 flexShrink，不然文字項目會用內容自身寬度當最小寬度，照樣不會縮。
    rowLeft: { flex: 1, paddingRight: 8 },
    rowRight: { flexShrink: 0 },
    bold: { fontWeight: "bold" },
    bullet: { flexDirection: "row", paddingLeft: BULLET_INDENT_PT },
    bulletDot: { width: BULLET_DOT_PT, fontSize: m.body },
    bulletText: { fontSize: m.body, flex: 1 },
  });
}

type Styles = ReturnType<typeof createStyles>;

function wrapIfZh(text: string, language: string, fontSize: number, maxWidthPt: number): string {
  return language === "zh" ? wrapCjkText(text, fontSize, maxWidthPt) : text;
}

// 每一行內容都包一個掛了 data-k 的 View，量 PDF 時才找得到它落在第幾頁（measureResumePdf.tsx）。
// data-k 不在 react-pdf 的型別裡，但會原封不動留在排版結果的 props 上。
// keepWithNext：區塊標題用，後面至少要跟著這麼高（pt）的內容才留在這一頁，不然整個標題一起換到下一頁，
// 不會出現「EDUCATION」標題孤零零留在第一頁底部、內容全在第二頁的情況。
// 只有 bullet 跟摘要這種多行段落可以被切到兩頁；標題、公司／職稱列、學校列都是一行，
// 不能被切開（不然會在第一頁留下一小段空白碎片，量出來的分頁位置也會錯）。
function Keyed({
  k,
  style,
  keepWithNext,
  splittable = false,
  children,
}: {
  k: string;
  style?: ViewProps["style"];
  keepWithNext?: number;
  splittable?: boolean;
  children: ReactNode;
}) {
  return (
    <View data-k={k} style={style} minPresenceAhead={keepWithNext} wrap={splittable}>
      {children}
    </View>
  );
}

function ExperienceBlocks({
  section,
  items,
  language,
  metrics,
  styles,
}: {
  section: ResumeSectionKey;
  items: ResumeDocInput["resume"]["work_experience"];
  language: string;
  metrics: ResumeMetrics;
  styles: Styles;
}) {
  return (
    <>
      {items.map((exp, i) => (
        <View key={i} style={styles.block}>
          <Keyed k={pdfKey.org(section, i)} style={styles.row}>
            <Text style={[styles.bold, styles.rowLeft]}>{exp.org}</Text>
            {exp.location && <Text style={[styles.bold, styles.rowRight]}>{exp.location}</Text>}
          </Keyed>
          <Keyed k={pdfKey.role(section, i)} style={styles.row}>
            <Text style={styles.rowLeft}>{exp.role}</Text>
            <Text style={styles.rowRight}>{exp.period}</Text>
          </Keyed>
          {exp.bullets.map((b, j) => (
            <Keyed key={j} k={pdfKey.bullet(section, i, j)} style={styles.bullet} splittable>
              <Text style={styles.bulletDot}>{"•"}</Text>
              <Text style={styles.bulletText}>{wrapIfZh(b, language, metrics.body, BULLET_WIDTH_PT)}</Text>
            </Keyed>
          ))}
        </View>
      ))}
    </>
  );
}

export function ResumePdfDocument({
  contact,
  resume,
  language,
  onRender,
}: ResumeDocInput & { onRender?: DocumentProps["onRender"] }) {
  registerFontOnce();
  const labels = getLabels(language);
  const metrics = resolveMetrics(language, resume.layout);
  const styles = createStyles(metrics);
  // 標題後面至少要放得下下一段的上方間距加兩行，標題才留在這一頁。
  const keepWithNext = metrics.block + metrics.line * 2;
  const name = pickName(contact, language);
  const contactLines = groupContactLines(contactParts(contact, language), metrics.contact, BODY_WIDTH_PT);

  return (
    <Document onRender={onRender}>
      <Page size="A4" style={styles.page}>
        <Keyed k={pdfKey.name()}>
          <Text style={styles.name}>{name}</Text>
        </Keyed>
        {/* 聯絡資訊：標籤粗體、內容一般字重，用「 / 」隔開；放不下時整組換到下一行（contactLines.ts）。 */}
        <Keyed k={pdfKey.contact()} style={styles.contact}>
          {contactLines.map((line, li) => (
            <Text key={li} style={styles.contactLine}>
              {line.map((p, i) => (
                <Text key={i}>
                  {i > 0 ? CONTACT_SEPARATOR : ""}
                  <Text style={styles.bold}>{p.label}: </Text>
                  {p.value}
                </Text>
              ))}
              {li < contactLines.length - 1 ? CONTACT_SEPARATOR.trimEnd() : ""}
            </Text>
          ))}
        </Keyed>

        <Keyed keepWithNext={keepWithNext} k={pdfKey.header("summary")}>
          <Text style={styles.sectionHeader}>{labels.summary}</Text>
        </Keyed>
        <Keyed k={pdfKey.summary()} splittable>
          <Text style={styles.bodyText}>{wrapIfZh(resume.summary, language, metrics.body, BODY_WIDTH_PT)}</Text>
        </Keyed>

        <Keyed keepWithNext={keepWithNext} k={pdfKey.header("experience")}>
          <Text style={styles.sectionHeader}>{labels.experience}</Text>
        </Keyed>
        <ExperienceBlocks
          section="work_experience"
          items={resume.work_experience}
          language={language}
          metrics={metrics}
          styles={styles}
        />

        {resume.leadership.length > 0 && (
          <>
            <Keyed keepWithNext={keepWithNext} k={pdfKey.header("leadership")}>
              <Text style={styles.sectionHeader}>{labels.leadership}</Text>
            </Keyed>
            <ExperienceBlocks
              section="leadership"
              items={resume.leadership}
              language={language}
              metrics={metrics}
              styles={styles}
            />
          </>
        )}

        <Keyed keepWithNext={keepWithNext} k={pdfKey.header("education")}>
          <Text style={styles.sectionHeader}>{labels.education}</Text>
        </Keyed>
        {resume.education.map((edu, i) => (
          <View key={i} style={styles.block}>
            <Keyed k={pdfKey.school(i)} style={styles.row}>
              <Text style={[styles.bold, styles.rowLeft]}>{edu.school}</Text>
              {edu.location && <Text style={[styles.bold, styles.rowRight]}>{edu.location}</Text>}
            </Keyed>
            {(edu.detail || edu.period) && (
              <Keyed k={pdfKey.eduDetail(i)} style={styles.row}>
                <Text style={styles.rowLeft}>{edu.detail ?? ""}</Text>
                <Text style={styles.rowRight}>{edu.period ?? ""}</Text>
              </Keyed>
            )}
          </View>
        ))}

        <Keyed keepWithNext={keepWithNext} k={pdfKey.header("skills")}>
          <Text style={styles.sectionHeader}>{labels.skills}</Text>
        </Keyed>
        <Keyed k={pdfKey.skills()} splittable>
          <Text style={styles.bodyText}>
            <Text style={styles.bold}>{labels.computer} </Text>
            {/* 第一行前面有「技能：」標籤，一起算斷行位置，再把標籤切掉。 */}
            {wrapIfZh(`${labels.computer} ${joinList(resume.skills, language)}`, language, metrics.body, BODY_WIDTH_PT).slice(
              labels.computer.length + 1,
            )}
          </Text>
        </Keyed>
        {(resume.languages ?? []).length > 0 && (
          <Keyed k={pdfKey.languages()} splittable>
            <Text style={styles.bodyText}>
              <Text style={styles.bold}>{labels.languages} </Text>
              {wrapIfZh(
                `${labels.languages} ${joinList(resume.languages ?? [], language)}`,
                language,
                metrics.body,
                BODY_WIDTH_PT,
              ).slice(labels.languages.length + 1)}
            </Text>
          </Keyed>
        )}
      </Page>
    </Document>
  );
}
