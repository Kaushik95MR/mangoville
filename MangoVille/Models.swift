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
