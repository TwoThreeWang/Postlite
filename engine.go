package main

import (
	"bytes"
	"crypto/tls"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// {{var}} 插值：与 Postman 语法一致。
var varPattern = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

func interpolate(s string, vars []KeyValue) string {
	if s == "" || len(vars) == 0 {
		return s
	}
	m := make(map[string]string, len(vars))
	for _, v := range vars {
		if v.Enabled {
			m[v.Key] = v.Value
		}
	}
	return varPattern.ReplaceAllStringFunc(s, func(raw string) string {
		key := varPattern.FindStringSubmatch(raw)[1]
		if val, ok := m[key]; ok {
			return val
		}
		return raw // 未定义的变量原样保留，方便用户发现
	})
}

func interpolateSpec(spec RequestSpec, vars []KeyValue) RequestSpec {
	spec.URL = interpolate(spec.URL, vars)
	spec.RawBody = interpolate(spec.RawBody, vars)
	for i := range spec.Headers {
		spec.Headers[i].Key = interpolate(spec.Headers[i].Key, vars)
		spec.Headers[i].Value = interpolate(spec.Headers[i].Value, vars)
	}
	for i := range spec.QueryParams {
		spec.QueryParams[i].Key = interpolate(spec.QueryParams[i].Key, vars)
		spec.QueryParams[i].Value = interpolate(spec.QueryParams[i].Value, vars)
	}
	for i := range spec.FormFields {
		spec.FormFields[i].Key = interpolate(spec.FormFields[i].Key, vars)
		spec.FormFields[i].Value = interpolate(spec.FormFields[i].Value, vars)
	}
	return spec
}

const maxBodySize = 10 << 20 // 响应体最多读 10MB

func sendRequest(spec RequestSpec, vars []KeyValue) ResponseResult {
	spec = interpolateSpec(spec, vars)

	timeout := time.Duration(spec.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	client := &http.Client{Timeout: timeout}
	// 代理策略：设置里配置了代理地址才走代理；默认显式不走代理
	// （Go 默认会读 HTTP_PROXY 等环境变量，这里关掉，避免隐式代理干扰本地调试）
	if px := currentProxy(); px != "" {
		if pu, perr := url.Parse(px); perr == nil && pu.Scheme != "" && pu.Host != "" {
			client.Transport = &http.Transport{Proxy: http.ProxyURL(pu)}
		}
	} else {
		client.Transport = &http.Transport{Proxy: nil}
	}
	if !spec.FollowRedirects {
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}

	method := strings.ToUpper(spec.Method)
	if method == "" {
		method = http.MethodGet
	}

	// 拼接 Query 参数（参数表里的 enabled 项追加到 URL 上）
	fullURL := strings.TrimSpace(spec.URL)
	qp := make([]KeyValue, 0, len(spec.QueryParams))
	for _, p := range spec.QueryParams {
		if p.Enabled && p.Key != "" {
			qp = append(qp, p)
		}
	}
	if len(qp) > 0 {
		if u, err := url.Parse(fullURL); err == nil {
			q := u.Query()
			for _, p := range qp {
				q.Add(p.Key, p.Value)
			}
			u.RawQuery = q.Encode()
			fullURL = u.String()
		}
	}

	// 请求体
	var bodyReader io.Reader
	var reqBodyBytes int
	contentType := ""
	switch spec.BodyType {
	case "raw":
		if spec.RawBody != "" {
			bodyReader = strings.NewReader(spec.RawBody)
			reqBodyBytes = len(spec.RawBody)
		}
	case "urlencoded":
		form := url.Values{}
		for _, f := range spec.FormFields {
			if f.Enabled && f.Key != "" {
				form.Add(f.Key, f.Value)
			}
		}
		encoded := form.Encode()
		bodyReader = strings.NewReader(encoded)
		reqBodyBytes = len(encoded)
		contentType = "application/x-www-form-urlencoded"
	case "form":
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		for _, f := range spec.FormFields {
			if f.Enabled && f.Key != "" {
				_ = w.WriteField(f.Key, f.Value)
			}
		}
		_ = w.Close()
		reqBodyBytes = buf.Len()
		bodyReader = &buf
		contentType = w.FormDataContentType()
	}

	req, err := http.NewRequest(method, fullURL, bodyReader)
	if err != nil {
		return ResponseResult{Ok: false, Error: "invalid request: " + err.Error()}
	}
	for _, h := range spec.Headers {
		if h.Enabled && h.Key != "" {
			req.Header.Add(h.Key, h.Value)
		}
	}
	if contentType != "" && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", contentType)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "postlite/0.1")
	}

	// 请求大小明细（请求行 + Host + 头块）
	reqHeaderBytes := headerBlockSize(req.Header, method+" "+req.URL.RequestURI()+" HTTP/1.1")
	if req.URL.Host != "" {
		reqHeaderBytes += len("Host: ") + len(req.URL.Host) + 2
	}

	// 时间明细：httptrace 记录 DNS / 连接 / TLS / 首字节
	var dnsStart, dnsEnd, connStart, connEnd, tlsStart, tlsEnd, wroteAt, ttfbAt time.Time
	trace := &httptrace.ClientTrace{
		DNSStart:          func(httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:           func(httptrace.DNSDoneInfo) { dnsEnd = time.Now() },
		ConnectStart:      func(string, string) { connStart = time.Now() },
		ConnectDone:       func(string, string, error) { connEnd = time.Now() },
		TLSHandshakeStart: func() { tlsStart = time.Now() },
		TLSHandshakeDone:  func(tls.ConnectionState, error) { tlsEnd = time.Now() },
		WroteRequest:      func(httptrace.WroteRequestInfo) { wroteAt = time.Now() },
		GotFirstResponseByte: func() {
			ttfbAt = time.Now()
		},
	}
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return ResponseResult{Ok: false, Error: err.Error(), DurationMs: time.Since(start).Milliseconds()}
	}
	defer resp.Body.Close()

	bodyBytes, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBodySize))
	duration := time.Since(start).Milliseconds()

	var dnsMs, connMs, tlsMs, ttfbMs, transferMs int64
	if !dnsStart.IsZero() && !dnsEnd.IsZero() {
		dnsMs = dnsEnd.Sub(dnsStart).Milliseconds()
	}
	if !connStart.IsZero() && !connEnd.IsZero() {
		connMs = connEnd.Sub(connStart).Milliseconds()
	}
	if !tlsStart.IsZero() && !tlsEnd.IsZero() {
		tlsMs = tlsEnd.Sub(tlsStart).Milliseconds()
	}
	if !wroteAt.IsZero() && !ttfbAt.IsZero() {
		ttfbMs = ttfbAt.Sub(wroteAt).Milliseconds()
	}
	transferMs = duration - ttfbMs
	if transferMs < 0 {
		transferMs = 0
	}

	// 响应头块大小（状态行 + 头 + CRLF）
	statusLine := resp.Proto + " " + resp.Status
	respHeaderBytes := headerBlockSize(resp.Header, statusLine)

	headers := make([]KeyValue, 0, len(resp.Header))
	for k, vs := range resp.Header {
		headers = append(headers, KeyValue{Key: k, Value: strings.Join(vs, ", "), Enabled: true})
	}
	sort.Slice(headers, func(i, j int) bool { return headers[i].Key < headers[j].Key })

	result := ResponseResult{
		Ok:               true,
		Status:           resp.Status,
		StatusCode:       resp.StatusCode,
		DurationMs:       duration,
		SizeBytes:        len(bodyBytes),
		Proto:            resp.Proto,
		Headers:          headers,
		Body:             string(bodyBytes),
		TimingDNSMs:      dnsMs,
		TimingConnectMs:  connMs,
		TimingTLSMs:      tlsMs,
		TimingTTFBMs:     ttfbMs,
		TimingTransferMs: transferMs,
		RespHeaderBytes:  respHeaderBytes,
		RespBodyBytes:    len(bodyBytes),
		ReqHeaderBytes:   reqHeaderBytes,
		ReqBodyBytes:     reqBodyBytes,
	}
	if readErr != nil {
		result.Error = "body read: " + readErr.Error()
	}
	return result
}

// headerBlockSize 估算一个 HTTP 头块的字节数（requestLine/statusLine + 头 + 结束空行）。
func headerBlockSize(h http.Header, startLine string) int {
	n := len(startLine)
	for k, vs := range h {
		for _, v := range vs {
			n += len(k) + len(v) + 4 // ": " + CRLF
		}
	}
	return n + 2
}
