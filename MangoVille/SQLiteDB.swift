import Foundation
import SQLite3

enum DBError: Error { case open(String), sql(String) }

private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

enum Arg {
    case int(Int)
    case text(String)
    case blob(Data)
    case null
}

/// Minimal wrapper over the SQLite that ships with iOS — no third-party packages.
final class SQLiteDB {
    private var handle: OpaquePointer?

    init(path: String) throws {
        if sqlite3_open(path, &handle) != SQLITE_OK {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "cannot open"
            sqlite3_close(handle)
            throw DBError.open(message)
        }
    }

    deinit { sqlite3_close(handle) }

    private var lastError: String {
        handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
    }

    /// Runs one or more statements without parameters (used for the schema).
    func script(_ sql: String) throws {
        if sqlite3_exec(handle, sql, nil, nil, nil) != SQLITE_OK { throw DBError.sql(lastError) }
    }

    private func prepare(_ sql: String, _ args: [Arg]) throws -> OpaquePointer {
        var raw: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &raw, nil) == SQLITE_OK, let statement = raw else {
            throw DBError.sql(lastError)
        }
        for (i, arg) in args.enumerated() {
            let index = Int32(i + 1)
            switch arg {
            case .int(let v): sqlite3_bind_int64(statement, index, Int64(v))
            case .text(let s): sqlite3_bind_text(statement, index, s, -1, transient)
            case .blob(let d):
                _ = d.withUnsafeBytes { sqlite3_bind_blob(statement, index, $0.baseAddress, Int32(d.count), transient) }
            case .null: sqlite3_bind_null(statement, index)
            }
        }
        return statement
    }

    func run(_ sql: String, _ args: [Arg] = []) throws {
        let statement = try prepare(sql, args)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw DBError.sql(lastError) }
    }

    func rows<T>(_ sql: String, _ args: [Arg] = [], _ map: (Row) -> T) throws -> [T] {
        let statement = try prepare(sql, args)
        defer { sqlite3_finalize(statement) }
        var out: [T] = []
        while true {
            let code = sqlite3_step(statement)
            if code == SQLITE_ROW {
                out.append(map(Row(statement)))
            } else if code == SQLITE_DONE {
                break
            } else {
                throw DBError.sql(lastError)
            }
        }
        return out
    }
}

struct Row {
    private let statement: OpaquePointer
    init(_ statement: OpaquePointer) { self.statement = statement }

    func int(_ column: Int32) -> Int { Int(sqlite3_column_int64(statement, column)) }
    func data(_ column: Int32) -> Data? {
        guard let bytes = sqlite3_column_blob(statement, column) else { return nil }
        let count = Int(sqlite3_column_bytes(statement, column))
        return count == 0 ? nil : Data(bytes: bytes, count: count)
    }
    func text(_ column: Int32) -> String {
        sqlite3_column_text(statement, column).map { String(cString: $0) } ?? ""
    }
}
