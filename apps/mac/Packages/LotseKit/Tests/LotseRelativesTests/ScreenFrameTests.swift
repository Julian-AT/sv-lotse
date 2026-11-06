import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit
import Testing

@testable import LotseRelatives

@Test("FR-R2 accepts real screen frame attachments containing status and noninteger metadata")
func screenFrameAttachments() throws {
    var pixelBuffer: CVPixelBuffer?
    #expect(CVPixelBufferCreate(nil, 16, 16, kCVPixelFormatType_32BGRA, nil, &pixelBuffer) == kCVReturnSuccess)
    let image = try #require(pixelBuffer)
    var format: CMVideoFormatDescription?
    #expect(CMVideoFormatDescriptionCreateForImageBuffer(allocator: nil, imageBuffer: image, formatDescriptionOut: &format) == noErr)
    var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
    var buffer: CMSampleBuffer?
    #expect(CMSampleBufferCreateReadyWithImageBuffer(allocator: nil, imageBuffer: image,
                                                    formatDescription: try #require(format), sampleTiming: &timing,
                                                    sampleBufferOut: &buffer) == noErr)
    let sample = try #require(buffer)
    let attachments = try #require(CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true)) as NSArray
    let metadata = try #require(attachments.firstObject as? NSMutableDictionary)
    metadata[SCStreamFrameInfo.status] = SCFrameStatus.complete.rawValue
    metadata[SCStreamFrameInfo.contentRect] = CGRect(x: 0, y: 0, width: 16, height: 16).dictionaryRepresentation
    #expect(RelativesScreenFrame.isComplete(sample))
    metadata[SCStreamFrameInfo.status] = SCFrameStatus.idle.rawValue
    #expect(RelativesScreenFrame.isComplete(sample) == false)
}
