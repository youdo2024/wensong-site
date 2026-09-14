/*
 * 選項要怎麼擺（純函式，故意不 import 任何東西）。
 *
 * 這支刻意跟 lib/choice-stock.ts 分開：那支 import 了 db，
 * 而這裡的邏輯要在 client 元件（BuyPanel）裡跑。
 * 混在一起的話，一顆按鈕的排版判斷會把整個 SQLite 層拖進瀏覽器包，
 * 建置直接失敗（實際踩過：Module not found: Can't resolve 'fs'）。
 */

export type ChoiceSplit = {
  /* 還能選的 */
  open: string[];
  /* 額滿的，順序照後台原本的排法 */
  full: string[];
  /* 這次要不要收合 */
  collapse: boolean;
  /* 一個都不能選了 */
  allFull: boolean;
};

/*
 * 選項要怎麼擺。
 *
 * 收合要三個條件同時成立：商品開了開關、額滿的有兩個以上、而且不是全部額滿。
 *
 * 「兩個以上」是因為只有一格額滿時，收起來等於為了藏一格多花使用者一次點擊，不划算。
 * 「不是全部額滿」是因為全滿時收合會讓選項區一個格子都不剩，頁面看起來像壞掉，
 * 那時候該做的是把話講明白（元件會改顯示補貨說明），不是把東西藏起來。
 */
export function splitChoices(choices: string[], soldout: string[], enabled: boolean): ChoiceSplit {
  const isFull = (c: string) => soldout.includes(c);
  const full = choices.filter(isFull);
  const open = choices.filter((c) => !isFull(c));
  const allFull = choices.length > 0 && open.length === 0;
  return { open, full, collapse: enabled && full.length >= 2 && !allFull, allFull };
}

/* ── 規格下架日（choice_expiry）── */

export type ChoiceExpiry = Record<string, string>; /* 規格名 → "YYYY-MM-DD" */

/* 下架日當天仍可買，隔天起消失。沒填日期＝永遠有效 */
export function choiceActive(choice: string, expiry: ChoiceExpiry, todayIso: string): boolean {
  const d = expiry[choice];
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return true;
  return todayIso <= d;
}

export function activeChoices(choices: string[], expiry: ChoiceExpiry, todayIso: string): string[] {
  return choices.filter((c) => choiceActive(c, expiry, todayIso));
}

/*
 * 工作台上這一週該不該收掉。
 * 三個條件同時成立才收：沒有任何未完的事（待出貨、待付款、已保留都是零）、
 * 有明確的下架日、而且已經過了下架日之後的保留期（預設 14 天）。
 * 沒填下架日的週永遠不自動收——寧可畫面長一點，不可把還要出的貨藏起來。
 */
export function weekRetired(
  w: { open: boolean },
  choice: string,
  expiry: ChoiceExpiry,
  todayIso: string,
  keepDays = 14
): boolean {
  if (w.open) return false;
  const d = expiry[choice];
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const cutoff = new Date(new Date(`${d}T00:00:00Z`).getTime() + keepDays * 86400_000).toISOString().slice(0, 10);
  return todayIso > cutoff;
}

export function parseChoiceExpiry(raw: string | null | undefined): ChoiceExpiry {
  try {
    const o = JSON.parse(raw || "{}") as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const out: ChoiceExpiry = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v;
      }
      return out;
    }
  } catch { /* 壞資料當沒設定 */ }
  return {};
}
