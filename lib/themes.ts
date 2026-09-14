/* 候選風格清單（2026-09-14 給站長選稿）。key 對應 app/themes/<key>.css 與 html[data-theme] */
export const THEMES: { key: string; name: string; blurb: string }[] = [
  { key: "base", name: "原稿", blurb: "第 1 段交付時的版本：硬邊、橘與奶油白" },
  { key: "bubble", name: "圓潤糖果", blurb: "大圓角、果凍按鈕、柔陰影，像手機 App" },
  { key: "night", name: "深夜錄音室", blurb: "深炭底、橘色是唯一的光，像 Spotify" },
  { key: "editorial", name: "雜誌編輯", blurb: "純白、襯線大標、細髮線，像一本季刊" },
  { key: "pop", name: "貼紙拼貼", blurb: "粗黑框、歪標籤、四色亂撞，像貼滿貼紙的筆記本" },
  { key: "minimal", name: "極簡留白", blurb: "灰白、細字、大留白、等寬小標，像瑞士設計" },
];

export function isTheme(v: string | undefined): boolean {
  return !!v && THEMES.some((t) => t.key === v && t.key !== "base");
}
