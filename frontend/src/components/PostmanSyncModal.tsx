import { useEffect, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import { PostmanRemoteListT, PostmanSyncResultT, api } from "../lib";

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
  onSynced: () => void; // 同步成功后刷新侧栏
}

type Phase = "idle" | "listing" | "list-error" | "ready" | "syncing" | "done";

export default function PostmanSyncModal({ onClose, onToast, onSynced }: Props) {
  const [remote, setRemote] = useState<PostmanRemoteListT | null>(null);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<PostmanSyncResultT | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  // 同步进度日志：后端逐条推送（postman:log 事件），与 Git 弹窗同款交互
  const [log, setLog] = useState<string[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const appendLog = (lines: string[]) =>
    setLog((prev) => {
      const next = [...prev, ...lines];
      return next.length > 600 ? next.slice(next.length - 600) : next;
    });

  useEffect(() => {
    const off = Events.On("postman:log", (ev: any) => {
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

  const list = async () => {
    setPhase("listing");
    setErr("");
    setRemote(null);
    try {
      const r = await api.postmanListRemote();
      setRemote(r);
      setPhase("ready");
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/, ""));
      setPhase("list-error");
    }
  };

  useEffect(() => {
    list();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncAll = async () => {
    setPhase("syncing");
    setErr("");
    const now = new Date().toTimeString().slice(0, 8);
    appendLog(["", `──── 拉取全部 · ${now} ────`]);
    try {
      const r = await api.postmanSyncAll();
      setResult(r);
      setPhase("done");
      onSynced();
      onToast(`Postman 同步完成：更新 ${r.updated.length}，新建 ${r.created.length}，失败 ${r.failed.length}`);
    } catch (e) {
      const errText = String(e).replace(/^Error:\s*/, "");
      setErr(errText);
      setPhase("ready");
      appendLog(errText.split("\n").map((l) => `✗ ${l}`));
    }
  };

  const busy = phase === "listing" || phase === "syncing";
  const total = remote ? remote.collections.length + remote.environments.length : 0;

  // 单行日志的样式：分隔条 / 错误 / 阶段标题（普通 ✓ 行不加色）
  const lineClass = (l: string) => {
    if (l.startsWith("────")) return " sep";
    if (l.startsWith("✗")) return " err";
    if (l.endsWith("…")) return " cmd";
    return "";
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Postman 云端同步{phase === "syncing" ? " · 拉取中…" : ""}</span>
          <button className="mini-btn" onClick={onClose} disabled={phase === "syncing"}>
            {phase === "syncing" ? "同步中…" : "关闭"}
          </button>
        </div>
        <div className="modal-body git-body">
          <div className="pm-note">
            <div className="pm-note-title">同步规则（点「拉取全部」时）</div>
            <ul>
              <li>
                <b>名字相同</b> → 用云端内容<b>覆盖</b>本地同名集合/环境，你在本地对它的修改会被替换（请确认云端是最新版本）
              </li>
              <li>
                <b>名字不同</b> → 作为<b>新</b>集合/环境加入本地，互不影响
              </li>
              <li>
                <b>本地有、云端没有</b> → 保持原样，<b>不会被删除</b>
              </li>
            </ul>
            <div className="pm-note-foot">
              拉取范围是该 API Key 账号可访问的全部集合与环境；API Key 在「设置 → Postman 云端同步」里填写，只保存在本机。
            </div>
          </div>

          <div className="git-actions">
            <button className="sbtn" disabled={busy} onClick={list} title="重新拉取远端清单">
              {phase === "listing" ? "获取中…" : "刷新清单"}
            </button>
            <button
              className="sbtn"
              disabled={busy || phase !== "ready"}
              onClick={syncAll}
              title="下载全部远端集合并导入本地"
            >
              {phase === "syncing" ? "拉取中…" : "拉取全部"}
            </button>
            {phase === "syncing" && <span className="git-hint">正在逐条下载，进度见下方日志…</span>}
          </div>

          {phase === "listing" && <div className="git-hint">正在获取远端清单…</div>}

          {err && <div className="git-log-line err">✗ {err}</div>}

          {remote && (
            <div className="git-log" style={{ maxHeight: 160 }}>
              <div className="git-log-line cmd">
                远端集合（{remote.collections.length}） · 环境（{remote.environments.length}）
              </div>
              {total === 0 && <div className="git-log-line">远端没有集合或环境</div>}
              {remote.collections.map((c) => (
                <div className="git-log-line" key={c.uid}>
                  📁 {c.name}
                </div>
              ))}
              {remote.environments.map((e) => (
                <div className="git-log-line" key={e.uid}>
                  🌿 {e.name}
                </div>
              ))}
            </div>
          )}

          {log.length > 0 && (
            <div className="git-log" ref={logBoxRef}>
              {log.map((l, i) => (
                <div key={i} className={`git-log-line${lineClass(l)}`}>
                  {l}
                </div>
              ))}
            </div>
          )}

          {result && (
            <div className="git-hint" style={{ marginTop: 8 }}>
              上次结果：更新 {result.updated.length} · 新建 {result.created.length} · 失败 {result.failed.length}
              {result.failed.length > 0 && "（失败明细见上方日志）"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
