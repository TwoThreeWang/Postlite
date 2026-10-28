// 临时调试用：mock 登录接口，延迟 1.2s 返回小 JSON（几行），模拟"获取 token"场景
import http from "node:http";

let n = 0;
http.createServer((req, res) => {
  setTimeout(() => {
    n++;
    const body = JSON.stringify({
      code: 0,
      data: {
        access_token: "eyJhbGciOiJIUzI1NiJ9.mock-token-" + n,
        expires_in: 7200,
        user: { name: "Evan", roles: ["admin"] },
      },
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    console.log(`served ${req.method} ${req.url} (${body.length}B)`);
  }, 1200);
}).listen(18111, "127.0.0.1", () => console.log("mock server on http://127.0.0.1:18111"));
