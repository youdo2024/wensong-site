import fs from "fs";
import path from "path";
import { DATA_DIR } from "./db";
import { WIDTHS } from "./img-src";

/*
 * 圖片衍生檔：把後台上傳的原圖，在需要時另存一份縮小過的版本。
 *
 * 為什麼需要：後台上傳是把原始 bytes 直接落地，不縮圖也不轉檔（上限 8MB）。
 * 於是商品頁上有一張 6240×4160、7.1MB 的 JPEG，而它在畫面上只顯示 276×154。
 * 實測第一次載入 /shop/9 要下載 11.37MB、跑 9.3 秒——中秋檔期的成交頁。
 *
 * ── 三個不能違反的原則 ──
 *
 * 一、原圖永遠不動。
 *    不覆蓋、不刪除、不改檔名。衍生檔另存在 images/.cache/，
 *    真的出問題時把整個 .cache 刪掉就回到今天以前的狀態，資料一張都不會少。
 *
 * 二、sharp 壞掉不能讓圖片消失。
 *    sharp 是原生模組，換平台、換 Node 版本都可能載不起來。
 *    所有呼叫都包在 try/catch 裡，任何一步失敗就回 null，
 *    呼叫端就送原圖。使用者頂多看到「圖比較大」，不會看到破圖。
 *
 * 三、同一張圖同時被很多人要，只能轉一次。
 *    第一個請求進來時建立一個 Promise 放進 inflight，
 *    後面的請求等同一個 Promise。沒有這層的話，電子報一發，
 *    幾百個人同時打同一張圖，就會同時跑幾百個 sharp 轉檔把機器壓垮。
 */

/* 寬度白名單定義在 lib/img-src.ts（那支沒有伺服器端相依，client 也能引用）。
   用白名單而不是任意數字：任意寬度等於讓任何人用 ?w=1、?w=2、?w=3…
   在磁碟上塞滿幾萬個檔案。 */
export type DeriveFormat = "avif" | "webp";

const CACHE_DIR = path.join(DATA_DIR, "images", ".cache");

/* 同一個 process 內的轉檔去重 */
const g = globalThis as unknown as { __yoImgInflight?: Map<string, Promise<string | null>> };
if (!g.__yoImgInflight) g.__yoImgInflight = new Map();
const inflight = g.__yoImgInflight;

export function pickWidth(raw: string | null): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return (WIDTHS as readonly number[]).includes(n) ? n : null;
}

/* 依瀏覽器的 Accept 決定格式。都不支援就回 null，呼叫端送原圖。 */
export function pickFormat(accept: string | null): DeriveFormat | null {
  const a = (accept || "").toLowerCase();
  if (a.includes("image/avif")) return "avif";
  if (a.includes("image/webp")) return "webp";
  return null;
}

export const MIME_OF: Record<DeriveFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
};

/*
 * 取得（必要時產生）衍生檔的路徑。失敗一律回 null，讓呼叫端送原圖。
 * name 已由呼叫端用 regex 驗證過，這裡不再組裝使用者提供的路徑片段。
 */
export async function deriveImage(name: string, width: number, fmt: DeriveFormat): Promise<string | null> {
  const src = path.join(DATA_DIR, "images", name);
  const out = path.join(CACHE_DIR, `${name}.${width}.${fmt}`);
  const key = `${name}|${width}|${fmt}`;

  try {
    if (fs.existsSync(out)) return out;
  } catch {
    return null;
  }

  const running = inflight.get(key);
  if (running) return running;

  const job = (async (): Promise<string | null> => {
    try {
      if (!fs.existsSync(src)) return null;
      /* 動態載入：sharp 沒裝或載不起來時，整站其他功能不受影響 */
      const sharp = (await import("sharp")).default;
      fs.mkdirSync(CACHE_DIR, { recursive: true });

      const pipeline = sharp(src, { failOn: "none" })
        /* withoutEnlargement：原圖比目標窄就維持原寬，不要放大——
           放大只會讓檔案變大而畫質更差 */
        .resize({ width, withoutEnlargement: true })
        /* 去掉 EXIF：相機原圖可能帶 GPS 座標，那是拍攝地點的個資，
           不該隨著商品照公開出去。sharp 預設就不保留，這裡寫明是為了讓人知道有想過。 */
        .rotate();

      const buf =
        fmt === "avif"
          ? await pipeline.avif({ quality: 55, effort: 3 }).toBuffer()
          : await pipeline.webp({ quality: 80 }).toBuffer();

      /* 先寫暫存再改名：直接寫目標檔的話，另一個請求可能讀到只寫一半的檔案 */
      const tmp = `${out}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, out);
      return out;
    } catch (e) {
      console.error("[image-derive] 轉檔失敗，改送原圖", name, width, fmt, e);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}
