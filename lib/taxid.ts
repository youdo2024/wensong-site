/*
 * 統一編號：檢查碼 + 到經濟部查名稱。
 *
 * 為什麼要做這一層——三個發票欄位裡，只有統編的錯誤是「無聲」的。
 * 2026-08-31 實測（tests/invoice-rescue.ts）：
 *   載具、捐贈碼填錯 → 光貿退件 → 系統降級補開，站長收到信。
 *   統編填錯　　　　 → 光貿【只驗檢查碼】。12345670 檢查碼過得了、
 *                      經濟部查是不存在，光貿照樣開出一張 B2B 發票，一句錯誤都沒有。
 * 客人拿到一張抬頭是空氣的發票，公司報不了帳，而站長永遠不會知道。
 */

/*
 * 財政部統一編號檢查碼。
 * 權重 [1,2,1,2,1,2,4,1]，逐位相乘後把乘積的十位與個位相加，總和被 5 整除即為有效。
 * 第 7 位是 7 時另有一條路：總和加 1 也能被 5 整除同樣算有效
 * （舊制留下來的例外，實際存在的統編有用到，寫死不管會誤擋真公司）。
 */
const WEIGHTS = [1, 2, 1, 2, 1, 2, 4, 1];

export function taxIdChecksumOk(no: string): boolean {
  const s = String(no || "").trim();
  if (!/^\d{8}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const p = Number(s[i]) * WEIGHTS[i];
    sum += Math.floor(p / 10) + (p % 10);
  }
  if (sum % 5 === 0) return true;
  return s[6] === "7" && (sum + 1) % 5 === 0;
}

const GCIS = "https://data.gcis.nat.gov.tw/od/data/api/";
/* 三個資料集分別涵蓋公司、商號（獨資合夥）、分公司。一個統編只會落在其中一個，
   所以三支平行打，誰有回應就用誰的——比先問「你是哪一種」再查快一半，
   也少一次可能逾時的往返 */
const SETS: { id: string; field: string; name: string; kind: string }[] = [
  { id: "9D17AE0D-09B5-4732-A8F4-81ADED04B679", field: "Business_Accounting_NO", name: "Company_Name", kind: "公司" },
  { id: "426D5542-5F05-43EB-83F9-F1300F14E1F1", field: "President_No", name: "Business_Name", kind: "商號" },
  { id: "FDB8D2C8-573D-4276-BFA4-8D3925ABE1CB", field: "Business_Accounting_NO", name: "Company_Name", kind: "分公司" },
];

async function query(set: (typeof SETS)[number], no: string): Promise<{ name: string; kind: string } | null> {
  try {
    const u = new URL(GCIS + set.id);
    u.searchParams.set("$format", "json");
    u.searchParams.set("$filter", `${set.field} eq ${no}`);
    u.searchParams.set("$top", "1");
    const res = await fetch(u, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) return null;
    const rows = (await res.json()) as Record<string, string>[];
    const row = Array.isArray(rows) ? rows[0] : null;
    const name = row ? String(row[set.name] || "").trim() : "";
    return name ? { name, kind: set.kind } : null;
  } catch {
    return null;
  }
}

export type TaxIdLookup =
  | { ok: true; no: string; name: string; kind: string }
  /* checksum＝連檢查碼都不對，一定是打錯，可以直接說死 */
  | { ok: false; reason: "checksum" }
  /*
   * notfound＝經濟部查不到，但【不能當成打錯】。
   * 經濟部商工登記只涵蓋公司、商號、分公司；財團法人、社團法人、學校、
   * 政府機關、醫療法人都有統編卻不在裡面——家扶基金會自己的 52628812
   * 就查不到。把查不到當錯誤擋下來，會擋掉一整類真實客戶。
   */
  | { ok: false; reason: "notfound" }
  | { ok: false; reason: "unreachable" };

export async function lookupTaxId(input: string): Promise<TaxIdLookup> {
  const no = String(input || "").trim();
  if (!taxIdChecksumOk(no)) return { ok: false, reason: "checksum" };
  const results = await Promise.all(SETS.map((s) => query(s, no)));
  const hit = results.find(Boolean);
  if (hit) return { ok: true, no, name: hit.name, kind: hit.kind };
  /* 三支全部回 null 有兩種可能：真的沒有，或三支都連不上。
     分不出來時說「查不到」，因為兩種情況給客人的指示是一樣的：自己再確認一次 */
  return { ok: false, reason: "notfound" };
}
