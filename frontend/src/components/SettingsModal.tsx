import { useEffect, useState } from "react";
import { AppInfoT, SettingsT, api } from "../lib";

interface Props {
  settings: SettingsT;
  onChange: (next: SettingsT) => void;
  onClose: () => void;
  onRefresh: () => void;
  onToast: (msg: string) => void;
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className={`switch ${on ? "on" : ""}`} onClick={onClick} role="switch" aria-checked={on}>
      <span className="switch-knob" />
    </button>
  );
}

export default function SettingsModal({ settings, onChange, onClose, onRefresh, onToast }: Props) {
  const [info, setInfo] = useState<AppInfoT | null>(null);
  // 代理输入的本地草稿：失焦 / 回车才提交，避免每敲一个字符就落盘
  const [proxyDraft, setProxyDraft] = useState(settings.proxy);
  const [pmKeyDraft, setPmKeyDraft] = useState(settings.postmanApiKey);

  const commitProxy = () => {
    const v = proxyDraft.trim();
    if (v === settings.proxy) return;
    onChange({ ...settings, proxy: v });
    onToast(v ? `代理已设置：${v}` : "已恢复直连（不走代理）");
  };

  const commitPmKey = () => {
    const v = pmKeyDraft.trim();
    if (v === settings.postmanApiKey) return;
    onChange({ ...settings, postmanApiKey: v });
    onToast(v ? "Postman API Key 已保存" : "已清除 Postman API Key");
  };

  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => {});
  }, []);

  const flip = (key: keyof SettingsT) => onChange({ ...settings, [key]: !settings[key] });

  // 切换数据目录：弹出原生目录选择框；切换后刷新信息并重新加载界面数据
  const changeDir = async () => {
    try {
      const p = await api.chooseDataDir();
      if (!p) return; // 用户取消
      const next = await api.setDataDir(p);
      setInfo(next);
      onRefresh();
      onToast(`数据目录已切换：${next.dataDir}`);
    } catch (e) {
      setInfo(await api.appInfo());
      onToast(`切换失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  const resetDir = async () => {
    try {
      const next = await api.setDataDir("");
      setInfo(next);
      onRefresh();
      onToast("已恢复默认数据目录");
    } catch (e) {
      onToast(`恢复失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>设置</span>
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body">
          <div className="set-section">外观</div>

          <div className="set-row">
            <div className="set-text">
              <div className="set-name">浅色模式</div>
              <div className="set-desc">切换深色 / 浅色主题，立即生效</div>
            </div>
            <Toggle
              on={settings.theme === "light"}
              onClick={() => onChange({ ...settings, theme: settings.theme === "light" ? "dark" : "light" })}
            />
          </div>

          <div className="set-section">通用</div>

          <div className="set-row">
            <div className="set-text">
              <div className="set-name">记录发送历史</div>
              <div className="set-desc">关闭后不再保存每次请求的发送记录</div>
            </div>
            <Toggle on={settings.recordHistory} onClick={() => flip("recordHistory")} />
          </div>

          <div className="set-row">
            <div className="set-text">
              <div className="set-name">显示响应行号</div>
              <div className="set-desc">响应 Body 左侧的行号栏</div>
            </div>
            <Toggle on={settings.showLineNumbers} onClick={() => flip("showLineNumbers")} />
          </div>

          <div className="set-section">网络</div>

          <div className="set-row">
            <div className="set-text">
              <div className="set-name">HTTP 代理</div>
              <div className="set-desc">留空 = 默认直连（忽略系统代理环境变量）；回车或失焦保存</div>
            </div>
            <input
              className="kv-input set-proxy"
              value={proxyDraft}
              placeholder="http://127.0.0.1:7890"
              spellCheck={false}
              onChange={(e) => setProxyDraft(e.target.value)}
              onBlur={commitProxy}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>

          <div className="set-section">Postman 云端同步</div>

          <div className="set-row">
            <div className="set-text">
              <div className="set-name">API Key</div>
              <div className="set-desc">
                postman.com → Settings → API Keys 生成；仅存本机（settings.json 不进 Git）。回车或失焦保存
              </div>
            </div>
            <input
              className="kv-input set-proxy"
              value={pmKeyDraft}
              placeholder="PMAK-..."
              type="password"
              spellCheck={false}
              onChange={(e) => setPmKeyDraft(e.target.value)}
              onBlur={commitPmKey}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>

          <div className="set-section">调试</div>

          <div className="set-row">
            <div className="set-text">
              <div className="set-name">开发者工具</div>
              <div className="set-desc">等价浏览器 F12，可查看 Console / Network / 元素</div>
            </div>
            <button className="mini-btn" onClick={() => api.openDevTools()}>
              打开
            </button>
          </div>

          <div className="set-row">
            <div className="set-text">
              <div className="set-name">数据目录</div>
              <div className="set-path">{info?.dataDir || "…"}{info?.dataDirIsCustom ? "（自定义）" : ""}</div>
              <div className="set-desc">切换时自动迁移集合 / 环境 / 历史 / 设置</div>
            </div>
            <div className="set-btns">
              <button
                className="mini-btn"
                onClick={changeDir}
                title="选择新的数据目录"
              >
                修改…
              </button>
              {info?.dataDirIsCustom && (
                <button className="mini-btn" onClick={resetDir} title="恢复到默认数据目录">
                  恢复默认
                </button>
              )}
              <button className="mini-btn" onClick={() => api.openDataDir()}>
                打开
              </button>
            </div>
          </div>

          <div className="set-section">关于</div>
          <div className="set-about">Postlite v{info?.version || "?"}</div>
        </div>
      </div>
    </div>
  );
}
