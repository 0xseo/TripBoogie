// Deterministic size/format conversion only. Original artwork stays unchanged.
// Run from the project root: swift scripts/native-assets.swift
import AppKit
import Foundation
import ImageIO

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let fm = FileManager.default
func url(_ path: String) -> URL { root.appendingPathComponent(path) }
func source(_ path: String) throws -> NSImage {
    guard let image = NSImage(contentsOf: url(path)) else { throw NSError(domain: "TripBoogieAssets", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot open \(path)"]) }
    return image
}
func copy(_ source: String, _ target: String) throws {
    try fm.createDirectory(at: url(target).deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(contentsOf: url(source)).write(to: url(target), options: .atomic)
}
func png(_ image: NSImage, _ path: String, size: Int, background: NSColor?, inset: Double = 0) throws {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0), let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw NSError(domain: "TripBoogieAssets", code: 2) }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    NSColor.clear.setFill(); rect.fill(using: .copy)
    if let background { background.setFill(); rect.fill() }
    image.draw(in: rect.insetBy(dx: Double(size) * inset, dy: Double(size) * inset), from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    // iOS App Store icons must not carry an alpha channel, even when all pixels are opaque.
    var output = bitmap.cgImage!
    if background != nil {
        guard let flat = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw NSError(domain: "TripBoogieAssets", code: 3) }
        flat.draw(output, in: CGRect(x: 0, y: 0, width: size, height: size))
        output = flat.makeImage()!
    }
    try fm.createDirectory(at: url(path).deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let destination = CGImageDestinationCreateWithURL(url(path) as CFURL, "public.png" as CFString, 1, nil) else { throw NSError(domain: "TripBoogieAssets", code: 4) }
    CGImageDestinationAddImage(destination, output, nil)
    guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "TripBoogieAssets", code: 5) }

}
let icon = try source("icon.png")
let blue = NSColor(srgbRed: 0.60, green: 0.80, blue: 0.96, alpha: 1)
try copy("map.png", "public/map-mascot.png")
try copy("splash.png", "public/launch-splash.png")
for (path, size) in [("public/icon-192.png", 192), ("public/icon-512.png", 512), ("public/apple-touch-icon.png", 180), ("public/favicon-32.png", 32)] { try png(icon, path, size: size, background: .white) }
try png(icon, "public/icon-maskable-512.png", size: 512, background: blue, inset: 0.12)
try png(icon, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", size: 1024, background: .white)
try copy("splash.png", "ios/App/App/Assets.xcassets/Splash.imageset/launch.png")
let densities: [(String, Double)] = [("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)]
for (name, scale) in densities {
    let folder = "android/app/src/main/res/mipmap-\(name)"
    try png(icon, "\(folder)/ic_launcher.png", size: Int(48 * scale), background: blue)
    try png(icon, "\(folder)/ic_launcher_round.png", size: Int(48 * scale), background: blue)
    // Android adaptive layers are 108 dp. Artwork is inside the 72 dp safe area.
    try png(icon, "\(folder)/ic_launcher_foreground.png", size: Int(108 * scale), background: nil, inset: 1.0 / 6.0)
}
print("TripBoogie icon, splash and mascot assets generated from icon.png / splash.png / map.png.")
