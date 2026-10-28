package main

import "testing"

// TestVersionCompare 验证检查更新的三段版本号比较。
func TestVersionCompare(t *testing.T) {
	cases := []struct {
		latest, current string
		want            bool
	}{
		{"v0.1.1", "0.1.0", true},       // 补丁位更新
		{"v0.2.0", "0.1.9", true},       // 次版本更新
		{"v1.0.0", "0.9.9", true},       // 大版本更新
		{"v0.1.0", "0.1.0", false},      // 相同
		{"v0.1.0", "0.1.2", false},      // 本地更新
		{"v0.1.0-beta", "0.1.0", false}, // 忽略预发布后缀
		{"v0.1", "0.1.0", false},        // 缺段补 0
		{"v0.1", "0.0.9", true},         // 缺段补 0 后比较
	}
	for _, c := range cases {
		if got := isNewerVersion(c.latest, c.current); got != c.want {
			t.Errorf("isNewerVersion(%q, %q) = %v, want %v", c.latest, c.current, got, c.want)
		}
	}
}
