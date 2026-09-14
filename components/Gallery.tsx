"use client";
import { useEffect, useRef, useState } from "react";
import { imgSrc, SIZES } from "@/lib/img-src";

/*
 * 商品圖組：手指可以直接滑，跟一般購物網站一樣。
 *
 * 用 CSS scroll-snap 而不是 JS 輪播套件，理由是它就是真的捲動，
 * 觸控慣性、滾輪、觸控板全部由瀏覽器原生處理，手機上不會有模擬滑動的黏滯感。
 *
 * 幾個 WebKit 的坑，寫法上有繞開：
 *   scroll-snap-stop:always  快速一甩時 iOS 會直接滑到最後一張，這個屬性強迫它每張都停
 *   不要動態改 slide 的樣式  WebKit 會快取 snap 位置，改了子元素樣式它不重算，畫面會歪；
 *                            所以「目前第幾張」只反映在縮圖和圓點上，不碰 slide 本身
 *   寬度用 flex-basis 100%   舊版 iOS Safari 對百分比寬度的 snap 子元素會失效，
 *                            再加一個 min-width 兜底
 *
 * 只有一張圖時整個退回單張顯示，不出現縮圖與圓點。
 */
export default function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [idx, setIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  /* 取投影片一律從 DOM 查，不另外維護一份 ref 陣列。
     用 ref callback 收集元素的版本在這裡是拿不到值的（收集的時機跟 effect 對不上，
     結果 observer 一個都沒掛上，捲動了縮圖也不會亮），查 DOM 沒有這個時序問題。 */
  const slidesOf = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(".gal-slide")];

  /* 目前停在第幾張：直接由 scrollLeft 換算。
     原本想用 IntersectionObserver，但每張投影片剛好等於容器寬、又有 scroll-snap，
     算式就只是一個除法，多一個觀察器並不會比較準，反而多一層環境相依
     （實測某些環境根本不回呼）。用 rAF 節流，慣性捲動時也只會一格一次。 */
  useEffect(() => {
    const box = boxRef.current;
    if (!box || images.length < 2) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const w = box.clientWidth;
        if (!w) return;
        const i = Math.round(box.scrollLeft / w);
        setIdx(Math.max(0, Math.min(images.length - 1, i)));
      });
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      box.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [images.length]);

  function go(i: number) {
    const box = boxRef.current;
    if (!box) return;
    /* 平滑捲動交給 CSS 的 scroll-behavior，不在這裡寫 behavior:"smooth"。
       一來 CSS 那邊可以用 prefers-reduced-motion 關掉，二來 JS 的 smooth 在部分環境
       （無頭瀏覽器、舊 WebKit）會直接不捲動，換成預設值至少一定會到位。 */
    slidesOf(box)[i]?.scrollIntoView({ inline: "start", block: "nearest" });
  }

  if (images.length === 0) return <div className="main ph">商品主圖</div>;
  if (images.length === 1) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img {...imgSrc(images[0], SIZES.productMain)} alt={alt} className="img-fill gal-single" fetchPriority="high" />;
  }

  return (
    <>
      <div className="gal-box" ref={boxRef} tabIndex={0} role="group" aria-roledescription="輪播" aria-label={`${alt}，共 ${images.length} 張圖`}>
        {images.map((src, i) => (
          <div
            className="gal-slide"
            key={src + i}
            role="group"
            aria-roledescription="投影片"
            aria-label={`第 ${i + 1} 張，共 ${images.length} 張`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img {...imgSrc(src, SIZES.productMain)} alt={i === 0 ? alt : `${alt}（第 ${i + 1} 張）`} className="img-fill" loading={i === 0 ? "eager" : "lazy"} {...(i === 0 ? { fetchPriority: "high" as const } : {})} />
          </div>
        ))}
        <span className="gal-count" aria-hidden="true">{idx + 1} / {images.length}</span>
      </div>

      {/* 不另外做圓點指示：右下角的「3 / 7」已經講清楚位置，
          縮圖列本身也會高亮目前這張，再加一排點只是重複 */}
      <div className="gal-thumbs">
        {images.map((src, i) => (
          <button type="button" key={src + i} className={i === idx ? "on" : ""} onClick={() => go(i)} aria-label={`看第 ${i + 1} 張`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img {...imgSrc(src, SIZES.thumb)} alt="" className="img-fill" loading="lazy" />
          </button>
        ))}
      </div>
    </>
  );
}
