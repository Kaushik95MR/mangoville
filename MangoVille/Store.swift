import Foundation
import Observation

/// Single source of truth. Everything is read from and written to the on-device SQLite file.
@MainActor
@Observable
final class Store {
    private(set) var bookings: [Booking] = []
    private(set) var expenses: [Expense] = []
    private(set) var customers: [Customer] = []
    private(set) var extraCategories: [String] = []
    private(set) var fixedCost = 12000
    var errorMessage: String?

    @ObservationIgnored private var db: SQLiteDB?

    private static let schema = """
    CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT, start TEXT NOT NULL, nights INTEGER NOT NULL DEFAULT 1,
      guest TEXT DEFAULT '', phone TEXT DEFAULT '', source TEXT DEFAULT 'Direct', total INTEGER DEFAULT 0, advance INTEGER DEFAULT 0,
      settled INTEGER DEFAULT 0, notes TEXT DEFAULT '', checkin_time TEXT DEFAULT '14:00', checkout_time TEXT DEFAULT '11:00', guests INTEGER DEFAULT 2);
    CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, description TEXT DEFAULT '',
      category TEXT DEFAULT 'Other', amount INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT '', phone TEXT DEFAULT '', city TEXT DEFAULT '',
      id_proof TEXT DEFAULT '', notes TEXT DEFAULT '', id_img BLOB);
    INSERT OR IGNORE INTO settings VALUES('fixed_cost','12000');
    """

    private static let customerColumns = "id,name,phone,city,id_proof,notes,id_img"

    private static func customer(_ r: Row) -> Customer {
        Customer(id: r.int(0), name: r.text(1), phone: r.text(2), city: r.text(3), idProof: r.text(4), notes: r.text(5), idImage: r.data(6))
    }

    /// Creates the tables, then adds any columns that older databases (or the bundled seed) are missing.
    private static func prepare(_ database: SQLiteDB) throws {
        try database.script(schema)
        let additions: [(table: String, column: String, definition: String)] = [
            ("bookings", "checkin_time", "TEXT DEFAULT '14:00'"),
            ("bookings", "checkout_time", "TEXT DEFAULT '11:00'"),
            ("bookings", "guests", "INTEGER DEFAULT 2"),
            ("customers", "id_img", "BLOB"),
        ]
        for item in additions {
            let existing = try database.rows("PRAGMA table_info(\(item.table))") { $0.text(1) }
            if !existing.contains(item.column) {
                try database.script("ALTER TABLE \(item.table) ADD COLUMN \(item.column) \(item.definition)")
            }
        }
    }

    static var databaseURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("mango-ville.sqlite")
    }

    init() { open() }

    /// First launch only: start from the bundled history (seed.sqlite) instead of an empty database.
    private static func installSeedIfNeeded() {
        let fm = FileManager.default
        guard !fm.fileExists(atPath: databaseURL.path),
              let seed = Bundle.main.url(forResource: "seed", withExtension: "sqlite") else { return }
        try? fm.copyItem(at: seed, to: databaseURL)
    }

    private func open() {
        Self.installSeedIfNeeded()
        do {
            let database = try SQLiteDB(path: Self.databaseURL.path)
            try Self.prepare(database)
            db = database
            backfillCustomers()
            reload()
        } catch {
            errorMessage = "Could not open the database: \(error)"
        }
    }

    private func reload() {
        guard let db else { return }
        do {
            bookings = try db.rows("SELECT id,start,nights,guest,phone,source,total,advance,settled,notes,checkin_time,checkout_time,guests FROM bookings ORDER BY start,id") { r in
                Booking(id: r.int(0), start: r.text(1), nights: max(1, r.int(2)), guest: r.text(3), phone: r.text(4),
                        source: r.text(5), total: r.int(6), advance: r.int(7), settled: r.int(8) != 0, notes: r.text(9),
                        checkInTime: r.text(10).isEmpty ? "14:00" : r.text(10),
                        checkOutTime: r.text(11).isEmpty ? "11:00" : r.text(11),
                        guests: max(1, r.int(12)))
            }
            expenses = try db.rows("SELECT id,date,description,category,amount FROM expenses ORDER BY date DESC,id DESC") { r in
                Expense(id: r.int(0), date: r.text(1), desc: r.text(2), category: r.text(3), amount: r.int(4))
            }
            customers = try db.rows("SELECT \(Self.customerColumns) FROM customers ORDER BY name COLLATE NOCASE") { Self.customer($0) }
            extraCategories = (try db.rows("SELECT value FROM settings WHERE key='extra_categories'") { $0.text(0) }.first ?? "")
                .split(separator: "\n").map(String.init)
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

    /// Saves the booking and keeps the guest's address-book entry (and Aadhaar photo, if one was added) in step.
    @discardableResult
    func save(_ b: Booking, idImage: Data? = nil) -> Int {
        let customerID = ensureCustomer(guest: b.guest, phone: b.phone)
        if let idImage, customerID != 0 {
            try? db?.run("UPDATE customers SET id_img=? WHERE id=?", [.blob(idImage), .int(customerID)])
        }
        let args: [Arg] = [.text(b.start), .int(b.nights), .text(b.guest), .text(b.phone), .text(b.source),
                           .int(b.total), .int(b.advance), .int(b.settled ? 1 : 0), .text(b.notes),
                           .text(b.checkInTime), .text(b.checkOutTime), .int(b.guests)]
        if b.id == 0 {
            write("INSERT INTO bookings(start,nights,guest,phone,source,total,advance,settled,notes,checkin_time,checkout_time,guests) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", args)
        } else {
            write("UPDATE bookings SET start=?,nights=?,guest=?,phone=?,source=?,total=?,advance=?,settled=?,notes=?,checkin_time=?,checkout_time=?,guests=? WHERE id=?",
                  args + [.int(b.id)])
            return b.id
        }
        return bookings.map(\.id).max() ?? 0
    }

    /// The one saved customer matching this name / phone, if there is exactly one.
    func customer(matching guest: String, phone: String) -> Customer? {
        let name = guest.trimmingCharacters(in: .whitespaces)
        let number = Customer.normalize(phone)
        if name.isEmpty && number.isEmpty { return nil }
        let hits = customers.filter { number.count >= 10 ? Customer.normalize($0.phone) == number : $0.matches(guest: name, phone: number) }
        return hits.count == 1 ? hits[0] : nil
    }

    func delete(_ b: Booking) { write("DELETE FROM bookings WHERE id=?", [.int(b.id)]) }

    // MARK: Customers

    /// Adds an address-book entry for this guest unless one already matches.
    @discardableResult
    private func ensureCustomer(guest: String, phone: String) -> Int {
        let name = guest.trimmingCharacters(in: .whitespaces)
        let number = Customer.normalize(phone)
        if name.isEmpty && number.isEmpty { return 0 }
        if number.isEmpty && Choices.sources.contains(name) { return 0 }
        guard let db else { return 0 }
        let existing = (try? db.rows("SELECT \(Self.customerColumns) FROM customers") { Self.customer($0) }) ?? []
        if let hit = existing.first(where: { $0.matches(guest: name, phone: number) }) {
            if Customer.normalize(hit.phone).isEmpty && !number.isEmpty {
                try? db.run("UPDATE customers SET phone=? WHERE id=?", [.text(number), .int(hit.id)])
            }
            return hit.id
        }
        try? db.run("INSERT INTO customers(name,phone) VALUES(?,?)", [.text(name), .text(number)])
        return (try? db.rows("SELECT last_insert_rowid()") { $0.int(0) })?.first ?? 0
    }

    /// Makes sure every guest in the bookings (for example after a restore) has a customer entry.
    private func backfillCustomers() {
        guard let db else { return }
        let rows = (try? db.rows("SELECT guest,phone FROM bookings") { ($0.text(0), $0.text(1)) }) ?? []
        for (guest, phone) in rows { ensureCustomer(guest: guest, phone: phone) }
    }

    func bookings(for customer: Customer) -> [Booking] {
        bookings.filter { customer.matches(guest: $0.guest, phone: $0.phone) }.sorted { $0.start > $1.start }
    }

    func save(_ c: Customer) {
        let image: Arg = c.idImage.map { Arg.blob($0) } ?? .null
        let args: [Arg] = [.text(c.name), .text(Customer.normalize(c.phone)), .text(c.city), .text(c.idProof), .text(c.notes), image]
        if c.id == 0 {
            write("INSERT INTO customers(name,phone,city,id_proof,notes,id_img) VALUES(?,?,?,?,?,?)", args)
        } else {
            // keep the guest's bookings attached if the name or number changed
            if let old = customers.first(where: { $0.id == c.id }) {
                for b in bookings(for: old) {
                    try? db?.run("UPDATE bookings SET guest=?,phone=? WHERE id=?", [.text(c.name), .text(Customer.normalize(c.phone)), .int(b.id)])
                }
            }
            write("UPDATE customers SET name=?,phone=?,city=?,id_proof=?,notes=?,id_img=? WHERE id=?", args + [.int(c.id)])
        }
    }

    func delete(_ c: Customer) { write("DELETE FROM customers WHERE id=?", [.int(c.id)]) }

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

    /// Built-in categories, ones you added, and any already used by an expense ("Other" stays last).
    func allCategories(including selected: String = "") -> [String] {
        var seen = Set<String>()
        let all = (Choices.categories + extraCategories + expenses.map(\.category) + [selected])
            .filter { !$0.isEmpty && $0 != "Other" && seen.insert($0).inserted }
        return all + ["Other"]
    }

    func addCategory(_ name: String) {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty,
              !allCategories().contains(where: { $0.caseInsensitiveCompare(clean) == .orderedSame }) else { return }
        write("INSERT OR REPLACE INTO settings(key,value) VALUES('extra_categories',?)",
              [.text((extraCategories + [clean]).joined(separator: "\n"))])
    }

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
            try Self.prepare(check)
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
