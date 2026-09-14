/*
 * 後台的布林設定一律用這個開關列（伺服器元件，純 HTML＋CSS，不需要 JS）。
 * 送出時一定帶值：前面藏一個同名 value="0"，勾了才多一個 "1"；後端 setCheckbox 看最後一個非 0 的值。
 * 舊分頁沒有這個欄位時保持原設定，這是 actions.ts 那段註解講過的坑。
 */
export default function Switch({
  name, label, hint, defaultChecked, disabled,
}: { name: string; label: React.ReactNode; hint?: React.ReactNode; defaultChecked?: boolean; disabled?: boolean }) {
  return (
    <label className="sw-row" style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      <input type="hidden" name={name} value="0" />
      <input type="checkbox" name={name} value="1" defaultChecked={defaultChecked} disabled={disabled} />
      <i className="sw" aria-hidden />
    </label>
  );
}
