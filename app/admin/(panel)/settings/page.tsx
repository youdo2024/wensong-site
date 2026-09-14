import type { Metadata } from "next";
import Link from "next/link";
import PageHead from "@/components/admin/PageHead";
import Ico from "@/components/admin/Ico";
import { requireAdmin } from "@/lib/admin-guard";

export const metadata: Metadata = { title: "網站設定" };

/*
 * 設定目錄頁（ia.md §1 舊網址、§2）。
 *
 * 這一頁以前是 19 個區塊、723 行、一顆儲存管全部，站長要改一句退換貨政策
 * 得從最上面滑到最下面，中間經過金流環境與捐贈碼清單。現在拆成六頁，
 * 這裡只負責一件事：讓人知道自己要找的東西在哪一頁。
 *
 * 每張卡一句話，說的是「這頁管什麼」而不是「這頁有哪些欄位」——
 * 站長腦子裡想的是「客人收不到信」，不是「mail_copy_to」。
 * 這不是「更多」清單，所以卡有份量、標題 16px，跟六個側欄入口一一對應。
 */
const PAGES: { href: string; name: string; desc: string }[] = [
  { href: "/admin/settings/shop", name: "商 店", desc: "商店開不開、運費怎麼算、客人能用哪些付款方式、首頁那幾張照片。" },
  { href: "/admin/settings/sponsor", name: "贊 助", desc: "四階金額、給觀眾的信、結帳頁的加購支持，以及贊助入口要不要開。" },
  { href: "/admin/settings/pay", name: "金 流", desc: "商店結帳走哪一家金流，以及現在到底跑在正式還是測試環境。" },
  { href: "/admin/settings/notify", name: "通 知", desc: "自動提醒的開關、信件副本、LINE 推播，還有每一則通知的文字。" },
  { href: "/admin/settings/content", name: "內 容", desc: "社群連結、隱私權與條款這些法務頁，以及前台每一句話與每一封信的文案。" },
  { href: "/admin/settings/system", name: "系 統", desc: "備份、審查用的預覽連結、各種測試信與探測按鈕、環境資訊。" },
];

export default async function AdminSettings() {
  await requireAdmin();
  return (
    <>
      <PageHead title="設 定" sub="六頁各管一件事，各自儲存。改哪一頁就只影響那一頁" />
      <div className="ad-menu">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href}>
            <span>
              <span className="nm">{p.name}</span>
              <span className="ds">{p.desc}</span>
            </span>
            <Ico n="right" size={20} />
          </Link>
        ))}
      </div>
    </>
  );
}
