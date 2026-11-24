// TimeStamp app icon: the whole 오둥이 holding a camera (Astro's odung-hero art), uncropped, on PT Note's light canvas.
// Build: swiftc -O -o /tmp/mk scripts/make-icons.swift && /tmp/mk assets/astro/odung-hero.png assets/icons
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let heroPath = args[1]
let outDir = args[2]
let cs = CGColorSpace(name: CGColorSpace.sRGB)!

let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: heroPath) as CFURL, nil)!
let hero = CGImageSourceCreateImageAtIndex(src, 0, nil)!

// opaque box of the art (top-left coords, 1024px): x 175-861, y 83-948
let box = (x0: 175.0, x1: 861.0, y0: 83.0, y1: 948.0)

// background: PT Note's own app-icon sky (its touch icon goes #bfe3fd on the left to #b7defd on the right), no glow
let skyLeft = (r: 0xbf, g: 0xe3, b: 0xfd), skyRight = (r: 0xb7, g: 0xde, b: 0xfd)
let glowRGB = (r: 150.0, g: 192.0, b: 255.0), glowAlpha = 0.0

func save(_ img: CGImage, _ name: String) {
  let url = URL(fileURLWithPath: outDir).appendingPathComponent(name)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

/// fill: how much of the icon height the character takes (0.72 leaves ~14% above and below inside the iOS mask)
func make(_ size: Int, _ name: String, fill: CGFloat) {
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                      space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  let s = CGFloat(size)
  ctx.interpolationQuality = .high

  // same sky as PT Note's icon, left to right
  let ground = CGGradient(colorsSpace: cs, colors: [
    CGColor(srgbRed: CGFloat(skyLeft.r) / 255, green: CGFloat(skyLeft.g) / 255, blue: CGFloat(skyLeft.b) / 255, alpha: 1),
    CGColor(srgbRed: CGFloat(skyRight.r) / 255, green: CGFloat(skyRight.g) / 255, blue: CGFloat(skyRight.b) / 255, alpha: 1),
  ] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(ground, start: CGPoint(x: 0, y: s / 2), end: CGPoint(x: s, y: s / 2), options: [])
  let glow = CGGradient(colorsSpace: cs, colors: [
    CGColor(srgbRed: glowRGB.r / 255, green: glowRGB.g / 255, blue: glowRGB.b / 255, alpha: glowAlpha),
    CGColor(srgbRed: glowRGB.r / 255, green: glowRGB.g / 255, blue: glowRGB.b / 255, alpha: 0),
  ] as CFArray, locations: [0, 1])!
  if glowAlpha > 0 { ctx.drawRadialGradient(glow, startCenter: CGPoint(x: s * 0.5, y: s * 0.46), startRadius: 0,
                         endCenter: CGPoint(x: s * 0.5, y: s * 0.46), endRadius: s * 0.5, options: []) }

  // whole character, centred on its own box
  let k = (s * fill) / CGFloat(box.y1 - box.y0)
  let cx = CGFloat(box.x0 + box.x1) / 2, cy = CGFloat(box.y0 + box.y1) / 2
  let x = s / 2 - cx * k
  let yTop = s / 2 - cy * k // top-left coords
  ctx.draw(hero, in: CGRect(x: x, y: s - (yTop + 1024 * k), width: 1024 * k, height: 1024 * k))
  save(ctx.makeImage()!, name)
}

make(1024, "icon-1024.png", fill: 0.72)
make(180, "apple-touch-icon.png", fill: 0.72)
make(192, "icon-192.png", fill: 0.72)
make(512, "icon-512.png", fill: 0.72)
make(512, "icon-maskable-512.png", fill: 0.6)
print("ok")
