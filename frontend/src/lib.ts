// 前端自己的非空类型 + Wails 绑定包装层。
// Go 的 slice 可能为 nil，生成器会给出 `T[] | null`，所以在边界处统一 normalize。

import {
  CollectionService,
  EnvironmentService,
  GitService,
  HistoryService,
  PostmanService,
  RequestService,
  SessionService,
  SettingsService,
} from "../bindings/postlite";

export interface KV {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Capture {
  target: string; // env | collection
  varName: string;
  path: string; // 响应 JSON 路径，如 data.access_token
}

export interface Spec {
  method: string;
  url: string;
  headers: KV[];
  queryParams: KV[];
  bodyType: string; // none | raw | form | urlencoded
  rawBody: string;
  formFields: KV[];
  followRedirects: boolean;
  timeoutSeconds: number;
  captures: Capture[];
}

export interface Item {
  id: string;
  name: string;
  spec: Spec;
}

export interface Fdr {
  id: string;
  name: string;
  items: Item[];
  folders: Fdr[];
}

export interface Col {
  id: string;
  name: string;
  root: Fdr;
  variables: KV[];
}

export interface EnvT {
  id: string;
  name: string;
  variables: KV[];
}

export interface HistEntry {
  id: string;
  time: string; // RFC3339
  method: string;
  url: string; // 原始 URL（含 {{var}}）
  statusCode: number;
  ok: boolean;
  durationMs: number;
  spec: Spec;
  vars: KV[];
}

export interface GitStatusT {
  gitFound: boolean;
  isRepo: boolean;
  branch: string;
  /** HEAD 是否游离（detached） */
  detached: boolean;
  changes: number;
  remote: string;
  lastCommit: string;
  /** 最近一次提交是否已推送到远端（true 时不能撤销提交） */
  lastCommitPushed: boolean;
}

export interface SettingsT {
  recordHistory: boolean;
  showLineNumbers: boolean;
  theme: "dark" | "light";
  /** HTTP 代理地址；空 = 不走代理 */
  proxy: string;
  /** Postman 云端同步 API Key；settings.json 在 .gitignore 里不会同步出去 */
  postmanApiKey: string;
}

/** Postman 云端清单条目 */
export interface PostmanRemoteItemT {
  uid: string;
  name: string;
}

export interface PostmanRemoteListT {
  collections: PostmanRemoteItemT[];
  environments: PostmanRemoteItemT[];
}

export interface PostmanSyncResultT {
  updated: string[];
  created: string[];
  failed: string[];
}

/** 检查更新结果 */
export interface UpdateInfoT {
  current: string;
  latest: string;
  hasUpdate: boolean;
  url: string;
  notes: string;
  published: string;
}

export interface AppInfoT {
  version: string;
  dataDir: string;
  defaultDataDir: string;
  dataDirIsCustom: boolean;
}

export interface DiffHunkT {
  oldStart: number;
  oldLines: string[];
  newStart: number;
  newLines: string[];
}

export interface DiffFileT {
  path: string;
  isNew: boolean;
  hunkCount: number;
  hunks: DiffHunkT[];
}

export interface SessionTabT {
  id: string;
  name: string;
  spec: Spec;
  collectionId: string;
  itemId: string;
  /** 上次保存到集合时的 spec JSON 快照；未保存过为 emptySpec 的 JSON */
  savedSpec: string;
}

export interface SessionDataT {
  tabs: SessionTabT[];
  activeTabId: string;
  activeEnvId: string;
}

export interface Resp {
  ok: boolean;
  status: string;
  statusCode: number;
  durationMs: number;
  sizeBytes: number;
  proto: string;
  headers: KV[];
  body: string;
  error: string;
  timingDnsMs: number;
  timingConnectMs: number;
  timingTlsMs: number;
  timingTtfbMs: number;
  timingTransferMs: number;
  respHeaderBytes: number;
  respBodyBytes: number;
  reqHeaderBytes: number;
  reqBodyBytes: number;
}

// ---------- normalize ----------

const normKVRows = (rows: unknown): KV[] =>
  Array.isArray(rows)
    ? rows.map((r: any) => ({
        key: r?.key ?? "",
        value: r?.value ?? "",
        enabled: r?.enabled ?? true,
      }))
    : [];

export const normSpec = (s: any): Spec => ({
  method: s?.method ?? "GET",
  url: s?.url ?? "",
  headers: normKVRows(s?.headers),
  queryParams: normKVRows(s?.queryParams),
  bodyType: s?.bodyType ?? "none",
  rawBody: s?.rawBody ?? "",
  formFields: normKVRows(s?.formFields),
  followRedirects: s?.followRedirects ?? true,
  timeoutSeconds: s?.timeoutSeconds ?? 60,
  captures: Array.isArray(s?.captures)
    ? s.captures.map((c: any) => ({
        target: c?.target === "collection" ? "collection" : "env",
        varName: c?.varName ?? "",
        path: c?.path ?? "",
      }))
    : [],
});

const normItem = (it: any): Item => ({
  id: it?.id ?? "",
  name: it?.name ?? "",
  spec: normSpec(it?.spec),
});

export const normFolder = (f: any): Fdr => ({
  id: f?.id ?? "",
  name: f?.name ?? "",
  items: Array.isArray(f?.items) ? f.items.map(normItem) : [],
  folders: Array.isArray(f?.folders) ? f.folders.map(normFolder) : [],
});

const normCollection = (c: any): Col => ({
  id: c?.id ?? "",
  name: c?.name ?? "",
  root: normFolder(c?.root),
  variables: normKVRows(c?.variables),
});

const normEnv = (e: any): EnvT => ({
  id: e?.id ?? "",
  name: e?.name ?? "",
  variables: normKVRows(e?.variables),
});

const normHist = (e: any): HistEntry => ({
  id: e?.id ?? "",
  time: e?.time ?? "",
  method: e?.method ?? "GET",
  url: e?.url ?? "",
  statusCode: e?.statusCode ?? 0,
  ok: !!e?.ok,
  durationMs: e?.durationMs ?? 0,
  spec: normSpec(e?.spec),
  vars: normKVRows(e?.vars),
});

const normResp = (r: any): Resp => ({
  ok: !!r?.ok,
  status: r?.status ?? "",
  statusCode: r?.statusCode ?? 0,
  durationMs: r?.durationMs ?? 0,
  sizeBytes: r?.sizeBytes ?? 0,
  proto: r?.proto ?? "",
  headers: normKVRows(r?.headers),
  body: r?.body ?? "",
  error: r?.error ?? "",
  timingDnsMs: r?.timingDnsMs ?? 0,
  timingConnectMs: r?.timingConnectMs ?? 0,
  timingTlsMs: r?.timingTlsMs ?? 0,
  timingTtfbMs: r?.timingTtfbMs ?? 0,
  timingTransferMs: r?.timingTransferMs ?? 0,
  respHeaderBytes: r?.respHeaderBytes ?? 0,
  respBodyBytes: r?.respBodyBytes ?? 0,
  reqHeaderBytes: r?.reqHeaderBytes ?? 0,
  reqBodyBytes: r?.reqBodyBytes ?? 0,
});

// ---------- API 包装 ----------

export const api = {
  listCollections: async (): Promise<Col[]> =>
    ((await CollectionService.List()) ?? []).map(normCollection),
  saveCollection: (col: Col) => CollectionService.Save(col as any),
  deleteCollection: (id: string) => CollectionService.Delete(id),
  newCollection: async (name: string): Promise<Col> =>
    normCollection(await CollectionService.NewCollection(name)),
  importPostman: async (text: string): Promise<Col> =>
    normCollection(await CollectionService.ImportPostman(text)),
  importPostmanEnv: async (text: string): Promise<EnvT> =>
    normEnv(await EnvironmentService.ImportPostmanEnvironment(text)),

  listEnvs: async (): Promise<EnvT[]> =>
    ((await EnvironmentService.List()) ?? []).map(normEnv),
  saveEnv: (env: EnvT) => EnvironmentService.Save(env as any),
  deleteEnv: (id: string) => EnvironmentService.Delete(id),
  newEnv: async (name: string): Promise<EnvT> =>
    normEnv(await EnvironmentService.NewEnvironment(name)),

  listHistory: async (): Promise<HistEntry[]> =>
    ((await HistoryService.List()) ?? []).map(normHist),
  addHistory: async (spec: Spec, resp: Resp): Promise<HistEntry> =>
    normHist(await HistoryService.Add(spec as any, resp as any)),
  clearHistory: () => HistoryService.Clear(),

  parseCurl: async (cmd: string): Promise<Spec> =>
    normSpec(await RequestService.ParseCurl(cmd)),

  gitStatus: async (): Promise<GitStatusT> => {
    const s: any = await GitService.Status();
    return {
      gitFound: !!s?.gitFound,
      isRepo: !!s?.isRepo,
      branch: s?.branch ?? "",
      detached: !!s?.detached,
      changes: s?.changes ?? 0,
      remote: s?.remote ?? "",
      lastCommit: s?.lastCommit ?? "",
      lastCommitPushed: !!s?.lastCommitPushed,
    };
  },
  gitInit: () => GitService.Init(),
  gitCommit: (msg: string): Promise<string> => GitService.Commit(msg) as Promise<string>,
  gitPush: (): Promise<string> => GitService.Push() as Promise<string>,
  gitPull: (): Promise<string> => GitService.Pull() as Promise<string>,
  gitUndoCommit: (): Promise<string> => GitService.UndoCommit() as Promise<string>,
  gitSetRemote: (url: string) => GitService.SetRemote(url),
  gitDiffDetail: async (): Promise<DiffFileT[]> => {
    const r: any = (await GitService.DiffDetail()) ?? [];
    return (Array.isArray(r) ? r : []).map((f: any) => ({
      path: f?.path ?? "",
      isNew: !!f?.isNew,
      hunkCount: f?.hunkCount ?? 0,
      hunks: (Array.isArray(f?.hunks) ? f.hunks : []).map((h: any) => ({
        oldStart: h?.oldStart ?? 0,
        oldLines: Array.isArray(h?.oldLines) ? h.oldLines : [],
        newStart: h?.newStart ?? 0,
        newLines: Array.isArray(h?.newLines) ? h.newLines : [],
      })),
    }));
  },
  gitOpenDiffWindow: () => GitService.OpenDiffWindow(),

  loadSession: async (): Promise<SessionDataT> => {
    const s: any = await SessionService.Load();
    return {
      tabs: (s?.tabs ?? []).map((t: any) => ({
        id: t?.id ?? "",
        name: t?.name ?? "",
        spec: normSpec(t?.spec),
        collectionId: t?.collectionId ?? "",
        itemId: t?.itemId ?? "",
        savedSpec: t?.savedSpec ?? "",
      })),
      activeTabId: s?.activeTabId ?? "",
      activeEnvId: s?.activeEnvId ?? "",
    };
  },
  saveSession: (d: SessionDataT) => SessionService.Save(d as any),

  send: async (spec: Spec, vars: KV[]): Promise<Resp> =>
    normResp(await RequestService.Send(spec as any, vars as any)),

  getSettings: async (): Promise<SettingsT> => {
    const s: any = await SettingsService.Get();
    return {
      recordHistory: s?.recordHistory ?? true,
      showLineNumbers: s?.showLineNumbers ?? true,
      theme: s?.theme === "light" ? "light" : "dark",
      proxy: s?.proxy ?? "",
      postmanApiKey: s?.postmanApiKey ?? "",
    };
  },
  saveSettings: (st: SettingsT) => SettingsService.Save(st as any),
  checkUpdate: async (): Promise<UpdateInfoT> =>
    ((await SettingsService.CheckUpdate()) as any) ?? {
      current: "",
      latest: "",
      hasUpdate: false,
      url: "",
      notes: "",
      published: "",
    },
  openReleasesPage: () => SettingsService.OpenReleasesPage(),
  postmanListRemote: async (): Promise<PostmanRemoteListT> => {
    const r: any = await PostmanService.ListRemote();
    return {
      collections: r?.collections ?? [],
      environments: r?.environments ?? [],
    };
  },
  postmanSyncAll: async (): Promise<PostmanSyncResultT> => {
    const r: any = await PostmanService.SyncAll();
    return {
      updated: r?.updated ?? [],
      created: r?.created ?? [],
      failed: r?.failed ?? [],
    };
  },
  openDevTools: () => SettingsService.OpenDevTools(),
  openDataDir: () => SettingsService.OpenDataDir(),
  appInfo: async (): Promise<AppInfoT> => {
    const a: any = await SettingsService.AppInfo();
    return {
      version: a?.version ?? "",
      dataDir: a?.dataDir ?? "",
      defaultDataDir: a?.defaultDataDir ?? "",
      dataDirIsCustom: !!a?.dataDirIsCustom,
    };
  },
  setDataDir: (path: string): Promise<AppInfoT> =>
    SettingsService.SetDataDir(path) as Promise<AppInfoT>,
  chooseDataDir: (): Promise<string> => SettingsService.ChooseDataDir() as Promise<string>,

  exportPostman: (): Promise<string> => CollectionService.ExportPostman() as Promise<string>,
};

// ---------- 常量与工具 ----------

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export const METHOD_COLORS: Record<string, string> = {
  GET: "#7fd13b",
  POST: "#f5b83d",
  PUT: "#4d9dff",
  PATCH: "#43cfc0",
  DELETE: "#f0647c",
  HEAD: "#a0a0aa",
  OPTIONS: "#a0a0aa",
};

export function emptySpec(): Spec {
  return {
    method: "GET",
    url: "",
    headers: [],
    queryParams: [],
    bodyType: "none",
    rawBody: "",
    formFields: [],
    followRedirects: true,
    timeoutSeconds: 60,
    captures: [],
  };
}

/** 在（已克隆的）KV 数组里写入或更新变量 */
export function upsertKV(rows: KV[], key: string, value: string): void {
  const r = rows.find((x) => x.key === key);
  if (r) r.value = value;
  else rows.push({ key, value, enabled: true });
}

/** 极简 JSON 路径取值：a.b.c，数组索引用 a.0.b；取不到返回 null */
export function getJSONPath(obj: any, path: string): string | null {
  const parts = String(path).split(".").filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return null;
    if (Array.isArray(cur)) {
      const idx = Number(p);
      if (Number.isNaN(idx)) return null;
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = cur[p];
    } else {
      return null;
    }
  }
  if (cur === null || cur === undefined) return null;
  if (typeof cur === "object") return JSON.stringify(cur);
  return String(cur);
}

export function emptyKV(): KV {
  return { key: "", value: "", enabled: true };
}

/** 把 {{var}} 用 vars 替换；未命中的变量保留原文（与 Go 引擎行为一致） */
export function interpolate(s: string, vars: KV[]): string {
  return String(s).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (raw, k) => {
    const v = vars.find((x) => x.key.trim() === k.trim());
    return v !== undefined ? v.value : raw;
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function isProbablyJSON(body: string): boolean {
  const t = body.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 极简 JSON 语法高亮（先转义再着色） */
export function highlightJSON(json: string): string {
  const escaped = escapeHtml(json);
  return escaped.replace(
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = "j-num";
      if (m.startsWith('"')) cls = m.endsWith(":") ? "j-key" : "j-str";
      else if (m === "true" || m === "false") cls = "j-bool";
      else if (m === "null") cls = "j-null";
      return `<span class="${cls}">${m}</span>`;
    },
  );
}

/** 深度查找集合中的请求项并应用修改；找不到返回 false */
export function updateItemDeep(
  folder: Fdr,
  itemId: string,
  fn: (it: Item) => Item,
): boolean {
  for (let i = 0; i < folder.items.length; i++) {
    if (folder.items[i].id === itemId) {
      folder.items[i] = fn(folder.items[i]);
      return true;
    }
  }
  for (const sub of folder.folders) {
    if (updateItemDeep(sub, itemId, fn)) return true;
  }
  return false;
}

/** 深度查找集合中的请求项 */
export function findItemDeep(folder: Fdr, itemId: string): Item | null {
  for (const it of folder.items) {
    if (it.id === itemId) return it;
  }
  for (const sub of folder.folders) {
    const found = findItemDeep(sub, itemId);
    if (found) return found;
  }
  return null;
}

/** 深度删除集合中的请求项；删除成功返回 true */
export function removeItemDeep(folder: Fdr, itemId: string): boolean {
  const before = folder.items.length;
  folder.items = folder.items.filter((it) => it.id !== itemId);
  if (folder.items.length < before) return true;
  for (const sub of folder.folders) {
    if (removeItemDeep(sub, itemId)) return true;
  }
  return false;
}

/** 统计文件夹树里的请求总数 */
export function countRequests(folder: Fdr): number {
  return (
    folder.items.length +
    folder.folders.reduce((acc, f) => acc + countRequests(f), 0)
  );
}
