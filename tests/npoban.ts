/*
 * 捐贈碼清單的檢查（手動執行，最後一段會真的連財政部下載一次）。
 *
 *   DATA_DIR=/tmp/npotest node --experimental-strip-types --import ./tests/reg.mjs tests/npoban.ts
 *
 * 沒放進 npm run smoke：要連外網，而冒煙測試必須離線、可以無限次重跑。
 * 第一段（空資料庫自動灌種子）就是正式站每次部署的情境——建置容器沒有掛載磁碟，
 * 每次都是空資料庫，種子沒灌成的話所有捐贈碼都會驗不過。
 */
import { npobanName, npobanCount, npobanFormatOk, npobanUpdatedAt, parseNpobanCsv, refreshNpoban } from "@/lib/npoban";

const r: boolean[] = [];
const t = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  r.push(pass);
  console.log(`${pass ? "✓" : "✗"} ${label}${pass ? "" : `　得到 ${JSON.stringify(got)} 預期 ${JSON.stringify(want)}`}`);
};

console.log("── 空資料庫自動灌種子（正式站每次部署都是這個情境）──");
console.log("   筆數", npobanCount(), "／版本", npobanUpdatedAt());
t("種子筆數 2022", npobanCount(), 2022);
t("8585 是家扶基金會", npobanName("8585"), "財團法人台灣兒童暨家庭扶助基金會");
t("024 是台中北區", npobanName("024"), "財團法人台灣兒童暨家庭扶助基金會台中市北區分事務所");

console.log("\n── 格式與查無 ──");
t("3 碼可以", npobanFormatOk("024"), true);
t("7 碼可以", npobanFormatOk("6361712"), true);
t("2 碼不行", npobanFormatOk("12"), false);
t("8 碼不行", npobanFormatOk("12345678"), false);
t("有字母不行", npobanFormatOk("85a5"), false);
t("前後空白會清掉", npobanName(" 8585 "), "財團法人台灣兒童暨家庭扶助基金會");
t("105 查無（不在清單裡）", npobanName("105"), null);
t("格式不對直接 null", npobanName("abc"), null);

console.log("\n── CSV 解析 ──");
const csv = ['序號,受捐贈機關或團體名稱,捐贈碼,簡稱,統編,縣市',
  '1,測試協會,1234,測試,12345678,臺北市',
  '2,"逗號, 在名字裡的協會",567,X,12345678,新北市',
  '3,"引號""測試""協會",8901234,Y,12345678,臺中市',
  '4,壞資料,99,Z,12345678,高雄市',
  '5,,4567,W,12345678,臺南市'].join("\n");
const m = parseNpobanCsv(csv);
t("解析出 3 筆（碼太短與沒名字的被丟掉）", Object.keys(m).length, 3);
t("名字裡的逗號沒切壞", m["567"], "逗號, 在名字裡的協會");
t("跳脫雙引號正確", m["8901234"], '引號"測試"協會');
t("欄位名對不上就整批放棄", Object.keys(parseNpobanCsv("a,b,c\n1,2,3")).length, 0);

console.log("\n── 真的到財政部更新一次 ──");
const before = npobanCount();
const res = await refreshNpoban();
console.log("   ", res.ok ? "✓" : "✗", res.msg);
t("更新成功", res.ok, true);
t("筆數沒有暴跌", res.count >= before * 0.9, true);
t("更新後 8585 還在", npobanName("8585"), "財團法人台灣兒童暨家庭扶助基金會");
t("更新後版本變成日期", /^\d{4}-\d{2}-\d{2}$/.test(npobanUpdatedAt()), true);

console.log(`\n${r.filter(Boolean).length} / ${r.length} 通過`);
if (r.some((x) => !x)) process.exit(1);
