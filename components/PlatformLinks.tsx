/* 收聽平台按鈕列：Apple、Spotify、KKBOX、YouTube、SoundOn，沒填網址的不出現 */
export default function PlatformLinks({ platforms, small = false }: { platforms: { key: string; label: string; url: string }[]; small?: boolean }) {
  if (platforms.length === 0) return null;
  return (
    <div className={`platforms${small ? " small" : ""}`}>
      {platforms.map((p) => (
        <a key={p.key} className={`pf pf-${p.key}`} href={p.url} target="_blank" rel="noopener" data-ga={`platform-${p.key}`}>
          {p.label}
        </a>
      ))}
    </div>
  );
}
