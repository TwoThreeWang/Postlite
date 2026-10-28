// 请求 → 多语言代码生成。基于「变量替换后的可运行值」生成（所见即所得），
// 源头是当前 spec + 合并后的变量，粘贴出去就能跑。

import { KV, Spec, interpolate } from "./lib";

export const CODE_LANGS = ["cURL", "Python", "JavaScript", "Go", "Java"] as const;
export type CodeLang = (typeof CODE_LANGS)[number];

/** 拼接 query 后的完整 URL（已插值） */
export function fullURL(spec: Spec, vars: KV[]): string {
  const q = spec.queryParams
    .filter((p) => p.enabled && p.key)
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
  const base = interpolate(spec.url, vars);
  return q ? `${base}${base.includes("?") ? "&" : "?"}${q}` : base;
}

/** 生效的 Header（urlencoded 自动补 Content-Type；值已插值） */
function headersFor(spec: Spec, vars: KV[]): KV[] {
  const hs = spec.headers.filter((h) => h.enabled && h.key).map((h) => ({ ...h }));
  if (spec.bodyType === "urlencoded" && !hs.some((h) => h.key.toLowerCase() === "content-type")) {
    hs.push({ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true });
  }
  return hs.map((h) => ({ key: h.key, value: interpolate(h.value, vars), enabled: true }));
}

/** raw / urlencoded 的字符串请求体；没有则 null */
function bodyRaw(spec: Spec, vars: KV[]): string | null {
  if (spec.bodyType === "raw" && spec.rawBody) return interpolate(spec.rawBody, vars);
  if (spec.bodyType === "urlencoded") {
    const rows = spec.formFields.filter((f) => f.enabled && f.key);
    if (!rows.length) return null;
    return rows
      .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(interpolate(f.value, vars))}`)
      .join("&");
  }
  return null;
}

/** form-data 字段（值已插值） */
function formFields(spec: Spec, vars: KV[]): KV[] {
  if (spec.bodyType !== "form") return [];
  return spec.formFields
    .filter((f) => f.enabled && f.key)
    .map((f) => ({ key: f.key, value: interpolate(f.value, vars), enabled: true }));
}

// ---------- 各语言字符串转义 ----------

const sq = (s: string) => s.replace(/'/g, "'\\''"); // shell 单引号

function dq(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

// ---------- cURL ----------

function genCurl(spec: Spec, vars: KV[]): string {
  const parts = [`curl -X ${spec.method} '${sq(fullURL(spec, vars))}'`];
  for (const h of headersFor(spec, vars)) parts.push(`-H '${sq(`${h.key}: ${h.value}`)}'`);
  const b = bodyRaw(spec, vars);
  if (b) parts.push(`-d '${sq(b)}'`);
  for (const f of formFields(spec, vars)) parts.push(`-F '${sq(`${f.key}=${f.value}`)}'`);
  return parts.join(" \\\n  ");
}

// ---------- Python (requests) ----------

function pyDict(rows: KV[], indent = "    "): string {
  const rows2 = rows.filter((h) => h.key);
  if (!rows2.length) return "{}";
  const items = rows2.map((h) => `${indent}"${dq(h.key)}": "${dq(h.value)}",`);
  return `{\n${items.join("\n")}\n}`;
}

/** requests 的 files 字典：值是 (None, "值") 元组 */
function pyFiles(ff: KV[]): string {
  const items = ff.map((f) => `    "${dq(f.key)}": (None, "${dq(f.value)}"),`);
  return `{\n${items.join("\n")}\n}`;
}

function genPython(spec: Spec, vars: KV[]): string {
  const lines: string[] = ["import requests", "", `url = "${dq(fullURL(spec, vars))}"`];
  const hs = headersFor(spec, vars);
  const b = bodyRaw(spec, vars);
  const ff = formFields(spec, vars);
  const args: string[] = [];
  if (hs.length) {
    lines.push(`headers = ${pyDict(hs)}`);
    args.push("headers=headers");
  }
  if (ff.length) {
    lines.push(`files = ${pyFiles(ff)}`);
    args.push("files=files");
  } else if (b) {
    lines.push(`data = "${dq(b)}"`);
    args.push("data=data");
  }
  lines.push("", `resp = requests.request("${spec.method}", url${args.length ? ", " + args.join(", ") : ""})`, "print(resp.status_code)", "print(resp.text)");
  return lines.join("\n");
}

// ---------- JavaScript (fetch) ----------

function jsDict(rows: KV[]): string {
  const rows2 = rows.filter((h) => h.key);
  if (!rows2.length) return "";
  const items = rows2.map((h) => `    "${dq(h.key)}": "${dq(h.value)}",`);
  return `  headers: {\n${items.join("\n")}\n  },\n`;
}

function genJS(spec: Spec, vars: KV[]): string {
  const hs = headersFor(spec, vars);
  const b = bodyRaw(spec, vars);
  const ff = formFields(spec, vars);
  const opts: string[] = [];
  const isGet = spec.method === "GET";
  if (!isGet) opts.push(`  method: "${spec.method}",`);
  if (hs.length) opts.push(jsDict(hs).trimEnd().replace(/,$/, ","));
  if (ff.length) {
    const appends = ff.map((f) => `form.append("${dq(f.key)}", "${dq(f.value)}");`);
    return [
      `const form = new FormData();`,
      ...appends,
      "",
      `const resp = await fetch("${dq(fullURL(spec, vars))}", {`,
      `  method: "${spec.method}",`,
      `  body: form,`,
      `});`,
      ``,
      `console.log(resp.status);`,
      `console.log(await resp.text());`,
    ].join("\n");
  }
  if (b && !isGet) opts.push(`  body: "${dq(b)}",`);
  const optBody = opts.length ? `{\n${opts.join("\n")}\n}` : "undefined";
  return [
    `const resp = await fetch("${dq(fullURL(spec, vars))}", ${optBody});`,
    ``,
    `console.log(resp.status);`,
    `console.log(await resp.text());`,
  ].join("\n");
}

// ---------- Go (net/http) ----------

function goHeaderLines(hs: KV[]): string {
  return hs.filter((h) => h.key).map((h) => `\treq.Header.Set("${dq(h.key)}", "${dq(h.value)}")`).join("\n");
}

function genGo(spec: Spec, vars: KV[]): string {
  const hs = headersFor(spec, vars);
  const b = bodyRaw(spec, vars);
  const ff = formFields(spec, vars);
  const isGet = spec.method === "GET" && !b && !ff.length;

  let imports = '\t"fmt"\n\t"io"\n\t"net/http"\n';
  let bodyExpr = "nil";
  if (ff.length) {
    imports = '\t"bytes"\n\t"fmt"\n\t"io"\n\t"mime/multipart"\n\t"net/http"\n';
    const fields = ff.map((f) => `\t_ = w.WriteField("${dq(f.key)}", "${dq(f.value)}")`).join("\n");
    bodyExpr =
      "&buf\n\t// buf 由下方 multipart 构造";
    return [
      "package main",
      "",
      "import (",
      imports,
      ')',
      "",
      "func main() {",
      "\tvar buf bytes.Buffer",
      "\tw := multipart.NewWriter(&buf)",
      fields,
      "\tw.Close()",
      "",
      `\treq, err := http.NewRequest("${spec.method}", "${dq(fullURL(spec, vars))}", &buf)`,
      "\tif err != nil {",
      "\t\tpanic(err)",
      "\t}",
      `\treq.Header.Set("Content-Type", w.FormDataContentType())`,
      goHeaderLines(hs),
      "\tresp, err := http.DefaultClient.Do(req)",
      "\tif err != nil {",
      "\t\tpanic(err)",
      "\t}",
      "\tdefer resp.Body.Close()",
      "\tdata, _ := io.ReadAll(resp.Body)",
      "\tfmt.Println(resp.Status)",
      "\tfmt.Println(string(data))",
      "}",
    ].join("\n");
  }

  if (!isGet) {
    imports += '\t"strings"\n';
    bodyExpr = `strings.NewReader("${dq(b ?? "")}")`;
  }

  return [
    "package main",
    "",
    "import (",
    imports,
    ")",
    "",
    "func main() {",
    isGet
      ? `\treq, err := http.NewRequest("${spec.method}", "${dq(fullURL(spec, vars))}", nil)`
      : `\treq, err := http.NewRequest("${spec.method}", "${dq(fullURL(spec, vars))}", ${bodyExpr})`,
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    goHeaderLines(hs),
    "\tresp, err := http.DefaultClient.Do(req)",
    "\tif err != nil {",
    "\t\tpanic(err)",
    "\t}",
    "\tdefer resp.Body.Close()",
    "\tdata, _ := io.ReadAll(resp.Body)",
    "\tfmt.Println(resp.Status)",
    "\tfmt.Println(string(data))",
    "}",
  ].join("\n");
}

// ---------- Java (11+ HttpClient) ----------

function genJava(spec: Spec, vars: KV[]): string {
  const hs = headersFor(spec, vars);
  const b = bodyRaw(spec, vars);
  const ff = formFields(spec, vars);
  const isGet = spec.method === "GET" && !b && !ff.length;
  const headerLines = hs
    .filter((h) => h.key)
    .map((h) => `                .header("${dq(h.key)}", "${dq(h.value)}")`)
    .join("\n");

  let bodyPart: string;
  let extraLines: string[] = [];
  if (ff.length) {
    const appends = ff.map(
      (f) =>
        `        body.append("--").append(boundary).append("\\r\\n")\n` +
        `                .append("Content-Disposition: form-data; name=\\"${dq(f.key)}\\"\\r\\n\\r\\n")\n` +
        `                .append("${dq(f.value)}").append("\\r\\n");`,
    );
    extraLines = [
      "        String boundary = \"----postlite\" + System.currentTimeMillis();",
      "        StringBuilder body = new StringBuilder();",
      ...appends,
      "        body.append(\"--\").append(boundary).append(\"--\\r\\n\");",
    ];
    bodyPart = `.header("Content-Type", "multipart/form-data; boundary=" + boundary)\n                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))`;
  } else if (isGet) {
    bodyPart = ".GET()";
  } else {
    bodyPart = `.POST(HttpRequest.BodyPublishers.ofString("${dq(b ?? "")}"))`;
  }

  return [
    "import java.net.URI;",
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "import java.net.http.HttpResponse;",
    "",
    "public class Request {",
    "    public static void main(String[] args) throws Exception {",
    "        HttpClient client = HttpClient.newHttpClient();",
    ...extraLines,
    "        HttpRequest request = HttpRequest.newBuilder()",
    `                .uri(URI.create("${dq(fullURL(spec, vars))}"))`,
    headerLines,
    "                " + bodyPart.trimStart(),
    "                .build();",
    "        HttpResponse<String> resp = client.send(request, HttpResponse.BodyHandlers.ofString());",
    "        System.out.println(resp.statusCode());",
    "        System.out.println(resp.body());",
    "    }",
    "}",
  ].join("\n");
}

// ---------- 入口 ----------

export function generateCode(lang: CodeLang, spec: Spec, vars: KV[]): string {
  switch (lang) {
    case "Python":
      return genPython(spec, vars);
    case "JavaScript":
      return genJS(spec, vars);
    case "Go":
      return genGo(spec, vars);
    case "Java":
      return genJava(spec, vars);
    default:
      return genCurl(spec, vars);
  }
}
