package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestDetachedHeadRecovery 验证游离 HEAD 的自动恢复：
// 同提交切回 / 分支落后快进 / 分叉拒绝，且恢复后提交都能正常工作。
func TestDetachedHeadRecovery(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not in PATH")
	}
	t.Setenv("AppData", t.TempDir())

	dir := dataDir()
	if err := os.MkdirAll(filepath.Join(dir, "collections"), 0o755); err != nil {
		t.Fatal(err)
	}
	aJSON := filepath.Join(dir, "collections", "a.json")
	mustGit(t, dir, "init", "-b", "master")
	mustGit(t, dir, "config", "user.email", "t@example.com")
	mustGit(t, dir, "config", "user.name", "t")
	ensureGitIgnore(dir, "history.json", "settings.json", "session.json", "*.tmp")

	write := func(content string) {
		if err := os.WriteFile(aJSON, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	onBranch := func(want string) {
		t.Helper()
		if out := strings.TrimSpace(must(gitRun(dir, "rev-parse", "--abbrev-ref", "HEAD"))); out != want {
			t.Fatalf("HEAD 应在 %s，got %q", want, out)
		}
	}

	// c1 提交后游离到同一提交
	write("v1\n")
	mustGit(t, dir, "add", "-A")
	mustGit(t, dir, "commit", "-m", "c1")
	mustGit(t, dir, "checkout", "--detach")
	if st, _ := (&GitService{}).Status(); !st.Detached {
		t.Fatal("checkout --detach 后 Status().Detached 应为 true")
	}

	g := &GitService{}

	// ① 游离在同一提交：Commit 应先切回 master 再提交
	write("v2\n")
	if _, err := g.Commit("c2 on branch"); err != nil {
		t.Fatalf("Commit 失败: %v", err)
	}
	onBranch("master")
	if st, _ := g.Status(); st.Detached {
		t.Fatal("恢复后 Detached 应为 false")
	}

	// ② 分支落后于游离提交：先在游离态提交 c3（父提交=c2=master），再 Commit
	mustGit(t, dir, "checkout", "--detach") // 游离到 c2（master 当前指向）
	write("v3\n")
	mustGit(t, dir, "commit", "-am", "c3 detached")
	if _, err := g.Commit("c4 on branch"); err != nil {
		t.Fatalf("快进恢复后 Commit 失败: %v", err)
	}
	onBranch("master")
	b, _ := os.ReadFile(aJSON)
	if strings.TrimSpace(string(b)) != "v3" {
		t.Fatalf("master 内容 = %q, want v3", string(b))
	}
	// c3（游离提交）必须已被 master 包含，不能丢
	if out := strings.TrimSpace(must(gitRun(dir, "log", "--oneline", "master"))); !strings.Contains(out, "c3 detached") {
		t.Fatalf("游离提交 c3 丢失: %s", out)
	}

	// ③ 分叉：游离提交与 master 各有对方没有的提交 → 拒绝
	mustGit(t, dir, "checkout", "--detach", "master~1") // 游离到 c3
	write("v4\n")
	mustGit(t, dir, "commit", "-am", "c5 diverged") // c5 的父是 c3，与 master(c4) 分叉
	if _, err := g.Commit("c6 should fail"); err == nil {
		t.Fatal("分叉时 Commit 应报错")
	}
	// 拒绝后游离提交仍在，没被丢弃
	if out := strings.TrimSpace(must(gitRun(dir, "log", "--oneline", "HEAD"))); !strings.Contains(out, "c5 diverged") {
		t.Fatal("分叉拒绝后游离提交丢失")
	}
	onBranch("HEAD") // 仍处于游离态（保持现场等用户手动处理）
}

// TestRebaseInProgressGuard 验证：有中断的 rebase 残留时，提交/拉取必须拒绝，
// 避免把快照提交挂到 rebase 停留的游离点上（真实事故：auto-commit 落在 rebasing 现场）。
func TestRebaseInProgressGuard(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not in PATH")
	}
	t.Setenv("AppData", t.TempDir())

	dir := dataDir()
	if err := os.MkdirAll(filepath.Join(dir, "collections"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustGit(t, dir, "init", "-b", "master")
	mustGit(t, dir, "config", "user.email", "t@example.com")
	mustGit(t, dir, "config", "user.name", "t")
	ensureGitIgnore(dir, "history.json", "settings.json", "session.json", "*.tmp")
	if err := os.WriteFile(filepath.Join(dir, "collections", "a.json"), []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, dir, "add", "-A")
	mustGit(t, dir, "commit", "-m", "c1")

	// 模拟 rebase 残留：手工创建 .git/rebase-merge 目录 + 游离 HEAD
	mustGit(t, dir, "checkout", "--detach")
	rbDir := filepath.Join(dir, ".git", "rebase-merge")
	if err := os.MkdirAll(rbDir, 0o755); err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(rbDir)

	if !rebaseInProgress(dir) {
		t.Fatal("rebaseInProgress 应检测到 .git/rebase-merge")
	}
	g := &GitService{}
	if _, err := g.Commit("should fail"); err == nil {
		t.Fatal("rebase 残留时 Commit 应报错")
	}
	if _, err := g.Pull(); err == nil {
		t.Fatal("rebase 残留时 Pull 应报错")
	}
	if _, err := g.Push(); err == nil {
		t.Fatal("rebase 残留时 Push 应报错")
	}
	// 报错后游离提交与工作区原样保留
	if out := strings.TrimSpace(must(gitRun(dir, "log", "--oneline", "HEAD"))); !strings.Contains(out, "c1") {
		t.Fatal("rebase 残留拒绝后提交丢失")
	}
}
