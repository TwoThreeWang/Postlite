package main

// 检查更新：查询 GitHub Releases 的最新版本，与内置 appVersion 比较。
// 无需认证（公共仓库）；HTTP 走设置里的代理。

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	repoOwner    = "TwoThreeWang"
	repoName     = "Postlite"
	releasesAPI  = "https://api.github.com/repos/" + repoOwner + "/" + repoName + "/releases/latest"
	releasesPage = "https://github.com/" + repoOwner + "/" + repoName + "/releases"
)

// UpdateInfo 检查更新结果。
type UpdateInfo struct {
	Current   string `json:"current"`   // 当前版本（如 0.1.0）
	Latest    string `json:"latest"`    // 远端最新标签（如 v0.1.1）；远端没有发布时为空
	HasUpdate bool   `json:"hasUpdate"` // Latest 是否比 Current 新
	URL       string `json:"url"`       // Releases 页面（前往下载用）
	Notes     string `json:"notes"`     // 最新 Release 的说明（截断到 500 字符）
	Published string `json:"published"` // 发布时间（RFC3339）
}

// CheckUpdate 查询远端最新 Release 并与当前版本比较。
// 远端还没有任何 Release 时返回 HasUpdate=false 且 Latest 为空，不算错误。
func (s *SettingsService) CheckUpdate() (UpdateInfo, error) {
	info := UpdateInfo{Current: appVersion, URL: releasesPage}

	req, err := http.NewRequest(http.MethodGet, releasesAPI, nil)
	if err != nil {
		return info, err
	}
	req.Header.Set("User-Agent", "Postlite/"+appVersion) // GitHub API 要求 UA
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := pmClient().Do(req)
	if err != nil {
		return info, fmt.Errorf("网络请求失败: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return info, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return info, nil // 还没发过版
	}
	if resp.StatusCode != http.StatusOK {
		return info, fmt.Errorf("GitHub API 返回 %d", resp.StatusCode)
	}

	var rel struct {
		TagName    string `json:"tag_name"`
		Body       string `json:"body"`
		Published  string `json:"published_at"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
	}
	if err := json.Unmarshal(body, &rel); err != nil {
		return info, err
	}
	if rel.Draft {
		return info, nil // 草稿对未认证请求本来也拿不到，防御一下
	}
	info.Latest = rel.TagName
	info.Notes = strings.TrimSpace(rel.Body)
	if len(info.Notes) > 500 {
		info.Notes = info.Notes[:500] + "…"
	}
	info.Published = rel.Published
	info.HasUpdate = isNewerVersion(rel.TagName, appVersion)
	return info, nil
}

// OpenReleasesPage 用系统默认浏览器打开 Releases 页面。
func (s *SettingsService) OpenReleasesPage() error {
	a := application.Get()
	if a == nil {
		return fmt.Errorf("应用未初始化")
	}
	return a.Browser.OpenURL(releasesPage)
}

// ---- 版本比较 ----

// parseVer 把 "v0.2.1-beta" 解析成 [0,2,1]；缺失的段补 0，非数字段按 0 处理。
func parseVer(v string) [3]int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	v = strings.TrimPrefix(v, "V")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	var out [3]int
	for i, p := range strings.SplitN(v, ".", 3) {
		if i > 2 {
			break
		}
		n, _ := strconv.Atoi(strings.TrimSpace(p))
		out[i] = n
	}
	return out
}

// isNewerVersion 判断 latest 是否比 current 新（纯数字三段比较，忽略预发布后缀）。
func isNewerVersion(latest, current string) bool {
	l, c := parseVer(latest), parseVer(current)
	if l == c {
		return false
	}
	for i := 0; i < 3; i++ {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	return false
}
