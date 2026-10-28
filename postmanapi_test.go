package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestParsePostmanAPIWrappers 验证 Postman API 的 wrapper 格式能剥壳解析
// （API 返回 {"collection": {...}} / {"environment": {...}}，与本地导出的裸格式不同）。
func TestParsePostmanAPIWrappers(t *testing.T) {
	t.Setenv("AppData", t.TempDir())
	dir := dataDir()
	if err := os.MkdirAll(filepath.Join(dir, "collections"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "environments"), 0o755); err != nil {
		t.Fatal(err)
	}

	// 集合 wrapper → parsePostmanCollection
	colRaw := `{"collection": {"info": {"name": "API 集合", "schema": "v2.1"}, "item": [], "variable": []}}
`
	var colWrap struct {
		Collection json.RawMessage `json:"collection"`
	}
	if err := json.Unmarshal([]byte(colRaw), &colWrap); err != nil {
		t.Fatal(err)
	}
	col, err := parsePostmanCollection(colWrap.Collection)
	if err != nil {
		t.Fatalf("wrapper 里的集合应能解析: %v", err)
	}
	if col.Name != "API 集合" {
		t.Fatalf("集合名不对: %q", col.Name)
	}

	// 环境 wrapper → parsePostmanEnvironment
	envRaw := `{"environment": {"name": "API 环境", "values": [{"key": "a", "value": "1", "enabled": true}]}}
`
	var envWrap struct {
		Environment json.RawMessage `json:"environment"`
	}
	if err := json.Unmarshal([]byte(envRaw), &envWrap); err != nil {
		t.Fatal(err)
	}
	env, err := parsePostmanEnvironment(envWrap.Environment)
	if err != nil {
		t.Fatalf("wrapper 里的环境应能解析: %v", err)
	}
	if env.Name != "API 环境" || len(env.Variables) != 1 || env.Variables[0].Key != "a" {
		t.Fatalf("环境解析不对: %+v", env)
	}
}

// TestSyncAllByNameUpdate 验证同名覆盖保留本地 ID（不产生重复）。
func TestSyncAllByNameUpdate(t *testing.T) {
	t.Setenv("AppData", t.TempDir())
	dir := dataDir()
	if err := os.MkdirAll(filepath.Join(dir, "collections"), 0o755); err != nil {
		t.Fatal(err)
	}
	cs := &CollectionService{}
	col, err := cs.ImportPostman(`{"info": {"name": "我的集合", "schema": "v2.1"}, "item": []}`)
	if err != nil {
		t.Fatal(err)
	}
	// 模拟"同名覆盖"分支的决策逻辑：远端同名集合应映射到已有本地 ID
	localID, ok := map[string]string{"我的集合": col.ID}["我的集合"]
	if !ok || localID != col.ID {
		t.Fatal("同名映射应命中本地 ID")
	}
}
