// genicon 渲染 Postlite 应用图标（赤陶圆角方块 + 居中白色几何 P）。
// 纯标准库：SDF 命中测试 + 4x 超采样盒式降采样抗锯齿。
// 用法: go run ./cmd/genicon -out build/appicon.png -size 1024
package main

import (
	"bufio"
	"flag"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"os"
)

const (
	terraR, terraG, terraB = 0xC8, 0x50, 0x1E // 赤陶 Terracotta
)

func inCircle(px, py, cx, cy, r float64) bool {
	dx, dy := px-cx, py-cy
	return dx*dx+dy*dy <= r*r
}

// 圆角矩形命中测试（标准 SDF）
func inRRect(px, py, x0, y0, x1, y1, r float64) bool {
	if px < x0 || px > x1 || py < y0 || py > y1 {
		return false
	}
	qx := math.Max(x0+r, math.Min(x1-r, px))
	qy := math.Max(y0+r, math.Min(y1-r, py))
	dx, dy := px-qx, py-qy
	return dx*dx+dy*dy <= r*r
}

// 白色部分：竖笔 + 碗环（挖掉内圆）。字形 bbox (37,30)-(91,98) 对齐 128 画布中心。
func inWhite(x, y float64) bool {
	if inRRect(x, y, 37, 30, 52, 98, 7.5) {
		return true
	}
	if inCircle(x, y, 67, 54, 24) && !inCircle(x, y, 67, 54, 13) {
		return true
	}
	return false
}

func main() {
	out := flag.String("out", "build/appicon.png", "输出 PNG 路径")
	size := flag.Int("size", 1024, "输出尺寸（像素）")
	supersample := flag.Int("ss", 4, "超采样倍数")
	flag.Parse()

	N := *size
	S := *supersample
	big := N * S
	k := float64(big) / 128.0

	img := image.NewNRGBA(image.Rect(0, 0, big, big))
	for y := 0; y < big; y++ {
		fy := (float64(y) + 0.5) / k
		for x := 0; x < big; x++ {
			fx := (float64(x) + 0.5) / k
			if !inRRect(fx, fy, 0, 0, 128, 128, 30) {
				img.SetNRGBA(x, y, color.NRGBA{0, 0, 0, 0})
				continue
			}
			if inWhite(fx, fy) {
				img.SetNRGBA(x, y, color.NRGBA{255, 255, 255, 255})
			} else {
				img.SetNRGBA(x, y, color.NRGBA{terraR, terraG, terraB, 255})
			}
		}
	}

	// 盒式降采样（预乘 alpha 平均）
	final := image.NewNRGBA(image.Rect(0, 0, N, N))
	for yy := 0; yy < N; yy++ {
		for xx := 0; xx < N; xx++ {
			var r, g, b, a uint64
			for dy := 0; dy < S; dy++ {
				for dx := 0; dx < S; dx++ {
					p := img.NRGBAAt(xx*S+dx, yy*S+dy)
					a64 := uint64(p.A)
					r += uint64(p.R) * a64
					g += uint64(p.G) * a64
					b += uint64(p.B) * a64
					a += a64
				}
			}
			var fr, fg, fb, fa uint8
			if a > 0 {
				n := uint64(S * S)
				fr = uint8(r / a)
				fg = uint8(g / a)
				fb = uint8(b / a)
				fa = uint8(a / n)
			}
			final.SetNRGBA(xx, yy, color.NRGBA{fr, fg, fb, fa})
		}
	}

	f, err := os.Create(*out)
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	if err := png.Encode(w, final); err != nil {
		log.Fatal(err)
	}
	if err := w.Flush(); err != nil {
		log.Fatal(err)
	}
	log.Printf("written %s (%dx%d)", *out, N, N)
}
