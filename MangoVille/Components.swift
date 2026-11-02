import SwiftUI

enum Theme {
    static let green = Color(red: 0.12, green: 0.37, blue: 0.23)
    static let booked = Color.green
    static let missed = Color.red
    static let free = Color.blue
    static let due = Color.orange
}

enum Fmt {
    private static let money: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "en_IN")
        f.maximumFractionDigits = 0
        return f
    }()

    static func inr(_ n: Int) -> String {
        (n < 0 ? "-" : "") + "₹" + (money.string(from: NSNumber(value: abs(n))) ?? "\(abs(n))")
    }

    static func short(_ key: String) -> String {
        DateKey.date(key)?.formatted(.dateTime.day().month(.abbreviated)) ?? key
    }

    static func long(_ key: String) -> String {
        DateKey.date(key)?.formatted(.dateTime.weekday(.wide).day().month(.wide)) ?? key
    }
}

/// Month title with previous / next arrows, shared by all three tabs.
struct MonthHeader: View {
    @Binding var month: Date

    var body: some View {
        HStack {
            Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .buttonStyle(.borderless)
            Spacer()
            Text(month, format: .dateTime.month(.wide).year())
                .font(.title2.bold())
            Spacer()
            Button { shift(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .buttonStyle(.borderless)
        }
    }

    private func shift(_ n: Int) {
        if let d = Cal.g.date(byAdding: .month, value: n, to: month) { month = Cal.monthStart(d) }
    }
}

struct TodayButton: ToolbarContent {
    @Binding var month: Date

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Today") { month = Cal.monthStart(Date()) }
        }
    }
}

struct StatCell: View {
    let title: String
    let value: String
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16))
    }
}

struct BookingRow: View {
    let booking: Booking
    var showDate = false

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(booking.guest.isEmpty ? "Guest" : booking.guest).font(.body.weight(.semibold))
                Text((showDate ? Fmt.short(booking.start) + " · " : "")
                     + "\(booking.nights) night\(booking.nights > 1 ? "s" : "") · \(booking.source)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Fmt.inr(booking.total)).font(.body.weight(.semibold))
                Text(booking.due > 0 ? "Due \(Fmt.inr(booking.due))" : "Paid")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(booking.due > 0 ? Theme.due : Theme.booked)
            }
        }
        .contentShape(Rectangle())
    }
}
