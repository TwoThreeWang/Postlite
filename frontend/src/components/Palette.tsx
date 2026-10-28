import { useEffect, useMemo, useRef, useState } from "react";
import { Col, EnvT, Fdr, Item, METHOD_COLORS } from "../lib";

interface Props {
  collections: Col[];
  envs: EnvT[];
  activeEnvId: string;
  onOpenRequest: (item: Item, col: Col) => void;
  onSwitchEnv: (id: string) => void;
  onClose: () => void;
}

interface PItem {
  type: "req" | "env";
  label: string;
  src: string;
  item?: Item;
  col?: Col;
  envId?: string;
}

function collectItems(folder: Fdr, col: Col, out: PItem[]) {
  for (const it of folder.items) {
    out.push({
      type: "req",
      label: `${it.spec.method}  ${it.name}`,
      src: `${col.name}/`,
      item: it,
      col,
    });
  }
  for (const sub of folder.folders) collectItems(sub, col, out);
}

export default function Palette({
  collections,
  envs,
  activeEnvId,
  onOpenRequest,
  onSwitchEnv,
  onClose,
}: Props) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<PItem[]>(() => {
    const f = q.trim().toLowerCase();
    const out: PItem[] = [];
    for (const col of collections) {
      const all: PItem[] = [];
      collectItems(col.root, col, all);
      for (const it of all) {
        if (!f || (it.label + col.name).toLowerCase().includes(f)) out.push(it);
      }
    }
    for (const env of envs) {
      if (env.id === activeEnvId) continue;
      if (!f || (`环境 ${env.name}`).toLowerCase().includes(f)) {
        out.push({ type: "env", label: `环境 → 切换到「${env.name}」`, src: "env", envId: env.id });
      }
    }
    return out.slice(0, 50);
  }, [q, collections, envs, activeEnvId]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  // 选中项滚入视野
  useEffect(() => {
    listRef.current
      ?.querySelector(`.p-item[data-i="${idx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const exec = (it: PItem | undefined) => {
    if (!it) return;
    if (it.type === "req" && it.item && it.col) onOpenRequest(it.item, it.col);
    else if (it.type === "env" && it.envId !== undefined) onSwitchEnv(it.envId);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      exec(items[idx]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <>
      <div className="modal-mask" onClick={onClose} />
      <div className="palette">
        <input
          className="p-in"
          autoFocus
          value={q}
          placeholder="搜索请求、集合、环境…"
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div ref={listRef}>
          {items.length === 0 && <div className="p-hint">没有匹配项</div>}
          {items.map((it, i) => (
            <div
              key={i}
              data-i={i}
              className={`p-item ${i === idx ? "on" : ""}`}
              onClick={() => exec(it)}
              onMouseEnter={() => setIdx(i)}
            >
              {it.type === "req" && (
                <span
                  className="p-method"
                  style={{ color: METHOD_COLORS[it.item?.spec.method ?? ""] ?? "#a0a0aa" }}
                >
                  {it.item?.spec.method}
                </span>
              )}
              <span className="p-label">{it.type === "req" ? it.item?.name : it.label}</span>
              <span className="src">{it.src}</span>
            </div>
          ))}
        </div>
        <div className="p-hint">↑↓ 选择 · ⏎ 执行 · esc 关闭</div>
      </div>
    </>
  );
}
