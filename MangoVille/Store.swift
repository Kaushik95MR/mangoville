import Foundation
import Observation

/// Single source of truth. Everything is read from and written to the on-device SQLite file.
@MainActor
@Observable
final class Store {
    private(set) var bookings: [Booking] = []
    private(set) var expenses: [Expense] = []
    private(set) var fixedCost = 12000
    var errorMessage: String?

    @ObservationIgnored private var db: SQLiteDB?

    private static let schema = """
    CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT, start TEXT NOT NULL, nights INTEGER NOT NULL DEFAULT 1,
      guest TEXT DEFAULT '', phone TEXT DEFAULT '', source TEXT DEFAULT 'Direct', total INTEGER DEFAULT 0, advance INTEGER DEFAULT 0,
      settled INTEGER DEFAULT 0, notes TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, description TEXT DEFAULT '',
      category TEXT DEFAULT 'Other', amount INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    INSERT OR IGNORE INTO settings VALUES('fixed_cost','12000');
    """

    static var databaseURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("mango-ville.sqlite")
    }

    init() { open() }

    private func open() {
        do {
            let database = try SQLiteDB(path: Self.databaseURL.path)
            try database.script(Self.schema)
            db = database
            reload()
        } catch {
            errorMessage = "Could not open the database: \(error)"
        }
    }

    private func reload() {
        guard let db else { return }
        do {
            bookings = try db.rows("SELECT id,start,nights,guest,phone,source,total,advance,settled,notes FROM bookings ORDER BY start,id") { r in
                Booking(id: r.int(0), start: r.text(1), nights: max(1, r.int(2)), guest: r.text(3), phone: r.text(4),
                        source: r.text(5), total: r.int(6), advance: r.int(7), settled: r.int(8) != 0, notes: r.text(9))
            }
            expenses = try db.rows("SELECT id,date,description,category,amount FROM expenses ORDER BY date DESC,id DESC") { r in
                Expense(id: r.int(0), date: r.text(1), desc: r.text(2), category: r.text(3), amount: r.int(4))
            }
            fixedCost = try db.rows("SELECT value FROM settings WHERE key='fixed_cost'") { Int($0.text(0)) ?? 0 }.first ?? 0
        } catch {
            errorMessage = "Could not read data: \(error)"
        }
    }

    private func write(_ sql: String, _ args: [Arg]) {
        do { try db?.run(sql, args) } catch { errorMessage = "Could not save: \(error)" }
        reload()
    }

    // MARK: Bookings

    func save(_ b: Booking) {
        let args: [Arg] = [.text(b.start), .int(b.nights), .text(b.guest), .text(b.phone), .text(b.source),
                           .int(b.total), .int(b.advance), .int(b.settled ? 1 : 0), .text(b.notes)]
        if b.id == 0 {
            write("INSERT INTO bookings(start,nights,guest,phone,source,total,advance,settled,notes) VALUES(?,?,?,?,?,?,?,?,?)", args)
        } else {
            write("UPDATE bookings SET start=?,nights=?,guest=?,phone=?,source=?,total=?,advance=?,settled=?,notes=? WHERE id=?",
                  args + [.int(b.id)])
        }
    }

    func delete(_ b: Booking) { write("DELETE FROM bookings WHERE id=?", [.int(b.id)]) }

    // MARK: Expenses

    func save(_ e: Expense) {
        let args: [Arg] = [.text(e.date), .text(e.desc), .text(e.category), .int(e.amount)]
        if e.id == 0 {
            write("INSERT INTO expenses(date,description,category,amount) VALUES(?,?,?,?)", args)
        } else {
            write("UPDATE expenses SET date=?,description=?,category=?,amount=? WHERE id=?", args + [.int(e.id)])
        }
    }

    func delete(_ e: Expense) { write("DELETE FROM expenses WHERE id=?", [.int(e.id)]) }

    func setFixedCost(_ value: Int) {
        write("INSERT OR REPLACE INTO settings(key,value) VALUES('fixed_cost',?)", [.text(String(value))])
    }

    // MARK: Month views

    /// Every booked night in the month, keyed by "yyyy-MM-dd".
    func dayMap(for month: Date) -> [String: [Booking]] {
        let key = String(DateKey.string(month).prefix(7))
        var map: [String: [Booking]] = [:]
        for b in bookings {
            for day in b.days where day.hasPrefix(key) { map[day, default: []].append(b) }
        }
        return map
    }

    /// Revenue is counted in the month of check-in, as in the original sheet.
    func stats(for month: Date) -> MonthStats {
        let key = String(DateKey.string(month).prefix(7))
        let inMonth = bookings.filter { $0.start.hasPrefix(key) }
        let spent = expenses.filter { $0.date.hasPrefix(key) }.reduce(0) { $0 + $1.amount }
        var bySource: [String: Int] = [:]
        for b in inMonth { bySource[b.source, default: 0] += b.total }
        return MonthStats(
            revenue: inMonth.reduce(0) { $0 + $1.total },
            pending: inMonth.reduce(0) { $0 + $1.due },
            expenses: spent,
            fixed: (!inMonth.isEmpty || spent > 0) ? fixedCost : 0,
            occupied: dayMap(for: month).count,
            daysInMonth: Cal.g.range(of: .day, in: .month, for: month)?.count ?? 30,
            bySource: bySource.sorted { $0.value > $1.value }.map { SourceTotal(name: $0.key, amount: $0.value) }
        )
    }

    func monthExpenses(_ month: Date) -> [Expense] {
        let key = String(DateKey.string(month).prefix(7))
        return expenses.filter { $0.date.hasPrefix(key) }
    }

    var pendingDues: [Booking] { bookings.filter { $0.due > 0 } }

    // MARK: Backup & restore

    /// Writes a consistent copy of the database to a temporary file for sharing.
    func makeBackup() -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mango-ville-\(DateKey.today).sqlite")
        try? FileManager.default.removeItem(at: url)
        do {
            try db?.run("VACUUM INTO ?", [.text(url.path)])
            return url
        } catch {
            errorMessage = "Could not create backup: \(error)"
            return nil
        }
    }

    /// Replaces the whole database with the chosen file after checking it looks right.
    func restore(from picked: URL) -> Bool {
        let scoped = picked.startAccessingSecurityScopedResource()
        defer { if scoped { picked.stopAccessingSecurityScopedResource() } }
        let fm = FileManager.default
        let temp = fm.temporaryDirectory.appendingPathComponent("restore-\(UUID().uuidString).sqlite")
        do {
            try fm.copyItem(at: picked, to: temp)
            let check = try SQLiteDB(path: temp.path)
            try check.script(Self.schema)
            _ = try check.rows("SELECT count(*) FROM bookings") { $0.int(0) }
            _ = try check.rows("SELECT count(*) FROM expenses") { $0.int(0) }
        } catch {
            errorMessage = "That file is not a Mango Ville backup."
            try? fm.removeItem(at: temp)
            return false
        }
        db = nil
        let target = Self.databaseURL
        for suffix in ["", "-wal", "-shm", "-journal"] {
            try? fm.removeItem(atPath: target.path + suffix)
        }
        do {
            try fm.moveItem(at: temp, to: target)
        } catch {
            errorMessage = "Could not restore: \(error)"
        }
        open()
        return true
    }
}
