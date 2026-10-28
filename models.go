package main

// KeyValue 是所有键值对（Header / Query / 表单 / 变量）的通用结构。
type KeyValue struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

// Capture 发送成功后从响应 JSON 提取值写入变量（如自动捕获 token）。
type Capture struct {
	Target  string `json:"target"`  // env | collection：写入环境变量还是集合变量
	VarName string `json:"varName"` // 目标变量名，如 token
	Path    string `json:"path"`    // 响应 JSON 路径，如 data.access_token，数组用 data.list.0.id
}

// RequestSpec 描述一次 HTTP 请求的全部参数。
type RequestSpec struct {
	Method          string     `json:"method"`
	URL             string     `json:"url"`
	Headers         []KeyValue `json:"headers"`
	QueryParams     []KeyValue `json:"queryParams"`
	BodyType        string     `json:"bodyType"` // none | raw | form | urlencoded
	RawBody         string     `json:"rawBody"`
	FormFields      []KeyValue `json:"formFields"`
	FollowRedirects bool       `json:"followRedirects"`
	TimeoutSeconds  int        `json:"timeoutSeconds"`
	Captures        []Capture  `json:"captures"` // 发送后自动提取规则（方案 A：声明式）
}

// ResponseResult 是发送请求后的完整响应。
type ResponseResult struct {
	Ok         bool       `json:"ok"`
	Status     string     `json:"status"`
	StatusCode int        `json:"statusCode"`
	DurationMs int64      `json:"durationMs"`
	SizeBytes  int        `json:"sizeBytes"`
	Proto      string     `json:"proto"`
	Headers    []KeyValue `json:"headers"`
	Body       string     `json:"body"`
	Error      string     `json:"error"`

	// 时间明细（毫秒；连接复用时 DNS/连接/TLS 为 0）
	TimingDNSMs      int64 `json:"timingDnsMs"`
	TimingConnectMs  int64 `json:"timingConnectMs"`
	TimingTLSMs      int64 `json:"timingTlsMs"`
	TimingTTFBMs     int64 `json:"timingTtfbMs"`
	TimingTransferMs int64 `json:"timingTransferMs"`

	// 大小明细（字节）
	RespHeaderBytes int `json:"respHeaderBytes"`
	RespBodyBytes   int `json:"respBodyBytes"`
	ReqHeaderBytes  int `json:"reqHeaderBytes"`
	ReqBodyBytes    int `json:"reqBodyBytes"`
}

// RequestItem 集合里的单个请求。
type RequestItem struct {
	ID   string      `json:"id"`
	Name string      `json:"name"`
	Spec RequestSpec `json:"spec"`
}

// Folder 集合里的文件夹（可嵌套）。
type Folder struct {
	ID      string        `json:"id"`
	Name    string        `json:"name"`
	Items   []RequestItem `json:"items"`
	Folders []Folder      `json:"folders"`
}

// Collection 一个完整集合。
type Collection struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Root      Folder     `json:"root"`
	Variables []KeyValue `json:"variables"`
}

// Environment 一套环境变量。
type Environment struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Variables []KeyValue `json:"variables"`
}

// HistoryEntry 一次请求的历史记录。
type HistoryEntry struct {
	ID         string      `json:"id"`
	Time       string      `json:"time"` // RFC3339
	Method     string      `json:"method"`
	URL        string      `json:"url"` // 原始 URL（含 {{var}}）
	StatusCode int         `json:"statusCode"`
	OK         bool        `json:"ok"`
	DurationMs int64       `json:"durationMs"`
	Spec       RequestSpec `json:"spec"` // 完整请求快照，可一键重开
	Vars       []KeyValue  `json:"vars"` // 发送时使用的变量
}
