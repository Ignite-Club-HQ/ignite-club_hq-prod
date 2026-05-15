import Capacitor
import Foundation
import Photos

@objc(IgnitePhotoSaverPlugin)
public class IgnitePhotoSaverPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IgnitePhotoSaverPlugin"
    public let jsName = "IgnitePhotoSaver"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "savePhoto", returnType: CAPPluginReturnPromise)
    ]

    @objc func savePhoto(_ call: CAPPluginCall) {
        if let dataUrl = call.getString("dataUrl") {
            saveImageData(dataUrlToData(dataUrl), call: call)
            return
        }

        if let base64 = call.getString("base64") {
            saveImageData(Data(base64Encoded: base64), call: call)
            return
        }

        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Must provide url, dataUrl, or base64", "argumentError")
            return
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 30

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                call.reject("Unable to download image: \(error.localizedDescription)", "downloadError", error)
                return
            }

            if let httpResponse = response as? HTTPURLResponse,
               !(200...299).contains(httpResponse.statusCode) {
                call.reject("Unable to download image: HTTP \(httpResponse.statusCode)", "downloadError")
                return
            }

            self.saveImageData(data, call: call)
        }.resume()
    }

    private func dataUrlToData(_ dataUrl: String) -> Data? {
        guard let commaIndex = dataUrl.firstIndex(of: ",") else {
            return Data(base64Encoded: dataUrl)
        }

        return Data(base64Encoded: String(dataUrl[dataUrl.index(after: commaIndex)...]))
    }

    private func saveImageData(_ data: Data?, call: CAPPluginCall) {
        guard let imageData = data, !imageData.isEmpty else {
            call.reject("Image data was empty", "argumentError")
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Access to photos not allowed by user", "accessDenied")
                return
            }

            var createdIdentifier = ""
            PHPhotoLibrary.shared().performChanges({
                let creationRequest = PHAssetCreationRequest.forAsset()
                creationRequest.addResource(with: .photo, data: imageData, options: nil)
                createdIdentifier = creationRequest.placeholderForCreatedAsset?.localIdentifier ?? ""
            }, completionHandler: { success, error in
                if success {
                    call.resolve(["identifier": createdIdentifier])
                } else {
                    call.reject("Unable to save image to Photos", "filesystemError", error)
                }
            })
        }
    }
}