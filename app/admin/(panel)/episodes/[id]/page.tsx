import type { Metadata } from "next";
import { notFound } from "next/navigation";
import db, { json } from "@/lib/db";
import { saveEpisode, deleteEpisode } from "@/app/admin/actions";
import MultiInput from "@/components/MultiInput";
import ImagePicker from "@/components/ImagePicker";
import MdImageHelper from "@/components/MdImageHelper";
import BlockHelper from "@/components/BlockHelper";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import { requireAdmin } from "@/lib/admin-guard";
import StickySave from "@/components/admin/StickySave";
import PageHead from "@/components/admin/PageHead";
import DangerZone from "@/components/admin/DangerZone";
import { cleanDescription, displayTitle, epLabel, fmtDuration, type EpisodeRow } from "@/lib/episodes";
import { fmtDate } from "@/lib/format";

export const metadata: Metadata = { title: "編輯集數" };

/*
 * 編輯集數。上半是 RSS 來的唯讀資料（同步會覆蓋，這裡不給改），
 * 下半是手動欄位：精簡標題、摘要、筆記、逐字稿、章節、來賓、SEO、別名、發布。
 * 集數不能在後台新增：來源永遠是 RSS，新集數按列表頁的「立即同步」。
 */
export default async function EditEpisode({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { error, saved } = await searchParams;
  const e = db.prepare("SELECT * FROM episodes WHERE id=?").get(Number(id)) as EpisodeRow | undefined;
  if (!e) notFound();
  const guests = db.prepare("SELECT id,name,title FROM guests ORDER BY sort,name").all() as { id: number; name: string; title: string }[];
  const linked = new Set((db.prepare("SELECT guest_id FROM episode_guests WHERE episode_id=?").all(e.id) as { guest_id: number }[]).map((r) => r.guest_id));
  const chapters = json<{ t: number; label: string }[]>(e.chapters, []);
  const chaptersText = chapters.map((c) => `${Math.floor(c.t / 60)}:${String(c.t % 60).padStart(2, "0")} ${c.label}`).join("\n");

  return (
    <>
      <PageHead
        back={{ href: "/admin/episodes", label: "回集數列表" }}
        title="編 輯 集 數"
        sub={<>{epLabel(e.series, e.ep_no)}・網址 /ep/{e.key}・{e.pub_date ? fmtDate(e.pub_date) : "—"}・{fmtDuration(e.duration)}</>}
        action={<a className="btn" href={`/ep/${e.key}`} target="_blank" rel="noopener">看前台 ↗</a>}
      />
      {error === "key" && <p className="msg-err">網址 key 只能是小寫英數與連字號，而且不能跟別集重複。</p>}
      {saved && <p className="msg-ok">已儲存，前台最多五分鐘後更新（或直接重新整理那一頁）。</p>}

      <form className="adm-form" action={saveEpisode}>
        <input type="hidden" name="id" value={e.id} />

        <div className="ad-sect"><h2>RSS 來 的（同 步 會 覆 蓋，這 裡 不 能 改）</h2><div className="rule" /></div>
        <div className="adm-2col">
          <div className="field"><label>原標題</label><input type="text" value={e.title} readOnly /></div>
          <div className="field"><label>音檔</label><input className="sans" type="text" value={e.audio_url} readOnly /></div>
        </div>
        <details className="ad-tools">
          <summary>原始簡介（SoundOn 上的那份）</summary>
          <div className="in"><pre className="fine" style={{ whiteSpace: "pre-wrap" }}>{cleanDescription(e.rss_description) || "（空）"}</pre></div>
        </details>

        <div className="ad-sect"><h2>基 本 資 料</h2><div className="rule" /></div>
        <div className="adm-2col">
          <div className="field">
            <label>精簡標題（前台顯示用；留空就用原標題去掉節目後綴）</label>
            <input type="text" name="short_title" defaultValue={e.short_title} placeholder={displayTitle({ title: e.title, short_title: "" })} />
          </div>
          <div className="field">
            <label>SEO 標題（搜尋結果專用，30 字內；留空自動截短）</label>
            <input type="text" name="seo_title" defaultValue={e.seo_title} maxLength={40} />
          </div>
          <div className="field">
            <label>網址 key <em>＊</em>（小寫英數與連字號，例如 23、submit-03）</label>
            <input className="sans" type="text" name="key" defaultValue={e.key} pattern="[a-z0-9-]+" required />
          </div>
          <div className="field">
            <label>英文別名（選填，/ep/別名 會 301 到主網址）</label>
            <input className="sans" type="text" name="slug_alias" defaultValue={e.slug_alias} pattern="[a-z0-9-]*" />
          </div>
          <div className="field">
            <label>系列</label>
            <select name="series" defaultValue={e.series}>
              <option value="main">正篇</option>
              <option value="submit">投稿</option>
              <option value="pilot">試播</option>
              <option value="other">特別篇</option>
            </select>
          </div>
          <div className="field">
            <label>集數字串（排序與「第 N 集」用）</label>
            <input className="sans" type="text" name="ep_no" defaultValue={e.ep_no} />
          </div>
          <div className="field">
            <label>Tags（一格一個，按＋新增）</label>
            <MultiInput name="tags" defaultValues={json<string[]>(e.tags, [])} placeholder="例如：創業" />
          </div>
        </div>
        <ImagePicker name="cover" label="自訂封面（留空用 SoundOn 的集數封面）" value={e.cover} height={160} />

        <div className="ad-sect"><h2>來 賓</h2><div className="rule" /></div>
        <p className="fine">勾這一集有誰。名單在「來賓」頁維護；同步時從標題的 feat. 自動建的來賓已經勾好了。</p>
        <div className="sw-list">
          {guests.length === 0 && <p className="fine">還沒有來賓，先去「來賓」新增。</p>}
          {guests.map((g) => (
            <label className="sw-row" key={g.id}>
              <span>{g.name}{g.title && <small>{g.title}</small>}</span>
              <input type="checkbox" name="guest" value={g.id} defaultChecked={linked.has(g.id)} />
              <i className="sw" aria-hidden />
            </label>
          ))}
        </div>

        <div className="ad-sect"><h2>內 容</h2><div className="rule" /></div>
        <div className="field">
          <label>摘要（卡片與搜尋結果顯示，110 字內最好）</label>
          <textarea className="ta-s" name="summary" defaultValue={e.summary} />
        </div>
        <MdImageHelper />
        <BlockHelper />
        <div className="field">
          <label>節目筆記（Markdown）</label>
          <textarea className="code" name="notes" defaultValue={e.notes} />
        </div>
        <div className="field">
          <label>章節（一行一個：「分:秒 標題」，例如 12:30 開始聊創業）</label>
          <textarea className="ta-s sans" name="chapters" defaultValue={chaptersText} placeholder={"0:00 開場\n12:30 開始聊創業"} />
        </div>
        <div className="field">
          <label>逐字稿（Markdown；前台收合顯示，並標「AI 辨識可能有錯字」）</label>
          <textarea className="code" name="transcript" defaultValue={e.transcript} style={{ minHeight: 360 }} />
        </div>

        <div className="ad-sect"><h2>顯 示</h2><div className="rule" /></div>
        <div className="sw-list">
          <label className="sw-row">
            <span>發布（取消勾選＝隱藏，前台與 sitemap 都不出現）</span>
            <input type="checkbox" name="published" defaultChecked={e.published === 1} />
            <i className="sw" aria-hidden />
          </label>
        </div>
        <StickySave />
      </form>

      <DangerZone title="刪除這一集" warn="刪掉之後下一次 RSS 同步會把它當新集數再抓回來（筆記與逐字稿不會回來）。只是不想給人看的話，關掉上面的「發布」就好。">
        <form action={deleteEpisode}>
          <input type="hidden" name="id" value={e.id} />
          <ConfirmSubmit className="btn danger" message="確定要刪除這一集？筆記與逐字稿會一起消失，無法復原。">刪除這一集</ConfirmSubmit>
        </form>
      </DangerZone>
    </>
  );
}
