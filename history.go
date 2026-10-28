package main

// 请求历史：一份 JSON 文件，最新的在最前，超过上限丢弃最旧记录。

import (
	"os"
	"path/filepath"
	"sync"
	"time"
)

const historyCap = 200

type HistoryService struct {
	mu sync.Mutex
}

func historyFile() string {
	return filepath.Join(dataDir(), "history.json")
}

// List 返回全部历史（新在前）。没有历史文件不算错误。
func (h *HistoryService) List() ([]HistoryEntry, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []HistoryEntry
	if err := loadJSONFile(historyFile(), &out); err != nil {
		return []HistoryEntry{}, nil
	}
	return out, nil
}

// Add 记录一次请求（发送后由前端调用），返回新条目。
func (h *HistoryService) Add(spec RequestSpec, resp ResponseResult) (HistoryEntry, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	var list []HistoryEntry
	_ = loadJSONFile(historyFile(), &list)

	entry := HistoryEntry{
		ID:         newID(),
		Time:       time.Now().Format(time.RFC3339),
		Method:     spec.Method,
		URL:        spec.URL,
		StatusCode: resp.StatusCode,
		OK:         resp.Ok,
		DurationMs: resp.DurationMs,
		Spec:       spec,
		Vars:       []KeyValue{},
	}
	list = append([]HistoryEntry{entry}, list...)
	if len(list) > historyCap {
		list = list[:historyCap]
	}
	if err := saveJSONFile(historyFile(), list); err != nil {
		return HistoryEntry{}, err
	}
	return entry, nil
}

// Clear 清空历史。
func (h *HistoryService) Clear() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if err := os.Remove(historyFile()); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
