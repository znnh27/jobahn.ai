// 兩句話逐段比對，標出刪掉跟加上的地方（「換成 JD 用字」的前後對照用）。
// 英文以單字為單位（連同後面的空白），中文一個字一個字比，標點自成一段。
// 句子很短（一條 bullet、一段摘要），用最長共同子序列（LCS）就夠快。

export type DiffPart = { type: "same" | "del" | "ins"; text: string };

function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9'’\-/.]*\s*|\s+|[\s\S]/gu) ?? [];
}

export function inlineDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  // lcs[i][j]：a[i..] 跟 b[j..] 的最長共同子序列長度。
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", a[i++]);
    } else {
      push("ins", b[j++]);
    }
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("ins", b[j++]);
  return parts;
}
