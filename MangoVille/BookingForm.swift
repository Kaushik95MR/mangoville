import SwiftUI

struct BookingForm: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var booking: Booking
    @State private var startDate: Date
    @State private var totalText: String
    @State private var advanceText: String
    @State private var confirmDelete = false

    init(booking: Booking) {
        _booking = State(initialValue: booking)
        _startDate = State(initialValue: DateKey.date(booking.start) ?? Date())
        _totalText = State(initialValue: booking.total == 0 ? "" : String(booking.total))
        _advanceText = State(initialValue: booking.advance == 0 ? "" : String(booking.advance))
    }

    private var total: Int { Int(totalText) ?? 0 }
    private var advance: Int { Int(advanceText) ?? 0 }
    private var balance: Int { booking.settled ? 0 : max(0, total - advance) }

    var body: some View {
        NavigationStack {
            Form {
                Section("Guest") {
                    TextField("Name", text: $booking.guest)
                        .textContentType(.name)
                    TextField("Mobile number", text: $booking.phone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                }
                Section("Stay") {
                    DatePicker("Check-in", selection: $startDate, displayedComponents: .date)
                    Stepper("Nights: \(booking.nights)", value: $booking.nights, in: 1...60)
                    Picker("Source", selection: $booking.source) {
                        ForEach(Choices.sources, id: \.self) { Text($0) }
                    }
                }
                Section("Payment") {
                    HStack {
                        Text("Total ₹")
                        TextField("0", text: $totalText).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                    HStack {
                        Text("Advance ₹")
                        TextField("0", text: $advanceText).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                    Toggle("Fully paid", isOn: $booking.settled)
                    LabeledContent("Balance") {
                        Text(balance > 0 ? Fmt.inr(balance) : "Nothing due")
                            .fontWeight(.semibold)
                            .foregroundStyle(balance > 0 ? .red : .green)
                    }
                }
                Section("Notes") {
                    TextField("Notes", text: $booking.notes, axis: .vertical).lineLimit(2...5)
                }
                if booking.id != 0 {
                    Section {
                        if !booking.phone.isEmpty, let url = URL(string: "tel:\(booking.phone.filter { $0.isNumber || $0 == "+" })") {
                            Link(destination: url) { Label("Call guest", systemImage: "phone.fill") }
                        }
                        Button("Delete booking", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(booking.id == 0 ? "New booking" : "Edit booking")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).fontWeight(.semibold) }
            }
            .confirmationDialog("Delete this booking?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    store.delete(booking)
                    dismiss()
                }
            }
        }
    }

    private func save() {
        var b = booking
        b.start = DateKey.string(startDate)
        b.total = total
        b.advance = advance
        b.guest = b.guest.trimmingCharacters(in: .whitespaces)
        store.save(b)
        dismiss()
    }
}
