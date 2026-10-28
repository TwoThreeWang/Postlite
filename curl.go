package main

// 极简 cURL 命令解析器：支持 -X / -H / -d 系 / -F 系 / --url 与引号包裹。
// 不认识的选项宽容忽略；目标是从终端里复制的命令快速还原成可编辑的请求。

import (
	"fmt"
	"strings"
)

// curlTokens 按空格切分命令，支持 ' / " 引号与行续接符（\ 与 ^）。
func curlTokens(cmd string) []string {
	cmd = strings.ReplaceAll(cmd, "\\\r\n", " ")
	cmd = strings.ReplaceAll(cmd, "\\\n", " ")
	cmd = strings.ReplaceAll(cmd, "^\r\n", " ")
	cmd = strings.ReplaceAll(cmd, "^\n", " ")

	var toks []string
	var cur strings.Builder
	inTok := false
	i := 0
	for i < len(cmd) {
		c := cmd[i]
		switch c {
		case '\'':
			inTok = true
			j := i + 1
			for j < len(cmd) && cmd[j] != '\'' {
				j++
			}
			cur.WriteString(cmd[i+1 : j])
			i = j + 1
		case '"':
			inTok = true
			j := i + 1
			for j < len(cmd) {
				if cmd[j] == '\\' && j+1 < len(cmd) {
					cur.WriteByte(cmd[j+1])
					j += 2
					continue
				}
				if cmd[j] == '"' {
					break
				}
				cur.WriteByte(cmd[j])
				j++
			}
			i = j + 1
		case ' ', '\t', '\r', '\n':
			if inTok || cur.Len() > 0 {
				toks = append(toks, cur.String())
				cur.Reset()
				inTok = false
			}
			i++
		default:
			cur.WriteByte(c)
			i++
		}
	}
	if inTok || cur.Len() > 0 {
		toks = append(toks, cur.String())
	}
	return toks
}

// 需要取值的短选项（忽略其值）
var curlShortValueFlags = map[string]bool{
	"-u": true, "-A": true, "-e": true, "-b": true,
	"-o": true, "-m": true, "-D": true, "-H": true, "-X": true,
	"-d": true, "-F": true,
}

// ParseCurl 把 cURL 命令解析成 RequestSpec。
func ParseCurl(cmd string) (RequestSpec, error) {
	toks := curlTokens(strings.TrimSpace(cmd))
	if len(toks) == 0 {
		return RequestSpec{}, fmt.Errorf("空的 cURL 命令")
	}
	if strings.EqualFold(toks[0], "curl") || strings.EqualFold(toks[0], "curl.exe") {
		toks = toks[1:]
	}

	spec := RequestSpec{
		Method: "GET", BodyType: "none", FollowRedirects: true, TimeoutSeconds: 60,
	}
	hasBody := false

	for i := 0; i < len(toks); i++ {
		t := toks[i]
		low := strings.ToLower(t)

		// 长选项：有值的白名单在下面各分支处理，其余忽略
		if strings.HasPrefix(t, "--") {
			switch low {
			case "--request":
				if i+1 < len(toks) {
					spec.Method = strings.ToUpper(toks[i+1])
					i++
				}
			case "--header":
				if i+1 < len(toks) {
					addCurlHeader(&spec, toks[i+1])
					i++
				}
			case "--data", "--data-raw", "--data-ascii", "--data-binary":
				if i+1 < len(toks) {
					if spec.RawBody != "" {
						spec.RawBody += "&"
					}
					spec.RawBody += toks[i+1]
					hasBody = true
					i++
				}
			case "--data-urlencode":
				if i+1 < len(toks) {
					if spec.RawBody != "" {
						spec.RawBody += "&"
					}
					spec.RawBody += toks[i+1]
					hasBody = true
					i++
				}
			case "--form", "--form-string":
				if i+1 < len(toks) {
					addCurlFormField(&spec, toks[i+1])
					i++
				}
			case "--url":
				if i+1 < len(toks) {
					spec.URL = toks[i+1]
					i++
				}
			case "--user", "--user-agent", "--referer", "--cookie", "--cert",
				"--key", "--connect-timeout", "--max-time", "--output", "--retry":
				i++ // 带值但忽略
			}
			continue
		}

		// 短选项
		if strings.HasPrefix(t, "-") && len(t) >= 2 && t[1] != '-' {
			if curlShortValueFlags[t] {
				switch t {
				case "-X":
					if i+1 < len(toks) {
						spec.Method = strings.ToUpper(toks[i+1])
						i++
					}
				case "-H":
					if i+1 < len(toks) {
						addCurlHeader(&spec, toks[i+1])
						i++
					}
				case "-d":
					if i+1 < len(toks) {
						if spec.RawBody != "" {
							spec.RawBody += "&"
						}
						spec.RawBody += toks[i+1]
						hasBody = true
						i++
					}
				case "-F":
					if i+1 < len(toks) {
						addCurlFormField(&spec, toks[i+1])
						i++
					}
				default:
					i++ // -u/-A/-e 等带值但忽略
				}
			}
			// -L/-k/-s 等无值选项直接忽略
			continue
		}

		// 位置参数：URL
		if spec.URL == "" {
			spec.URL = t
		}
	}

	if hasBody {
		if spec.BodyType != "form" {
			spec.BodyType = "raw"
		}
		if spec.Method == "GET" {
			spec.Method = "POST"
		}
	}
	if spec.URL == "" {
		return RequestSpec{}, fmt.Errorf("未在命令中找到 URL")
	}
	return spec, nil
}

func addCurlHeader(spec *RequestSpec, h string) {
	if k, v, ok := strings.Cut(h, ":"); ok {
		spec.Headers = append(spec.Headers, KeyValue{
			Key: strings.TrimSpace(k), Value: strings.TrimSpace(v), Enabled: true,
		})
	}
}

func addCurlFormField(spec *RequestSpec, f string) {
	if k, v, ok := strings.Cut(f, "="); ok {
		spec.FormFields = append(spec.FormFields, KeyValue{Key: k, Value: v, Enabled: true})
	}
	spec.BodyType = "form"
}
