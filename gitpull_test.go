package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// TestPullAutoCommitBeforeRebase 验证：工作区有未提交变更时 Pull 会先自动提交本地快照，
// 再成功 rebase 拉取远端新提交（回归 "cannot pull with rebase: You have unstaged changes"）。
// isolateDataDir 隔离数据目录，全程使用临时目录，不碰真实数据。
func TestPullAutoCommitBeforeRebase(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not in PATH")
	}
	isolateDataDir(t)

	dir := dataDir()
	if err := os.MkdirAll(filepath.Join(dir, "collections"), 0o755); err != nil {
		t.Fatal(err)
	}
	aJSON := filepath.Join(dir, "collections", "a.json")

	// 本地仓库：init -b master + 初始提交
	if out, err := gitRun(dir, "init", "-b", "master"); err != nil {
		t.Fatalf("git init: %s", out)
	}
	mustGit(t, dir, "config", "user.email", "t@example.com")
	mustGit(t, dir, "config", "user.name", "t")
	if err := os.WriteFile(aJSON, []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, dir, "add", "-A")
	mustGit(t, dir, "commit", "-m", "init")

	// 裸远端（file:/// 形式，避免 Windows 路径被当 scp 语法）
	bare := filepath.Join(t.TempDir(), "remote.git")
	mustGit(t, dir, "clone", "--bare", dir, bare)
	bareURL := "file:///" + strings.ReplaceAll(bare, "\\", "/")

	// 第二个工作克隆模拟另一台机器：改 a.json → v2，提交并推送
	work2 := filepath.Join(t.TempDir(), "w2")
	if err := os.MkdirAll(work2, 0o755); err != nil { // gitRun 的 cmd.Dir 必须已存在
		t.Fatal(err)
	}
	mustGit(t, work2, "clone", bareURL, work2)
	mustGit(t, work2, "config", "user.email", "t@example.com")
	mustGit(t, work2, "config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(work2, "collections", "a.json"), []byte("v2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, work2, "commit", "-am", "remote change")
	mustGit(t, work2, "push", "origin", "master")

	// 本地仓库：配置 origin + upstream，并制造未提交变更
	mustGit(t, dir, "remote", "add", "origin", bareURL)
	mustGit(t, dir, "fetch", "origin")
	mustGit(t, dir, "branch", "--set-upstream-to=origin/master", "master")
	if err := os.WriteFile(filepath.Join(dir, "collections", "local.json"), []byte("local\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Pull：脏工作区 → 应自动提交快照并成功拉取远端 v2
	g := &GitService{}
	msg, err := g.Pull()
	if err != nil {
		t.Fatalf("Pull 失败: %v\n%s", err, msg)
	}
	if !strings.Contains(msg, "已自动提交本地快照") {
		t.Fatalf("返回信息缺少自动提交提示: %s", msg)
	}

	// 远端内容到达本地（Windows 下 autocrlf 可能转成 CRLF，归一化后比较）
	b, err := os.ReadFile(aJSON)
	if err != nil || strings.TrimSpace(string(b)) != "v2" {
		t.Fatalf("a.json = %q (err=%v), want v2", string(b), err)
	}
	// 本地未提交的文件随自动快照保留
	if _, err := os.Stat(filepath.Join(dir, "collections", "local.json")); err != nil {
		t.Fatal("本地未提交文件丢失")
	}

	// 工作区干净时再拉取：直接成功且无自动提交提示
	msg2, err := g.Pull()
	if err != nil {
		t.Fatalf("第二次 Pull 失败: %v\n%s", err, msg2)
	}
	if strings.Contains(msg2, "已自动提交本地快照") {
		t.Fatalf("干净工作区不应自动提交: %s", msg2)
	}
}

func mustGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	if out, err := gitRun(dir, args...); err != nil {
		t.Fatalf("git %v: %v\nout=%q", args, err, out)
	}
}

// TestGitLogSink 验证 gitRunLogged 会把命令与输出推送到注入的日志通道。
func TestGitLogSink(t *testing.T) {
	isolateDataDir(t)
	dir := dataDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	mustGit(t, dir, "init", "-b", "master")
	mustGit(t, dir, "config", "user.email", "t@example.com")
	mustGit(t, dir, "config", "user.name", "t")

	var mu sync.Mutex
	var lines []string
	SetGitLogSink(func(line string) {
		mu.Lock()
		lines = append(lines, line)
		mu.Unlock()
	})
	defer SetGitLogSink(nil)

	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := gitRunLogged(dir, "add", "-A"); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, "$ git add -A") {
		t.Fatalf("日志缺少命令行: %q", joined)
	}
}
