import { useState } from "react";
import { Spec, api } from "../lib";

interface Props {
  onClose: () => void;
  onParsed: (spec: Spec) => void;
  onError: (msg: string) => void;
}

export default function CurlImportModal({ onClose, onParsed, onError }: Props) {
  const [cmd, setCmd] = useState("");
  const [parsing, setParsing] = useState(false);

  const doParse = async () => {
    if (!cmd.trim() || parsing) return;
    setParsing(true);
    try {
      const spec = await api.parseCurl(cmd);
      onParsed(spec);
    } catch (e) {
      onError(`cURL 解析失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>从 cURL 导入</span>
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body">
          <div className="field-label">
            粘贴完整的 cURL 命令（支持 -X / -H / -d / -F 与续行符），解析后作为新请求打开：
          </div>
          <textarea
            className="curl-ta"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            placeholder={"curl -X POST 'https://api.example.com/v1/users' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"Evan\"}'"}
            spellCheck={false}
            autoFocus
          />
          <div className="modal-actions">
            <button className="send-btn" onClick={doParse} disabled={!cmd.trim() || parsing}>
              {parsing ? "解析中…" : "解析并打开"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
