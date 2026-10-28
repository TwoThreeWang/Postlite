// 临时调试用：通过 WebView2 远程调试端口(9333)挂到 postlite.exe 的页面，
// 填 URL、点 Send，全程收集 console/异常/崩溃事件。
// 用法：node cdp-drive.mjs [要发送的URL]
const URL_TO_SEND = process.argv[2] ?? "http://127.0.0.1:18111/login";
const DEBUG_PORT = 9333;

const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) {
  console.error("no page target:", JSON.stringify(targets, null, 2));
  process.exit(1);
}
console.log(`[drive] attached: "${page.title}" ${page.url}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const evlog = [];
let crashed = false;

const cmd = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    return;
  }
  const { method, params } = m;
  if (method === "Runtime.consoleAPICalled")
    evlog.push(
      `[console.${params.type}] ${params.args
        .map((a) => a.value ?? a.description ?? JSON.stringify(a.preview?.properties ?? ""))
        .join(" ")}`,
    );
  else if (method === "Runtime.exceptionThrown")
    evlog.push(
      `[JS-EXCEPTION] ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`,
    );
  else if (method === "Inspector.targetCrashed") {
    crashed = true;
    evlog.push("[RENDERER-CRASHED] Inspector.targetCrashed fired");
  } else if (method === "Log.entryAdded")
    evlog.push(`[log.${params.entry.level}] [${params.entry.source}] ${params.entry.text}`);
});

ws.addEventListener("close", () => {
  console.log("[drive] WebSocket CLOSED unexpectedly" + (crashed ? " (renderer crashed)" : ""));
  dump();
  process.exit(2);
});
ws.addEventListener("error", () => {});

await new Promise((r) => (ws.onopen = r));
await cmd("Runtime.enable");
await cmd("Log.enable");
await cmd("Page.enable");
await cmd("Inspector.enable");
console.log("[drive] enabled Runtime/Log/Page/Inspector");

async function evalJS(expr) {
  const r = await cmd("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r?.exceptionDetails)
    throw new Error(
      "eval failed: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text),
    );
  return r?.result?.value;
}

// 1) 用 React 原生 setter 填 URL（受控输入）
const fill = await evalJS(`(() => {
  const inp = document.querySelector(".url-in");
  if (!inp) return "NO-INPUT";
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(inp, ${JSON.stringify(URL_TO_SEND)});
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  return "OK";
})()`);
console.log(`[drive] fill url: ${fill}`);

// 2) 点 Send
const clicked = await evalJS(`(() => {
  const btn = document.querySelector(".send-btn");
  if (!btn) return "NO-BTN";
  btn.click();
  return "OK:" + btn.textContent.trim();
})()`);
console.log(`[drive] clicked ${clicked} @ ${new Date().toISOString()}`);

// 3) 观察 15 秒，轮询状态栏
let status = "";
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const s = await evalJS(
      `(() => {
        const el = document.querySelector(".statusline");
        return el ? el.innerText.replace(/\\n/g, " | ") : "(no statusline)";
      })()`,
    );
    if (s !== status) {
      status = s;
      console.log(`[drive] status: ${s}`);
    }
  } catch (e) {
    console.log(`[drive] eval failed: ${e.message}`);
  }
  if (crashed) break;
}
console.log("[drive] survived 15s, no crash. DONE");
dump();

function dump() {
  if (evlog.length) {
    console.log("---- captured events ----");
    for (const l of evlog) console.log(l);
  } else {
    console.log("---- no console/log events captured ----");
  }
}
