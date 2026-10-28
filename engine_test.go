package main

import (
	"strings"
	"testing"
)

func TestInterpolate(t *testing.T) {
	vars := []KeyValue{
		{Key: "base_url", Value: "https://api.example.com", Enabled: true},
		{Key: "off", Value: "x", Enabled: false},
	}
	got := interpolate("{{ base_url }}/v1?d={{off}}&m={{missing}}", vars)
	want := "https://api.example.com/v1?d={{off}}&m={{missing}}"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestParsePostmanCollection(t *testing.T) {
	const jsonText = `{
		"info": {"name": "Demo", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
		"variable": [{"key": "v1", "value": "aaa"}],
		"item": [
			{
				"name": "folder-1",
				"item": [
					{
						"name": "create-user",
						"request": {
							"method": "POST",
							"url": {"raw": "https://x.io/api/users?a=1", "query": [{"key": "a", "value": "1"}]},
							"header": [{"key": "X-Token", "value": "t1"}],
							"body": {"mode": "raw", "raw": "{\"n\":1}"}
						}
					}
				]
			},
			{"name": "simple", "request": "https://plain.io/get"}
		]
	}`
	col, err := parsePostmanCollection([]byte(jsonText))
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if col.Name != "Demo" {
		t.Fatalf("collection name = %q", col.Name)
	}
	if len(col.Variables) != 1 || col.Variables[0].Key != "v1" {
		t.Fatalf("variables = %+v", col.Variables)
	}
	if len(col.Root.Folders) != 1 || len(col.Root.Items) != 1 {
		t.Fatalf("root structure wrong: folders=%d items=%d", len(col.Root.Folders), len(col.Root.Items))
	}
	r1 := col.Root.Folders[0].Items[0]
	if r1.Spec.Method != "POST" || r1.Spec.URL != "https://x.io/api/users" {
		t.Fatalf("r1 spec = %+v", r1.Spec)
	}
	if len(r1.Spec.QueryParams) != 1 || r1.Spec.QueryParams[0].Key != "a" {
		t.Fatalf("r1 query = %+v", r1.Spec.QueryParams)
	}
	if r1.Spec.BodyType != "raw" || r1.Spec.RawBody != `{"n":1}` {
		t.Fatalf("r1 body = %+v", r1.Spec)
	}
	if len(r1.Spec.Headers) != 1 || r1.Spec.Headers[0].Key != "X-Token" {
		t.Fatalf("r1 headers = %+v", r1.Spec.Headers)
	}
	r2 := col.Root.Items[0]
	if r2.Spec.Method != "GET" || !strings.HasPrefix(r2.Spec.URL, "https://plain.io") {
		t.Fatalf("r2 spec = %+v", r2.Spec)
	}
}
