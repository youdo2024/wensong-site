import Link from "next/link";

/*
 * 六個設定頁共用的頁首：麵包屑一行、標題、一句話說明。
 *
 * 為什麼要麵包屑：桌機有側欄，站長看得到自己在「設定」底下的哪一頁；
 * 手機的側欄收在抽屜裡，進來就只剩標題，不寫出來就不知道上一層是什麼、怎麼回去。
 * 「設定」兩個字本身是連結，回目錄頁。
 */
export default function SettingsHead({
  name, title, sub,
}: {
  /* 麵包屑右半段，例如「通知」 */
  name: string;
  /* 大標，例如「設 定 ・ 通 知」（字距是品牌的一部分，空格手寫） */
  title: string;
  sub: string;
}) {
  return (
    <div className="ad-head">
      <div>
        <p className="ad-crumb"><Link href="/admin/settings">設 定</Link> › {name}</p>
        <h1>{title}</h1>
        <p className="sub">{sub}</p>
      </div>
    </div>
  );
}
