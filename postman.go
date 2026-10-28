package main

// Postman Collection v2.x JSON 导入器。
// 只做结构映射：item 树 / request / url(string|object) / header / body 三种模式 / 集合变量。

import (
	"encoding/json"
	"fmt"
	"strings"
)

type pmKV struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Disabled bool   `json:"disabled"`
}

type pmURL struct {
	Raw   string `json:"raw"`
	Query []pmKV `json:"query"`
}

type pmBody struct {
	Mode       string `json:"mode"`
	Raw        string `json:"raw"`
	URLEncoded []pmKV `json:"urlencoded"`
	FormData   []pmKV `json:"formdata"`
}

type pmRequest struct {
	Method string          `json:"method"`
	URL    json.RawMessage `json:"url"` // 可能是字符串或对象
	Header []pmKV          `json:"header"`
	Body   pmBody          `json:"body"`
}

type pmItem struct {
	Name    string          `json:"name"`
	Item    []pmItem        `json:"item"`
	Request json.RawMessage `json:"request"` // 可能是字符串或对象
}

type pmCollection struct {
	Info struct {
		Name   string `json:"name"`
		Schema string `json:"schema"`
	} `json:"info"`
	Item     []pmItem `json:"item"`
	Variable []pmKV   `json:"variable"`
}

// parsePostmanCollection 把 Postman v2.x JSON 解析成 aplite 的 Collection。
func parsePostmanCollection(data []byte) (Collection, error) {
	var pm pmCollection
	if err := json.Unmarshal(data, &pm); err != nil {
		return Collection{}, fmt.Errorf("不是合法的 Postman 集合 JSON: %v", err)
	}
	if pm.Info.Name == "" {
		return Collection{}, fmt.Errorf("缺少 info.name，不像 Postman v2.x 集合格式")
	}

	col := Collection{
		ID:        newID(),
		Name:      pm.Info.Name,
		Root:      Folder{ID: newID(), Name: pm.Info.Name},
		Variables: make([]KeyValue, 0, len(pm.Variable)),
	}
	for _, v := range pm.Variable {
		col.Variables = append(col.Variables, KeyValue{Key: v.Key, Value: v.Value, Enabled: !v.Disabled})
	}
	col.Root.Folders, col.Root.Items = convertItems(pm.Item)
	return col, nil
}

func convertItems(items []pmItem) ([]Folder, []RequestItem) {
	folders := make([]Folder, 0)
	reqs := make([]RequestItem, 0)
	for _, it := range items {
		if len(it.Item) > 0 { // 文件夹
			f := Folder{ID: newID(), Name: it.Name}
			f.Folders, f.Items = convertItems(it.Item)
			folders = append(folders, f)
			continue
		}
		if len(it.Request) > 0 { // 请求
			reqs = append(reqs, convertRequest(it.Name, it.Request))
		}
	}
	return folders, reqs
}

func convertRequest(name string, rawReq json.RawMessage) RequestItem {
	item := RequestItem{ID: newID(), Name: name, Spec: RequestSpec{
		Method:          "GET",
		BodyType:        "none",
		FollowRedirects: true,
		TimeoutSeconds:  60,
	}}

	// request 可能就是一个 URL 字符串
	var asString string
	if err := json.Unmarshal(rawReq, &asString); err == nil {
		item.Spec.URL = strings.TrimSpace(asString)
		return item
	}

	var pr pmRequest
	if err := json.Unmarshal(rawReq, &pr); err != nil {
		return item
	}
	if pr.Method != "" {
		item.Spec.Method = strings.ToUpper(pr.Method)
	}

	// URL：对象时拆出 query；纯字符串时整体放入
	var pu pmURL
	if err := json.Unmarshal(pr.URL, &pu); err == nil && pu.Raw != "" {
		rawURL, queryPart := splitQuery(pu.Raw)
		item.Spec.URL = rawURL
		if len(pu.Query) > 0 {
			item.Spec.QueryParams = pmKVToKV(pu.Query)
		} else if queryPart != "" {
			item.Spec.URL = pu.Raw // 没有 query 明细就保留原样
		}
	} else {
		var s string
		if err := json.Unmarshal(pr.URL, &s); err == nil {
			item.Spec.URL = strings.TrimSpace(s)
		}
	}

	// Header
	if len(pr.Header) > 0 {
		item.Spec.Headers = pmKVToKV(pr.Header)
	}

	// Body
	switch pr.Body.Mode {
	case "raw":
		item.Spec.BodyType = "raw"
		item.Spec.RawBody = pr.Body.Raw
	case "urlencoded":
		item.Spec.BodyType = "urlencoded"
		item.Spec.FormFields = pmKVToKV(pr.Body.URLEncoded)
	case "formdata":
		item.Spec.BodyType = "form"
		item.Spec.FormFields = pmKVToKV(pr.Body.FormData)
	}

	return item
}

func pmKVToKV(in []pmKV) []KeyValue {
	out := make([]KeyValue, 0, len(in))
	for _, kv := range in {
		out = append(out, KeyValue{Key: kv.Key, Value: kv.Value, Enabled: !kv.Disabled})
	}
	return out
}

func splitQuery(raw string) (string, string) {
	if i := strings.IndexByte(raw, '?'); i >= 0 {
		return raw[:i], raw[i+1:]
	}
	return raw, ""
}

// ---------------------------------------------------------------- 环境导入（Postman Environment v2.x）

type pmEnvValue struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	// 注意：Postman 环境文件用 enabled（默认 true），与集合文件的 disabled 相反
	Enabled *bool `json:"enabled"`
}

func (v pmEnvValue) isEnabled() bool {
	return v.Enabled == nil || *v.Enabled
}

type pmEnvironment struct {
	Name   string       `json:"name"`
	Values []pmEnvValue `json:"values"`
	Scope  string       `json:"_postman_variable_scope"`
}

// looksLikePostmanEnvironment 判断 JSON 是否是 Postman 环境文件
// （顶层有 values 数组且无 info，或显式声明 _postman_variable_scope=environment）。
func looksLikePostmanEnvironment(data []byte) bool {
	var probe struct {
		Info  json.RawMessage `json:"info"`
		Scope string          `json:"_postman_variable_scope"`
	}
	if json.Unmarshal(data, &probe) != nil {
		return false
	}
	if probe.Scope == "environment" {
		return true
	}
	var hasValues struct {
		Values json.RawMessage `json:"values"`
	}
	if json.Unmarshal(data, &hasValues) != nil || len(hasValues.Values) == 0 {
		return false
	}
	return len(probe.Info) == 0 // 有 values 且没有 info：环境文件
}

// parsePostmanEnvironment 把 Postman 环境导出 JSON 解析成 aplite 的 Environment。
func parsePostmanEnvironment(data []byte) (Environment, error) {
	var pm pmEnvironment
	if err := json.Unmarshal(data, &pm); err != nil {
		return Environment{}, fmt.Errorf("不是合法的 Postman 环境 JSON: %v", err)
	}
	if strings.TrimSpace(pm.Name) == "" {
		return Environment{}, fmt.Errorf("缺少 name，不像 Postman 环境格式")
	}
	env := Environment{ID: newID(), Name: pm.Name, Variables: make([]KeyValue, 0, len(pm.Values))}
	for _, v := range pm.Values {
		env.Variables = append(env.Variables, KeyValue{Key: v.Key, Value: v.Value, Enabled: v.isEnabled()})
	}
	return env, nil
}

// ---------------------------------------------------------------- 导出（Postman v2.1）

// buildPostmanV21 把集合列表转成 Postman v2.1 兼容结构。
// 每个 Postlite 集合作为顶层 item（文件夹）放入同一个 collection 文件。
func buildPostmanV21(cols []Collection) map[string]any {
	items := make([]map[string]any, 0, len(cols))
	for _, col := range cols {
		items = append(items, map[string]any{
			"name":     col.Name,
			"item":     folderToPostman(col.Root),
			"variable": kvToPostmanVar(col.Variables),
		})
	}
	return map[string]any{
		"info": map[string]any{
			"name":   "Postlite Export",
			"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
		},
		"item": items,
	}
}

func folderToPostman(f Folder) []map[string]any {
	out := make([]map[string]any, 0, len(f.Items)+len(f.Folders))
	for _, sub := range f.Folders {
		out = append(out, map[string]any{"name": sub.Name, "item": folderToPostman(sub)})
	}
	for _, it := range f.Items {
		out = append(out, map[string]any{"name": it.Name, "request": specToPostman(it.Spec)})
	}
	return out
}

func specToPostman(s RequestSpec) map[string]any {
	req := map[string]any{
		"method": s.Method,
		"url": map[string]any{
			"raw":   s.URL,
			"query": kvToPostmanKV(s.QueryParams),
		},
	}
	if len(s.Headers) > 0 {
		req["header"] = kvToPostmanKV(s.Headers)
	}
	switch s.BodyType {
	case "raw":
		req["body"] = map[string]any{"mode": "raw", "raw": s.RawBody}
	case "urlencoded":
		req["body"] = map[string]any{"mode": "urlencoded", "urlencoded": kvToPostmanKV(s.FormFields)}
	case "form":
		req["body"] = map[string]any{"mode": "formdata", "formdata": kvToPostmanKV(s.FormFields)}
	}
	return req
}

func kvToPostmanKV(rows []KeyValue) []map[string]any {
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		if r.Key == "" {
			continue
		}
		out = append(out, map[string]any{"key": r.Key, "value": r.Value, "disabled": !r.Enabled})
	}
	return out
}

func kvToPostmanVar(rows []KeyValue) []map[string]any {
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		if r.Key == "" {
			continue
		}
		out = append(out, map[string]any{"key": r.Key, "value": r.Value, "disabled": !r.Enabled})
	}
	return out
}
