// TimeStamp app icon: swiftc -O -o /tmp/mk scripts/make-icons.swift && /tmp/mk assets/astro/odung-hero.png assets/astro/stamp-clock.png <out-dir>
// a round clock stamp in the lower right for "time". Art comes from Astro (transparent 1024px PNGs).
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let heroPath = args[1]
let clockPath = args[2]
let outDir = args[3]
let cs = CGColorSpace(name: CGColorSpace.sRGB)!

func load(_ p: String) -> CGImage {
  let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil)!
  return CGImageSourceCreateImageAtIndex(src, 0, nil)!
}
let hero = load(heroPath)
let clock = load(clockPath)

// hero opaque box (top-left coords, 1024 art): x 174-868, y 84-947
let heroBox = (x0: 174.0, x1: 868.0, y0: 84.0)

func save(_ img: CGImage, _ name: String) {
  let url = URL(fileURLWithPath: outDir).appendingPathComponent(name)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

/// content: 1 = full icon composition, < 1 shrinks the art toward the centre (maskable safe zone)
func make(_ size: Int, _ name: String, content: CGFloat) {
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                      space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  let s = CGFloat(size)
  let k = s / 1024 // work in a 1024 design grid, top-left origin
  ctx.interpolationQuality = .high

  // ground: PT Note blue, lighter at the top-left
  let ground = CGGradient(colorsSpace: cs, colors: [
    CGColor(srgbRed: 0x6b / 255, green: 0xab / 255, blue: 0xff / 255, alpha: 1),
    CGColor(srgbRed: 0x2c / 255, green: 0x70 / 255, blue: 0xe8 / 255, alpha: 1),
  ] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(ground, start: CGPoint(x: 0, y: s), end: CGPoint(x: s, y: 0), options: [])
  let glow = CGGradient(colorsSpace: cs, colors: [
    CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.32),
    CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0),
  ] as CFArray, locations: [0, 1])!
  ctx.drawRadialGradient(glow, startCenter: CGPoint(x: s * 0.28, y: s * 0.78), startRadius: 0,
                         endCenter: CGPoint(x: s * 0.28, y: s * 0.78), endRadius: s * 0.62, options: [])

  // design-grid rect (top-left origin) → CG rect (bottom-left origin), shrunk toward centre by `content`
  func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
    let cx = 512 + (x - 512) * content, cy = 512 + (y - 512) * content
    return CGRect(x: cx * k, y: s - (cy + h * content) * k, width: w * content * k, height: h * content * k)
  }

  // 오둥이: scale 1.22, centred on its body, head top 128 from the top, feet run off the bottom edge
  let hs: CGFloat = 1.22
  let heroCenter = (heroBox.x0 + heroBox.x1) / 2
  let hx = 512 - heroCenter * hs - 34
  let hy = 128 - heroBox.y0 * hs
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -14 * k * content), blur: 34 * k * content,
                color: CGColor(srgbRed: 0.04, green: 0.16, blue: 0.42, alpha: 0.35))
  ctx.draw(hero, in: rect(hx, hy, 1024 * hs, 1024 * hs))
  ctx.restoreGState()

  // clock stamp: lower right, tilted like a stamp
  let d: CGFloat = 380 // drawn art size (the clock disc is ~78% of it)
  let cx: CGFloat = 792, cy: CGFloat = 790
  ctx.saveGState()
  let r = rect(cx - d / 2, cy - d / 2, d, d)
  ctx.translateBy(x: r.midX, y: r.midY)
  ctx.rotate(by: 0.16)
  ctx.setShadow(offset: CGSize(width: 0, height: -8 * k * content), blur: 22 * k * content,
                color: CGColor(srgbRed: 0.04, green: 0.16, blue: 0.42, alpha: 0.35))
  ctx.draw(clock, in: CGRect(x: -r.width / 2, y: -r.height / 2, width: r.width, height: r.height))
  ctx.restoreGState()

  save(ctx.makeImage()!, name)
}

make(1024, "icon-1024.png", content: 1)
make(180, "apple-touch-icon.png", content: 1)
make(192, "icon-192.png", content: 1)
make(512, "icon-512.png", content: 1)
make(512, "icon-maskable-512.png", content: 0.8)
print("ok")
