import Capacitor
import Photos
import UIKit

@objc(TripBoogieImagesPlugin)
public class TripBoogieImagesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TripBoogieImagesPlugin"
    public let jsName = "TripBoogieImages"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "saveImage", returnType: CAPPluginReturnPromise)]

    @objc func saveImage(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), encoded.utf8.count <= 33554432,
              let data = Data(base64Encoded: encoded),
              data.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]), UIImage(data: data) != nil else {
            call.reject("Invalid image", "SAVE_FAILED"); return
        }
        let name = String((call.getString("name") ?? "tripboogie.png").replacingOccurrences(of: "[\\\\/\\p{Cc}]", with: "_", options: .regularExpression).prefix(160))
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Photo permission denied", "PERMISSION_DENIED"); return
            }
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = name
                request.addResource(with: .photo, data: data, options: options)
            }) { success, _ in
                if success { call.resolve() }
                else { call.reject("Could not save image", "SAVE_FAILED") }
            }
        }
    }
}
