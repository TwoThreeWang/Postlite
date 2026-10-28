import { useState } from "react";
import { EnvT, api } from "../lib";
import KVEditor from "./KVEditor";

interface Props {
  envs: EnvT[];
  /** 打开时默认选中的环境（顶栏下拉当前选中的那个）；传空或不存在时回落到第一个 */
  initialSelectedId?: string;
  onClose: () => void;
  onChanged: () => void;
}

export default function EnvModal({ envs, initialSelectedId, onClose, onChanged }: Props) {
  const [selectedId, setSelectedId] = useState<string>(
    initialSelectedId && envs.some((e) => e.id === initialSelectedId)
      ? initialSelectedId
      : envs[0]?.id ?? "",
  );
  const [newName, setNewName] = useState("");
  const selected = envs.find((e) => e.id === selectedId) ?? null;

  const saveEnv = async (patch: Partial<EnvT>) => {
    if (!selected) return;
    await api.saveEnv({ ...selected, ...patch });
    onChanged();
  };

  const createEnv = async () => {
    const name = newName.trim();
    if (!name) return;
    const created = await api.newEnv(name);
    setNewName("");
    onChanged();
    setSelectedId(created.id);
  };

  const deleteEnv = async () => {
    if (!selected) return;
    await api.deleteEnv(selected.id);
    onChanged();
    setSelectedId("");
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>环境变量管理</span>
          <button className="mini-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-body env-layout">
          <div className="env-list">
            {envs.map((env) => (
              <div
                key={env.id}
                className={`env-item ${env.id === selectedId ? "active" : ""}`}
                onClick={() => setSelectedId(env.id)}
              >
                {env.name}
              </div>
            ))}
            <div className="env-create">
              <input
                className="kv-input"
                value={newName}
                placeholder="新环境名称"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createEnv();
                }}
              />
              <button className="mini-btn" onClick={createEnv} disabled={!newName.trim()}>
                新建
              </button>
            </div>
          </div>
          <div className="env-detail">
            {selected ? (
              <>
                <div className="env-detail-head">
                  <input
                    className="env-name-input"
                    value={selected.name}
                    onChange={(e) => saveEnv({ name: e.target.value })}
                  />
                  <button className="mini-btn danger" onClick={deleteEnv}>
                    删除此环境
                  </button>
                </div>
                <KVEditor
                  rows={selected.variables}
                  onChange={(rows) => saveEnv({ variables: rows })}
                  keyPlaceholder="变量名（如 base_url）"
                  valuePlaceholder="变量值"
                />
                <div className="env-hint">
                  在 URL / Header / Body 中用 {"{{变量名}}"} 引用，发送时自动替换；环境变量优先于集合变量。
                </div>
              </>
            ) : (
              <div className="kv-empty">选择或新建一个环境</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
