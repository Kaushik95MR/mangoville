import Foundation

struct Booking: Identifiable, Hashable {
    var id = 0
    var start: String
    var nights = 1
    var guest = ""
    var phone = ""
    var source = "Direct"
    var total = 0
    var advance = 0
    var settled = false
    var notes = ""
    var checkInTime = "14:00"
    var checkOutTime = "11:00"
    var guests = 2

    var due: Int { settled ? 0 : max(0, total - advance) }
    var days: [String] { (0..<max(nights, 1)).map { DateKey.add(start, $0) } }
    var firstName: String {
        let name = guest.split(separator: " ").first.map(String.init) ?? ""
        return name.isEmpty ? source : name
    }
}

struct Expense: Identifiable, Hashable {
    var id = 0
    var date: String
    var desc = ""
    var category = "Other"
    var amount = 0
}

struct Customer: Identifiable, Hashable {
    var id = 0
    var name = ""
    var phone = ""
    var city = ""
    var idProof = ""
    var notes = ""
    var idImage: Data?

    var isVerified: Bool { idImage != nil }

    var displayName: String { name.isEmpty ? (phone.isEmpty ? "Unnamed" : phone) : name }

    /// Last 10 digits, so "+91 63644 28956" and "6364428956" are the same person.
    static func normalize(_ phone: String) -> String {
        let digits = phone.filter(\.isNumber)
        return digits.count >= 10 ? String(digits.suffix(10)) : digits
    }

    func matches(guest: String, phone other: String) -> Bool {
        let a = Customer.normalize(phone), b = Customer.normalize(other)
        if !a.isEmpty && !b.isEmpty { return a == b }
        let n = name.trimmingCharacters(in: .whitespaces).lowercased()
        return !n.isEmpty && n == guest.trimmingCharacters(in: .whitespaces).lowercased()
    }
}

struct SourceTotal: Identifiable {
    var name: String
    var amount: Int
    var id: String { name }
}

struct MonthStats {
    var revenue = 0
    var pending = 0
    var expenses = 0
    var fixed = 0
    var occupied = 0
    var daysInMonth = 30
    var bySource: [SourceTotal] = []

    var collected: Int { revenue - pending }
    var net: Int { revenue - expenses - fixed }
    var occupancy: Int { daysInMonth == 0 ? 0 : Int((Double(occupied) / Double(daysInMonth) * 100).rounded()) }
}

/// Dates are stored as "yyyy-MM-dd" text so the database is easy to read and sorts correctly.
enum DateKey {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static var today: String { string(Date()) }
    static func string(_ date: Date) -> String { formatter.string(from: date) }
    static func date(_ key: String) -> Date? { formatter.date(from: key) }

    static func add(_ key: String, _ days: Int) -> String {
        guard let d = date(key), let r = Cal.g.date(byAdding: .day, value: days, to: d) else { return key }
        return string(r)
    }
}

enum Clock {
    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f
    }()

    static func time(_ date: Date) -> String { formatter.string(from: date) }

    /// "2026-11-03" + "14:00" -> a Date.
    static func combine(day: String, time: String) -> Date {
        let base = DateKey.date(day) ?? Date()
        let parts = time.split(separator: ":").compactMap { Int($0) }
        let h = parts.first ?? 12
        let m = parts.count > 1 ? parts[1] : 0
        return Cal.g.date(bySettingHour: h, minute: m, second: 0, of: base) ?? base
    }
}

enum Cal {
    static let g: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.firstWeekday = 2
        return c
    }()

    static func monthStart(_ d: Date) -> Date {
        g.date(from: g.dateComponents([.year, .month], from: d)) ?? d
    }
}

enum Choices {
    static let sources = ["Direct", "Airbnb", "Booking.com", "Referral", "Other"]
    static let categories = ["Caretaker / Salary", "Electricity", "Water", "Housekeeping",
                             "Maintenance", "Supplies", "Marketing", "Gas", "Other"]
}
