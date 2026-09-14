"use client";
import { useRef } from "react";

/*
 * 集數播放器（決策定案 Q17）：頁面內建 HTML audio 直接播 RSS 裡的 mp3。
 * 不嵌 SoundOn iframe：省 CSP 白名單、不拖慢頁面。
 * 原生 controls：iOS 鎖屏與 AirPods 控制都能用，自己畫的播放器做不到這些。
 * 章節按鈕跳到指定秒數；沒有章節就只有播放器。
 */
export default function EpisodePlayer({
  src,
  type,
  title,
  chapters = [],
  compact = false,
}: {
  src: string;
  type?: string;
  title: string;
  chapters?: { t: number; label: string }[];
  compact?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const seek = (sec: number) => {
    const a = ref.current;
    if (!a) return;
    a.currentTime = sec;
    void a.play().catch(() => {});
  };
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
  };
  if (!src) return null;
  return (
    <div className={`ep-player${compact ? " compact" : ""}`}>
      <audio ref={ref} controls preload="none" src={src} aria-label={`播放 ${title}`}>
        {type && <source src={src} type={type} />}
        你的瀏覽器不支援站內播放，請用下方平台連結收聽。
      </audio>
      {chapters.length > 0 && (
        <ol className="ep-chapters">
          {chapters.map((c, i) => (
            <li key={i}>
              <button type="button" onClick={() => seek(c.t)}>
                <span className="sans tm">{fmt(c.t)}</span>
                <span>{c.label}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
