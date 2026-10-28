package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestUndoLastCommit 验证撤销提交：未推送可撤销且文件保留；仅一个提交拒绝；已推送拒绝。
func TestUndoLastCommit(t *testing.T) {
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
	// 预先写 .gitignore 并入库，避免 Status() 的兜底补写干扰变更数断言
	ensureGitIgnore(dir, "history.json", "settings.json", "session.json", "*.tmp")
	if err := os.WriteFile(aJSON, []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, dir, "add", "-A")
	mustGit(t, dir, "commit", "-m", "c1")
	if err := os.WriteFile(aJSON, []byte("v2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mustGit(t, dir, "commit", "-am", "c2")

	g := &GitService{}

	// ① 未推送 → 撤销成功，文件内容保留为未提交状态
	msg, err := g.UndoCommit()
	if err != nil {
		t.Fatalf("UndoCommit 失败: %v\n%s", err, msg)
	}
	b, rerr := os.ReadFile(aJSON)
	if rerr != nil || strings.TrimSpace(string(b)) != "v2" {
		t.Fatalf("撤销后 a.json = %q (err=%v)，内容应保留 v2", string(b), rerr)
	}
	st, _ := g.Status()
	if st.Changes != 1 {
		t.Fatalf("撤销后未提交变更数 = %d，want 1", st.Changes)
	}
	if !strings.Contains(st.LastCommit, "c1") {
		t.Fatalf("撤销后 HEAD 应为 c1，got %q", st.LastCommit)
	}
	if st.LastCommitPushed {
		t.Fatal("c1 未推送，LastCommitPushed 应为 false")
	}

	// ② 只剩一个提交 → 拒绝
	if _, err := g.UndoCommit(); err == nil {
		t.Fatal("只有一个提交时 UndoCommit 应报错")
	}

	// ③ 推送后 → 拒绝撤销
	mustGit(t, dir, "add", "-A")
	mustGit(t, dir, "commit", "-m", "c2 again")
	bare := filepath.Join(t.TempDir(), "remote.git")
	mustGit(t, dir, "clone", "--bare", dir, bare)
	bareURL := "file:///" + strings.ReplaceAll(bare, "\\", "/")
	mustGit(t, dir, "remote", "add", "origin", bareURL)
	mustGit(t, dir, "push", "-u", "origin", "master")

	st2, _ := g.Status()
	if !st2.LastCommitPushed {
		t.Fatalf("推送后 LastCommitPushed 应为 true（lastCommit=%q）", st2.LastCommit)
	}
	if _, err := g.UndoCommit(); err == nil {
		t.Fatal("已推送的提交 UndoCommit 应报错")
	}
}
