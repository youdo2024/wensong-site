import type { Metadata } from "next";
import { notFound } from "next/navigation";
import db, { json } from "@/lib/db";
import { saveGuest, deleteGuest } from "@/app/admin/actions";
import ImagePicker from "@/components/ImagePicker";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import Switch from "@/components/admin/Switch";
import { requireAdmin } from "@/lib/admin-guard";
import StickySave from "@/components/admin/StickySave";
import PageHead from "@/components/admin/PageHead";
import DangerZone from "@/components/admin/DangerZone";
import { displayTitle, epLabel, type EpisodeRow } from "@/lib/episodes";

export const metadata: Metadata = { title: "編輯來賓" };

type Guest = { id: number; slug: string; name: string; title: string; intro: string; photo: string; links: string; published: number; featured: number };

export default async function EditGuest({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { error } = await searchParams;
  const isNew = id === "new";
  const g = isNew ? null : ((db.prepare("SELECT * FROM guests WHERE id=?").get(Number(id)) as Guest | undefined) ?? null);
  if (!isNew && !g) notFound();
  const links = json<{ label: string; url: string }[]>(g?.links ?? "[]", []);
  const linksText = links.map((l) => `${l.label}|${l.url}`).join("\n");
  const episodes = g
    ? (db.prepare("SELECT id,key,series,ep_no,title,short_title,published FROM episodes ORDER BY pub_date DESC").all() as (Pick<EpisodeRow, "id" | "key" | "series" | "ep_no" | "title" | "short_title" | "published">)[])
    : [];
  const linked = new Set(g ? (db.prepare("SELECT episode_id FROM episode_guests WHERE guest_id=?").all(g.id) as { episode_id: number }[]).map((r) => r.episode_id) : []);

  return (
    <>
      <PageHead
        back={{ href: "/admin/guests", label: "回來賓列表" }}
        title={isNew ? "新 增 來 賓" : "編 輯 來 賓"}
        sub="名字、頭銜（店家）、一段簡介、照片、連結。網址 slug 用英文，例如 pinglin-anne"
        action={g ? <a className="btn" href={`/guests/${g.slug}`} target="_blank" rel="noopener">看前台 ↗</a> : undefined}
      />
      {error === "missing" && <p className="msg-err">「名字」與「網址 slug」為必填。</p>}
      {error === "slug" && <p className="msg-err">這個 slug 已經有人用了，換一個。</p>}

      <form className="adm-form" action={saveGuest}>
        <input type="hidden" name="id" value={g?.id ?? ""} />
        <div className="ad-sect"><h2>基 本 資 料</h2><div className="rule" /></div>
        <div className="adm-2col">
          <div className="field">
            <label>名字 <em>＊</em></label>
            <input type="text" name="name" defaultValue={g?.name ?? ""} required />
          </div>
          <div className="field">
            <label>頭銜或店家（例如：坪感覺 主理人）</label>
            <input type="text" name="title" defaultValue={g?.title ?? ""} />
          </div>
          <div className="field">
            <label>網址 slug <em>＊</em>（小寫英數與連字號）</label>
            <input className="sans" type="text" name="slug" defaultValue={g?.slug ?? ""} pattern="[a-z0-9-]+" required />
          </div>
          <div className="field">
            <label>連結（一行一筆，「名稱|網址」）</label>
            <textarea className="ta-s sans" name="links" defaultValue={linksText} placeholder={"Instagram|https://instagram.com/xxx\n官網|https://xxx.tw"} />
          </div>
        </div>
        <ImagePicker name="photo" label="照片（正方形最好）" value={g?.photo ?? ""} height={160} />
        <div className="field">
          <label>簡介（Markdown）</label>
          <textarea className="code" name="intro" defaultValue={g?.intro ?? ""} />
        </div>

        {g && (
          <>
            <div className="ad-sect"><h2>上 過 的 集 數</h2><div className="rule" /></div>
            <div className="sw-list">
              {episodes.map((e) => (
                <label className="sw-row" key={e.id}>
                  <span>{epLabel(e.series, e.ep_no)}　{displayTitle(e)}{!e.published && <small>隱藏中</small>}</span>
                  <input type="checkbox" name="episode" value={e.id} defaultChecked={linked.has(e.id)} />
                  <i className="sw" aria-hidden />
                </label>
              ))}
            </div>
          </>
        )}

        <div className="ad-sect"><h2>顯 示</h2><div className="rule" /></div>
        <div className="sw-list">
          <label className="sw-row">
            <span>顯示（取消勾選＝前台看不到這位）</span>
            <input type="checkbox" name="published" defaultChecked={g ? g.published === 1 : true} />
            <i className="sw" aria-hidden />
          </label>
          <Switch name="featured" label="首頁精選" hint="勾了會排在首頁來賓區最前面" defaultChecked={g ? g.featured === 1 : false} />
        </div>
        <StickySave />
      </form>
      {g && (
        <DangerZone title="刪除這位來賓" warn="集數不會被刪，只是不再掛這位來賓。">
          <form action={deleteGuest}>
            <input type="hidden" name="id" value={g.id} />
            <ConfirmSubmit className="btn danger" message="確定要刪除這位來賓？">刪除這位來賓</ConfirmSubmit>
          </form>
        </DangerZone>
      )}
    </>
  );
}
