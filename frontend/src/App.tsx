import { useEffect, useRef, useState } from "react";
import { Window } from "@wailsio/runtime";
import Sidebar from "./components/Sidebar";
import RequestBuilder from "./components/RequestBuilder";
import ResponsePanel from "./components/ResponsePanel";
import EnvModal from "./components/EnvModal";
import Palette from "./components/Palette";
import CurlImportModal from "./components/CurlImportModal";
import CodeGenModal from "./components/CodeGenModal";
import GitModal from "./components/GitModal";
import PostmanSyncModal from "./components/PostmanSyncModal";
import SettingsModal from "./components/SettingsModal";
import KVEditor from "./components/KVEditor";
import {
  Col,
  EnvT,
  HistEntry,
  Item,
  KV,
  Resp,
  SettingsT,
  Spec,
  api,
  countRequests,
  emptySpec,
  findItemDeep,
  getJSONPath,
  removeItemDeep,
  updateItemDeep,
  upsertKV,
} from "./lib";

interface Tab {
  id: string;
  name: string;
  spec: Spec;
  response: Resp | null;
  sending: boolean;
  collectionId: string;
  itemId: string;
  /** 上次保存到集合时的 spec JSON 快照；与当前 spec 不一致即有未保存修改 */
  savedJson: string;
}

let tabSeq = 0;
function newTab(name = "未命名请求", spec: Spec = emptySpec()): Tab {
  tabSeq += 1;
  return {
    id: `t${tabSeq}-${Date.now()}`,
    name,
    spec,
    response: null,
    sending: false,
    collectionId: "",
    itemId: "",
    savedJson: JSON.stringify(emptySpec()),
  };
}

/** 标签是否有未保存到集合的修改 */
function isDirty(t: Tab): boolean {
  return JSON.stringify(t.spec) !== t.savedJson;
}

export default function App() {
  const [collections, setCollections] = useState<Col[]>([]);
  const [envs, setEnvs] = useState<EnvT[]>([]);
  const [activeEnvId, setActiveEnvId] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([newTab("新请求")]);
  const [activeTabId, setActiveTabId] = useState("");
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveTargetCol, setSaveTargetCol] = useState("");
  const [saveNewName, setSaveNewName] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sideView, setSideView] = useState<"cols" | "hist">("cols");
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [curlModalOpen, setCurlModalOpen] = useState(false);
  const [varsModalCol, setVarsModalCol] = useState<Col | null>(null);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [gitModalOpen, setGitModalOpen] = useState(false);
  const [postmanModalOpen, setPostmanModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsT>({
    recordHistory: true,
    showLineNumbers: true,
    theme: "dark",
    proxy: "",
    postmanApiKey: "",
  });
  const [toast, setToast] = useState("");
  // 关闭脏标签的三选确认；pendingCloseId = 保存弹窗成功后要顺带关闭的标签
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // 会话：启动恢复后才开始自动保存；activeEnvId 的 ref 供 reload 里的默认环境逻辑读取
  const sessionLoadedRef = useRef(false);
  const envIdRef = useRef("");

  // 请求/响应分隔条拖拽（响应优先布局）
  const [builderH, setBuilderH] = useState<number | null>(null);
  const draggingRef = useRef(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  useEffect(() => {
    if (!activeTabId && tabs.length > 0) setActiveTabId(tabs[0].id);
  }, [activeTabId, tabs]);

  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  };

  const reload = async () => {
    const [cols, envList, hist] = await Promise.all([
      api.listCollections(),
      api.listEnvs(),
      api.listHistory(),
    ]);
    setCollections(cols);
    setEnvs(envList);
    setHistory(hist);
    if (!envIdRef.current && envList.length > 0) setActiveEnvId(envList[0].id);
    // 设置体积小，顺手刷新（文件被外部改动也能回到界面）
    try {
      setSettings(await api.getSettings());
    } catch {
      /* 忽略，保留当前值 */
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 恢复上次会话：先于 reload 完成，环境选择才不会被默认值覆盖
  useEffect(() => {
    (async () => {
      try {
        const sess = await api.loadSession();
        if (sess.tabs.length > 0) {
          setTabs(
            sess.tabs.map((st) => ({
              id: st.id,
              name: st.name || "未命名请求",
              spec: st.spec,
              response: null,
              sending: false,
              collectionId: st.collectionId,
              itemId: st.itemId,
              savedJson: st.savedSpec || JSON.stringify(emptySpec()),
            })),
          );
          if (sess.activeTabId) setActiveTabId(sess.activeTabId);
          if (sess.activeEnvId) {
            envIdRef.current = sess.activeEnvId;
            setActiveEnvId(sess.activeEnvId);
          }
        }
      } catch {
        /* 会话损坏按新会话处理 */
      }
      sessionLoadedRef.current = true;
    })();
  }, []);

  // 会话自动保存：标签/激活状态变化后防抖落盘；窗口关闭前另有强制保存
  useEffect(() => {
    if (!sessionLoadedRef.current) return;
    const timer = setTimeout(() => {
      api
        .saveSession({
          tabs: tabs.map((t) => ({
            id: t.id,
            name: t.name,
            spec: t.spec,
            collectionId: t.collectionId,
            itemId: t.itemId,
            savedSpec: t.savedJson,
          })),
          activeTabId: activeTabId || tabs[0]?.id || "",
          activeEnvId,
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeTabId, activeEnvId]);

  useEffect(() => {
    envIdRef.current = activeEnvId;
  }, [activeEnvId]);

  // 主题随设置即时生效；同步写 localStorage 供下次启动提前应用（避免闪色）
  useEffect(() => {
    const t = settings.theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    localStorage.setItem("postlite-theme", t);
  }, [settings.theme]);

  const updateActive = (patch: Partial<Tab>) => {
    if (!activeTab) return;
    setTabs((ts) => ts.map((t) => (t.id === activeTab.id ? { ...t, ...patch } : t)));
  };

  const updateSpec = (patch: Partial<Spec>) => {
    if (!activeTab) return;
    updateActive({ spec: { ...activeTab.spec, ...patch } });
  };

  const mergeVars = (tab: Tab): KV[] => {
    const vars: KV[] = [];
    if (tab.collectionId) {
      const col = collections.find((c) => c.id === tab.collectionId);
      if (col) vars.push(...col.variables);
    }
    const env = envs.find((e) => e.id === activeEnvId);
    if (env) vars.push(...env.variables); // 环境变量优先于集合变量
    return vars;
  };

  /** 方案 A：发送成功后按 spec.captures 自动提取响应值写入变量 */
  const applyCaptures = async (tab: Tab, res: Resp) => {
    const caps = (tab.spec.captures ?? []).filter((c) => c.varName && c.path);
    if (!caps.length || !res.ok || !res.body) return;
    let obj: any;
    try {
      obj = JSON.parse(res.body);
    } catch {
      showToast("提取规则未生效：响应体不是 JSON");
      return;
    }
    const names: string[] = [];
    let newEnv: EnvT | null = null;
    let newCol: Col | null = null;
    let colSkipped = false;
    const env = envs.find((e) => e.id === activeEnvId);
    const col = collections.find((c) => c.id === tab.collectionId);
    for (const cap of caps) {
      const v = getJSONPath(obj, cap.path);
      if (v === null) continue;
      if (cap.target === "collection") {
        if (!col) {
          colSkipped = true;
          continue;
        }
        if (!newCol) newCol = JSON.parse(JSON.stringify(col)) as Col;
        upsertKV(newCol.variables, cap.varName, v);
      } else {
        if (!env) continue;
        if (!newEnv) newEnv = JSON.parse(JSON.stringify(env)) as EnvT;
        upsertKV(newEnv.variables, cap.varName, v);
      }
      names.push(cap.varName);
    }
    try {
      if (newEnv) await api.saveEnv(newEnv);
      if (newCol) await api.saveCollection(newCol);
      if (names.length) {
        await reload();
        showToast(`已捕获 ${names.length} 个变量：${names.join("、")}`);
      } else if (colSkipped) {
        showToast("集合变量提取需先把本请求保存到集合");
      }
    } catch (e) {
      showToast(`捕获写回失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  const send = async () => {
    if (!activeTab || activeTab.sending) return;
    const tab = activeTab;
    const vars = mergeVars(tab);
    updateActive({ sending: true });
    try {
      const res = await api.send(tab.spec, vars);
      updateActive({ sending: false, response: res });
      // 发送后留痕（无论成败；可在设置里关闭）；失败不阻塞界面
      if (settings.recordHistory) {
        api
          .addHistory(tab.spec, res)
          .then((h) => setHistory((prev) => [h, ...prev].slice(0, 200)))
          .catch(() => {});
      }
      // 自动捕获变量
      applyCaptures(tab, res);
    } catch (e) {
      const errRes: Resp = {
        ok: false,
        status: "",
        statusCode: 0,
        durationMs: 0,
        sizeBytes: 0,
        proto: "",
        headers: [],
        body: "",
        error: String(e),
        timingDnsMs: 0,
        timingConnectMs: 0,
        timingTlsMs: 0,
        timingTtfbMs: 0,
        timingTransferMs: 0,
        respHeaderBytes: 0,
        respBodyBytes: 0,
        reqHeaderBytes: 0,
        reqBodyBytes: 0,
      };
      updateActive({ sending: false, response: errRes });
      if (settings.recordHistory) {
        api
          .addHistory(tab.spec, errRes)
          .then((h) => setHistory((prev) => [h, ...prev].slice(0, 200)))
          .catch(() => {});
      }
    }
  };

  const openRequest = (item: Item, col: Col) => {
    const key = `${col.id}:${item.id}`;
    const existing = tabs.find((t) => t.id === key);
    if (existing) {
      setActiveTabId(key);
      return;
    }
    const tab: Tab = {
      id: key,
      name: item.name,
      spec: JSON.parse(JSON.stringify(item.spec)),
      response: null,
      sending: false,
      collectionId: col.id,
      itemId: item.id,
      savedJson: JSON.stringify(item.spec),
    };
    setTabs((ts) => [...ts, tab]);
    setActiveTabId(key);
  };

  const openSaveModal = () => {
    if (!activeTab) return;
    setPendingCloseId(null); // 常规打开保存弹窗时清掉遗留的待关闭标签
    setSaveName(activeTab.name);
    setSaveTargetCol(activeTab.collectionId || collections[0]?.id || "__new__");
    setSaveNewName("");
    setSaveModalOpen(true);
  };

  /** 关闭保存弹窗：连带清掉「保存并关闭」的待关闭标记 */
  const closeSaveModal = () => {
    setSaveModalOpen(false);
    setPendingCloseId(null);
  };

  const doSave = async () => {
    if (!activeTab) return;
    let col: Col | undefined;
    if (saveTargetCol === "__new__") {
      const name = saveNewName.trim();
      if (!name) {
        showToast("请输入新集合名称");
        return;
      }
      col = await api.newCollection(name);
    } else {
      col = collections.find((c) => c.id === saveTargetCol);
    }
    if (!col) return;
    const cloned: Col = JSON.parse(JSON.stringify(col));
    let itemId = activeTab.itemId;
    const newItem: Item = {
      id: itemId || `req-${Date.now()}`,
      name: saveName.trim() || "未命名请求",
      spec: activeTab.spec,
    };
    if (itemId && findItemDeep(cloned.root, itemId)) {
      updateItemDeep(cloned.root, itemId, (it) => ({ ...it, name: newItem.name, spec: newItem.spec }));
    } else {
      cloned.root.items.push(newItem);
      itemId = newItem.id;
    }
    await api.saveCollection(cloned);
    await reload();
    setSaveModalOpen(false);
    updateActive({
      collectionId: cloned.id,
      itemId,
      name: newItem.name,
      savedJson: JSON.stringify(activeTab.spec),
    });
    showToast(`已保存到「${cloned.name}」`);
    // 「保存并关闭」流程：保存成功后自动关掉等待中的标签
    if (pendingCloseId) {
      const target = pendingCloseId;
      setPendingCloseId(null);
      closeTab(target);
    }
  };

  const newCollection = async () => {
    const name = window.prompt("新集合名称：", "我的集合");
    if (!name || !name.trim()) return;
    await api.newCollection(name.trim());
    await reload();
    showToast(`已创建集合「${name.trim()}」`);
  };

  const handleImport = async (text: string) => {
    try {
      // 自动识别：Postman 环境文件（顶层 values + 无 info）走环境导入，其余走集合导入
      const probe = JSON.parse(text);
      const isEnv =
        probe?._postman_variable_scope === "environment" ||
        (Array.isArray(probe?.values) && !probe?.info);
      if (isEnv) {
        const env = await api.importPostmanEnv(text);
        await reload();
        showToast(`已导入环境「${env.name}」`);
        return;
      }
      const col = await api.importPostman(text);
      await reload();
      showToast(`已导入集合「${col.name}」`);
    } catch (e) {
      showToast(`导入失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (text) handleImport(text);
    };
    reader.readAsText(f, "utf-8");
  };

  const handleExport = async () => {
    try {
      const path = await api.exportPostman();
      showToast(path ? `已导出到 ${path}` : "已取消导出");
    } catch (e) {
      showToast(`导出失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  const deleteCollection = async (id: string) => {
    const col = collections.find((c) => c.id === id);
    if (!col) return;
    const n = countRequests(col.root);
    const tip = n > 0 ? `及其下面的 ${n} 个请求` : "（空集合）";
    if (!window.confirm(`确认删除集合「${col.name}」${tip}？删除后不可恢复。`)) return;
    await api.deleteCollection(id);
    // 关掉属于该集合的标签页，避免留下无法保存的孤儿标签
    const orphanIds = new Set(tabs.filter((t) => t.collectionId === id).map((t) => t.id));
    if (orphanIds.size > 0) {
      setTabs((ts) => {
        const next = ts.filter((t) => !orphanIds.has(t.id));
        if (next.length === 0) {
          const fresh = newTab("新请求");
          setActiveTabId(fresh.id);
          return [fresh];
        }
        if (activeTabId && orphanIds.has(activeTabId)) {
          setActiveTabId(next[0].id);
        }
        return next;
      });
    }
    await reload();
    showToast(orphanIds.size > 0 ? `集合已删除，同时关闭了 ${orphanIds.size} 个相关标签` : "集合已删除");
  };

  const openHistoryEntry = (h: HistEntry) => {
    const t = newTab(h.url || `${h.method} 请求`, JSON.parse(JSON.stringify(h.spec)));
    setTabs((ts) => [...ts, t]);
    setActiveTabId(t.id);
  };

  const clearHistory = async () => {
    if (history.length === 0) return;
    if (!window.confirm(`确认清空全部 ${history.length} 条历史？`)) return;
    await api.clearHistory();
    setHistory([]);
    showToast("历史已清空");
  };

  const renameItem = async (col: Col, item: Item) => {
    const name = window.prompt("新的请求名称：", item.name);
    if (!name || !name.trim() || name.trim() === item.name) return;
    const cloned: Col = JSON.parse(JSON.stringify(col));
    updateItemDeep(cloned.root, item.id, (it) => ({ ...it, name: name.trim() }));
    await api.saveCollection(cloned);
    await reload();
    setTabs((ts) =>
      ts.map((t) =>
        t.collectionId === col.id && t.itemId === item.id ? { ...t, name: name.trim() } : t,
      ),
    );
    showToast("已重命名");
  };

  const deleteItem = async (col: Col, item: Item) => {
    if (!window.confirm(`确认删除请求「${item.name}」？`)) return;
    const cloned: Col = JSON.parse(JSON.stringify(col));
    removeItemDeep(cloned.root, item.id);
    await api.saveCollection(cloned);
    await reload();
    setTabs((ts) => {
      const next = ts.filter((t) => !(t.collectionId === col.id && t.itemId === item.id));
      if (next.length === 0) {
        const fresh = newTab("新请求");
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (activeTab && activeTab.collectionId === col.id && activeTab.itemId === item.id) {
        setActiveTabId(next[0].id);
      }
      return next;
    });
    showToast("请求已删除");
  };

  const saveColVars = async () => {
    if (!varsModalCol) return;
    await api.saveCollection(varsModalCol);
    await reload();
    setVarsModalCol(null);
    showToast(`集合「${varsModalCol.name}」变量已保存`);
  };

  // 设置更改：立即生效（本地 + 落盘），失败时提示
  const changeSettings = async (next: SettingsT) => {
    setSettings(next);
    try {
      await api.saveSettings(next);
    } catch (e) {
      showToast(`保存设置失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  };

  const closeTab = (id: string) => {
    setTabs((ts) => {
      const idx = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = newTab("新请求");
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (id === activeTabId) {
        setActiveTabId(next[Math.min(idx, next.length - 1)].id);
      }
      return next;
    });
  };

  /** 关标签入口：有未保存修改时先确认 */
  const requestCloseTab = (id: string) => {
    const t = tabs.find((x) => x.id === id);
    if (t && isDirty(t)) setConfirmCloseId(id);
    else closeTab(id);
  };

  /** 确认弹窗里的「保存并关闭」：已入库的直接写回；未入库的走保存弹窗 */
  const saveAndClose = async (t: Tab) => {
    setConfirmCloseId(null);
    if (t.collectionId && t.itemId) {
      const col = collections.find((c) => c.id === t.collectionId);
      if (col) {
        const cloned: Col = JSON.parse(JSON.stringify(col));
        updateItemDeep(cloned.root, t.itemId, (it) => ({ ...it, name: t.name, spec: t.spec }));
        await api.saveCollection(cloned);
        await reload();
      }
      showToast("已保存并关闭标签");
      closeTab(t.id);
    } else {
      setPendingCloseId(t.id);
      setActiveTabId(t.id); // 保存弹窗针对该标签操作
      setSaveName(t.name);
      setSaveTargetCol(collections[0]?.id || "__new__");
      setSaveNewName("");
      setSaveModalOpen(true);
    }
  };

  const addTab = () => {
    const t = newTab("新请求");
    setTabs((ts) => [...ts, t]);
    setActiveTabId(t.id);
  };

  // 双击标签重命名；已保存的请求同步更新集合里的名称
  const renameTab = (t: Tab) => {
    const name = window.prompt("修改标签名称：", t.name);
    if (!name || !name.trim() || name.trim() === t.name) return;
    const nn = name.trim();
    setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, name: nn } : x)));
    if (t.collectionId && t.itemId) {
      const col = collections.find((c) => c.id === t.collectionId);
      if (col) {
        const cloned: Col = JSON.parse(JSON.stringify(col));
        updateItemDeep(cloned.root, t.itemId, (it) => ({ ...it, name: nn }));
        api
          .saveCollection(cloned)
          .then(reload)
          .catch(() => {});
      }
    }
  };

  // 分隔条拖拽
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !mainRef.current) return;
      const rect = mainRef.current.getBoundingClientRect();
      const stripH = 35; // tabstrip 高度 + 底边框
      const h = Math.min(Math.max(e.clientY - rect.top - stripH, 96), rect.height - 160);
      setBuilderH(h);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // 全局快捷键：Ctrl+Enter 发送 / Ctrl+K 面板 / Ctrl+T 新标签 / Ctrl+S 保存 / Ctrl+W 关标签
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "Enter") {
        e.preventDefault();
        send();
      } else if (ctrl && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (ctrl && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        addTab();
      } else if (ctrl && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        openSaveModal();
      } else if (ctrl && (e.key === "w" || e.key === "W")) {
        e.preventDefault();
        if (activeTab) requestCloseTab(activeTab.id);
      } else if (e.key === "F12") {
        e.preventDefault();
        api.openDevTools();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, collections, envs, activeEnvId, saveTargetCol]);

  // 自定义标题栏：双击顶栏空白处切换最大化（点在控件上时不触发）
  const onTopbarDoubleClick = (e: { target: EventTarget | null }) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest("button, select, input")) return;
    Window.ToggleMaximise();
  };

  const activeVars = activeTab ? mergeVars(activeTab) : [];

  return (
    <div className="app">
      <header className="topbar" onDoubleClick={onTopbarDoubleClick}>
        <div className="brand">
          <span className="logo-dot" />
          <span className="logo-text">Postlite</span>
        </div>

        <div className="spacer" />

        <div className="topbar-right">
          <select
            className="env-select compact"
            value={activeEnvId}
            onChange={(e) => setActiveEnvId(e.target.value)}
            title="当前环境"
          >
            <option value="">无环境</option>
            {envs.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <button
            className="mini-btn"
            onClick={() => setEnvModalOpen(true)}
            title="环境管理 / 新建环境"
          >
            + 环境
          </button>
          <button className="mini-btn" onClick={openSaveModal} title="保存当前请求到集合 (Ctrl+S)">
            保存
          </button>
          <button className="mini-btn" onClick={() => setPaletteOpen(true)} title="命令面板 (Ctrl+K)">
            搜索
          </button>
          <button className="mini-btn" onClick={() => setSettingsOpen(true)} title="设置">
            ⚙ 设置
          </button>

          <div className="win-controls">
            <button className="win-btn" onClick={() => Window.Minimise()} title="最小化">
              &#x2500;
            </button>
            <button className="win-btn" onClick={() => Window.ToggleMaximise()} title="最大化 / 还原">
              &#x25A1;
            </button>
            <button
              className="win-btn close"
              onClick={async () => {
                // 关窗前强制保存一次会话，别等防抖
                try {
                  await api.saveSession({
                    tabs: tabs.map((t) => ({
                      id: t.id,
                      name: t.name,
                      spec: t.spec,
                      collectionId: t.collectionId,
                      itemId: t.itemId,
                      savedSpec: t.savedJson,
                    })),
                    activeTabId: activeTabId || tabs[0]?.id || "",
                    activeEnvId,
                  });
                } catch {
                  /* 保存失败也照常关闭 */
                }
                Window.Close();
              }}
              title="关闭"
            >
              &#x2715;
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          collections={collections}
          history={history}
          activeKey={activeTab ? `${activeTab.collectionId}:${activeTab.itemId}` : ""}
          view={sideView}
          onViewChange={setSideView}
          onOpenRequest={openRequest}
          onOpenHistoryEntry={openHistoryEntry}
          onClearHistory={clearHistory}
          onRenameItem={renameItem}
          onDeleteItem={deleteItem}
          onEditVars={setVarsModalCol}
          onDeleteCollection={deleteCollection}
          onNewCollection={newCollection}
          onNewRequest={addTab}
          onImport={() => fileRef.current?.click()}
          onImportCurl={() => setCurlModalOpen(true)}
          onExport={handleExport}
          onGit={() => setGitModalOpen(true)}
          onPostman={() => setPostmanModalOpen(true)}
        />

        <main className="main" ref={mainRef}>
          <div className="tabstrip">
            <div className="tabs">
              {tabs.map((t) => (
                <div
                  key={t.id}
                  className={`req-tab ${t.id === activeTabId ? "active" : ""} ${isDirty(t) ? "dirty" : ""}`}
                  onClick={() => setActiveTabId(t.id)}
                  onDoubleClick={() => renameTab(t)}
                  title={`${t.name}${isDirty(t) ? "（有未保存的修改）" : ""}\n双击重命名`}
                >
                  <span className="req-tab-name">{t.name}</span>
                  {isDirty(t) && <span className="tab-dot" title="有未保存的修改" />}
                  {tabs.length > 1 && (
                    <span
                      className="req-tab-close"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestCloseTab(t.id);
                      }}
                    >
                      ×
                    </span>
                  )}
                </div>
              ))}
            </div>
            <button className="t-add" onClick={addTab} title="新建标签 (Ctrl+T)">
              +
            </button>
          </div>

          {activeTab && (
            <>
              <div
                className="reqblock"
                style={builderH !== null ? { height: builderH } : undefined}
              >
                <RequestBuilder
                  spec={activeTab.spec}
                  vars={activeVars}
                  sending={activeTab.sending}
                  onChange={updateSpec}
                  onSend={send}
                  onOpenCode={() => setCodeModalOpen(true)}
                  onToast={showToast}
                />
              </div>
              <div
                className="divider"
                title="拖拽调整请求 / 响应比例"
                onMouseDown={(e) => {
                  draggingRef.current = true;
                  e.preventDefault();
                }}
              />
              <ResponsePanel
                response={activeTab.response}
                sending={activeTab.sending}
                spec={activeTab.spec}
                vars={activeVars}
                showLineNumbers={settings.showLineNumbers}
              />
            </>
          )}
        </main>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          handleFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />

      {envModalOpen && (
        <EnvModal
          envs={envs}
          initialSelectedId={activeEnvId}
          onClose={() => setEnvModalOpen(false)}
          onChanged={() => {
            reload();
          }}
        />
      )}

      {paletteOpen && (
        <Palette
          collections={collections}
          envs={envs}
          activeEnvId={activeEnvId}
          onOpenRequest={openRequest}
          onSwitchEnv={setActiveEnvId}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {curlModalOpen && (
        <CurlImportModal
          onClose={() => setCurlModalOpen(false)}
          onParsed={(spec) => {
            setCurlModalOpen(false);
            const t = newTab("cURL 导入", spec);
            setTabs((ts) => [...ts, t]);
            setActiveTabId(t.id);
            showToast("已从 cURL 创建请求，可编辑后发送");
          }}
          onError={(msg) => showToast(msg)}
        />
      )}

      {codeModalOpen && activeTab && (
        <CodeGenModal
          spec={activeTab.spec}
          vars={activeVars}
          onClose={() => setCodeModalOpen(false)}
          onToast={showToast}
        />
      )}

      {gitModalOpen && (
        <GitModal
          onClose={() => setGitModalOpen(false)}
          onToast={showToast}
          onPulled={() => {
            reload();
          }}
        />
      )}

      {postmanModalOpen && (
        <PostmanSyncModal onClose={() => setPostmanModalOpen(false)} onToast={showToast} onSynced={reload} />
      )}

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChange={changeSettings}
          onClose={() => setSettingsOpen(false)}
          onRefresh={reload}
          onToast={showToast}
        />
      )}

      {varsModalCol && (
        <div className="modal-mask" onClick={() => setVarsModalCol(null)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>集合变量 · {varsModalCol.name}</span>
              <button className="mini-btn" onClick={() => setVarsModalCol(null)}>
                关闭
              </button>
            </div>
            <div className="modal-body">
              <KVEditor
                rows={varsModalCol.variables}
                onChange={(rows) => setVarsModalCol({ ...varsModalCol, variables: rows })}
                keyPlaceholder="变量名（如 base_url）"
                valuePlaceholder="变量值"
              />
              <div className="env-hint" style={{ marginTop: 8 }}>
                在 URL / Header / Body 中用 {"{{变量名}}"} 引用；环境变量优先于集合变量。
              </div>
              <div className="modal-actions">
                <button className="send-btn" onClick={saveColVars}>
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {saveModalOpen && (
        <div className="modal-mask" onClick={closeSaveModal}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>保存请求</span>
              <button className="mini-btn" onClick={closeSaveModal}>
                关闭
              </button>
            </div>
            <div className="modal-body">
              <label className="field-label">保存到集合</label>
              <select
                className="env-select wide"
                value={saveTargetCol}
                onChange={(e) => setSaveTargetCol(e.target.value)}
              >
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__new__">＋ 新建集合…</option>
              </select>
              {saveTargetCol === "__new__" && (
                <input
                  className="env-select wide"
                  value={saveNewName}
                  placeholder="新集合名称"
                  autoFocus
                  onChange={(e) => setSaveNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doSave();
                  }}
                />
              )}
              <label className="field-label">请求名称</label>
              <input
                className="env-select wide"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doSave();
                }}
              />
              <div className="modal-actions">
                <button className="send-btn" onClick={doSave} disabled={!saveTargetCol}>
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmCloseId &&
        (() => {
          const t = tabs.find((x) => x.id === confirmCloseId);
          if (!t) return null;
          return (
            <div className="modal-mask" onClick={() => setConfirmCloseId(null)}>
              <div className="modal small" onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                  <span>未保存的修改</span>
                  <button className="mini-btn" onClick={() => setConfirmCloseId(null)}>
                    关闭
                  </button>
                </div>
                <div className="modal-body">
                  <div className="env-hint">
                    「{t.name}」有未保存到集合的修改，关闭后这些修改会丢失（下次启动仍会恢复该标签本身）。
                  </div>
                  <div
                    className="modal-actions"
                    style={{ justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}
                  >
                    <button
                      className="send-btn"
                      onClick={() => {
                        saveAndClose(t);
                      }}
                    >
                      保存并关闭
                    </button>
                    <button
                      className="mini-btn"
                      onClick={() => {
                        setConfirmCloseId(null);
                        closeTab(t.id);
                      }}
                    >
                      直接关闭
                    </button>
                    <button className="mini-btn" onClick={() => setConfirmCloseId(null)}>
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
