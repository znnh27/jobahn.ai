import type { NextRequest } from "next/server";
import { readCustomSectionLabels } from "@/lib/resumes/sectionLabels";
import { createClient } from "@/lib/supabase/server";
import { buildResumeDocx } from "@/lib/documents/buildResumeDocx";
import { buildResumePdf } from "@/lib/documents/buildResumePdf";
import { readContact } from "@/lib/resumes/contact";
import { resumeFileName } from "@/lib/documents/resumeFileName";
import type { GeneratedResume } from "@/lib/resumes/generateResume";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/applications/[id]/resume-download">,
) {
  const { id } = await ctx.params;
  const searchParams = request.nextUrl.searchParams;
  const lang = searchParams.get("lang");
  const format = searchParams.get("format");

  if (!lang || (format !== "docx" && format !== "pdf")) {
    return new Response("缺少或不合法的 lang / format 參數", { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("請先登入", { status: 401 });

  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("resume_snapshot, resume_language, company_name, job_title")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (appError || !application) {
    return new Response("找不到這筆應徵紀錄", { status: 404 });
  }

  const resumeSnapshot: Record<string, GeneratedResume["resume"]> | null =
    application.resume_snapshot;
  if (!resumeSnapshot || !resumeSnapshot[lang]) {
    return new Response("這個語言版本的履歷還沒定案", { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profile_data")
    .select("data")
    .eq("user_id", user.id)
    .maybeSingle();

  const contact = readContact(profile?.data);

  const labels = readCustomSectionLabels(profile?.data)[lang === "zh" ? "zh" : "en"];
  const input = { contact, resume: resumeSnapshot[lang], language: lang, labels };
  const buffer = format === "docx" ? await buildResumeDocx(input) : await buildResumePdf(input);

  const fileName = resumeFileName({
    companyName: application.company_name,
    jobTitle: application.job_title,
    contact,
    language: lang,
    ext: format,
  });

  const contentType =
    format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/pdf";

  // HTTP 標頭只能放 ASCII，檔名有中文（公司名、職稱）時直接塞進去會出錯。
  // filename 放 ASCII 備用檔名，filename* 用 UTF-8 編碼放真正的中文檔名（RFC 6266），瀏覽器會優先用後者。
  const asciiFallback = fileName.replace(/[^\x20-\x7e]+/g, "_");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
