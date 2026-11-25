// 아스트로가 그린 달력 · 도장 그림(1024px)을 앱에 쓸 크기로 만든다.
// Build: swiftc -O -o /tmp/mkcal scripts/make-calendar-art.swift && /tmp/mkcal assets/astro/calendar assets/art
//  - 밥상 캐릭터 8장 → art/meal/{who}-{breakfast,lunch,dinner,full}.png (288px, 거의 불투명한 곳은 완전히 불투명하게)
//  - 달력 도장 6장 → art/stamp/{who}-{smile,yum,wink}.png (120px, 오둥이 하늘 잉크 · 퍼펭이 민트 잉크로 칠함)
//  - 사진 도장 고리 → art/seal-ring-rough.png (512px, 검정) + 고리 바깥선으로 만든 원판 art/seal-disc-rough.png
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let srcDir = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
let cs = CGColorSpace(name: CGColorSpace.sRGB)!

func load(_ name: String) -> CGImage {
  let src = CGImageSourceCreateWithURL(srcDir.appendingPathComponent(name) as CFURL, nil)!
  return CGImageSourceCreateImageAtIndex(src, 0, nil)!
}

func save(_ img: CGImage, _ path: String) {
  let url = outDir.appendingPathComponent(path)
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

/// RGBA(premultiplied) 버퍼
final class Bitmap {
  let w: Int, h: Int
  let ctx: CGContext
  let p: UnsafeMutablePointer<UInt8>
  init(_ w: Int, _ h: Int) {
    self.w = w; self.h = h
    ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                    space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    p = ctx.data!.bindMemory(to: UInt8.self, capacity: w * h * 4)
  }
  convenience init(_ img: CGImage) {
    self.init(img.width, img.height)
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  }
  func alpha(_ x: Int, _ y: Int) -> UInt8 { p[(y * w + x) * 4 + 3] }
  var image: CGImage { ctx.makeImage()! }
}

/// 알파가 thr보다 큰 픽셀의 범위 (버퍼 좌표: y=0이 아래)
func bbox(_ b: Bitmap, thr: UInt8 = 16) -> (x0: Int, y0: Int, x1: Int, y1: Int) {
  var x0 = b.w, y0 = b.h, x1 = -1, y1 = -1
  for y in 0..<b.h { for x in 0..<b.w where b.alpha(x, y) > thr { x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y) } }
  return (x0, y0, x1, y1)
}

/// src에서 정사각형 crop을 잘라 size로 줄인다
func resample(_ img: CGImage, crop: CGRect, size: Int) -> Bitmap {
  let out = Bitmap(size, size)
  let k = CGFloat(size) / crop.width
  out.ctx.draw(img, in: CGRect(x: -crop.minX * k, y: -crop.minY * k, width: CGFloat(img.width) * k, height: CGFloat(img.height) * k))
  return out
}

// ── 1. 밥상 캐릭터: 프레임은 그대로(모두 같은 크기 · 같은 발 위치), 288px ──
for who in ["odung", "perpeng"] {
  for meal in ["breakfast", "lunch", "dinner", "full"] {
    let img = load("\(who)-meal-\(meal).png")
    let b = resample(img, crop: CGRect(x: 0, y: 0, width: img.width, height: img.height), size: 288)
    // 거의 불투명(228 이상)한 곳은 완전히 불투명하게: 유리 카드 위에서 비쳐 보이지 않게
    for i in stride(from: 0, to: b.w * b.h * 4, by: 4) {
      let a = Int(b.p[i + 3])
      if a >= 228 && a < 255 {
        for c in 0..<3 { b.p[i + c] = UInt8(min(255, Int(b.p[i + c]) * 255 / a)) }
        b.p[i + 3] = 255
      }
    }
    save(b.image, "meal/\(who)-\(meal).png")
  }
}

// ── 2. 달력 도장: 테두리에 딱 맞게 잘라 120px, 잉크 색으로 ──
let inks: [String: (Int, Int, Int)] = ["odung": (74, 127, 208), "perpeng": (47, 154, 137)]
for who in ["odung", "perpeng"] {
  for face in ["smile", "yum", "wink"] {
    let img = load("stamp-\(who)-\(face).png")
    let full = Bitmap(img)
    let bb = bbox(full)
    let side = CGFloat(max(bb.x1 - bb.x0, bb.y1 - bb.y0) + 1) * 1.03
    let cx = CGFloat(bb.x0 + bb.x1 + 1) / 2, cy = CGFloat(bb.y0 + bb.y1 + 1) / 2
    let b = resample(img, crop: CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side), size: 120)
    let (r, g, bl) = inks[who]!
    for i in stride(from: 0, to: b.w * b.h * 4, by: 4) {
      let a = Int(b.p[i + 3])
      b.p[i] = UInt8(r * a / 255); b.p[i + 1] = UInt8(g * a / 255); b.p[i + 2] = UInt8(bl * a / 255)
    }
    save(b.image, "stamp/\(who)-\(face).png")
  }
}

// ── 3. 사진 도장 고리 + 같은 바깥선의 원판 ──
do {
  let img = load("seal-ring-rough.png")
  let full = Bitmap(img)
  let bb = bbox(full, thr: 40)
  // 고리 바깥 지름이 그림 폭의 98.5%가 되게 (앱은 원판 지름 2R을 0.985로 나눈 크기로 그린다)
  let side = CGFloat(max(bb.x1 - bb.x0, bb.y1 - bb.y0) + 1) / 0.985
  let cx = CGFloat(bb.x0 + bb.x1 + 1) / 2, cy = CGFloat(bb.y0 + bb.y1 + 1) / 2
  let crop = CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side)
  let W = 1024
  let work = resample(img, crop: crop, size: W)
  // 검정으로 고정 (색은 앱에서 입힌다)
  for i in stride(from: 0, to: W * W * 4, by: 4) { work.p[i] = 0; work.p[i + 1] = 0; work.p[i + 2] = 0 }
  let ring512 = Bitmap(512, 512)
  ring512.ctx.draw(work.image, in: CGRect(x: 0, y: 0, width: 512, height: 512))
  save(ring512.image, "seal-ring-rough.png")

  // 원판: 고리의 빈 점 때문에 새지 않게 살짝 부풀린 고리로 바깥을 채운 뒤, 바깥이 아닌 곳 = 원판. 다시 같은 만큼 줄인다
  let n = W * W
  var solid = [Bool](repeating: false, count: n)
  for i in 0..<n { solid[i] = work.p[i * 4 + 3] > 60 }
  func grow(_ m: [Bool], _ r: Int, _ value: Bool) -> [Bool] {
    // value=true: 팽창, false: 침식 (정사각 커널, 가로 → 세로)
    var tmp = m
    for y in 0..<W { for x in 0..<W {
      var hit = !value
      for dx in -r...r { let xx = x + dx; if xx < 0 || xx >= W { continue }; if m[y * W + xx] == value { hit = value; break } }
      tmp[y * W + x] = hit
    } }
    var out = tmp
    for y in 0..<W { for x in 0..<W {
      var hit = !value
      for dy in -r...r { let yy = y + dy; if yy < 0 || yy >= W { continue }; if tmp[yy * W + x] == value { hit = value; break } }
      out[y * W + x] = hit
    } }
    return out
  }
  let wall = grow(solid, 6, true)
  var outside = [Bool](repeating: false, count: n)
  var stack = [0, W - 1, n - W, n - 1]
  while let i = stack.popLast() {
    if outside[i] || wall[i] { continue }
    outside[i] = true
    let x = i % W, y = i / W
    if x > 0 { stack.append(i - 1) }; if x < W - 1 { stack.append(i + 1) }
    if y > 0 { stack.append(i - W) }; if y < W - 1 { stack.append(i + W) }
  }
  var inside = outside.map { !$0 }
  inside = grow(inside, 6, false)
  let disc = Bitmap(W, W)
  for i in 0..<n { disc.p[i * 4 + 3] = inside[i] ? 255 : 0 }
  let disc512 = Bitmap(512, 512)
  disc512.ctx.draw(disc.image, in: CGRect(x: 0, y: 0, width: 512, height: 512))
  save(disc512.image, "seal-disc-rough.png")
}
print("ok")
