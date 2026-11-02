import SwiftUI

private struct DayRef: Identifiable { let id: String }

struct CalendarScreen: View {
    @Environment(Store.self) private var store
    @Binding var month: Date
    @State private var selectedDay: DayRef?
    @State private var newBooking: Booking?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)

    var body: some View {
        let map = store.dayMap(for: month)
        let stats = store.stats(for: month)

        ScrollView {
            VStack(spacing: 14) {
                MonthHeader(month: $month)
                snapshot(stats)
                grid(map)
                legend
            }
            .padding(.horizontal)
        }
        .navigationTitle("Mango Ville")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            TodayButton(month: $month)
            ToolbarItem(placement: .topBarTrailing) {
                Button { newBooking = Booking(start: defaultStart) } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New booking")
            }
        }
        .sheet(item: $selectedDay) { DaySheet(day: $0.id) }
        .sheet(item: $newBooking) { BookingForm(booking: $0) }
    }

    private var defaultStart: String {
        let today = DateKey.today
        return today.hasPrefix(String(DateKey.string(month).prefix(7))) ? today : DateKey.string(month)
    }

    private func snapshot(_ s: MonthStats) -> some View {
        Card {
            HStack(alignment: .top) {
                StatCell(title: "Revenue", value: Fmt.inr(s.revenue))
                StatCell(title: "Profit", value: Fmt.inr(s.net), tint: s.net < 0 ? .red : .primary)
                StatCell(title: "Booked", value: "\(s.occupied)/\(s.daysInMonth)")
                StatCell(title: "Due", value: Fmt.inr(s.pending), tint: s.pending > 0 ? .red : .primary)
            }
        }
    }

    private func grid(_ map: [String: [Booking]]) -> some View {
        let first = month
        let days = Cal.g.range(of: .day, in: .month, for: month)?.count ?? 30
        let lead = (Cal.g.component(.weekday, from: first) + 5) % 7
        let today = DateKey.today

        return LazyVGrid(columns: columns, spacing: 4) {
            ForEach(Array(["M", "T", "W", "T", "F", "S", "S"].enumerated()), id: \.offset) { _, d in
                Text(d).font(.caption.weight(.bold)).foregroundStyle(.secondary)
            }
            ForEach(0..<lead, id: \.self) { _ in Color.clear.frame(height: 58) }
            ForEach(1...days, id: \.self) { d in
                let key = DateKey.add(DateKey.string(first), d - 1)
                DayCell(day: d, key: key, bookings: map[key] ?? [], isToday: key == today, isPast: key < today)
                    .onTapGesture { selectedDay = DayRef(id: key) }
            }
        }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            LegendDot(color: Theme.booked, label: "Booked")
            LegendDot(color: Theme.missed, label: "Not occupied")
            LegendDot(color: Theme.free, label: "Available")
            Text("T total · A advance · D due")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.bottom, 8)
    }
}

private struct DayCell: View {
    let day: Int
    let key: String
    let bookings: [Booking]
    let isToday: Bool
    let isPast: Bool

    private var fill: Color {
        if !bookings.isEmpty { return Theme.booked }
        return isPast ? Theme.missed : Theme.free
    }

    var body: some View {
        VStack(spacing: 2) {
            Text("\(day)").font(.callout.weight(.semibold))
            if let first = bookings.first {
                Group {
                    Text(first.firstName + (bookings.count > 1 ? " +\(bookings.count - 1)" : ""))
                    if first.start == key {
                        if !first.phone.isEmpty { Text(first.phone) }
                        Text("T \(first.total)")
                        Text("A \(first.advance)")
                        Text(first.due > 0 ? "D \(first.due)" : "Paid")
                            .foregroundStyle(first.due > 0 ? Color.red : Color.primary)
                    } else {
                        Text("↳ stay")
                    }
                }
                .font(.system(size: 8.5, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 58)
        .background(fill.opacity(0.28), in: RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .topTrailing) {
            if bookings.contains(where: { $0.due > 0 }) {
                Circle().fill(Theme.due).frame(width: 8, height: 8).padding(5)
            }
        }
        .overlay {
            if isToday { RoundedRectangle(cornerRadius: 10).stroke(Theme.green, lineWidth: 2) }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct LegendDot: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 3).fill(color.opacity(0.4)).frame(width: 12, height: 12)
            Text(label)
        }
    }
}

/// Bookings that cover one day, with a shortcut to add another.
private struct DaySheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    let day: String
    @State private var editing: Booking?

    var body: some View {
        let list = store.bookings.filter { $0.days.contains(day) }
        NavigationStack {
            List {
                if list.isEmpty {
                    Text("Available — no booking").foregroundStyle(.secondary)
                }
                ForEach(list) { b in
                    Button { editing = b } label: { BookingRow(booking: b) }.buttonStyle(.plain)
                }
                Button { editing = Booking(start: day) } label: {
                    Label("New booking", systemImage: "plus.circle.fill")
                }
            }
            .navigationTitle(Fmt.long(day))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $editing) { BookingForm(booking: $0) }
        }
        .presentationDetents([.medium, .large])
    }
}
