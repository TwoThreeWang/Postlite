package main

// Postman 云端同步：通过官方 API（api.getpostman.com + X-Api-Key）拉取
// 账号下的集合与环境。集合返回标准 v2.1 JSON，复用 parsePostmanCollection；
// 环境返回 {"environment": {...}} 包装，剥壳后复用 parsePostmanEnvironment。
// 同名策略：本地已有同名集合/环境则覆盖更新（保留本地 ID），否则新建。

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const postmanAPIBase = "https://api.getpostman.com"

// postmanLogSink 同步过程的实时日志通道（main.go 注入 Wails 事件；测试可注入收集器）。
var postmanLogSink atomic.Value // func(string)

// SetPostmanLogSink 注入日志输出函数；传 nil 关闭。
func SetPostmanLogSink(fn func(string)) {
	if fn == nil {
		postmanLogSink.Store(func(string) {})
		return
	}
	postmanLogSink.Store(fn)
}

func emitPMLog(line string) {
	if fn, ok := postmanLogSink.Load().(func(string)); ok {
		fn(line)
	}
}

type PostmanService struct {
	mu sync.Mutex
}

// PostmanRemoteItem 远端集合/环境清单条目。
type PostmanRemoteItem struct {
	UID  string `json:"uid"`
	Name string `json:"name"`
}

// PostmanRemoteList 远端清单（集合 + 环境两组）。
type PostmanRemoteList struct {
	Collections  []PostmanRemoteItem `json:"collections"`
	Environments []PostmanRemoteItem `json:"environments"`
}

// PostmanSyncResult 一次全量同步的结果明细。
type PostmanSyncResult struct {
	Updated []string `json:"updated"`
	Created []string `json:"created"`
	Failed  []string `json:"failed"`
}

// pmClient 带代理设置的 HTTP 客户端（复用 settings 里的 proxy）。
func pmClient() *http.Client {
	transport := &http.Transport{}
	if p := currentProxy(); p != "" {
		if pu, err := url.Parse(p); err == nil {
			transport.Proxy = http.ProxyURL(pu)
		}
	} else {
		transport.Proxy = nil // 显式直连，忽略环境变量代理
	}
	return &http.Client{Timeout: 30 * time.Second, Transport: transport}
}

// pmGet 调用 Postman API 并返回响应体；非 200 时把响应体摘要放进错误。
func pmGet(path, key string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, postmanAPIBase+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Api-Key", key)
	req.Header.Set("User-Agent", "Postlite/"+appVersion)
	resp, err := pmClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 Postman API 失败: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		if resp.StatusCode == http.StatusUnauthorized {
			return nil, fmt.Errorf("API Key 无效或已过期（401），请到 postman.com → Settings → API Keys 重新生成")
		}
		return nil, fmt.Errorf("Postman API 返回 %d: %s", resp.StatusCode, snippet)
	}
	return body, nil
}

// ListRemote 拉取远端集合与环境清单。
func (p *PostmanService) ListRemote() (PostmanRemoteList, error) {
	key := currentPostmanKey()
	if key == "" {
		return PostmanRemoteList{}, fmt.Errorf("请先在设置里填写 Postman API Key")
	}
	var out PostmanRemoteList
	// 集合清单
	if body, err := pmGet("/collections", key); err != nil {
		return out, err
	} else if err := json.Unmarshal(body, &out); err != nil {
		return out, fmt.Errorf("解析集合清单失败: %v", err)
	}
	// 环境清单（{"environments": [...]}，字段同为 uid/name）
	var envs struct {
		Environments []PostmanRemoteItem `json:"environments"`
	}
	if body, err := pmGet("/environments", key); err != nil {
		return out, err
	} else if err := json.Unmarshal(body, &envs); err != nil {
		return out, fmt.Errorf("解析环境清单失败: %v", err)
	}
	out.Environments = envs.Environments
	return out, nil
}

// SyncAll 全量拉取：远端每个集合/环境都下载、解析、按同名覆盖或新建。
// 单个失败不影响其余，失败原因汇总在 Failed 里返回。
func (p *PostmanService) SyncAll() (PostmanSyncResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	key := currentPostmanKey()
	if key == "" {
		return PostmanSyncResult{}, fmt.Errorf("请先在设置里填写 Postman API Key")
	}
	res := PostmanSyncResult{Updated: []string{}, Created: []string{}, Failed: []string{}}

	// ---- 集合 ----
	var colList struct {
		Collections []PostmanRemoteItem `json:"collections"`
	}
	body, err := pmGet("/collections", key)
	if err != nil {
		return res, err
	}
	if err := json.Unmarshal(body, &colList); err != nil {
		return res, fmt.Errorf("解析集合清单失败: %v", err)
	}
	cols, _ := new(CollectionService).List()
	colByName := map[string]string{} // name -> 本地 id
	for _, c := range cols {
		colByName[c.Name] = c.ID
	}
	emitPMLog(fmt.Sprintf("开始拉取 %d 个集合…", len(colList.Collections)))
	for i, rc := range colList.Collections {
		emitPMLog(fmt.Sprintf("集合 (%d/%d) %s …", i+1, len(colList.Collections), rc.Name))
		isNew, err := p.syncCollection(key, rc, colByName)
		if err != nil {
			emitPMLog("✗ " + rc.Name + "：" + err.Error())
			res.Failed = append(res.Failed, "集合 "+rc.Name+": "+err.Error())
			continue
		}
		if isNew == "" {
			emitPMLog("✓ " + rc.Name + "（已更新）")
			res.Updated = append(res.Updated, rc.Name)
		} else {
			emitPMLog("✓ " + rc.Name + "（已新建）")
			res.Created = append(res.Created, rc.Name)
		}
	}

	// ---- 环境 ----
	var envList struct {
		Environments []PostmanRemoteItem `json:"environments"`
	}
	body, err = pmGet("/environments", key)
	if err != nil {
		return res, err
	}
	if err := json.Unmarshal(body, &envList); err != nil {
		return res, fmt.Errorf("解析环境清单失败: %v", err)
	}
	envs, _ := new(EnvironmentService).List()
	envByName := map[string]string{}
	for _, e := range envs {
		envByName[e.Name] = e.ID
	}
	emitPMLog(fmt.Sprintf("集合拉取完成，开始拉取 %d 个环境…", len(envList.Environments)))
	for i, re := range envList.Environments {
		emitPMLog(fmt.Sprintf("环境 (%d/%d) %s …", i+1, len(envList.Environments), re.Name))
		isNew, err := p.syncEnvironment(key, re, envByName)
		if err != nil {
			emitPMLog("✗ " + re.Name + "：" + err.Error())
			res.Failed = append(res.Failed, "环境 "+re.Name+": "+err.Error())
			continue
		}
		if isNew {
			emitPMLog("✓ " + re.Name + "（已新建）")
			res.Created = append(res.Created, re.Name)
		} else {
			emitPMLog("✓ " + re.Name + "（已更新）")
			res.Updated = append(res.Updated, re.Name)
		}
	}
	emitPMLog(fmt.Sprintf("拉取完成：更新 %d、新建 %d、失败 %d", len(res.Updated), len(res.Created), len(res.Failed)))
	return res, nil
}

// syncCollection 下载并导入一个远端集合。返回值：isNew 时带集合名，更新时为空串。
func (p *PostmanService) syncCollection(key string, rc PostmanRemoteItem, colByName map[string]string) (string, error) {
	// {"collection": {...v2.1...}}
	var wrap struct {
		Collection json.RawMessage `json:"collection"`
	}
	body, err := pmGet("/collections/"+url.PathEscape(rc.UID), key)
	if err != nil {
		return "", err
	}
	if err := json.Unmarshal(body, &wrap); err != nil || len(wrap.Collection) == 0 {
		return "", fmt.Errorf("响应缺少 collection 字段")
	}
	col, err := parsePostmanCollection(wrap.Collection)
	if err != nil {
		return "", err
	}
	if id, ok := colByName[rc.Name]; ok {
		col.ID = id // 同名：覆盖更新，保留本地 ID
	}
	cs := &CollectionService{}
	if err := cs.Save(col); err != nil {
		return "", fmt.Errorf("保存失败: %v", err)
	}
	if _, existed := colByName[rc.Name]; existed {
		return "", nil
	}
	return col.Name, nil
}

// syncEnvironment 下载并导入一个远端环境。返回是否新建。
func (p *PostmanService) syncEnvironment(key string, re PostmanRemoteItem, envByName map[string]string) (bool, error) {
	// {"environment": {"name": ..., "values": [...]}}
	var wrap struct {
		Environment json.RawMessage `json:"environment"`
	}
	body, err := pmGet("/environments/"+url.PathEscape(re.UID), key)
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(body, &wrap); err != nil || len(wrap.Environment) == 0 {
		return false, fmt.Errorf("响应缺少 environment 字段")
	}
	env, err := parsePostmanEnvironment(wrap.Environment)
	if err != nil {
		return false, err
	}
	es := &EnvironmentService{}
	_, existed := envByName[re.Name]
	if id, ok := envByName[re.Name]; ok {
		env.ID = id // 同名：覆盖更新，保留本地 ID
	}
	if err := es.Save(env); err != nil {
		return false, fmt.Errorf("保存失败: %v", err)
	}
	return !existed, nil
}
