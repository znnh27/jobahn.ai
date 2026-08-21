import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { ResumePdfDocument } from "./ResumePdfDocument";
import type { ResumeDocInput } from "./resumeDocContent";

export async function buildResumePdf(input: ResumeDocInput): Promise<Buffer> {
  return renderToBuffer(<ResumePdfDocument {...input} />);
}
