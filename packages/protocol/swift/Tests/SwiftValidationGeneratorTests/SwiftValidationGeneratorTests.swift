import XCTest

final class SwiftValidationGeneratorTests: XCTestCase {
    private func check(
        _ text: String = "abc", _ number: Double = 1,
        _ token: String = "fixed", _ date: String = "2024-02-29T23:59:59+01:00",
        _ labels: [String]? = nil, _ marker: String = "12$", keyword: String? = nil,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let value = LotseProtocolBundle(text: text, number: number, token: token,
                                       date: date, labels: labels, marker: marker)
        if let keyword {
            XCTAssertThrowsError(try value.validate(), file: file, line: line) { error in
                guard let error = error as? ProtocolValidationError else {
                    return XCTFail("Unexpected validation error", file: file, line: line)
                }
                XCTAssertEqual(error.keyword, keyword, file: file, line: line)
                if labels != nil {
                    XCTAssertEqual(error.path, ["labels", "0"], file: file, line: line)
                }
            }
        } else {
            XCTAssertNoThrow(try value.validate(), file: file, line: line)
        }
    }

    func testNFR13GeneratedSwiftEnforcesConstraintsAbsentFromTheFrozenSchema() {
        check()
        check("ab")
        check("a", keyword: "minLength")
        check("abcd", keyword: "maxLength")
        check("😀")
        check("😀😀", keyword: "maxLength")
        check("a\u{0301}")
        check("abc", 0, keyword: "exclusiveMinimum")
        check("abc", 10, keyword: "exclusiveMaximum")
        check("abc", 0.5, keyword: "type")
        check("abc", .infinity, keyword: "type")
        check("abc", .nan, keyword: "type")
        check("abc", 1, "wrong", keyword: "const")
        check("abc", 1, "fixed", "2023-02-29T23:59:59Z", keyword: "pattern")
        check("abc", 1, "fixed", "٢٠٢٤-02-29T23:59:59Z", keyword: "pattern")
        check("abc", 1, "fixed", "2024-02-29T23:59:59Z\n", keyword: "pattern")
        check("abc", 1, "fixed", "2024-02-29T23:59:59Z", ["abcd"], keyword: "maxLength")
        check("abc", 1, "fixed", "2024-02-29T23:59:59Z", ["😀"])
        check("abc", 1, "fixed", "2024-02-29T23:59:59Z", nil, "١٢$", keyword: "pattern")
        check("abc", 1, "fixed", "2024-02-29T23:59:59Z", nil, "12", keyword: "pattern")
    }
}
