package main

import (
	"strings"
	"testing"
)

// TestParsePostmanEnvironment 验证 Postman 环境导出 JSON 的识别与解析。
func TestParsePostmanEnvironment(t *testing.T) {
	raw := `{
		"id": "3aee8fc1-0b5f-4beb-abd1-f3cc8103dd81",
		"name": "及时更新-测试环境",
		"values": [
			{"key": "auth_url", "value": "http://192.168.120.102:8091", "type": "default", "enabled": true},
			{"key": "password", "value": "src_vin_part", "type": "default", "enabled": true},
			{"key": "access_token", "value": "", "type": "default", "enabled": false}
		],
		"_postman_variable_scope": "environment"
	}`

	if !looksLikePostmanEnvironment([]byte(raw)) {
		t.Fatal("环境 JSON 应被 looksLikePostmanEnvironment 识别")
	}
	env, err := parsePostmanEnvironment([]byte(raw))
	if err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	if env.Name != "及时更新-测试环境" {
		t.Fatalf("name 不对: %q", env.Name)
	}
	if len(env.Variables) != 3 {
		t.Fatalf("应有 3 个变量，got %d", len(env.Variables))
	}
	if env.Variables[0].Key != "auth_url" || env.Variables[0].Value != "http://192.168.120.102:8091" || !env.Variables[0].Enabled {
		t.Fatalf("变量 0 不对: %+v", env.Variables[0])
	}
	if env.Variables[2].Enabled {
		t.Fatal("disabled 变量应映射为 Enabled=false")
	}
	if env.ID == "" {
		t.Fatal("应生成新 ID")
	}

	// 集合文件不应被误判为环境
	colJSON := `{"info": {"name": "col", "schema": "v2.1"}, "item": []}`
	if looksLikePostmanEnvironment([]byte(colJSON)) {
		t.Fatal("集合 JSON 不应被识别为环境")
	}
	// 非法 JSON / 缺 name
	if _, err := parsePostmanEnvironment([]byte("{bad")); err == nil {
		t.Fatal("非法 JSON 应报错")
	}
	if _, err := parsePostmanEnvironment([]byte(`{"values": []}`)); err == nil || !strings.Contains(err.Error(), "name") {
		t.Fatalf("缺 name 应报错，got %v", err)
	}
}
