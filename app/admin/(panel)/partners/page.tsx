import type { Metadata } from "next";
import Link from "next/link";
import db from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import CopyField from "@/components/CopyField";
import { createPartner, updatePartner, regenPartnerKey, togglePartnerActive } from "@/app/admin/actions";
import type { Partner } from "@/lib/partner";
import { partnerData } from "@/lib/partner-data";
import AdminTabs from "@/components/AdminTabs";
import MultiInput from "@/components/MultiInput";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import PageHead from "@/components/admin/PageHead";
import Empty from "@/components/admin/Empty";
import DangerZone from "@/components/admin/DangerZone";

/* 舊資料是逗號字串，拆成一格一個給 MultiInput；分隔符照 lib/notify.ts 讀取端的規則 */
const splitEmails = (s: string) => String(s || "").split(/[,，、;\s]+/).map((t) => t.trim()).filter(Boolean);

export const metadata: Metadata = { title: "夥伴管理" };

/*
 * 出貨夥伴管理（多夥伴版，2026-09-06 改版第六批）。
 *
 * 一位夥伴＝一張收合卡：名稱、密碼、通知信箱、出貨地備註、專屬連結。
 * 預設收合是刻意的手煞車：卡裡有「重新產生連結」與「停用」兩顆做了會出事的鈕，
 * 攤開在畫面上很容易誤觸。這一批再把那兩顆收進紅框的 DangerZone，
 * 它們還在同一個 <form> 裡（用 formAction 指向各自的 action），送出的欄位一個都沒變。
 *
 * 「新增夥伴」升格成頁首那顆主動作，打開下面的收合區（?new=1，狀態放網址上）。
 * 商品要歸給哪位夥伴，在商品編輯頁選（這裡只管人，不管貨）。
 */
export default async function AdminPartners({ searchParams }: { searchParams: Promise<{ err?: string; new?: string }> }) {
  await requireAdmin();
  const { err, new: wantNew } = await searchParams;
  const partners = db.prepare("SELECT * FROM partners ORDER BY id").all() as Partner[];
  const counts = new Map(
    (db.prepare("SELECT partner_id, COUNT(*) AS n FROM products WHERE partner_id IS NOT NULL GROUP BY partner_id").all() as { partner_id: number; n: number }[])
      .map((r) => [r.partner_id, r.n])
  );
  const site = (process.env.SITE_URL || "https://www.wensong.tw").replace(/\/$/, "");
  /* 每位夥伴的待出貨盒數：管人的頁面順便看得到貨況，不用切去總覽 */
  const toShipOf = new Map<number, number>();
  for (const pd of partnerData()) toShipOf.set(pd.partnerId, (toShipOf.get(pd.partnerId) || 0) + pd.totalPaid);

  const activeN = partners.filter((p) => p.active).length;
  const openNew = wantNew === "1" || partners.length === 0;

  return (
    <>
      <AdminTabs active="partners" tabs={[
        { key: "partners", label: "夥伴管理", href: "/admin/partners" },
        { key: "settlement", label: "結算報表", href: "/admin/settlement" },
        { key: "workbench", label: "開出貨總覽", href: "/partner", blank: true },
      ]} />

      {err && <p className="msg-err">{err}</p>}

      <PageHead
        title="出 貨 夥 伴"
        sub={<>{partners.length} 位，{activeN} 位啟用中。每位一條專屬連結加一組密碼，工作台只看得到自己商品的訂單</>}
        action={<Link className="btn fill" href="/admin/partners?new=1#new">新增夥伴</Link>}
      />

      <p className="fine">商品的歸屬在「商品管理 → 編輯 → 出貨夥伴」設定。這一頁只管人，不管貨。</p>

      {/* 新增夥伴：開合狀態放在網址上（?new=1），建立失敗退回來表單還開著 */}
      <details className="ad-newbox" id="new" open={openNew}>
        <summary>新增一位夥伴</summary>
        <div className="in">
          <form action={createPartner}>
            <div className="ad-frow">
              <div className="field">
                <label>夥伴名稱 *</label>
                <input type="text" name="name" placeholder="例：山茶花工坊" required />
              </div>
              <div className="field f-sm">
                <label>密碼（留空隨機）</label>
                <input className="sans" type="text" name="pin" />
              </div>
              <div className="field f-lg">
                <label>通知信箱（一格一個，按＋新增）</label>
                <MultiInput name="notify_emails" placeholder="partner@example.com" sans inputType="email" />
              </div>
              <div className="field">
                <label>出貨地備註</label>
                <input type="text" name="ship_origin" />
              </div>
              <div className="field f-md">
                <label>超商通路</label>
                <select name="cvs_brand" defaultValue="7-11">
                  <option value="7-11">7-11</option>
                  <option value="全家">全家</option>
                </select>
              </div>
              <button className="btn fill" type="submit">建立</button>
            </div>
          </form>
          <p className="fine">
            建立後把商品歸給他（商品編輯頁），連結與密碼交給對方就能開工。
            <br />停用夥伴前，記得先把他的商品下架或轉給別人：停用只關工作台與通知，
            商品還上架的話客人照買，但沒有任何人看得到那些訂單要出貨。
          </p>
        </div>
      </details>

      {partners.length === 0 ? (
        <Empty>還沒有出貨夥伴。按右上角「新增夥伴」加第一位。</Empty>
      ) : (
        partners.map((p) => (
          <details key={p.id} className="ad-ptn" data-off={p.active ? "0" : "1"}>
            <summary>
              <span>{p.name}</span>
              <span className="mt sans">
                商品 {counts.get(p.id) || 0} 件
                {(toShipOf.get(p.id) || 0) > 0 && <b>・待出貨 {toShipOf.get(p.id)} 盒</b>}
                {p.active ? "" : "・停用中"}
                　點開編輯
              </span>
            </summary>
            <div className="in">
              <form action={updatePartner}>
                <input type="hidden" name="id" value={p.id} />
                <div className="ad-frow">
                  <div className="field">
                    <label>夥伴名稱</label>
                    <input type="text" name="name" defaultValue={p.name} />
                  </div>
                  <div className="field f-sm">
                    <label>工作台密碼</label>
                    <input className="sans" type="text" name="pin" defaultValue={p.pin} />
                  </div>
                  <div className="field f-lg">
                    <label>下單通知信箱（一格一個，按＋新增；只收自己商品的通知）</label>
                    <MultiInput name="notify_emails" defaultValues={splitEmails(p.notify_emails)} placeholder="partner@example.com" sans inputType="email" />
                  </div>
                </div>
                <div className="ad-frow">
                  <div className="field">
                    <label>出貨地備註（結帳頁「此包裹來自○○」）</label>
                    <input type="text" name="ship_origin" defaultValue={p.ship_origin} placeholder="例：南投魚池" />
                  </div>
                  <div className="field f-md">
                    <label>超商通路</label>
                    <select name="cvs_brand" defaultValue={p.cvs_brand || "7-11"}>
                      <option value="7-11">7-11</option>
                      <option value="全家">全家</option>
                    </select>
                  </div>
                  <button className="btn fill" type="submit">儲存</button>
                </div>

                {/* 兩顆做了回不來的鈕收進紅框，但還在同一個 <form> 裡：
                    它們是用 formAction 指到各自的 action，搬出表單就送不出 id 了。 */}
                <DangerZone
                  title="這兩顆做了回不來"
                  warn="重新產生連結：舊連結立刻失效，要親手把新連結重新交給他。停用：工作台與通知全關，他的商品若還上架，訂單將沒有人看得到要出貨。"
                >
                  <ConfirmSubmit className="btn danger" formAction={regenPartnerKey} message="確定重新產生這位夥伴的連結？舊連結立刻失效，要把新連結重新交給他。">
                    重新產生連結（只作廢這一位）
                  </ConfirmSubmit>
                  {p.active ? (
                    <ConfirmSubmit className="btn danger" formAction={togglePartnerActive} message="確定停用這位夥伴？工作台與通知會全部關閉；他的商品若還上架，訂單將沒有人看得到要出貨。">
                      停用
                    </ConfirmSubmit>
                  ) : (
                    <button className="btn" formAction={togglePartnerActive} formNoValidate>
                      重新啟用
                    </button>
                  )}
                </DangerZone>
              </form>

              <p className="fine">
                專屬連結（連同密碼交給夥伴{p.active ? "" : "；目前停用中，這條連結無效"}）
                <br />超商通路決定這位夥伴的貨從哪家超商寄出，客人結帳時的門市欄位會跟著改。
                一張訂單同時買到不同通路的商品時，超商選項會自動關閉、請客人改宅配。
              </p>
              <CopyField value={`${site}/api/partner-view?k=${p.key}`} />
            </div>
          </details>
        ))
      )}
    </>
  );
}
