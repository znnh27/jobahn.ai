// 履歷畫布、經歷資料庫共用的 bullet 編輯行為：
// - Enter：游標後面的文字移到新的一點（游標在最後就是新增空白的一點）
// - Shift + Enter：同一點裡換行（文字裡存 \n，畫面用 white-space: pre-wrap 顯示）
// - 中文輸入法選字時按的 Enter 是確認選字，不換點

/** 換行在最後面時要多一個看不見的字元，瀏覽器才會真的顯示出新的一行；存檔前拿掉。 */
const LINE_END_FILLER = "​";

/** 存檔前整理：拿掉看不見的填充字元，頭尾多的空白、換行也拿掉（中間的換行保留）。 */
export function cleanBulletText(text: string): string {
  return text.replaceAll(LINE_END_FILLER, "").trim();
}

/** 輸入法正在選字（這時候的 Enter 是確認選字）。 */
export function isComposing(e: React.KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

/** 在游標位置插入換行。 */
export function insertLineBreak(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const tail = document.createRange();
  tail.selectNodeContents(el);
  tail.setStart(range.endContainer, range.endOffset);
  const atEnd = tail.toString().replaceAll(LINE_END_FILLER, "") === "";
  const node = document.createTextNode(atEnd ? `\n${LINE_END_FILLER}` : "\n");
  range.insertNode(node);
  const caret = document.createRange();
  caret.setStart(node, 1);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
}

/** 以游標為界把文字切成前後兩段（有選取文字就先刪掉選取的部分）。 */
export function splitAtCaret(el: HTMLElement): [string, string] {
  const text = el.textContent ?? "";
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return [text, ""];
  const range = sel.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(el);
  after.setStart(range.endContainer, range.endOffset);
  return [before.toString(), after.toString()];
}

/** 把游標放到這個元素的開頭或結尾。 */
export function placeCaret(el: HTMLElement, atStart: boolean) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(atStart);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
