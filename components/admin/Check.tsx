/* 後台的勾選列（多選、同意事項）與單選列：整列可點、手機夠高。布林設定請用 Switch */
export default function Check({
  name, value = "1", label, hint, defaultChecked, checked, onChange, type = "checkbox", disabled, withZero = false,
}: {
  name: string; value?: string; label: React.ReactNode; hint?: React.ReactNode;
  defaultChecked?: boolean; checked?: boolean; onChange?: React.ChangeEventHandler<HTMLInputElement>;
  type?: "checkbox" | "radio"; disabled?: boolean;
  /* 需要「沒勾也送值」的表單（setCheckbox 那一套）設 true */
  withZero?: boolean;
}) {
  /* 站長 2026-09-04：後台所有勾選一律長得像開關（跟付款方式那排一樣）。單選（radio）維持圓點 */
  if (type === "checkbox") {
    return (
      <label className="sw-row" style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
        <span>{label}{hint && <small>{hint}</small>}</span>
        {withZero && <input type="hidden" name={name} value="0" />}
        <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} checked={checked} onChange={onChange} disabled={disabled} />
        <i className="sw" aria-hidden />
      </label>
    );
  }
  return (
    <label className="chk" style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}>
      <input type={type} name={name} value={value} defaultChecked={defaultChecked} checked={checked} onChange={onChange} disabled={disabled} />
      <span>{label}{hint && <> <small>{hint}</small></>}</span>
    </label>
  );
}
