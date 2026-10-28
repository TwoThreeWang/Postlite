package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// 数据目录：<UserConfigDir>/postlite
// 集合与环境都是「一份数据一个 JSON 文件」，为后续 Git 同步打基础。
// 可通过 <默认目录>/datadir.txt 覆盖（内容为绝对路径；删除该文件恢复默认）。
func defaultDataDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = "."
	}
	return filepath.Join(base, "postlite")
}

func overrideFile() string {
	return filepath.Join(defaultDataDir(), "datadir.txt")
}

func dataDir() string {
	dir := defaultDataDir()
	if b, err := os.ReadFile(overrideFile()); err == nil {
		if p := filepath.Clean(strings.TrimSpace(string(b))); filepath.IsAbs(p) {
			dir = p
		}
	}
	_ = os.MkdirAll(filepath.Join(dir, "collections"), 0o755)
	_ = os.MkdirAll(filepath.Join(dir, "environments"), 0o755)
	return dir
}

var unsafeNameRe = regexp.MustCompile(`[\\/:*?"<>|]`)

func safeFileName(s string) string {
	s = unsafeNameRe.ReplaceAllString(s, "-")
	s = strings.TrimSpace(s)
	if s == "" {
		s = "untitled"
	}
	return s
}

func loadJSONFile(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

func saveJSONFile(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// ---------------------------------------------------------------- RequestService

type RequestService struct{}

// Send 执行 HTTP 请求。vars = 集合变量 + 当前环境变量（由前端合并后传入）。
func (r *RequestService) Send(spec RequestSpec, vars []KeyValue) ResponseResult {
	return sendRequest(spec, vars)
}

// ParseCurl 把 cURL 命令解析成可编辑的请求。
func (r *RequestService) ParseCurl(cmd string) (RequestSpec, error) {
	return ParseCurl(cmd)
}

// ---------------------------------------------------------------- CollectionService

type CollectionService struct {
	mu sync.Mutex
}

func (c *CollectionService) List() ([]Collection, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	dir := filepath.Join(dataDir(), "collections")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Collection, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		var col Collection
		if err := loadJSONFile(filepath.Join(dir, e.Name()), &col); err != nil {
			continue // 单个文件损坏不影响其他集合
		}
		out = append(out, col)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (c *CollectionService) Save(col Collection) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if col.ID == "" {
		col.ID = newID()
	}
	return saveJSONFile(filepath.Join(dataDir(), "collections", col.ID+".json"), col)
}

func (c *CollectionService) Delete(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if id == "" || strings.ContainsAny(id, `/\`) {
		return errors.New("非法的集合 ID")
	}
	return os.Remove(filepath.Join(dataDir(), "collections", id+".json"))
}

// NewCollection 新建空集合。
func (c *CollectionService) NewCollection(name string) (Collection, error) {
	col := Collection{
		ID:        newID(),
		Name:      name,
		Root:      Folder{ID: newID(), Name: name},
		Variables: []KeyValue{},
	}
	if err := c.Save(col); err != nil {
		return Collection{}, err
	}
	return col, nil
}

// ImportPostman 导入 Postman v2.x 集合 JSON 并自动保存。
func (c *CollectionService) ImportPostman(jsonText string) (Collection, error) {
	col, err := parsePostmanCollection([]byte(jsonText))
	if err != nil {
		return Collection{}, err
	}
	if err := c.Save(col); err != nil {
		return Collection{}, fmt.Errorf("保存失败: %v", err)
	}
	return col, nil
}

// ImportPostmanEnvironment 导入 Postman 环境导出 JSON（顶层 name + values）。
func (e *EnvironmentService) ImportPostmanEnvironment(jsonText string) (Environment, error) {
	env, err := parsePostmanEnvironment([]byte(jsonText))
	if err != nil {
		return Environment{}, err
	}
	if err := e.Save(env); err != nil {
		return Environment{}, fmt.Errorf("保存失败: %v", err)
	}
	return env, nil
}

// ExportPostman 把全部集合导出为 Postman v2.1 格式 JSON。
// 弹出系统保存对话框选择位置；用户取消时返回空路径。
func (c *CollectionService) ExportPostman() (string, error) {
	cols, err := c.List()
	if err != nil {
		return "", err
	}
	if len(cols) == 0 {
		return "", errors.New("没有可导出的集合")
	}
	data, err := json.MarshalIndent(buildPostmanV21(cols), "", "  ")
	if err != nil {
		return "", err
	}
	dlg := application.Get().Dialog.SaveFile()
	dlg.SetFilename("postlite-export.postman_collection.json")
	dlg.AddFilter("Postman Collection", "*.json")
	path, err := dlg.PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // 用户取消
	}
	if !strings.EqualFold(filepath.Ext(path), ".json") {
		path += ".json"
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

// ---------------------------------------------------------------- EnvironmentService

type EnvironmentService struct {
	mu sync.Mutex
}

func (e *EnvironmentService) List() ([]Environment, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	dir := filepath.Join(dataDir(), "environments")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Environment, 0, len(entries))
	for _, en := range entries {
		if en.IsDir() || !strings.HasSuffix(en.Name(), ".json") {
			continue
		}
		var env Environment
		if err := loadJSONFile(filepath.Join(dir, en.Name()), &env); err != nil {
			continue
		}
		out = append(out, env)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (e *EnvironmentService) Save(env Environment) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if env.ID == "" {
		env.ID = newID()
	}
	return saveJSONFile(filepath.Join(dataDir(), "environments", env.ID+".json"), env)
}

func (e *EnvironmentService) Delete(id string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if id == "" || strings.ContainsAny(id, `/\`) {
		return errors.New("非法的环境 ID")
	}
	return os.Remove(filepath.Join(dataDir(), "environments", id+".json"))
}

// NewEnvironment 新建空环境。
func (e *EnvironmentService) NewEnvironment(name string) (Environment, error) {
	env := Environment{ID: newID(), Name: name, Variables: []KeyValue{}}
	if err := e.Save(env); err != nil {
		return Environment{}, err
	}
	return env, nil
}
