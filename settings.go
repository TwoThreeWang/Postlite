package main

// 应用设置：一份 JSON 文件持久化；附带调试入口（DevTools / 数据目录）。

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const appVersion = "0.1.3"

// Settings 前端可改的偏好项；新增字段记得同步 lib.ts 的 SettingsT。
type Settings struct {
	RecordHistory   bool   `json:"recordHistory"`
	ShowLineNumbers bool   `json:"showLineNumbers"`
	Theme           string `json:"theme"` // dark | light
	Proxy           string `json:"proxy"` // HTTP 代理地址（如 http://127.0.0.1:7890）；空 = 不走代理
	// PostmanApiKey Postman 云端同步用的 API Key（postman.com → Settings → API Keys 生成）。
	// settings.json 在 .gitignore 里，密钥不会被 Git 同步出去。
	PostmanApiKey string `json:"postmanApiKey"`
}

func defaultSettings() Settings {
	return Settings{RecordHistory: true, ShowLineNumbers: true, Theme: "dark"}
}

// currentProxy 供请求引擎读取代理设置（不经 service 锁，直接读文件，容忍错误）。
func currentProxy() string {
	var st Settings
	if b, err := os.ReadFile(settingsFile()); err == nil {
		_ = json.Unmarshal(b, &st)
	}
	return strings.TrimSpace(st.Proxy)
}

// currentPostmanKey 供 Postman 云端同步读取 API Key（直接读文件，容忍错误）。
func currentPostmanKey() string {
	var st Settings
	if b, err := os.ReadFile(settingsFile()); err == nil {
		_ = json.Unmarshal(b, &st)
	}
	return strings.TrimSpace(st.PostmanApiKey)
}

type SettingsService struct {
	mu sync.Mutex
}

func settingsFile() string {
	return filepath.Join(dataDir(), "settings.json")
}

// Get 读取设置；文件缺失或损坏时返回默认值。
func (s *SettingsService) Get() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := defaultSettings()
	b, err := os.ReadFile(settingsFile())
	if err != nil {
		return st
	}
	_ = json.Unmarshal(b, &st) // 部分字段缺失时保留默认值
	return st
}

// Save 覆盖保存设置。
func (s *SettingsService) Save(st Settings) (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.MarshalIndent(st, "", "  ")
	if err == nil {
		err = os.WriteFile(settingsFile(), b, 0o644)
	}
	if err != nil {
		return Settings{}, err
	}
	return st, nil
}

// AppInfo 关于信息。
type AppInfo struct {
	Version         string `json:"version"`
	DataDir         string `json:"dataDir"`
	DefaultDataDir  string `json:"defaultDataDir"`
	DataDirIsCustom bool   `json:"dataDirIsCustom"`
}

func (s *SettingsService) AppInfo() AppInfo {
	def := defaultDataDir()
	cur := dataDir()
	return AppInfo{
		Version:         appVersion,
		DataDir:         cur,
		DefaultDataDir:  def,
		DataDirIsCustom: filepath.Clean(cur) != filepath.Clean(def),
	}
}

// SetDataDir 自定义数据目录；传空串恢复默认。
// 切换时把旧目录的集合/环境/历史/设置迁移到新目录（目标已存在的文件不覆盖）。
func (s *SettingsService) SetDataDir(path string) (AppInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	path = strings.TrimSpace(path)
	if path == "" {
		_ = os.Remove(overrideFile())
		return s.AppInfo(), nil
	}
	if !filepath.IsAbs(filepath.Clean(path)) {
		return s.AppInfo(), errors.New("必须是绝对路径")
	}
	if err := os.MkdirAll(filepath.Join(path, "collections"), 0o755); err != nil {
		return s.AppInfo(), err
	}
	if err := os.MkdirAll(filepath.Join(path, "environments"), 0o755); err != nil {
		return s.AppInfo(), err
	}
	from := dataDir()
	if filepath.Clean(from) != filepath.Clean(path) {
		copyIfMissing := func(src, dst string) {
			data, err := os.ReadFile(src)
			if err != nil {
				return // 源不存在就跳过
			}
			if _, statErr := os.Stat(dst); os.IsNotExist(statErr) {
				_ = os.WriteFile(dst, data, 0o644)
			}
		}
		copyIfMissing(filepath.Join(from, "history.json"), filepath.Join(path, "history.json"))
		copyIfMissing(filepath.Join(from, "settings.json"), filepath.Join(path, "settings.json"))
		copyIfMissing(filepath.Join(from, "session.json"), filepath.Join(path, "session.json"))
		for _, sub := range []string{"collections", "environments"} {
			entries, _ := os.ReadDir(filepath.Join(from, sub))
			for _, e := range entries {
				if !e.IsDir() {
					copyIfMissing(filepath.Join(from, sub, e.Name()), filepath.Join(path, sub, e.Name()))
				}
			}
		}
	}
	if err := os.WriteFile(overrideFile(), []byte(path), 0o644); err != nil {
		return s.AppInfo(), err
	}
	return s.AppInfo(), nil
}

// ChooseDataDir 弹出原生目录选择框；取消返回空串。
func (s *SettingsService) ChooseDataDir() (string, error) {
	dlg := application.Get().Dialog.OpenFile()
	dlg.CanChooseDirectories(true)
	dlg.CanChooseFiles(false)
	dlg.SetTitle("选择数据目录")
	return dlg.PromptForSingleSelection()
}

// OpenDevTools 打开 WebView2 开发者工具（等价浏览器 F12）。
// 注意：正式构建需带 devtools 标签（-tags "production,devtools"），否则是空操作。
func (s *SettingsService) OpenDevTools() {
	if w := application.Get().Window.Current(); w != nil {
		w.OpenDevTools()
	}
}

// OpenDataDir 在资源管理器中打开数据目录。
func (s *SettingsService) OpenDataDir() error {
	return exec.Command("explorer", dataDir()).Start()
}
