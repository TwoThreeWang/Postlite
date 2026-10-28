import { useEffect, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import { GitStatusT, api } from "../lib";
import { confirmDialog } from "./Dialog";

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
  /** 拉取成功后刷新集合与环境数据 */
  onPulled: () => void;
}

export default function GitModal({ onClose, onToast, onPulled }: Props) {
  const [status, setStatus] = useState<GitStatusT | null>(null);
  const [remoteIn, setRemoteIn] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // 操作日志：git 命令实时推送（git:log 事件）+ 本地追加的分隔条与结果行
  const [log, setLog] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const appendLog = (lines: string[]) =>
    setLog((prev) => {
      const next = [...prev, ...lines];
      return next.length > 600 ? next.slice(next.length - 600) : next; // 防止无限增长
    });

  useEffect(() => {
    const off = Events.On("git:log", (ev: any) => {
      const line = Array.isArray(ev?.data) ? String(ev.data[0] ?? "") : String(ev?.data ?? "");
      if (!line) return;
      appendLog(line.split("\n"));
    });
    return () => off();
  }, []);

  // 日志区自动滚动到底部
  useEffect(() => {
    const box = logBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log]);

  const refresh = async () => {
    try {
      const st = await api.gitStatus();
      setStatus(st);
      setRemoteIn(st.remote);
    } catch (e) {
      appendLog([`✗ ${String(e)}`]);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(true);
    const now = new Date().toTimeString().slice(0, 8);
    appendLog(["", `──── ${label} · ${now} ────`]);
    try {
      const res = await fn();
      const text = typeof res === "string" && res.trim() ? res.trim() : `${label}完成`;
      appendLog(text.split("\n").map((l) => `✓ ${l}`));
      if (label !== "拉取") onToast(text.split("\n")[0].slice(0, 60));
      await refresh();
      if (label === "拉取") {
        onPulled();
        onToast("已从远端拉取并刷新数据");
      }
    } catch (e) {
      const errText = String(e).replace(/^Error:\s*/, "");
      appendLog(errText.split("\n").map((l) => `✗ ${l}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Git 同步（集合 + 环境）</span>
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body git-body">
          {!status && <div className="kv-empty">读取中…</div>}

          {status && !status.gitFound && (
            <div className="sidebar-hint">
              未找到 git 命令。请先安装 Git 并确保在 PATH 中，然后重启 Postlite。
            </div>
          )}

          {status?.gitFound && !status.isRepo && (
            <>
              <div className="env-hint">
                把本地数据目录变成 git 仓库后，就可以提交快照、推送到私有远端，在多台机器间同步集合与环境。
                <br />
                history.json（请求历史）不会参与同步。
              </div>
              <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                <button className="send-btn" onClick={() => run("初始化", api.gitInit)} disabled={busy}>
                  初始化仓库
                </button>
              </div>
            </>
          )}

          {status?.isRepo && (
            <>
              {status.detached && (
                <div className="env-hint git-detached-warn">
                  ⚠ 当前处于游离 HEAD（不在任何分支上）。执行 git 操作时会自动安全恢复到分支；
                  若与分支存在分叉冲突，操作会被拒绝并提示手动处理。
                </div>
              )}
              <div className="git-status">
                <div className="git-line">
                  <span className="git-k">分支</span>
                  <span className="git-v mono">{status.branch || "-"}</span>
                </div>
                <div className="git-line">
                  <span className="git-k">变更</span>
                  <span className="git-v">
                    {status.changes > 0 ? `${status.changes} 个文件未提交` : "工作区干净"}
                  </span>
                </div>
                <div className="git-line">
                  <span className="git-k">最近提交</span>
                  <span className="git-v mono">{status.lastCommit || "（还没有提交）"}</span>
                </div>
              </div>

              <label className="field-label">远端仓库地址（origin）</label>
              <div className="git-remote-row">
                <input
                  className="kv-input"
                  value={remoteIn}
                  placeholder="git@github.com:you/postlite-data.git"
                  spellCheck={false}
                  onChange={(e) => setRemoteIn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) {
                      run("保存 remote", () => api.gitSetRemote(remoteIn));
                    }
                  }}
                />
                <button
                  className="mini-btn"
                  disabled={busy}
                  onClick={() => run("保存 remote", () => api.gitSetRemote(remoteIn))}
                >
                  保存
                </button>
              </div>

              <label className="field-label">
                提交信息（留空自动生成时间戳）
                {status.changes === 0 && (
                  <span className="git-hint"> · 工作区干净，没有可提交的变更</span>
                )}
              </label>
              <div className="git-remote-row">
                <input
                  className="kv-input"
                  value={msg}
                  placeholder="同步集合与环境"
                  spellCheck={false}
                  disabled={status.changes === 0}
                  onChange={(e) => setMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && status.changes > 0 && !busy) {
                      run("提交", () => api.gitCommit(msg));
                    }
                  }}
                />
                <button
                  className="mini-btn"
                  disabled={busy || status.changes === 0}
                  onClick={() => run("提交", () => api.gitCommit(msg))}
                  title={status.changes === 0 ? "工作区干净，先在主界面改动集合/环境再提交" : "提交全部变更"}
                >
                  提交快照
                </button>
              </div>

              <div className="git-actions">
                <button className="sbtn" disabled={busy} onClick={() => run("拉取", api.gitPull)}>
                  拉取
                </button>
                <button className="sbtn" disabled={busy} onClick={() => run("推送", api.gitPush)}>
                  推送
                </button>
                <button
                  className="sbtn"
                  disabled={busy}
                  onClick={() => {
                    api.gitOpenDiffWindow().catch((e) =>
                      appendLog([`✗ 打开对比窗口失败：${String(e).replace(/^Error:\s*/, "")}`]),
                    );
                  }}
                  title={status.changes === 0 ? "工作区当前没有未提交改动" : "在独立窗口中查看未提交改动的左右对比"}
                >
                  查看改动
                </button>
                <button
                  className="sbtn"
                  disabled={busy || !status.lastCommit || status.lastCommitPushed}
                  onClick={async () => {
                    if (!(await confirmDialog("撤销最近一次提交？文件内容会保留为未提交状态。"))) return;
                    run("撤销提交", api.gitUndoCommit);
                  }}
                  title={
                    status.lastCommitPushed
                      ? "最近一次提交已推送到远端，不能撤销"
                      : "取消最近一次提交（git reset --mixed HEAD~1），文件内容保留"
                  }
                >
                  撤销上次提交
                </button>
              </div>
            </>
          )}

          <div className="git-log" ref={logBoxRef}>
            {log.length === 0 ? (
              <div className="git-log-empty">操作日志将在这里实时显示（每次操作用分隔条隔开）</div>
            ) : (
              log.map((line, i) => {
                let cls = "";
                if (line.startsWith("────")) cls = "sep";
                else if (line.startsWith("✗")) cls = "err";
                else if (line.startsWith("$ git")) cls = "cmd";
                return (
                  <div key={i} className={`git-log-line ${cls}`}>
                    {line || " "}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
