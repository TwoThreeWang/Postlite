import { useEffect, useRef, useState } from "react";
import { Col, countRequests, Fdr, HistEntry, Item, METHOD_COLORS } from "../lib";

const SIDEBAR_W_KEY = "postlite-sidebar-w";
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 520;
// 目录展开状态持久化（localStorage：纯本机 UI 状态，不进 git 同步的数据文件）
const TREE_EXPANDED_KEY = "postlite-tree-expanded";
const COLS_EXPANDED_KEY = "postlite-cols-expanded"; // 记录"展开的集合"，缺省 = 全部折叠（对齐 Postman 习惯）

/** 从 localStorage 恢复一组 ID */
function loadIdSet(key: string): Set<string> {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

/** 把侧栏宽度写到根节点 CSS 变量（.app-body 的列宽读它） */
function applySidebarWidth(px: number) {
  const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)));
  document.documentElement.style.setProperty("--sidebar-w", `${w}px`);
  return w;
}

interface Props {
  collections: Col[];
  history: HistEntry[];
  activeKey: string;
  view: "cols" | "hist";
  onViewChange: (v: "cols" | "hist") => void;
  onOpenRequest: (item: Item, col: Col) => void;
  onOpenHistoryEntry: (h: HistEntry) => void;
  onClearHistory: () => void;
  onRenameItem: (col: Col, item: Item) => void;
  onDeleteItem: (col: Col, item: Item) => void;
  onEditVars: (col: Col) => void;
  onDeleteCollection: (id: string) => void;
  onNewCollection: () => void;
  onNewRequest: () => void;
  onImport: () => void;
  onImportCurl: () => void;
  onExport: () => void;
  onGit: () => void;
  onPostman: () => void;
}

function histCodeColor(h: HistEntry): string {
  if (!h.ok) return "#f0647c";
  const code = h.statusCode;
  if (code >= 200 && code < 300) return "#7fd13b";
  if (code >= 300 && code < 400) return "#f5b83d";
  if (code >= 400 && code < 500) return "#f0997b";
  return "#f0647c";
}

interface MenuState {
  x: number;
  y: number;
  col: Col;
  item?: Item;
}

function TreeFolder({
  folder,
  depth,
  expanded,
  toggle,
  activeKey,
  onOpenRequest,
  onItemMenu,
  collection,
  isRoot = false, // 根层：不渲染文件夹头（集合名已在上方），内容直接平铺
}: {
  folder: Fdr;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  activeKey: string;
  onOpenRequest: (item: Item, col: Col) => void;
  onItemMenu: (e: React.MouseEvent, item: Item, col: Col) => void;
  collection: Col;
  isRoot?: boolean;
}) {
  const isOpen = expanded.has(folder.id);

  // 子内容（子文件夹 + 请求），root 与普通文件夹共用
  const children = (childDepth: number) => (
    <>
      {folder.folders.map((f) => (
        <TreeFolder
          key={f.id}
          folder={f}
          depth={childDepth}
          expanded={expanded}
          toggle={toggle}
          activeKey={activeKey}
          onOpenRequest={onOpenRequest}
          onItemMenu={onItemMenu}
          collection={collection}
        />
      ))}
      {folder.items.map((it) => {
        const key = `${collection.id}:${it.id}`;
        return (
          <div
            key={it.id}
            className={`tree-request ${key === activeKey ? "active" : ""}`}
            style={{ paddingLeft: 20 + childDepth * 14 }}
            onClick={() => onOpenRequest(it, collection)}
            onContextMenu={(e) => onItemMenu(e, it, collection)}
            title={`${it.spec.url}\n右键：重命名 / 删除`}
          >
            <span
              className="tree-method"
              style={{ color: METHOD_COLORS[it.spec.method] ?? "#a0a0aa" }}
            >
              {it.spec.method}
            </span>
            <span className="tree-request-name">{it.name}</span>
          </div>
        );
      })}
    </>
  );

  if (isRoot) {
    // 根层没有折叠头（折叠由集合标题行负责），直接平铺内容
    return <div>{children(depth)}</div>;
  }

  return (
    <div>
      <div
        className="tree-folder"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => toggle(folder.id)}
      >
        <span className={`tree-caret ${isOpen ? "open" : ""}`}>▸</span>
        <span className="tree-folder-name">{folder.name}</span>
      </div>
      {isOpen && <div>{children(depth + 1)}</div>}
    </div>
  );
}

export default function Sidebar({
  collections,
  history,
  activeKey,
  view,
  onViewChange,
  onOpenRequest,
  onOpenHistoryEntry,
  onClearHistory,
  onRenameItem,
  onDeleteItem,
  onEditVars,
  onDeleteCollection,
  onNewCollection,
  onNewRequest,
  onImport,
  onImportCurl,
  onExport,
  onGit,
  onPostman,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => loadIdSet(TREE_EXPANDED_KEY));
  // 集合默认全部折叠：只记录"展开过的集合"
  const [expandedCols, setExpandedCols] = useState<Set<string>>(() => loadIdSet(COLS_EXPANDED_KEY));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  // 展开状态持久化：文件夹展开 / 集合展开变化时写 localStorage。
  // 顺带清理已不存在的 ID；集合尚未加载完成时跳过，避免把存的状态清空。
  useEffect(() => {
    if (collections.length === 0) return;
    const validFolders = new Set<string>();
    const walk = (f: Fdr) => {
      validFolders.add(f.id);
      f.folders.forEach(walk);
    };
    collections.forEach((c) => walk(c.root));
    const colIds = new Set(collections.map((c) => c.id));
    localStorage.setItem(
      TREE_EXPANDED_KEY,
      JSON.stringify([...expanded].filter((id) => validFolders.has(id))),
    );
    localStorage.setItem(
      COLS_EXPANDED_KEY,
      JSON.stringify([...expandedCols].filter((id) => colIds.has(id))),
    );
  }, [expanded, expandedCols, collections]);

  // 启动时恢复上次拖出的宽度
  useEffect(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_W_KEY));
    if (saved > 0) applySidebarWidth(saved);
  }, []);

  // 拖宽：按住把手横向移动，实时更新列宽；松开后记忆
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const sidebarW = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
    resizeRef.current = { startX: e.clientX, startW: sidebarW };
    setResizing(true);
    document.body.style.userSelect = "none"; // 拖动时禁止选中文字
    const onMove = (ev: MouseEvent) => {
      const st = resizeRef.current;
      if (!st) return;
      applySidebarWidth(st.startW + (ev.clientX - st.startX));
      ev.preventDefault();
    };
    const onUp = () => {
      resizeRef.current = null;
      setResizing(false);
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const cur = document.documentElement.style.getPropertyValue("--sidebar-w");
      if (cur) localStorage.setItem(SIDEBAR_W_KEY, String(parseFloat(cur)));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };
  const toggleCol = (id: string) => {
    const next = new Set(expandedCols);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedCols(next);
  };

  const totalRequests = collections.reduce(
    (acc, c) => acc + countRequests(c.root),
    0,
  );

  const closeMenu = () => setMenu(null);

  return (
    <aside className="sidebar" onClick={menu ? closeMenu : undefined}>
      <div
        className={`sidebar-resizer ${resizing ? "dragging" : ""}`}
        onMouseDown={startResize}
        title="拖动调整侧栏宽度"
      />
      <div className="side-tabs">
        <button
          className={`side-tab ${view === "cols" ? "on" : ""}`}
          onClick={() => onViewChange("cols")}
        >
          集合
        </button>
        <button
          className={`side-tab ${view === "hist" ? "on" : ""}`}
          onClick={() => onViewChange("hist")}
        >
          历史{history.length > 0 && <span className="side-tab-n">{history.length}</span>}
        </button>
      </div>

      {view === "cols" ? (
        <>
          <div className="side-h">
            共 {totalRequests} 个请求
          </div>
          <div className="side-tools">
            <button className="sbtn" onClick={onNewCollection} title="新建空集合">
              + 集合
            </button>
            <button className="sbtn" onClick={onNewRequest} title="新建请求">
              + 请求
            </button>
            <button className="sbtn" onClick={onImport} title="导入 Postman v2.x 集合 / 环境 JSON（自动识别）">
              导入
            </button>
            <button className="sbtn" onClick={onImportCurl} title="粘贴 cURL 命令导入">
              cURL
            </button>
            <button className="sbtn" onClick={onExport} title="导出为 Postman v2.1 JSON">
              导出
            </button>
          </div>
          <div className="side-tools">
            <button className="sbtn" onClick={onGit} title="Git 同步：提交快照 / 拉取 / 推送">
              Git 同步
            </button>
            <button className="sbtn" onClick={onPostman} title="Postman 云端同步：用 API Key 拉取账号下的集合与环境">
              Postman 同步
            </button>
          </div>
          <div className="sidebar-body">
            {collections.length === 0 && (
              <div className="sidebar-hint">
                还没有集合。
                <br />
                点「+ 集合」新建，或「导入」Postman Collection JSON / cURL 命令。
              </div>
            )}
            {collections.map((col) => {
              const expandedCol = expandedCols.has(col.id);
              return (
                <div key={col.id} className="collection-block">
                  <div
                    className="collection-head"
                    onClick={() => toggleCol(col.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, col });
                    }}
                    title="右键：编辑变量 / 删除集合"
                  >
                    <span className={`tree-caret ${expandedCol ? "open" : ""}`}>▸</span>
                    <span className="collection-name">{col.name}</span>
                    <button
                      className="col-del"
                      title="删除集合"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCollection(col.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  {expandedCol &&
                    (countRequests(col.root) === 0 ? (
                      <div className="col-empty">空集合</div>
                    ) : (
                      <TreeFolder
                        folder={col.root}
                        depth={1}
                        isRoot
                        expanded={expanded}
                        toggle={toggle}
                        activeKey={activeKey}
                        onOpenRequest={onOpenRequest}
                        onItemMenu={(e, item, c) => {
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, col: c, item });
                        }}
                        collection={col}
                      />
                    ))}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="sidebar-body">
          {history.length > 0 && (
            <div className="hist-tools">
              <button className="sbtn" onClick={onClearHistory} title="清空全部历史">
                清空历史
              </button>
            </div>
          )}
          {history.length === 0 && (
            <div className="sidebar-hint">
              还没有历史。
              <br />
              发送请求后会自动记录在这里，点击条目可重新打开编辑。
            </div>
          )}
          {history.map((h) => (
            <div
              key={h.id}
              className="hist-item"
              onClick={() => onOpenHistoryEntry(h)}
              title={`${h.time.replace("T", " ").slice(0, 19)}\n${h.url}`}
            >
              <span
                className="tree-method"
                style={{ color: METHOD_COLORS[h.method] ?? "#a0a0aa" }}
              >
                {h.method}
              </span>
              <span className="hist-url">{h.url}</span>
              <span className="hist-code" style={{ color: histCodeColor(h) }}>
                {h.ok ? h.statusCode : "失败"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="side-k">
        <kbd>Ctrl K</kbd> 搜索 · <kbd>Ctrl ⏎</kbd> 发送
      </div>

      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.item ? (
            <>
              <button
                className="ctx-item"
                onClick={() => {
                  onRenameItem(menu.col, menu.item!);
                  closeMenu();
                }}
              >
                重命名
              </button>
              <button
                className="ctx-item danger"
                onClick={() => {
                  onDeleteItem(menu.col, menu.item!);
                  closeMenu();
                }}
              >
                删除请求
              </button>
            </>
          ) : (
            <>
              <button
                className="ctx-item"
                onClick={() => {
                  onEditVars(menu.col);
                  closeMenu();
                }}
              >
                编辑变量
              </button>
              <button
                className="ctx-item danger"
                onClick={() => {
                  onDeleteCollection(menu.col.id);
                  closeMenu();
                }}
              >
                删除集合
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
