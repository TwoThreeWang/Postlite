import { KV, emptyKV } from "../lib";

interface Props {
  rows: KV[];
  onChange: (rows: KV[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export default function KVEditor({ rows, onChange, keyPlaceholder = "Key", valuePlaceholder = "Value" }: Props) {
  const setRow = (idx: number, patch: Partial<KV>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const removeRow = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const addRow = () => onChange([...rows, emptyKV()]);

  return (
    <div className="kv-editor">
      {rows.length === 0 && <div className="kv-empty">暂无条目，点击下方按钮添加</div>}
      {rows.map((row, idx) => (
        <div className="kv-row" key={idx}>
          <input
            type="checkbox"
            className="kv-check"
            checked={row.enabled}
            onChange={(e) => setRow(idx, { enabled: e.target.checked })}
            title="启用/禁用"
          />
          <input
            className="kv-input"
            value={row.key}
            placeholder={keyPlaceholder}
            onChange={(e) => setRow(idx, { key: e.target.value })}
            spellCheck={false}
          />
          <input
            className="kv-input"
            value={row.value}
            placeholder={valuePlaceholder}
            onChange={(e) => setRow(idx, { value: e.target.value })}
            spellCheck={false}
          />
          <button className="kv-del" onClick={() => removeRow(idx)} title="删除">
            ×
          </button>
        </div>
      ))}
      <button className="kv-add" onClick={addRow}>
        + 添加
      </button>
    </div>
  );
}
