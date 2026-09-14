import { sendMail, wrapMail } from "./mail";

/*
 * 「有人在 LINE 打了你的訂單編號」通知信（站長 2026-09-05 決定的第三道保險）。
 *
 * 為什麼要這封：站長決定保留「在官方帳號打訂單編號就綁定」的方便，不加驗證碼。
 * 訂單編號是猜得到的（YD ＋ 日期 ＋ 流水號），所以綁定這件事本身擋不住陌生人，
 * 只能讓本人「立刻知道」。收到這封信而自己沒操作的人，回信我們就解除綁定。
 *
 * 呼叫端一律用 .catch(console.error) 射後不理：寄不出信是我們的問題，
 * 不可以讓客人在 LINE 那頭等不到回覆。
 */

/* 逃脫所有代入值（訂單編號與姓名都來自資料庫，但信件內容不該相信任何字串） */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function notifyOrderBoundByText(order: {
  order_no: string;
  email?: string;
  name?: string;
}): Promise<boolean> {
  const to = String(order.email || "").trim();
  /* 沒留 email 的訂單（少數電話單）就沒得通知，不當成錯誤 */
  if (!to.includes("@")) return false;

  const no = esc(order.order_no);
  const name = esc(String(order.name || "").trim());
  const hello = name ? `${name} 你好，` : "";
  const html = wrapMail(
    "你的訂單已綁定 LINE 通知",
    `<p style="font-size:15px;line-height:2;">${hello}剛才有人在 LINE 官方帳號輸入你的訂單編號 <b>${no}</b>，之後這張訂單的付款與出貨通知會推到那個 LINE。</p>
     <p style="font-size:15px;line-height:2;">如果不是你操作的，請直接回這封信告訴我們，我們會解除綁定。</p>`
  );
  return sendMail(to, `你的訂單 ${order.order_no} 已綁定 LINE 通知｜問爽的 WenSong`, html, undefined, {
    kind: "routine",
    refNo: order.order_no,
  });
}
