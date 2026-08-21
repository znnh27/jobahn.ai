import "server-only";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { buildContactLine, getLabels, pickName, type ResumeDocInput } from "./resumeDocContent";
import { wrapCjkText } from "./wrapCjkText";

const PAGE_WIDTH_PT = 595.28; // A4
const PAGE_PADDING_PT = 36; // 0.5"
const BODY_WIDTH_PT = PAGE_WIDTH_PT - PAGE_PADDING_PT * 2;
const BULLET_WIDTH_PT = BODY_WIDTH_PT - 12 - 10; // 扣掉 bullet 縮排跟符號欄寬

const FONT_FAMILY = "NotoSansTC";
let fontRegistered = false;

function registerFontOnce() {
  if (fontRegistered) return;
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: path.join(fontsDir, "NotoSansTC-Regular.otf"), fontWeight: "normal" },
      { src: path.join(fontsDir, "NotoSansTC-Bold.otf"), fontWeight: "bold" },
    ],
  });
  // react-pdf 的自動斷字是英文邏輯，中文字之間沒有空白可用，用內建邏輯斷行時每個斷點都會被
  // 硬插入一個「-」，中文完全不該出現這種符號。所以整個關掉自動斷字，中文段落改成用
  // wrapCjkText() 自己先量字寬、算好斷行位置，用真正的換行字元交給 react-pdf（見下方使用處）。
  Font.registerHyphenationCallback((word) => [word]);
  fontRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    paddingTop: 36,
    paddingBottom: 36,
    paddingLeft: 36,
    paddingRight: 36,
  },
  name: { fontSize: 18, fontWeight: "bold", textAlign: "center" },
  contact: { fontSize: 8, textAlign: "center", marginTop: 3, marginBottom: 7 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "bold",
    borderBottomWidth: 0.75,
    borderBottomColor: "#000000",
    paddingBottom: 1,
    marginTop: 5,
    marginBottom: 2,
  },
  bodyText: { fontSize: 11, lineHeight: 1.15 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  // 左邊（公司名／職稱）文字有時很長（例如公司名後面接一長串括號說明），一定要限制寬度讓它自己
  // 換行，不然預設 flex 版面會讓左右兩欄文字疊在一起，而不是把右邊往下推。用 flex:1（等於
  // flexBasis:0）而不是只設 flexShrink，不然文字項目會用內容自身寬度當最小寬度，照樣不會縮。
  rowLeft: { flex: 1, paddingRight: 8 },
  rowRight: { flexShrink: 0 },
  bold: { fontWeight: "bold" },
  // Noto Sans TC 沒有真正的斜體字形，react-pdf 找不到對應字重/樣式組合會直接噴錯，
  // 所以這裡不用 fontStyle: "italic"，改用顏色區分（原本 Word 版型裡斜體只是輔助區分職稱/日期）。
  italic: { color: "#404040" },
  boldItalic: { fontWeight: "bold", color: "#404040" },
  bullet: { flexDirection: "row", marginTop: 1, paddingLeft: 12 },
  bulletDot: { width: 10, fontSize: 11 },
  bulletText: { fontSize: 11, flex: 1, lineHeight: 1.2 },
});

function wrapIfZh(text: string, language: string, maxWidthPt: number): string {
  return language === "zh" ? wrapCjkText(text, 11, maxWidthPt) : text;
}

function OrgRow({ org, location }: { org: string; location: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.bold, styles.rowLeft]}>{org}</Text>
      {location && <Text style={[styles.bold, styles.rowRight]}>{location}</Text>}
    </View>
  );
}

function RoleRow({ role, period }: { role: string; period: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.boldItalic, styles.rowLeft]}>{role}</Text>
      <Text style={[styles.italic, styles.rowRight]}>{period}</Text>
    </View>
  );
}

function Bullets({ bullets, language }: { bullets: string[]; language: string }) {
  return (
    <>
      {bullets.map((b, i) => (
        <View key={i} style={styles.bullet}>
          <Text style={styles.bulletDot}>{"•"}</Text>
          <Text style={styles.bulletText}>{wrapIfZh(b, language, BULLET_WIDTH_PT)}</Text>
        </View>
      ))}
    </>
  );
}

export function ResumePdfDocument({ contact, resume, language }: ResumeDocInput) {
  registerFontOnce();
  const labels = getLabels(language);
  const name = pickName(contact, language);
  const contactLine = buildContactLine(contact);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.contact}>{contactLine}</Text>

        <Text style={styles.sectionHeader}>{labels.summary}</Text>
        <Text style={styles.bodyText}>{wrapIfZh(resume.summary, language, BODY_WIDTH_PT)}</Text>

        <Text style={styles.sectionHeader}>{labels.experience}</Text>
        {resume.work_experience.map((exp, i) => (
          <View key={i}>
            <OrgRow org={exp.org} location={exp.location} />
            <RoleRow role={exp.role} period={exp.period} />
            <Bullets bullets={exp.bullets} language={language} />
          </View>
        ))}

        {resume.leadership.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>{labels.leadership}</Text>
            {resume.leadership.map((exp, i) => (
              <View key={i}>
                <OrgRow org={exp.org} location={exp.location} />
                <RoleRow role={exp.role} period={exp.period} />
                <Bullets bullets={exp.bullets} language={language} />
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionHeader}>{labels.education}</Text>
        {resume.education.map((edu, i) => (
          <View key={i}>
            <OrgRow org={edu.school} location={edu.location} />
            {(edu.detail || edu.period) && (
              <View style={styles.row}>
                <Text style={[styles.italic, styles.rowLeft]}>{edu.detail ?? ""}</Text>
                <Text style={[styles.italic, styles.rowRight]}>{edu.period ?? ""}</Text>
              </View>
            )}
          </View>
        ))}

        <Text style={styles.sectionHeader}>{labels.skills}</Text>
        <Text style={styles.bodyText}>
          <Text style={styles.bold}>{labels.computer} </Text>
          {wrapIfZh(resume.skills.join(", "), language, BODY_WIDTH_PT)}
        </Text>
      </Page>
    </Document>
  );
}
