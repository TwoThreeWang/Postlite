import { useState } from "react";
import { KV, Spec, METHOD_COLORS, METHODS, interpolate } from "../lib";
import KVEditor from "./KVEditor";

interface Props {
  spec: Spec;
  vars: KV[];
  sending: boolean;
  onChange: (patch: Partial<Spec>) => void;
  onSend: () => void;
  onOpenCode: () => void;
  onToast: (msg: string) => void;
}

type BuilderTab = "params" | "headers" | "body" | "extract";

const BODY_TYPES: Array<{ value: string; label: string }> = [
  { value: "none", label: "none" },
  { value: "raw", label: "raw" },
  { value: "form", label: "form-data" },
  { value: "urlencoded", label: "x-www-form-urlencoded" },
];

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 从 URL 中拆出 query；没有 query 返回 null */
function parseQueryFromUrl(url: string): { base: string; pairs: KV[] } | null {
  const i = url.indexOf("?");
  if (i < 0) return null;
  const q = url.slice(i + 1);
  const pairs: KV[] = q
    .split("&")
    .filter(Boolean)
    .map((p) => {
      const eq = p.indexOf("=");
      const k = eq < 0 ? p : p.slice(0, eq);
      const v = eq < 0 ? "" : p.slice(eq + 1);
      const dec = (s: string) => {
        try {
          return decodeURIComponent(s.replace(/\+/g, " "));
        } catch {
          return s;
        }
      };
      return { key: dec(k), value: dec(v), enabled: true };
    });
  return { base: url.slice(0, i), pairs };
}

export default function RequestBuilder({ spec, vars, sending, onChange, onSend, onOpenCode, onToast }: Props) {
  const [tab, setTab] = useState<BuilderTab>("params");
  // 自绘变量提示（替代原生 title）：原生 tooltip 在截图快捷键触发时会被系统隐藏，
  // DOM 渲染的提示浮层可以正常截进图里
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const paramCount = spec.queryParams.filter((p) => p.enabled && p.key).length;
  const headerCount = spec.headers.filter((p) => p.enabled && p.key).length;
  const bodyCount = spec.bodyType !== "none" ? 1 : 0;

  // raw body JSON 美化
  const beautify = () => {
    try {
      const obj = JSON.parse(spec.rawBody);
      onChange({ rawBody: JSON.stringify(obj, null, 2) });
    } catch {
      onToast("美化失败：请求体不是合法 JSON");
    }
  };

  // URL 输入：带 ? 时自动把 query 拆到 Params
  const onUrlInput = (v: string) => {
    const parsed = parseQueryFromUrl(v);
    if (parsed && parsed.pairs.length) {
      onChange({ url: parsed.base, queryParams: parsed.pairs });
    } else {
      onChange({ url: v });
    }
  };

  // Params 编辑：同步拼回 URL
  const onParamsChange = (rows: KV[]) => {
    const base = spec.url.split("?")[0];
    const q = rows
      .filter((p) => p.enabled && p.key)
      .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join("&");
    onChange({ queryParams: rows, url: q ? `${base}?${q}` : base });
  };

  // 变量高亮层：每个 {{var}} 片段带悬浮提示（解析后的值）；
  // data-s/data-e 记录原始 URL 中的位置，点击片段可在输入框里选中该变量。
  // 注意按原始字符串分段转义，保证 data-* 下标与输入框光标位置一致。
  // 提示内容放 data-tip，由自绘浮层展示（截图可见），不用原生 title。
  const buildHl = () => {
    let out = "";
    let last = 0;
    for (const m of spec.url.matchAll(/\{\{[^{}]*\}\}/g)) {
      const i = m.index;
      out += escHtml(spec.url.slice(last, i));
      const name = m[0].slice(2, -2).trim();
      const v = vars.find((x) => x.enabled && x.key.trim() === name);
      const tip =
        v !== undefined
          ? `${m[0]} → ${v.value === "" ? "（空值）" : v.value}`
          : `未定义变量 ${m[0]}（发送时原样保留）`;
      out += `<span class="u-var" data-s="${i}" data-e="${i + m[0].length}" data-tip="${escAttr(tip)}">${escHtml(m[0])}</span>`;
      last = i + m[0].length;
    }
    out += escHtml(spec.url.slice(last)) + "<br>";
    return out;
  };
  const hlHtml = buildHl();

  /** 一段文本里所有 {{var}} 的提示（每行一个），没有变量返回空串 */
  const varTipFor = (text: string): string => {
    const ms = [...text.matchAll(/\{\{[^{}]*\}\}/g)];
    if (!ms.length) return "";
    return ms
      .map((m) => {
        const name = m[0].slice(2, -2).trim();
        const v = vars.find((x) => x.enabled && x.key.trim() === name);
        return v !== undefined
          ? `${m[0]} → ${v.value === "" ? "（空值）" : v.value}`
          : `未定义变量 ${m[0]}（发送时原样保留）`;
      })
      .join("\n");
  };

  // 事件委托：URL 高亮片段 / KV 输入框（参数、Header、表单字段值）悬停时显示变量提示
  const onTipOver = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    let text = "";
    const uv = el.closest(".u-var") as HTMLElement | null;
    if (uv) {
      text = uv.dataset.tip ?? "";
    } else if (el instanceof HTMLInputElement && el.classList.contains("kv-input")) {
      text = varTipFor(el.value);
    }
    if (!text) {
      setTip(null);
      return;
    }
    const r = el.getBoundingClientRect();
    // 优先显示在元素下方；底部放不下时改到上方；横向避免超出视口
    const estH = text.split("\n").length * 21 + 14;
    const y = r.bottom + estH + 12 > window.innerHeight ? r.top - estH - 6 : r.bottom + 6;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - 540));
    setTip({ x, y, text });
  };
  const onTipOut = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest(".u-var") || (el instanceof HTMLInputElement && el.classList.contains("kv-input"))) {
      setTip(null);
    }
  };

  // 点击变量片段：聚焦输入框并选中该变量，便于直接编辑
  const onHlClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.classList.contains("u-var")) return;
    const inp = e.currentTarget.parentElement?.querySelector<HTMLInputElement>(".url-in");
    if (!inp) return;
    const s = Number(t.dataset.s);
    const en = Number(t.dataset.e);
    if (Number.isNaN(s) || Number.isNaN(en)) return;
    e.preventDefault();
    inp.focus();
    inp.setSelectionRange(s, en);
  };

  // 解析后完整 URL（含 query）
  const q = spec.queryParams
    .filter((p) => p.enabled && p.key)
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
  const rawFull = q ? `${spec.url}${spec.url.includes("?") ? "&" : "?"}${q}` : spec.url;
  const resolved = interpolate(rawFull, vars);

  return (
    <div className="builder" onMouseOver={onTipOver} onMouseOut={onTipOut}>
      <div className="request-bar">
        <div className="urlgroup">
          <select
            className="method-select"
            value={spec.method}
            style={{ color: METHOD_COLORS[spec.method] ?? "#a0a0aa" }}
            onChange={(e) => onChange({ method: e.target.value })}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="url-wrap">
            <div className="url-hl" dangerouslySetInnerHTML={{ __html: hlHtml }} onClick={onHlClick} />
            <input
              className="url-in"
              value={spec.url}
              placeholder="https://api.example.com/path 或 {{base_url}}/path"
              spellCheck={false}
              onChange={(e) => onUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSend();
              }}
            />
          </div>
        </div>
        <button className="send-btn" onClick={onSend} disabled={sending}>
          {sending ? "…" : "Send"}
        </button>
      </div>

      <div className="builder-tabs">
        <button className={`builder-tab ${tab === "params" ? "active" : ""}`} onClick={() => setTab("params")}>
          Params{paramCount > 0 && <span className="badge">{paramCount}</span>}
        </button>
        <button className={`builder-tab ${tab === "headers" ? "active" : ""}`} onClick={() => setTab("headers")}>
          Headers{headerCount > 0 && <span className="badge">{headerCount}</span>}
        </button>
        <button className={`builder-tab ${tab === "body" ? "active" : ""}`} onClick={() => setTab("body")}>
          Body{bodyCount > 0 && <span className="badge">{bodyCount}</span>}
        </button>
        <div className="tabs-right">
          {resolved !== rawFull && (
            <span className="resolved" title={resolved}>
              解析 → <b>{resolved}</b>
            </span>
          )}
          <button
            className={`builder-tab ${tab === "extract" ? "active" : ""}`}
            onClick={() => setTab("extract")}
            title="发送成功后自动把响应里的值写入变量（如自动捕获 token）"
          >
            提取{spec.captures.length > 0 && <span className="badge">{spec.captures.length}</span>}
          </button>
          <button className="rbtn" onClick={onOpenCode} title="生成多语言代码（cURL/Python/JS/Go/Java）">
            {"</> 代码"}
          </button>
        </div>
      </div>

      <div className="builder-panel">
        {tab === "params" && (
          <KVEditor
            rows={spec.queryParams}
            onChange={onParamsChange}
            keyPlaceholder="参数名"
            valuePlaceholder="参数值"
          />
        )}
        {tab === "headers" && (
          <KVEditor
            rows={spec.headers}
            onChange={(rows) => onChange({ headers: rows })}
            keyPlaceholder="Header 名"
            valuePlaceholder="Header 值"
          />
        )}
        {tab === "body" && (
          <div className="body-panel">
            <div className="body-type-bar">
              {BODY_TYPES.map((t) => (
                <button
                  key={t.value}
                  className={`body-type ${spec.bodyType === t.value ? "active" : ""}`}
                  onClick={() => onChange({ bodyType: t.value })}
                >
                  {t.label}
                </button>
              ))}
              {spec.bodyType === "raw" && (
                <button
                  className="body-type beautify"
                  onClick={beautify}
                  title="格式化 JSON（缩进 2 空格）"
                >
                  美化
                </button>
              )}
            </div>
            {spec.bodyType === "raw" && (
              <textarea
                className="raw-body"
                value={spec.rawBody}
                placeholder='{"hello": "world"}'
                spellCheck={false}
                onChange={(e) => onChange({ rawBody: e.target.value })}
              />
            )}
            {(spec.bodyType === "form" || spec.bodyType === "urlencoded") && (
              <KVEditor
                rows={spec.formFields}
                onChange={(rows) => onChange({ formFields: rows })}
                keyPlaceholder="字段名"
                valuePlaceholder="字段值"
              />
            )}
            {spec.bodyType === "none" && <div className="kv-empty">此请求没有请求体</div>}
          </div>
        )}
        {tab === "extract" && (
          <div className="body-panel">
            {spec.captures.length === 0 && (
              <div className="kv-empty">
                没有提取规则。添加后，发送成功会自动把响应 JSON 里的值写入变量——其他请求直接引用 {"{{变量名}}"} 即可。
              </div>
            )}
            {spec.captures.map((c, i) => (
              <div className="cap-row" key={i}>
                <select
                  className="cap-target"
                  value={c.target}
                  onChange={(e) => {
                    const rows = spec.captures.map((r, j) =>
                      j === i ? { ...r, target: e.target.value } : r,
                    );
                    onChange({ captures: rows });
                  }}
                  title="写入环境变量还是集合变量"
                >
                  <option value="env">环境变量</option>
                  <option value="collection">集合变量</option>
                </select>
                <input
                  className="kv-input cap-name"
                  value={c.varName}
                  placeholder="变量名，如 token"
                  spellCheck={false}
                  onChange={(e) => {
                    const rows = spec.captures.map((r, j) =>
                      j === i ? { ...r, varName: e.target.value } : r,
                    );
                    onChange({ captures: rows });
                  }}
                />
                <input
                  className="kv-input"
                  value={c.path}
                  placeholder="响应 JSON 路径，如 data.access_token"
                  spellCheck={false}
                  onChange={(e) => {
                    const rows = spec.captures.map((r, j) =>
                      j === i ? { ...r, path: e.target.value } : r,
                    );
                    onChange({ captures: rows });
                  }}
                />
                <button
                  className="kv-del"
                  title="删除规则"
                  onClick={() => onChange({ captures: spec.captures.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="kv-add"
              onClick={() =>
                onChange({ captures: [...spec.captures, { target: "env", varName: "", path: "" }] })
              }
            >
              + 添加提取规则
            </button>
            <div className="env-hint">
              发送成功后自动把响应 JSON 中该路径的值写入变量；数组索引用数字，如 data.list.0.id。集合变量提取需先把本请求保存到集合。
            </div>
          </div>
        )}
      </div>
      {tip && (
        <div className="var-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text.split("\n").map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
