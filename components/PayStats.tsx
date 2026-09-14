import { payStats, dailyOrders, type Bucket } from "@/lib/pay-stats";
import { money } from "@/lib/format";

/*
 * 付款成功率速覽，放在訂單列表上方。
 *
 * 這一區存在的理由是站長訂了兩個門檻：
 *   Apple Pay 再累積 5 次嘗試、成功率低於 50% 就關掉
 *   內建瀏覽器隱藏信用卡之後兩週回看，訂單數掉超過兩成就回頭
 * 門檻要跟看得到的數字對得起來，否則不會有人真的去對照。
 */

function Table({ title, rows, note }: { title: string; rows: Bucket[]; note?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <b className="sans">{title}</b>
      <table className="adm-table wide sans" style={{ marginTop: 6 }}>
        <tbody>
          {rows.length === 0 && <tr><td className="empty">還沒有資料</td></tr>}
          {rows.map((b) => (
            <tr key={b.key}>
              <td>{b.key}</td>
              <td align="right">{b.ok}／{b.total}</td>
              <td align="right" style={{ color: b.total >= 5 && b.rate < 0.5 ? "var(--seal)" : undefined }}>
                <b>{Math.round(b.rate * 100)}%</b>
              </td>
              <td align="right" style={{ color: "var(--grey)" }}>{money(b.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="fine" style={{ marginTop: 4 }}>{note}</p>}
    </div>
  );
}

export default function PayStats() {
  const d30 = payStats(30);
  const all = payStats();
  const daily = dailyOrders(14);
  const apple = all.byPay.find((b) => b.key === "Apple Pay");
  const maxN = Math.max(1, ...daily.map((d) => d.n));

  return (
    <details className="box" style={{ marginBottom: 22 }}>
      <summary className="sans" style={{ cursor: "pointer", padding: "12px 16px", fontSize: 14.5 }}>
        付款成功率速覽（最近 30 天 {d30.n} 筆・全部 {all.n} 筆）
      </summary>
      <div className="inner" style={{ padding: "4px 16px 18px" }}>
        <p className="fine" style={{ marginTop: 0 }}>
          分母只算已經有結果的訂單（已付款與已取消），還在待付款的不列入，
          否則數字會看起來比實際差。同一個人重試而被取代的那幾筆算失敗，
          這樣才看得出「一次就成功」的比例。
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20, marginTop: 12 }}>
          <Table title="最近 30 天　付款方式" rows={d30.byPay} />
          <Table title="最近 30 天　瀏覽器環境" rows={d30.byEnv} note="內建瀏覽器隱藏信用卡之後，這一欄的成功率應該要往上。" />
          <Table title="全部　付款方式" rows={all.byPay} />
          <Table title="全部　瀏覽器環境" rows={all.byEnv} />
        </div>

        {/* Apple Pay 的門檻：再 5 次嘗試、成功率低於 50% 就關掉 */}
        <hr className="divider" />
        <div>
          <b className="sans">Apple Pay 的觀察門檻</b>
          <p className="fine" style={{ marginTop: 4 }}>
            {apple
              ? apple.total >= 5
                ? apple.rate < 0.5
                  ? `已累積 ${apple.total} 次嘗試，成功率 ${Math.round(apple.rate * 100)}%。已經到門檻而且低於 50%，建議到「網站設定」把它關掉。`
                  : `已累積 ${apple.total} 次嘗試，成功率 ${Math.round(apple.rate * 100)}%，超過 50%，維持開啟。`
                : `目前 ${apple.ok}／${apple.total} 次嘗試，還沒到 5 次，樣本太小不能下結論。`
              : "目前還沒有人用 Apple Pay 結過帳。"}
          </p>
        </div>

        {/* 每日訂單數：改動之後如果總量掉下來，代表有人因為看不到想要的付款方式而走掉 */}
        <hr className="divider" />
        <div>
          <b className="sans">最近 14 天的每日訂單數</b>
          <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 70, marginTop: 10 }}>
            {daily.length === 0 && <span className="fine">還沒有資料</span>}
            {daily.map((d) => (
              <div key={d.day} style={{ flex: 1, minWidth: 0, textAlign: "center" }} title={`${d.day}　${d.n} 筆，其中 ${d.paid} 筆有付款`}>
                <div style={{ height: `${(d.n / maxN) * 52}px`, background: "var(--indigo)", borderRadius: 1 }} />
                <div style={{ color: "var(--grey)", marginTop: 3 }}>{d.day.slice(3)}</div>
              </div>
            ))}
          </div>
          <p className="fine" style={{ marginTop: 6 }}>
            隱藏信用卡之後如果這條線掉超過兩成，代表有人因為看不到想要的付款方式而離開。
            那些人不會留下訂單，所以這是唯一看得出來的線索。
          </p>
        </div>
      </div>
    </details>
  );
}
