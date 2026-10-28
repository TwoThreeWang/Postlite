package main

import (
	"embed"
	"log"
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	winOpts := application.WindowsOptions{}
	// 仅调试用：设置 POSTLIE_DEBUG_ARGS 时注入 WebView2 浏览器参数，
	// 例：POSTLIE_DEBUG_ARGS="--remote-debugging-port=9333"（正式构建不受影响）
	if args := os.Getenv("POSTLIE_DEBUG_ARGS"); args != "" {
		winOpts.AdditionalBrowserArgs = strings.Fields(args)
	}
	// 仅调试用：POSTLIE_WEBVIEW_DATA_DIR 指定 WebView2 用户数据目录，
	// 用于与正在运行的正式实例并行启动（两者共用数据目录锁会 8007139f）
	if dir := os.Getenv("POSTLIE_WEBVIEW_DATA_DIR"); dir != "" {
		winOpts.WebviewUserDataPath = dir
	}
	app := application.New(application.Options{
		Windows:     winOpts,
		Name:        "Postlite",
		Description: "Lightweight API client",
		Services: []application.Service{
			application.NewService(&RequestService{}),
			application.NewService(&CollectionService{}),
			application.NewService(&EnvironmentService{}),
			application.NewService(&HistoryService{}),
			application.NewService(&GitService{}),
			application.NewService(&PostmanService{}),
			application.NewService(&SettingsService{}),
			application.NewService(&SessionService{}),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// git 操作日志实时推送：gitRunLogged 的输出以事件形式发给前端日志区
	SetGitLogSink(func(line string) {
		if a := application.Get(); a != nil {
			a.Event.Emit("git:log", line)
		}
	})

	// Postman 同步进度实时推送：SyncAll 的逐条进度以事件形式发给前端日志区
	SetPostmanLogSink(func(line string) {
		if a := application.Get(); a != nil {
			a.Event.Emit("postman:log", line)
		}
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:      "Postlite",
		Width:      1400,
		Height:     900,
		MinWidth:   1000,
		MinHeight:  620,
		Frameless:  true, // 隐藏系统标题栏，由应用内顶栏承担拖拽与窗口控制
		StartState: application.WindowStateMaximised, // 打开即最大化
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(23, 23, 26),
		URL:              "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
