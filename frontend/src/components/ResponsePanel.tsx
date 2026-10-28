import { useEffect, useMemo, useRef, useState } from "react";
import { KV, Resp, Spec, formatBytes, formatMs, highlightJSON, interpolate, isProbablyJSON } from "../lib";

interface Props {
  response: Resp | null;
  sending: boolean;
  spec: Spec;
  vars: KV[];
  showLineNumbers?: boolean;
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "#7fd13b";
  if (code >= 300 && code < 400) return "#f5b83d";
  if (code >= 400 && code < 500) return "#f0997b";
  if (code >= 500) return "#f0647c";
  return "#a0a0aa";
}

/** 由当前 spec 生成可执行的 cURL 命令 */
function buildCurl(spec: Spec, vars: KV[]): string {
  const q = spec.queryParams
    .filter((p) => p.enabled && p.key)
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
  const full = q ? `${spec.url}${spec.url.includes("?") ? "&" : "?"}${q}` : spec.url;
  const h = spec.headers
    .filter((x) => x.enabled && x.key)
    .map((x) => `-H '${x.key}: ${x.value}'`)
    .join(" ");
  const b =
    spec.bodyType === "raw" && spec.rawBody
      ? `-d '${spec.rawBody.replace(/\n\s*/g, "")}'`
      : "";
  return `curl -X ${spec.method} '${interpolate(full, vars)}' ${h} ${b}`
    .replace(/\s+/g, " ")
    .trim();
}

/** 时间明细的相位值：0 显示为 —（如连接复用） */
const phase = (v: number) => (v > 0 ? `${v} ms` : "—");

const escHTML = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 超长行跳过语法着色（正则在大字符串上会拖垮渲染线程），只做转义 */
const lineHTML = (l: string) =>
  (l.length > 200_000 ? escHTML(l) : highlightJSON(l)) || "&nbsp;";

const MAX_RENDER_LINES = 5000;

interface Row {
  idx: number; // 对应 bodyLines 的下标；-1 表示省略行
  ellipsis: boolean;
  count: number; // 省略行显示的折叠行数
  open: number; // 省略行对应的展开行下标
}

export default function ResponsePanel({ response, sending, spec, vars, showLineNumbers = true }: Props) {
  // ⚠️ React 规则：所有 Hook 必须无条件调用，必须放在任何 early return 之前。
  // 之前 hitLines 的 useMemo/useEffect 写在 early return 之后，响应一到达
  // hook 数量变多触发 React #310，整棵树卸载——表现为窗口全黑。
  const [tab, setTab] = useState<"body" | "headers">("body");
  const [pretty, setPretty] = useState(true);
  const [copied, setCopied] = useState(false);
  const [detail, setDetail] = useState<"time" | "size" | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [hitIdx, setHitIdx] = useState(0);
  const [bodyCopied, setBodyCopied] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gutterRef = useRef<HTMLPreElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 行号槽与内容滚动同步
  const onBodyScroll = (e: React.UIEvent<HTMLPreElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  // 新响应到达时重置搜索 / 明细 / 折叠
  useEffect(() => {
    setDetail(null);
    setSearchQ("");
    setSearchOpen(false);
    setHitIdx(0);
    setCollapsed(new Set());
    if (response?.ok && response.body) {
      setPretty(isProbablyJSON(response.body));
    }
  }, [response]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // Ctrl+F 打开搜索（仅本面板有响应时）；打开后聚焦输入框
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F") && response?.ok) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [response]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // 美化 JSON（一次解析；非 JSON 返回 null）
  const jsonPretty = useMemo(() => {
    if (!response?.body) return null;
    const t = response.body.trim();
    if (!(t.startsWith("{") || t.startsWith("["))) return null;
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      return null;
    }
  }, [response]);

  const bodyText = response?.body || "(空响应体)";
  const bodyShown = pretty && jsonPretty ? jsonPretty : bodyText;
  const bodyLines = bodyShown.split("\n");
  const lineCount = bodyLines.length;

  // 大响应保护：行数超限只渲染前 N 行，避免渲染线程被几十万个 DOM 节点打死。
  // 完整内容仍可通过复制按钮拿全。
  const truncated = lineCount > MAX_RENDER_LINES;
  const viewLines = truncated ? bodyLines.slice(0, MAX_RENDER_LINES) : bodyLines;

  const isPrettyJSON = pretty && !!jsonPretty;

  // 折叠映射：以 { 或 [ 结尾的行 → 对应闭合行下标（缩进由 JSON.stringify 保证）
  const foldMap = useMemo(() => {
    const m = new Map<number, number>();
    if (!isPrettyJSON) return m;
    const stack: number[] = [];
    viewLines.forEach((l, i) => {
      const t = l.trimEnd();
      if (t.endsWith("{") || t.endsWith("[")) {
        stack.push(i);
      } else if (t.trimStart().startsWith("}") || t.trimStart().startsWith("]")) {
        const open = stack.pop();
        if (open !== undefined) m.set(open, i);
      }
    });
    return m;
  }, [bodyShown, truncated, isPrettyJSON]);

  // 响应内搜索：命中的行号列表（基于已渲染部分）
  const q = searchQ.trim().toLowerCase();
  const hitLines = useMemo(() => {
    if (!q) return [] as number[];
    const out: number[] = [];
    viewLines.forEach((l, i) => {
      if (l.toLowerCase().includes(q)) out.push(i);
    });
    return out;
  }, [q, bodyShown, truncated]);

  // 当前命中行滚入视野
  useEffect(() => {
    if (!q || !hitLines.length) return;
    const idx = Math.min(hitIdx, hitLines.length - 1);
    const el = document.querySelector(`.resp-line[data-line="${hitLines[idx]}"]`);
    el?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitIdx, searchQ, tab]);

  // 当前选中命中的行号（上一个/下一个定位目标），与其他命中区分亮度
  // 注意：hitIdx 是 hitLines 的下标，要取 hitLines[hitIdx] 才是行号
  const cur = hitLines.length ? hitLines[Math.min(hitIdx, hitLines.length - 1)] : -1;

  const toggleFold = (i: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const searchNext = (dir: 1 | -1) => {
    if (!hitLines.length) return;
    setHitIdx((i) => (i + dir + hitLines.length) % hitLines.length);
  };

  const copyCurl = () => {
    const curl = buildCurl(spec, vars);
    if (navigator.clipboard) navigator.clipboard.writeText(curl);
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  const copyBody = () => {
    if (response?.body && navigator.clipboard) navigator.clipboard.writeText(response.body);
    setBodyCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setBodyCopied(false), 1600);
  };

  // ---------- 以下为纯渲染逻辑，Hook 已全部声明完毕 ----------

  if (sending) {
    return (
      <div className="response">
        <div className="response-placeholder">
          <div className="shimmer" />
          <div>发送中…</div>
        </div>
      </div>
    );
  }
  if (!response) {
    return (
      <div className="response">
        <div className="response-placeholder">
          <div className="placeholder-tip">点击 Send 发送请求</div>
          <div className="placeholder-kbd">
            <kbd>Ctrl ⏎</kbd> 发送 · <kbd>Ctrl K</kbd> 搜索 · <kbd>Ctrl S</kbd> 保存
          </div>
        </div>
      </div>
    );
  }

  // 按折叠状态生成可见行列表（省略行占一行，闭合行保留）
  const rows: Row[] = [];
  if (isPrettyJSON && collapsed.size > 0) {
    let i = 0;
    while (i < viewLines.length) {
      if (foldMap.has(i) && collapsed.has(i)) {
        const close = foldMap.get(i)!;
        rows.push({ idx: i, ellipsis: false, count: 0, open: i });
        rows.push({ idx: -1, ellipsis: true, count: close - i - 1, open: i });
        rows.push({ idx: close, ellipsis: false, count: 0, open: close });
        i = close + 1;
        continue;
      }
      rows.push({ idx: i, ellipsis: false, count: 0, open: i });
      i++;
    }
  } else {
    viewLines.forEach((_, i) => rows.push({ idx: i, ellipsis: false, count: 0, open: i }));
  }

  const gutterText = rows.map((r) => (r.ellipsis ? "" : String(r.idx + 1))).join("\n");

  const shown = (
    <>
      {truncated && (
        <div className="resp-trunc">
          <span>
            响应过大：共 {lineCount.toLocaleString()} 行，仅渲染前 {MAX_RENDER_LINES.toLocaleString()} 行（搜索也只覆盖已渲染部分）
          </span>
          <button className="rbtn" onClick={copyBody}>
            {bodyCopied ? "已复制 ✓" : "复制完整响应"}
          </button>
        </div>
      )}
      <div className="resp-body-wrap">
        {showLineNumbers && (
          <pre className="resp-gutter" ref={gutterRef}>
            {gutterText}
          </pre>
        )}
        <pre className={`resp-body ${isPrettyJSON ? "" : "plain"}`} onScroll={onBodyScroll}>
          {rows.map((r, k) => {
            if (r.ellipsis) {
              return (
                <div
                  key={`e${k}`}
                  className="resp-line resp-fold"
                  onClick={() => toggleFold(r.open)}
                  title="点击展开"
                >
                  {`… ${r.count} 行已折叠`}
                </div>
              );
            }
            const i = r.idx;
            const l = viewLines[i];
            const foldable = foldMap.has(i);
            return (
              <div
                key={i}
                data-line={i}
                className={`resp-line ${hitLines.includes(i) ? "hit" : ""} ${i === cur ? "hit-cur" : ""} ${foldable ? "foldable" : ""}`}
                title={foldable ? "点击折叠 / 展开" : undefined}
                onClick={foldable ? () => toggleFold(i) : undefined}
                dangerouslySetInnerHTML={isPrettyJSON ? { __html: lineHTML(l) } : undefined}
              >
                {isPrettyJSON ? undefined : l || "\u00a0"}
              </div>
            );
          })}
        </pre>
      </div>
    </>
  );

  return (
    <div className="response">
      <div className="statusline">
        {response.ok ? (
          <>
            <span className="sdot" style={{ background: statusColor(response.statusCode) }} />
            <span className="meta-item">
              {response.statusCode} {response.status.replace(/^\d+\s*/, "")}
            </span>
            <button
              className="meta-item meta-link"
              onClick={() => setDetail(detail === "time" ? null : "time")}
              title="点击查看各阶段耗时明细"
            >
              {formatMs(response.durationMs)}
            </button>
            <button
              className="meta-item meta-link"
              onClick={() => setDetail(detail === "size" ? null : "size")}
              title="点击查看响应/请求大小明细"
            >
              {formatBytes(response.sizeBytes)}
            </button>
            <span className="meta-item muted">{response.proto}</span>
          </>
        ) : (
          <>
            <span className="sdot" style={{ background: "#f0647c" }} />
            <span className="meta-item err-text">请求失败</span>
          </>
        )}

        {response.ok && tab === "body" && searchOpen && (
          <div className="findbar">
            <input
              ref={searchRef}
              className="resp-search"
              value={searchQ}
              placeholder="在响应中搜索…"
              spellCheck={false}
              onChange={(e) => {
                setSearchQ(e.target.value);
                setHitIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  searchNext(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  setSearchOpen(false);
                  setSearchQ("");
                  setHitIdx(0);
                }
              }}
            />
            <span className={`resp-search-n ${hitLines.length ? "" : "none"}`}>
              {q
                ? hitLines.length
                  ? `${Math.min(hitIdx + 1, hitLines.length)}/${hitLines.length}`
                  : "无结果"
                : ""}
            </span>
            <button
              className="rbtn"
              onClick={() => searchNext(-1)}
              disabled={!hitLines.length}
              title="上一个 (Shift+Enter)"
            >
              ↑
            </button>
            <button
              className="rbtn"
              onClick={() => searchNext(1)}
              disabled={!hitLines.length}
              title="下一个 (Enter)"
            >
              ↓
            </button>
            <button
              className="rbtn"
              onClick={() => {
                setSearchOpen(false);
                setSearchQ("");
                setHitIdx(0);
              }}
              title="关闭 (Esc)"
            >
              ×
            </button>
          </div>
        )}

        <div className="resp-tabs">
          <button className={`rbtn ${tab === "body" ? "on" : ""}`} onClick={() => setTab("body")}>
            Body
          </button>
          <button className={`rbtn ${tab === "headers" ? "on" : ""}`} onClick={() => setTab("headers")}>
            Headers
          </button>
          {tab === "body" && jsonPretty && (
            <button className={`rbtn ${pretty ? "on" : ""}`} onClick={() => setPretty(!pretty)}>
              Pretty
            </button>
          )}
          <button className="rbtn" onClick={copyCurl} title="复制为 cURL 命令">
            {copied ? "已复制 ✓" : "复制为 cURL"}
          </button>
          {response.ok && tab === "body" && (
            <button
              className={`rbtn ${searchOpen ? "on" : ""}`}
              onClick={() => setSearchOpen(!searchOpen)}
              title="在响应中搜索 (Ctrl+F)"
            >
              ⌕ 搜索
            </button>
          )}
        </div>

        {/* 耗时明细（渲染在 statusline 内部，绝对定位锚定状态栏） */}
        {detail === "time" && response.ok && (
          <div className="detail-pop">
            <div className="detail-row">
              <span>DNS 解析</span>
              <b>{phase(response.timingDnsMs)}</b>
            </div>
            <div className="detail-row">
              <span>TCP 连接</span>
              <b>{phase(response.timingConnectMs)}</b>
            </div>
            <div className="detail-row">
              <span>TLS 握手</span>
              <b>{phase(response.timingTlsMs)}</b>
            </div>
            <div className="detail-row">
              <span>等待首字节 (TTFB)</span>
              <b>{phase(response.timingTtfbMs)}</b>
            </div>
            <div className="detail-row">
              <span>内容下载</span>
              <b>{phase(response.timingTransferMs)}</b>
            </div>
            <div className="detail-row total">
              <span>总计</span>
              <b>{formatMs(response.durationMs)}</b>
            </div>
            {response.timingDnsMs === 0 && response.timingConnectMs === 0 && response.timingTlsMs === 0 && (
              <div className="detail-note">连接复用，无 DNS / 连接 / TLS 开销</div>
            )}
          </div>
        )}

        {/* 大小明细 */}
        {detail === "size" && response.ok && (
          <div className="detail-pop">
            <div className="detail-title">Response Size</div>
            <div className="detail-row">
              <span>Headers</span>
              <b>{formatBytes(response.respHeaderBytes)}</b>
            </div>
            <div className="detail-row">
              <span>Body</span>
              <b>{formatBytes(response.respBodyBytes)}</b>
            </div>
            <div className="detail-title">Request Size</div>
            <div className="detail-row">
              <span>Headers</span>
              <b>{formatBytes(response.reqHeaderBytes)}</b>
            </div>
            <div className="detail-row">
              <span>Body</span>
              <b>{formatBytes(response.reqBodyBytes)}</b>
            </div>
          </div>
        )}
      </div>

      {!response.ok && response.error && <div className="resp-error">{response.error}</div>}
      {response.ok && response.error && <div className="resp-error soft">{response.error}</div>}

      {tab === "body" && shown}
      {tab === "headers" && (
        <div className="resp-headers">
          {response.headers.map((h, i) => (
            <div className="resp-header-row" key={i}>
              <span className="resp-header-key">{h.key}</span>
              <span className="resp-header-val">{h.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
