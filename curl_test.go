package main

import "testing"

func TestParseCurl(t *testing.T) {
	cmd := "curl -X POST 'https://api.example.com/v1/users?full=1' " +
		"-H 'Content-Type: application/json' -H 'Auth: Bearer tk' " +
		"-d '{\"name\":\"Evan\"}' --compressed"
	spec, err := ParseCurl(cmd)
	if err != nil {
		t.Fatalf("ParseCurl 报错: %v", err)
	}
	if spec.Method != "POST" {
		t.Errorf("Method = %s, want POST", spec.Method)
	}
	if spec.URL != "https://api.example.com/v1/users?full=1" {
		t.Errorf("URL = %s", spec.URL)
	}
	if len(spec.Headers) != 2 || spec.Headers[0].Key != "Content-Type" {
		t.Errorf("Headers = %+v", spec.Headers)
	}
	if spec.BodyType != "raw" || spec.RawBody != `{"name":"Evan"}` {
		t.Errorf("Body = %s / %s", spec.BodyType, spec.RawBody)
	}
}

func TestParseCurlDataImpliesPost(t *testing.T) {
	spec, err := ParseCurl(`curl https://x.dev/api -d 'a=1&b=2'`)
	if err != nil {
		t.Fatalf("ParseCurl 报错: %v", err)
	}
	if spec.Method != "POST" || spec.BodyType != "raw" || spec.RawBody != "a=1&b=2" {
		t.Errorf("spec = %+v", spec)
	}
}

func TestParseCurlForm(t *testing.T) {
	spec, err := ParseCurl(`curl --url https://x.dev/upload -F "name=a.png" -F "file=@a.png"`)
	if err != nil {
		t.Fatalf("ParseCurl 报错: %v", err)
	}
	if spec.BodyType != "form" || len(spec.FormFields) != 2 || spec.FormFields[0].Key != "name" {
		t.Errorf("spec = %+v", spec)
	}
}

func TestParseCurlLineContinuation(t *testing.T) {
	cmd := "curl -X GET \\\n  'https://x.dev/hi' \\\n  -H 'K: V'\n"
	spec, err := ParseCurl(cmd)
	if err != nil {
		t.Fatalf("ParseCurl 报错: %v", err)
	}
	if spec.URL != "https://x.dev/hi" || len(spec.Headers) != 1 {
		t.Errorf("spec = %+v", spec)
	}
}

func TestParseCurlNoURL(t *testing.T) {
	if _, err := ParseCurl("curl -k -L"); err == nil {
		t.Error("期望报错（无 URL）")
	}
}
