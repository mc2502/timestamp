// 아스트로가 그린 달력 · 도장 그림(1024px)을 앱에 쓸 크기로 만든다.
// Build: swiftc -O -o /tmp/mkcal scripts/make-calendar-art.swift && /tmp/mkcal assets/astro/calendar assets/art
//  - 밥상 캐릭터 8장 → art/meal/{who}-{breakfast,lunch,dinner,full}.png (288px, 거의 불투명한 곳은 완전히 불투명하게)
//  - 앨범 든 캐릭터 2장 → art/album/{odung,perpeng}.png (192px, 카메라 길게 누르기 버튼)
//  - 빈 끼니 칸 그림 3장 → art/slot/{breakfast,lunch,dinner}.png (168px)
//  - 달력 도장 6장 → art/stamp/{who}-{smile,yum,wink}.png (120px, 오둥이 하늘 잉크 · 퍼펭이 민트 잉크로 칠함)
//  - 못 채운 날 도장 4장 → art/stamp/{who}-miss-{sad,hungry}.png (120px, 회색 잉크)
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

/// 알파가 thr보다 큰 픽셀의 범위 (메모리 좌표: y=0이 맨 위 줄)
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

// ── 1. 밥상 캐릭터: 8장을 같은 키 · 같은 발 위치로 맞춰 288px ──
// 그림마다 캐릭터 크기가 조금씩 달라서(예: 새 오둥이 저녁만 9% 큼) 끼니가 바뀔 때 커졌다 작아지지 않게,
// 그림 내용의 키를 프레임의 81.6%, 발끝을 위에서 90.6%(퍼펭이 원래 자리)에 두고 가로는 가운데로
let fitHeight: CGFloat = 0.816, fitBottom: CGFloat = 0.906
for who in ["odung", "perpeng"] {
  for meal in ["breakfast", "lunch", "dinner", "full"] {
    let img = load("\(who)-meal-\(meal).png")
    let bb = bbox(Bitmap(img), thr: 40) // 메모리 좌표: y=0이 위
    let W = CGFloat(img.width)
    let contentH = CGFloat(bb.y1 - bb.y0 + 1)
    let side = contentH / fitHeight // 이 크기의 정사각형을 잘라 288px로
    let cx = CGFloat(bb.x0 + bb.x1 + 1) / 2
    let bottomFromTop = CGFloat(bb.y1 + 1) // 위에서 잰 발끝
    let top = bottomFromTop - fitBottom * side
    let crop = CGRect(x: cx - side / 2, y: W - (top + side), width: side, height: side)
    let b = resample(img, crop: crop, size: 288)
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

// ── 1-1. 앨범 든 캐릭터(카메라를 길게 누르면 뜨는 동그란 버튼): 두 장을 같은 키로, 가운데에 192px ──
for who in ["odung", "perpeng"] {
  let img = load("album-\(who).png")
  let bb = bbox(Bitmap(img), thr: 40) // 메모리 좌표: y=0이 위
  let W = CGFloat(img.width)
  let side = CGFloat(bb.y1 - bb.y0 + 1) / 0.92 // 그림 내용이 프레임 키의 92%
  let cx = CGFloat(bb.x0 + bb.x1 + 1) / 2
  let cyTop = CGFloat(bb.y0 + bb.y1 + 1) / 2 // 위에서 잰 가운데
  let crop = CGRect(x: cx - side / 2, y: W - (cyTop + side / 2), width: side, height: side)
  let b = resample(img, crop: crop, size: 192)
  for i in stride(from: 0, to: b.w * b.h * 4, by: 4) {
    let a = Int(b.p[i + 3])
    if a >= 228 && a < 255 {
      for c in 0..<3 { b.p[i + c] = UInt8(min(255, Int(b.p[i + c]) * 255 / a)) }
      b.p[i + 3] = 255
    }
  }
  save(b.image, "album/\(who).png")
}

// ── 1-2. 빈 끼니 칸 그림(빈 그릇): 프레임 그대로 168px (칸 안에 44px로 들어간다) ──
for meal in ["breakfast", "lunch", "dinner"] {
  let img = load("slot-\(meal).png")
  let b = resample(img, crop: CGRect(x: 0, y: 0, width: img.width, height: img.height), size: 168)
  for i in stride(from: 0, to: b.w * b.h * 4, by: 4) {
    let a = Int(b.p[i + 3])
    if a >= 228 && a < 255 {
      for c in 0..<3 { b.p[i + c] = UInt8(min(255, Int(b.p[i + c]) * 255 / a)) }
      b.p[i + 3] = 255
    }
  }
  save(b.image, "slot/\(meal).png")
}

// ── 2. 달력 도장: 테두리에 딱 맞게 잘라 120px, 잉크 색으로 ──
func stamp(_ name: String, ink: (Int, Int, Int), out: String) {
  let img = load(name)
  let full = Bitmap(img)
  let bb = bbox(full)
  let side = CGFloat(max(bb.x1 - bb.x0, bb.y1 - bb.y0) + 1) * 1.03
  let cx = CGFloat(bb.x0 + bb.x1 + 1) / 2, cy = CGFloat(img.height) - CGFloat(bb.y0 + bb.y1 + 1) / 2 // 그리기 좌표(y=0이 아래)로
  let b = resample(img, crop: CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side), size: 120)
  let (r, g, bl) = ink
  for i in stride(from: 0, to: b.w * b.h * 4, by: 4) {
    let a = Int(b.p[i + 3])
    b.p[i] = UInt8(r * a / 255); b.p[i + 1] = UInt8(g * a / 255); b.p[i + 2] = UInt8(bl * a / 255)
  }
  save(b.image, out)
}
// 세 끼를 채운 날: 오둥이 하늘 · 퍼펭이 민트 잉크
let inks: [String: (Int, Int, Int)] = ["odung": (74, 127, 208), "perpeng": (47, 154, 137)]
for who in ["odung", "perpeng"] {
  for face in ["smile", "yum", "wink"] {
    stamp("stamp-\(who)-\(face).png", ink: inks[who]!, out: "stamp/\(who)-\(face).png")
  }
}
// 못 채운 날(지난날): 두 캐릭터 모두 회색 잉크 (#8b95a1)
for who in ["odung", "perpeng"] {
  for face in ["sad", "hungry"] {
    stamp("stamp-\(who)-miss-\(face).png", ink: (139, 149, 161), out: "stamp/\(who)-miss-\(face).png")
  }
}

// ── 3. 사진 도장 고리 + 같은 바깥선의 원판 ──
do {
  let img = load("seal-ring-rough.png")
  let full = Bitmap(img)
  let bb = bbox(full, thr: 40)
  // 고리 바깥 지름이 그림 폭의 98.5%가 되게 (앱은 원판 지름 2R을 0.985로 나눈 크기로 그린다)
  let side = CGFloat(max(bb.x1 - bb.x0, bb.y1 - bb.y0) + 1) / 0.985
  let cx = CGFloat(bb.x0 + bb.x1 + 1) / 2, cy = CGFloat(img.height) - CGFloat(bb.y0 + bb.y1 + 1) / 2 // 그리기 좌표(y=0이 아래)로
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
