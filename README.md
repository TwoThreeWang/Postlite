# Postlite

轻量级、本地优先的 API 调试工具 —— 一个极简的 Postman 替代品。

基于 **Go + Wails v3 + React + TypeScript** 构建，无 Electron、无强制云端账号，数据全部存本地。

## 特性

### 请求与集合
- 树形集合管理（文件夹 / 请求、右键重命名 / 删除、侧栏宽度可拖动且记忆展开状态）
- 全方法支持（GET / POST / PUT / DELETE…），Header / Query / Body（raw · urlencoded · form）
- 请求历史自动记录，点击即可重发
- 多标签页 + 会话恢复：重启后回到上次的工作现场，未保存的标签显示圆点提示

### 变量与环境
- `{{变量}}` 占位符，URL / Header / Body 全支持，鼠标悬停显示解析结果
- 环境变量 / 集合变量两级作用域，环境变量优先
- 响应捕获：把响应 JSON 的指定路径自动写入变量（如登录后自动存 `access_token`）
- 一键生成代码片段

### Postman 生态
- 导入 Postman 集合（v2.x）/ 环境文件，自动识别格式
- 粘贴 cURL 命令直接导入
- 导出为 Postman v2.1 兼容 JSON
- **Postman 云端同步**：填入 API Key 即可拉取账号下的全部集合与环境（同名覆盖更新，其余新建；Key 只存本机）

### Git 同步（多人协作 / 多机同步）
- 把数据目录变成 git 仓库，一键提交快照 / 拉取 / 推送到私有远端
- 实时滚动日志 + 逐操作分隔线，过程透明
- 未提交改动左右对比窗口（按文件 / 按行）
- 撤销上次提交、游离 HEAD 自动安全恢复、rebase 残留检测
- `history.json` / `settings.json` 等隐私文件自动排除，不会误同步

### 其他
- 深色 / 浅色主题，自绘顶栏（无边框窗口，启动即最大化）
- HTTP 代理设置（默认直连，忽略系统代理）
- Windows 优先适配（WebView2），同时提供 macOS（Intel / Apple Silicon）与 Linux 构建

## 开发

```bash
# 开发模式（前后端热重载）
wails3 dev

# 构建当前平台生产版本
wails3 task build
```

要求：Go 1.26+、Node 20+、[wails3 v3.0.0-beta.34](https://v3.wails.io/)。
Linux 需额外安装 GTK4 与 WebKitGTK 6.0 开发库：`sudo apt install libgtk-4-dev libwebkitgtk-6.0-dev`。

## 构建

推送到 GitHub 后自动多平台构建（见 [.github/workflows/build.yml](.github/workflows/build.yml)）：
Windows / macOS (Intel & Apple Silicon) / Linux。

推 `v*` 标签会自动创建 Release 并附上全部产物：

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## 数据与隐私

- 集合 / 环境 / 历史均为本地 JSON 文件（默认 `%APPDATA%\postlite`，可在设置中迁移）
- Git 同步用的是你自己的远端仓库，不经任何第三方服务器
- Postman API Key 仅保存在本机 settings.json（已被 gitignore 排除）
