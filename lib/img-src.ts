
/*
 * 產生 srcset／sizes。
 *
 * 只對 /api/images/ 開頭的網址動手——那些是後台上傳、我們控制得了的圖。
 * public/ 底下的品牌素材（logo、banner）本來就小，外部網址更不能亂加參數。
 *
 * 為什麼 src 也指向 ?w=1200 而不是原圖：
 * srcset 只是「建議」，遇到不支援的環境（少數爬蟲、非常舊的瀏覽器、
 * 把圖另存下來的人）拿到的是 src。指向原圖的話那些情境仍會拿到 7.1MB。
 * 1200 對任何螢幕都夠看，而且原圖永遠還在，網址拿掉 ?w= 就是。
 */

/*
 * 可用的寬度。
 *
 * 放在這一支而不是 image-derive.ts：這個檔會被 client component 引用
 * （Gallery 是 "use client"），而 image-derive 會 import fs 與 better-sqlite3。
 * 常數放錯邊，整條伺服器相依鏈就會被打包進瀏覽器，建置直接失敗。
 * 所以方向是「伺服器端引用這裡」，不是反過來。
 */
export const WIDTHS = [480, 768, 1200, 1600] as const;

export type ImgSrcSet = { src: string; srcSet?: string; sizes?: string };

function isDerivable(src: string): boolean {
  return typeof src === "string" && src.startsWith("/api/images/");
}

/*
 * sizes 要照實描述「這張圖在版面上會佔多寬」，瀏覽器才挑得對。
 * 寫錯的話比不寫更糟：寫太大就下載過大的檔，寫太小會糊掉。
 * 這裡提供三種站上真的存在的版型，呼叫端挑一個。
 */
export const SIZES = {
  /* 商品主圖：手機滿版，820px 以上是左右兩欄，圖約佔一半 */
  productMain: "(max-width: 819px) 100vw, 520px",
  /* 商品／文章列表的卡片：手機一欄、平板兩欄、桌機三欄 */
  card: "(max-width: 560px) 100vw, (max-width: 960px) 50vw, 340px",
  /* 內文裡的大圖：受限於文章欄寬 */
  article: "(max-width: 720px) 100vw, 680px",
  /* 縮圖列 */
  thumb: "96px",
} as const;

export function imgSrc(src: string, sizes?: string): ImgSrcSet {
  if (!isDerivable(src)) return { src };
  const sep = src.includes("?") ? "&" : "?";
  return {
    src: `${src}${sep}w=1200`,
    srcSet: WIDTHS.map((w) => `${src}${sep}w=${w} ${w}w`).join(", "),
    ...(sizes ? { sizes } : {}),
  };
}
