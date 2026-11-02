import SwiftUI

/// Booking details to send to the guest — shown right after a booking is created.
struct BookingConfirmation: View {
    @Environment(\.dismiss) private var dismiss
    let booking: Booking

    private var text: String { booking.confirmationText() }

    private var whatsAppURL: URL? {
        let digits = Customer.normalize(booking.phone)
        let number = digits.isEmpty ? "" : "91" + digits
        let encoded = text.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "https://wa.me/\(number)?text=\(encoded)")
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row("Guest", booking.guest.isEmpty ? "Guest" : booking.guest)
                    row("Check-in", stamp(booking.start, booking.checkInTime))
                    row("Check-out", stamp(DateKey.add(booking.start, max(1, booking.nights)), booking.checkOutTime))
                    row("Stay", "\(booking.nights) night\(booking.nights > 1 ? "s" : "") · \(booking.guests) guests")
                    row("Total", Fmt.inr(booking.total))
                    row("Advance", Fmt.inr(booking.advance))
                    if booking.due > 0 {
                        row("Balance due", Fmt.inr(booking.due), tint: .red)
                    } else {
                        row("Payment", "Fully paid", tint: .green)
                    }
                } header: {
                    Text("Mango Ville · confirmation")
                }
                Section {
                    ShareLink(item: text, subject: Text("Mango Ville booking")) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    if let url = whatsAppURL {
                        Link(destination: url) { Label("Send on WhatsApp", systemImage: "message.fill") }
                    }
                    Button { UIPasteboard.general.string = text } label: { Label("Copy text", systemImage: "doc.on.doc") }
                }
            }
            .navigationTitle("Booking details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.fontWeight(.semibold) } }
        }
        .presentationDetents([.large])
    }

    private func row(_ title: String, _ value: String, tint: Color = .primary) -> some View {
        LabeledContent(title) { Text(value).fontWeight(.semibold).foregroundStyle(tint) }
    }

    private func stamp(_ day: String, _ time: String) -> String {
        Clock.combine(day: day, time: time)
            .formatted(Date.FormatStyle().weekday(.abbreviated).day().month(.abbreviated).year().hour().minute())
    }
}
