//go:build windows

package main

// git.exe 是控制台程序，GUI 应用直接 exec 它会闪黑框。
// 用 CREATE_NO_WINDOW 抑制（HideWindow 单独用对某些系统不够）。

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

func hideConsoleWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}
