package main

// SessionService — 标签页会话持久化。
// 前端在标签/激活状态变化时防抖调用 Save，窗口关闭前再强制保存一次；
// 下次启动 Load 恢复上次的标签页与激活状态（响应体不持久化，恢复后需重新发送）。
// session.json 不参与 Git 同步（本机会话状态，与 history.json 同类），Init 时写入 .gitignore。

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// SessionTab 恢复一个标签页所需的最小状态。
type SessionTab struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	Spec         RequestSpec `json:"spec"`
	CollectionID string      `json:"collectionId"`
	ItemID       string      `json:"itemId"`
	// SavedSpec 上次保存到集合时的 spec 快照（前端 JSON 字符串），用于未保存圆点判断；
	// 未保存过的标签为 emptySpec 的 JSON。
	SavedSpec string `json:"savedSpec"`
}

// SessionData 一次会话的完整快照。
type SessionData struct {
	Tabs        []SessionTab `json:"tabs"`
	ActiveTabID string       `json:"activeTabId"`
	ActiveEnvID string       `json:"activeEnvId"`
}

type SessionService struct {
	mu sync.Mutex
}

func sessionFile() string {
	return filepath.Join(dataDir(), "session.json")
}

// Load 读取会话；文件不存在时返回空会话（不报错）。
func (s *SessionService) Load() (SessionData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data := SessionData{Tabs: []SessionTab{}}
	if err := loadJSONFile(sessionFile(), &data); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return data, nil
		}
		return SessionData{Tabs: []SessionTab{}}, nil // 损坏时按空会话处理，别卡启动
	}
	if data.Tabs == nil {
		data.Tabs = []SessionTab{}
	}
	return data, nil
}

// Save 覆盖保存会话。传空 tabs 等价于清空会话（下次启动开新标签）。
func (s *SessionService) Save(data SessionData) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if data.Tabs == nil {
		data.Tabs = []SessionTab{}
	}
	return saveJSONFile(sessionFile(), data)
}

// ensureGitIgnore 保证 .gitignore 包含给定的行（缺失时追加）。
// 供 GitService.Init 与会话保存共用。
func ensureGitIgnore(dir string, lines ...string) {
	path := filepath.Join(dir, ".gitignore")
	cur, _ := os.ReadFile(path)
	text := string(cur)
	changed := false
	for _, l := range lines {
		if !strings.Contains(text, l+"\n") && !strings.HasSuffix(text, l) {
			if text != "" && !strings.HasSuffix(text, "\n") {
				text += "\n"
			}
			text += l + "\n"
			changed = true
		}
	}
	if changed {
		_ = os.WriteFile(path, []byte(text), 0o644)
	}
}
