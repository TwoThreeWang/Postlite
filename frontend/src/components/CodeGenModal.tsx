import { useMemo, useState } from "react";
import { CODE_LANGS, CodeLang, generateCode } from "../codegen";
import { KV, Spec } from "../lib";

interface Props {
  spec: Spec;
  vars: KV[];
  onClose: () => void;
  onToast: (msg: string) => void;
}

export default function CodeGenModal({ spec, vars, onClose, onToast }: Props) {
  const [lang, setLang] = useState<CodeLang>("cURL");
  const code = useMemo(() => generateCode(lang, spec, vars), [lang, spec, vars]);

  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(code);
    onToast(`${lang} 代码已复制到剪贴板`);
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>生成代码（使用当前环境的变量值）</span>
          <div className="codegen-head-actions">
            <button className="mini-btn" onClick={copy}>
              复制
            </button>
            <button className="mini-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div className="codegen-tabs">
          {CODE_LANGS.map((l) => (
            <button
              key={l}
              className={`builder-tab ${lang === l ? "active" : ""}`}
              onClick={() => setLang(l)}
            >
              {l}
            </button>
          ))}
        </div>
        <pre className="codegen-view">{code}</pre>
      </div>
    </div>
  );
}
