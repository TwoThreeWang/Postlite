package main

// Git 同步：把数据目录（collections + environments 的 JSON 文件）变成 git 仓库，
// 支持提交快照 / 拉取 / 推送。history.json 属于本机隐私数据，通过 .gitignore 排除。

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// gitLogSink git 操作日志的实时输出通道（main.go 注入 Wails 事件；测试可注入收集器）。
var gitLogSink atomic.Value // func(string)

// SetGitLogSink 注入日志输出函数；传 nil 关闭。
func SetGitLogSink(fn func(string)) {
	if fn == nil {
		gitLogSink.Store(func(string) {})
		return
	}
	gitLogSink.Store(fn)
}

func emitGitLog(line string) {
	if f, ok := gitLogSink.Load().(func(string)); ok && f != nil {
		f(line)
	}
}

// gitRunLogged 与 gitRun 相同，但把命令行与输出实时推送到 UI 日志区。
// 只用于用户主动触发的操作（提交/拉取/推送/撤销/初始化）；
// 探测类调用（rev-parse / status 等）与读取类（Status/DiffDetail）保持静默。
func gitRunLogged(dir string, args ...string) (string, error) {
	emitGitLog("$ git " + strings.Join(args, " "))
	out, err := gitRun(dir, args...)
	if strings.TrimSpace(out) != "" {
		emitGitLog(strings.TrimSpace(out))
	}
	if err != nil {
		emitGitLog("✗ 命令执行失败")
	}
	return out, err
}

type GitService struct {
	mu sync.Mutex
}

// GitStatus 数据目录的 git 状态快照。
type GitStatus struct {
	GitFound   bool   `json:"gitFound"`   // PATH 里能否找到 git
	IsRepo     bool   `json:"isRepo"`     // 数据目录是否已是仓库
	Branch     string `json:"branch"`     // 当前分支（游离 HEAD 时为 "HEAD"）
	Detached   bool   `json:"detached"`   // HEAD 是否处于游离状态
	Changes    int    `json:"changes"`    // 未提交变更文件数
	Remote     string `json:"remote"`     // origin 地址（未配置为空）
	LastCommit string `json:"lastCommit"` // 最近一次提交摘要
	// LastCommitPushed 最近一次提交是否已推送到远端（决定能否安全撤销提交）
	LastCommitPushed bool `json:"lastCommitPushed"`
}

// gitRun 在 dir 里执行 git 子命令，返回合并输出。
// 过滤 OpenSSH 的 post-quantum 警告行（** 开头），避免污染界面输出。
func gitRun(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	hideConsoleWindow(cmd) // git 是控制台程序，GUI 下不弹黑框
	out, err := cmd.CombinedOutput()
	return cleanGitOut(string(out)), err
}

func cleanGitOut(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	kept := make([]string, 0, len(lines))
	for _, l := range lines {
		t := strings.TrimSpace(l)
		// 过滤 OpenSSH post-quantum 警告与 CRLF 换行警告，避免污染界面输出
		if strings.HasPrefix(t, "** ") || strings.HasPrefix(t, "warning: ") {
			continue
		}
		kept = append(kept, l)
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

// Status 返回 git 状态；git 不存在或不是仓库时字段为零值不报错。
func (g *GitService) Status() (GitStatus, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	st := GitStatus{}
	if _, err := exec.LookPath("git"); err != nil {
		return st, nil
	}
	st.GitFound = true

	dir := dataDir()
	if out, err := gitRun(dir, "rev-parse", "--is-inside-work-tree"); err != nil || out != "true" {
		return st, nil
	}
	st.IsRepo = true
	// 老仓库兜底补 .gitignore（settings.json / session.json 是本机数据，不该参与同步）
	ensureGitIgnore(dir, "history.json", "settings.json", "session.json", "*.tmp")

	if out, err := gitRun(dir, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		st.Branch = out
	}
	// 游离 HEAD：abbrev-ref 返回 "HEAD"
	st.Detached = strings.TrimSpace(st.Branch) == "HEAD"
	if out, err := gitRun(dir, "status", "--porcelain"); err == nil && out != "" {
		st.Changes = len(strings.Split(out, "\n"))
	}
	if out, err := gitRun(dir, "remote", "get-url", "origin"); err == nil {
		st.Remote = out
	}
	if out, err := gitRun(dir, "log", "-1", "--pretty=format:%h %s (%cr)"); err == nil {
		st.LastCommit = out
	}
	// 最近一次提交是否已在远端分支上（决定「撤销上次提交」是否可用）
	if rb := "origin/" + st.Branch; st.LastCommit != "" && rb != "origin/" {
		if out, err := gitRun(dir, "rev-parse", "--verify", "--quiet", rb); err == nil && strings.TrimSpace(out) != "" {
			if _, aerr := gitRun(dir, "merge-base", "--is-ancestor", "HEAD", rb); aerr == nil {
				st.LastCommitPushed = true
			}
		}
	}
	return st, nil
}

// Init 把数据目录初始化为 git 仓库并写入 .gitignore（排除 history.json）。
func (g *GitService) Init() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if _, err := exec.LookPath("git"); err != nil {
		return fmt.Errorf("未找到 git 命令，请先安装 Git 并加入 PATH")
	}
	dir := dataDir()
	// 已是仓库也要补 .gitignore（老仓库可能缺 session.json 等新增条目）
	// settings.json / session.json / history.json 都属于本机数据，不参与多机同步
	ensureGitIgnore(dir, "history.json", "settings.json", "session.json", "*.tmp")
	if out, err := gitRun(dir, "rev-parse", "--is-inside-work-tree"); err == nil && out == "true" {
		return nil // 已是仓库
	}
	if out, err := gitRunLogged(dir, "init"); err != nil {
		return fmt.Errorf("git init 失败: %s", out)
	}
	return nil
}

// Diff 返回未提交变更的文本对比（含已暂存：git diff HEAD）。
// 未跟踪的新文件没有基线内容，单独以注释行列出。
func (g *GitService) Diff() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	dir := dataDir()
	if out, err := gitRun(dir, "rev-parse", "--is-inside-work-tree"); err != nil || out != "true" {
		return "", fmt.Errorf("数据目录还不是 git 仓库，先初始化")
	}
	diff, err := gitRun(dir, "diff", "HEAD")
	if err != nil {
		return "", fmt.Errorf("git diff 失败: %s", diff)
	}
	var sb strings.Builder
	sb.WriteString(diff)
	if st, err := gitRun(dir, "status", "--porcelain"); err == nil && st != "" {
		var untracked []string
		for _, l := range strings.Split(st, "\n") {
			if strings.HasPrefix(l, "?? ") {
				untracked = append(untracked, strings.TrimPrefix(l, "?? "))
			}
		}
		if len(untracked) > 0 {
			sb.WriteString("\n\n# 以下为新增（未跟踪）文件，暂无基线内容可对比：")
			for _, f := range untracked {
				sb.WriteString("\n# + " + f)
			}
		}
	}
	out := sb.String()
	if strings.TrimSpace(out) == "" {
		return "（工作区干净，没有未提交的变更）", nil
	}
	return out, nil
}

// ---------------------------------------------------------------- 改动对比窗口

// DiffHunk 一个改动块：改动前/后内容与在新文件中的位置。
type DiffHunk struct {
	OldStart int      `json:"oldStart"`
	OldLines []string `json:"oldLines"` // 改动前（context + 删除行）
	NewStart int      `json:"newStart"`
	NewLines []string `json:"newLines"` // 改动后（context + 新增行）
}

// DiffFile 一个文件的改动。IsNew = 未跟踪新文件（无基线可对比）。
type DiffFile struct {
	Path      string     `json:"path"`
	IsNew     bool       `json:"isNew"`
	HunkCount int        `json:"hunkCount"`
	Hunks     []DiffHunk `json:"hunks"`
}

// DiffDetail 返回结构化的未提交改动（git diff HEAD + 未跟踪文件），供对比窗口渲染。
func (g *GitService) DiffDetail() ([]DiffFile, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	dir := dataDir()
	if out, err := gitRun(dir, "rev-parse", "--is-inside-work-tree"); err != nil || out != "true" {
		return nil, fmt.Errorf("数据目录还不是 git 仓库，先初始化")
	}
	out, err := gitRun(dir, "diff", "HEAD", "--no-color", "-U3")
	if err != nil {
		return nil, fmt.Errorf("git diff 失败: %s", out)
	}
	files := parseUnifiedDiff(out)

	// 未跟踪新文件不在 git diff 里，补充为无基线条目
	if st, err := gitRun(dir, "status", "--porcelain"); err == nil {
		for _, l := range strings.Split(st, "\n") {
			if !strings.HasPrefix(l, "?? ") {
				continue
			}
			p := strings.TrimSpace(strings.TrimPrefix(l, "?? "))
			dup := false
			for _, f := range files {
				if f.Path == p {
					dup = true
					break
				}
			}
			if !dup {
				files = append(files, DiffFile{Path: p, IsNew: true, Hunks: []DiffHunk{}})
			}
		}
	}
	if files == nil {
		files = []DiffFile{}
	}
	return files, nil
}

// parseUnifiedDiff 把 git diff 输出解析成结构化文件列表（尽力而为，异常行跳过）。
func parseUnifiedDiff(s string) []DiffFile {
	var files []DiffFile
	var cur *DiffFile
	var hunk *DiffHunk
	flushHunk := func() {
		if hunk != nil && cur != nil {
			cur.Hunks = append(cur.Hunks, *hunk)
			cur.HunkCount++
		}
		hunk = nil
	}
	flushFile := func() {
		flushHunk()
		cur = nil
	}
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimRight(line, "\r")
		switch {
		case strings.HasPrefix(line, "diff --git "):
			flushFile()
			files = append(files, DiffFile{Hunks: []DiffHunk{}})
			cur = &files[len(files)-1]
		case strings.HasPrefix(line, "+++ b/"):
			if cur != nil {
				cur.Path = strings.TrimPrefix(line, "+++ b/")
			}
		case strings.HasPrefix(line, "+++ /dev/null"):
			// 删除的文件：以 a 侧路径为准
			// （此分支只会在极端场景出现，保持 Path 为空也不影响渲染）
		case strings.HasPrefix(line, "new file mode"):
			if cur != nil {
				cur.IsNew = true
			}
		case strings.HasPrefix(line, "@@"):
			flushHunk()
			m := hunkHeaderRe.FindStringSubmatch(line)
			if m == nil || cur == nil {
				continue
			}
			hunk = &DiffHunk{
				OldStart: atoiSafe(m[1]),
				NewStart: atoiSafe(m[2]),
				OldLines: []string{},
				NewLines: []string{},
			}
		default:
			if hunk == nil {
				continue
			}
			switch {
			case strings.HasPrefix(line, " "):
				hunk.OldLines = append(hunk.OldLines, strings.TrimPrefix(line, " "))
				hunk.NewLines = append(hunk.NewLines, strings.TrimPrefix(line, " "))
			case strings.HasPrefix(line, "-"):
				hunk.OldLines = append(hunk.OldLines, strings.TrimPrefix(line, "-"))
			case strings.HasPrefix(line, "+"):
				hunk.NewLines = append(hunk.NewLines, strings.TrimPrefix(line, "+"))
			}
		}
	}
	flushFile()
	// 过滤没解析出路径的条目
	out := files[:0]
	for _, f := range files {
		if f.Path != "" {
			out = append(out, f)
		}
	}
	return out
}

var hunkHeaderRe = regexp.MustCompile(`^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@`)

func atoiSafe(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// OpenDiffWindow 弹出与主窗口同尺寸的改动对比窗口（只读）。
func (g *GitService) OpenDiffWindow() error {
	application.Get().Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "改动对比 - Postlite",
		Width:            1400,
		Height:           900,
		MinWidth:         900,
		MinHeight:        600,
		URL:              "/diff.html",
		BackgroundColour: application.NewRGB(23, 23, 26),
	})
	return nil
}

// Commit 提交全部变更（git add -A + commit）。没有变更时返回提示。
func (g *GitService) Commit(message string) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	dir := dataDir()
	if strings.TrimSpace(message) == "" {
		message = "同步集合与环境 " + time.Now().Format("2006-01-02 15:04")
	}
	// 游离 HEAD 时先恢复分支，避免把快照挂在不属于任何分支的提交上
	branch := strings.TrimSpace(must(gitRun(dir, "rev-parse", "--abbrev-ref", "HEAD")))
	if branch == "" || branch == "HEAD" {
		branch = "master"
	}
	if _, rerr := ensureOnBranch(dir, branch); rerr != nil {
		return "", rerr
	}
	if out, err := gitRunLogged(dir, "add", "-A"); err != nil {
		return "", fmt.Errorf("git add 失败: %s", out)
	}
	out, err := gitRunLogged(dir, "commit", "-m", message)
	if err != nil {
		if strings.Contains(out, "nothing to commit") {
			return "没有变更，无需提交", nil
		}
		return "", fmt.Errorf("git commit 失败: %s", out)
	}
	return out, nil
}

// Pull 拉取远端（rebase 方式）。首次拉取时本地分支还没有 upstream，
// 按「有无 upstream / 有无本地提交 / 远端有无同名分支」分别处理：
//   - 远端是空仓库 → 友好提示先提交并推送
//   - 本地无提交且工作区干净 → 直接对齐远端
//   - 本地无提交但有未提交文件 → 先自动提交一次再建立跟踪
//   - 常规情况 → 建立 upstream 后 pull --rebase
//
// 另外任何路径走到 pull --rebase 前，若工作区有未提交变更，先自动提交一份本地快照
// （rebase 拒绝脏工作区："cannot pull with rebase: You have unstaged changes"）。
func (g *GitService) Pull() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	dir := dataDir()

	branch := strings.TrimSpace(must(gitRun(dir, "rev-parse", "--abbrev-ref", "HEAD")))
	if branch == "" || branch == "HEAD" {
		branch = "master"
	}
	// 游离 HEAD 先安全恢复，否则自动提交会挂在不属于任何分支的提交上
	if b, rerr := ensureOnBranch(dir, branch); rerr != nil {
		return "", rerr
	} else {
		branch = b
	}

	hasUpstream := false
	if out, err := gitRun(dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"); err == nil && strings.TrimSpace(out) != "" {
		hasUpstream = true
	}
	hasCommit := false
	if out, err := gitRun(dir, "rev-parse", "--verify", "--quiet", "HEAD"); err == nil && strings.TrimSpace(out) != "" {
		hasCommit = true
	}

	// 先 fetch：网络 / 凭据问题在这一步暴露，报错信息最清楚
	if out, err := gitRunLogged(dir, "fetch", "origin"); err != nil {
		return out, fmt.Errorf("git fetch 失败: %s", out)
	}

	remoteBranch := "origin/" + branch
	remoteHasBranch := false
	if out, err := gitRun(dir, "rev-parse", "--verify", "--quiet", remoteBranch); err == nil && strings.TrimSpace(out) != "" {
		remoteHasBranch = true
	}

	if !hasUpstream {
		if !remoteHasBranch {
			return "远端还没有 " + branch + " 分支（远端仓库可能是空的）：先「提交快照」再「推送」一次，之后就可以拉取了。", nil
		}
		if !hasCommit {
			// 本地没有任何提交：若有未提交文件先自动提交一份快照，避免被对齐操作覆盖
			if _, err := gitRunLogged(dir, "add", "-A"); err == nil {
				if _, cerr := gitRunLogged(dir, "commit", "-m", "同步集合与环境 "+time.Now().Format("2006-01-02 15:04")); cerr == nil {
					hasCommit = true
				}
			}
			if !hasCommit {
				// 工作区干净且无提交，直接对齐远端是安全的
				if out, err := gitRunLogged(dir, "reset", "--hard", remoteBranch); err != nil {
					return out, fmt.Errorf("对齐远端失败: %s", out)
				}
				_, _ = gitRunLogged(dir, "branch", "--set-upstream-to="+remoteBranch, branch)
				return "本地还没有提交，已直接对齐远端 " + remoteBranch, nil
			}
		}
		if out, err := gitRunLogged(dir, "branch", "--set-upstream-to="+remoteBranch, branch); err != nil {
			return out, fmt.Errorf("建立分支跟踪失败: %s", out)
		}
	}

	// pull --rebase 拒绝脏工作区：有未提交变更时先自动提交一份本地快照，
	// 与首次拉取分支的行为保持一致，避免用户卡在"先提交再拉取"
	autoCommitted := false
	if out, err := gitRun(dir, "status", "--porcelain"); err == nil && strings.TrimSpace(out) != "" {
		if aout, aerr := gitRunLogged(dir, "add", "-A"); aerr != nil {
			return aout, fmt.Errorf("git add 失败: %s", aout)
		}
		if cout, cerr := gitRunLogged(dir, "commit", "-m", "同步集合与环境 "+time.Now().Format("2006-01-02 15:04")); cerr != nil {
			return cout, fmt.Errorf("自动提交本地快照失败: %s", cout)
		}
		autoCommitted = true
	}

	out, err := gitRunLogged(dir, "pull", "--rebase")
	if err != nil {
		return out, fmt.Errorf("git pull 失败: %s", out)
	}
	if autoCommitted {
		return "已自动提交本地快照。\n" + out, nil
	}
	return out, nil
}

// must 取输出首行（用于解析分支名）。
func must(out string, err error) string {
	if err != nil {
		return ""
	}
	if i := strings.IndexAny(out, "\r\n"); i >= 0 {
		return out[:i]
	}
	return out
}

// rebaseInProgress 检测仓库是否有中断的 rebase 残留（.git/rebase-merge 或 rebase-apply 目录）。
// 有残留时 HEAD 必然处于游离状态，此时提交/恢复分支都会把快照挂错位置，必须先让用户处理。
func rebaseInProgress(dir string) bool {
	for _, name := range []string{"rebase-merge", "rebase-apply"} {
		if st, err := os.Stat(filepath.Join(dir, ".git", name)); err == nil && st.IsDir() {
			return true
		}
	}
	return false
}

// ensureOnBranch 检测游离 HEAD 并尝试安全恢复到 branch 分支。
// 返回（可能修正后的）分支名。恢复策略（安全优先，绝不丢提交）：
//   - 有中断的 rebase 残留 → 拒绝并提示先完成/中止 rebase
//   - 已在分支上 → 原样返回
//   - 本地无该分支 → 在当前游离提交处创建分支（checkout -b）
//   - 分支指向同一提交 → 切回分支（checkout）
//   - 分支是当前游离提交的祖先 → 分支快进到当前提交（checkout -B）
//   - 与分支分叉 → 拒绝并提示手动处理（此时自动操作可能丢提交）
func ensureOnBranch(dir, branch string) (string, error) {
	if rebaseInProgress(dir) {
		return "", fmt.Errorf(
			"检测到上次拉取中断留下的未完成 rebase（.git/rebase-merge 残留），HEAD 处于游离状态。" +
				"为避免把快照提交挂错位置，已停止自动操作；请先在命令行处理：" +
				"git rebase --continue（完成它）或 git rebase --abort（放弃它），然后重试")
	}
	if out, err := gitRun(dir, "symbolic-ref", "-q", "HEAD"); err == nil && strings.TrimSpace(out) != "" {
		return branch, nil // 已在分支上
	}
	sha := strings.TrimSpace(must(gitRun(dir, "rev-parse", "HEAD")))
	if sha == "" {
		return "", fmt.Errorf("仓库没有任何提交，无法恢复游离 HEAD")
	}
	bout, berr := gitRun(dir, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch)
	if berr != nil || strings.TrimSpace(bout) == "" {
		// 本地没有这个分支：在当前游离提交处创建并挂上
		if out, err := gitRunLogged(dir, "checkout", "-b", branch); err != nil {
			return "", fmt.Errorf("恢复游离 HEAD 失败（创建分支 %s）: %s", branch, out)
		}
		emitGitLog("✓ 检测到游离 HEAD，已在当前提交创建分支 " + branch)
		return branch, nil
	}
	if strings.TrimSpace(bout) == sha {
		if out, err := gitRunLogged(dir, "checkout", branch); err != nil {
			return "", fmt.Errorf("恢复游离 HEAD 失败（切回 %s）: %s", branch, out)
		}
		emitGitLog("✓ 检测到游离 HEAD，已切回分支 " + branch)
		return branch, nil
	}
	if _, aerr := gitRun(dir, "merge-base", "--is-ancestor", "refs/heads/"+branch, sha); aerr == nil {
		// 分支落后于当前游离提交：把分支快进到当前提交（不丢任何提交）
		if out, err := gitRunLogged(dir, "checkout", "-B", branch, sha); err != nil {
			return "", fmt.Errorf("恢复游离 HEAD 失败（快进 %s）: %s", branch, out)
		}
		emitGitLog("✓ 检测到游离 HEAD，已把分支 " + branch + " 快进到当前提交")
		return branch, nil
	}
	return "", fmt.Errorf(
		"当前处于游离 HEAD（%s），且与分支 %s（%s）分叉（各自有不同的提交），为避免丢失提交已停止自动操作。"+
			"请比较两边提交后决定保留哪边：git log --oneline --graph --all；"+
			"若要保留当前游离提交，执行 git checkout -B %s；若要回到分支，执行 git checkout %s",
		shortSha(sha), branch, shortSha(strings.TrimSpace(bout)), branch, branch)
}

// shortSha 取 7 位短哈希；输入不合法时原样返回。
func shortSha(s string) string {
	if len(s) > 7 {
		return s[:7]
	}
	return s
}

// Push 推送到 origin。
func (g *GitService) Push() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	dir := dataDir()

	// 游离 HEAD 时先恢复分支，否则 push origin HEAD 无法推断 refname
	branch := strings.TrimSpace(must(gitRun(dir, "rev-parse", "--abbrev-ref", "HEAD")))
	if branch == "" || branch == "HEAD" {
		branch = "master"
	}
	if _, rerr := ensureOnBranch(dir, branch); rerr != nil {
		return "", rerr
	}

	// 还没有任何提交时 push 会报难以理解的 refspec 错误，先给友好提示
	if out, err := gitRun(dir, "rev-parse", "--verify", "--quiet", "HEAD"); err != nil || strings.TrimSpace(out) == "" {
		return "", fmt.Errorf("本地还没有任何提交：先「提交快照」再推送")
	}
	out, err := gitRunLogged(dir, "push", "-u", "origin", "HEAD")
	if err != nil {
		return out, fmt.Errorf("git push 失败: %s", out)
	}
	return out, nil
}

// UndoCommit 撤销最近一次提交（git reset --mixed HEAD~1）：
// 提交记录消失，文件内容原样保留为未提交状态。
// 已推送到远端的提交拒绝撤销（会造成本地与远端分叉）；仅有的一个提交也拒绝（会变空仓库）。
func (g *GitService) UndoCommit() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	dir := dataDir()
	if out, err := gitRun(dir, "rev-parse", "--is-inside-work-tree"); err != nil || out != "true" {
		return "", fmt.Errorf("数据目录还不是 git 仓库")
	}
	branch := strings.TrimSpace(must(gitRun(dir, "rev-parse", "--abbrev-ref", "HEAD")))
	if branch == "" || branch == "HEAD" {
		branch = "master"
	}
	rb := "origin/" + branch
	if out, err := gitRun(dir, "rev-parse", "--verify", "--quiet", rb); err == nil && strings.TrimSpace(out) != "" {
		if _, aerr := gitRun(dir, "merge-base", "--is-ancestor", "HEAD", rb); aerr == nil {
			return "", fmt.Errorf("最近一次提交已经推送到远端，撤销会导致本地与远端分叉；请先在远端处理或改用强制推送")
		}
	}
	if out, err := gitRun(dir, "rev-parse", "--verify", "--quiet", "HEAD~1"); err != nil || strings.TrimSpace(out) == "" {
		return "", fmt.Errorf("仓库只有一个提交，撤销后会变成空仓库，暂不支持")
	}
	if out, err := gitRunLogged(dir, "reset", "--mixed", "HEAD~1"); err != nil {
		return out, fmt.Errorf("撤销提交失败: %s", out)
	}
	return "已撤销最近一次提交，文件内容保留为未提交状态。", nil
}

// SetRemote 设置 origin 地址；传空串则移除。
func (g *GitService) SetRemote(url string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	dir := dataDir()
	if strings.TrimSpace(url) == "" {
		_, _ = gitRun(dir, "remote", "remove", "origin")
		return nil
	}
	if _, err := gitRun(dir, "remote", "get-url", "origin"); err == nil {
		if out, err := gitRun(dir, "remote", "set-url", "origin", url); err != nil {
			return fmt.Errorf("更新 remote 失败: %s", out)
		}
		return nil
	}
	if out, err := gitRun(dir, "remote", "add", "origin", url); err != nil {
		return fmt.Errorf("设置 remote 失败: %s", out)
	}
	return nil
}
