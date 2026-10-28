import { useEffect, useState } from "react";

// macOS 的 WKWebView 里 Wails 没实现 JS 弹窗委托：window.confirm 恒为 false、window.prompt 恒为 null，
// 所以用应用内弹窗替代。<DialogHost /> 在 App 里挂载一次。
type Req = { message: string; value?: string; resolve: (v: string | null) => void };
let open: ((r: Req) => void) | null = null;

const ask = (message: string, value?: string) =>
  new Promise<string | null>((resolve) => {
    if (open) open({ message, value, resolve });
    else resolve(null);
  });

export const confirmDialog = (message: string) => ask(message).then((v) => v !== null);
export const promptDialog = (message: string, value = "") => ask(message, value);

export default function DialogHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    open = (r) => {
      setText(r.value ?? "");
      setReq(r);
    };
    return () => {
      open = null;
    };
  }, []);

  if (!req) return null;
  const isPrompt = req.value !== undefined;
  const done = (v: string | null) => {
    setReq(null);
    req.resolve(v);
  };
  const ok = () => done(isPrompt ? text : "");

  return (
    <div className="modal-mask" onClick={() => done(null)}>
      <div
        className="modal small"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") done(null);
        }}
      >
        <div className="modal-body">
          <div style={{ marginBottom: 10, whiteSpace: "pre-wrap" }}>{req.message}</div>
          {isPrompt && (
            <input
              className="env-select wide"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ok();
              }}
            />
          )}
          <div className="modal-actions" style={{ gap: 8 }}>
            <button className="mini-btn" onClick={() => done(null)}>
              取消
            </button>
            <button className="send-btn" autoFocus={!isPrompt} onClick={ok}>
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
