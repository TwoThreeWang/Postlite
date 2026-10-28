package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestSetDataDirMigration 验证：切换数据目录后 dataDir() 生效、数据文件被迁移、
// 空串恢复默认。t.Setenv 隔离 %AppData%，不会碰真实数据。
func TestSetDataDirMigration(t *testing.T) {
	t.Setenv("AppData", t.TempDir())

	// 在默认目录造数据
	base := defaultDataDir()
	if err := os.MkdirAll(filepath.Join(base, "collections"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(base, "environments"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "collections", "a.json"), []byte(`{"id":"a"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "history.json"), []byte(`[]`), 0o644); err != nil {
		t.Fatal(err)
	}

	s := &SettingsService{}

	// 切换到自定义目录
	target := filepath.Join(t.TempDir(), "custom")
	info, err := s.SetDataDir(target)
	if err != nil {
		t.Fatal(err)
	}
	if !info.DataDirIsCustom {
		t.Fatal("expected DataDirIsCustom=true")
	}
	if filepath.Clean(dataDir()) != filepath.Clean(target) {
		t.Fatalf("dataDir() = %s, want %s", dataDir(), target)
	}
	// 迁移产物
	for _, p := range []string{
		filepath.Join(target, "history.json"),
		filepath.Join(target, "collections", "a.json"),
	} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("migrated file missing: %s", p)
		}
	}

	// 恢复默认
	info, err = s.SetDataDir("")
	if err != nil {
		t.Fatal(err)
	}
	if info.DataDirIsCustom {
		t.Fatal("expected DataDirIsCustom=false after reset")
	}
	if filepath.Clean(dataDir()) != filepath.Clean(base) {
		t.Fatalf("dataDir() = %s, want default %s", dataDir(), base)
	}
	if _, err := os.Stat(overrideFile()); !os.IsNotExist(err) {
		t.Fatal("override file should be removed after reset")
	}
}
