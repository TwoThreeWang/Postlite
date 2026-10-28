// 改动对比窗口（独立 WebviewWindow，只读）：
// 三列布局 —— 左：改动文件列表；右：改动前 / 改动后 双列逐块对齐。
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DiffFileT, api } from "./lib";

/** 把一个 hunk 的旧/新行按上下文对齐成行对：context 成对，删除/新增按同步点 run 配对 */
interface RowPair {
  left: string | null;
  right: string | null;
  del: boolean; // 左侧参与改动（红）
  add: boolean; // 右侧参与改动（绿）
}

function alignHunk(oldLines: string[], newLines: string[]): RowPair[] {
  const pairs: RowPair[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      pairs.push({ left: oldLines[i], right: newLines[j], del: false, add: false });
      i++;
      j++;
      continue;
    }
    if (j >= newLines.length) {
      pairs.push({ left: oldLines[i], right: null, del: true, add: false });
      i++;
      continue;
    }
    if (i >= oldLines.length) {
      pairs.push({ left: null, right: newLines[j], del: false, add: true });
      j++;
      continue;
    }
    // 失配：向两侧找下一个同步点，先配对较短的一侧 run（改行场景两侧都有内容）
    let k = 0;
    while (i + k < oldLines.length && oldLines[i + k] !== newLines[j]) k++;
    let m = 0;
    while (j + m < newLines.length && newLines[j + m] !== oldLines[i]) m++;
    const n = Math.min(k, m);
    for (let x = 0; x < n; x++) {
      pairs.push({
        left: oldLines[i + x] ?? null,
        right: newLines[j + x] ?? null,
        del: true,
        add: true,
      });
    }
    i += n;
    j += n;
  }
  return pairs;
}

function DiffApp() {
  const [files, setFiles] = useState<DiffFileT[] | null>(null);
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const fs = await api.gitDiffDetail();
      setFiles(fs);
      if (sel >= fs.length) setSel(0);
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/, ""));
      setFiles([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cur = files && files.length > 0 ? files[Math.min(sel, files.length - 1)] : null;

  return (
    <div className="diffwin">
      <header className="diffwin-head">
        <span className="diffwin-title">未提交改动对比（只读）</span>
        <div className="spacer" />
        <button className="mini-btn" onClick={load} title="重新读取改动">
          刷新
        </button>
      </header>

      {err && <div className="diffwin-err">{err}</div>}

      {files !== null && files.length === 0 && (
        <div className="diffwin-empty">工作区干净，没有未提交的改动。</div>
      )}

      {files !== null && files.length > 0 && (
        <div className="diffwin-body">
          <aside className="diffwin-files">
            {files.map((f, i) => (
              <div
                key={f.path}
                className={`diffwin-file ${i === sel ? "active" : ""}`}
                onClick={() => setSel(i)}
                title={f.path}
              >
                <span className="diffwin-file-path">{f.path}</span>
                <span className="diffwin-file-meta">{f.isNew ? "新文件" : `${f.hunkCount} 处改动`}</span>
              </div>
            ))}
          </aside>

          <section className="diffwin-detail">
            {!cur && <div className="diffwin-empty">选择左侧文件查看对比</div>}
            {cur && cur.isNew && cur.hunks.length === 0 && (
              <div className="diffwin-empty">「{cur.path}」是未跟踪的新文件，还没有基线内容可对比。提交一次快照后即可查看后续改动。</div>
            )}
            {cur &&
              cur.hunks.map((h, hi) => (
                <div className="diff-hunkbox" key={hi}>
                  <div className="diff-hunkhead">
                    @@ -{h.oldStart} +{h.newStart} @@
                  </div>
                  <div className="diff-grid">
                    {alignHunk(h.oldLines, h.newLines).map((p, ri) => (
                      <div className="diff-pair" key={ri}>
                        <div className={`diff-cell ${p.del ? "d-del" : ""} ${!p.left && !p.del ? "d-none" : ""}`}>
                          {p.left ?? ""}
                        </div>
                        <div className={`diff-cell ${p.add ? "d-add" : ""} ${!p.right && !p.add ? "d-none" : ""}`}>
                          {p.right ?? ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </section>
        </div>
      )}
    </div>
  );
}

// 主题与主窗口保持一致
try {
  const t = localStorage.getItem("postlite-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch {
  /* ignore */
}

createRoot(document.getElementById("root")!).render(<DiffApp />);
