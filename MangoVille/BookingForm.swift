import SwiftUI
import PhotosUI

struct BookingForm: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var booking: Booking
    @State private var checkIn: Date
    @State private var checkOut: Date
    @State private var totalText: String
    @State private var advanceText: String
    @State private var newID: Data?
    @State private var pickerItem: PhotosPickerItem?
    @State private var confirmDelete = false

    init(booking: Booking) {
        _booking = State(initialValue: booking)
        _checkIn = State(initialValue: Clock.combine(day: booking.start, time: booking.checkInTime))
        _checkOut = State(initialValue: Clock.combine(day: DateKey.add(booking.start, max(1, booking.nights)),
                                                      time: booking.checkOutTime))
        _totalText = State(initialValue: booking.total == 0 ? "" : String(booking.total))
        _advanceText = State(initialValue: booking.advance == 0 ? "" : String(booking.advance))
    }

    private var total: Int { Int(totalText) ?? 0 }
    private var advance: Int { Int(advanceText) ?? 0 }
    private var balance: Int { booking.settled ? 0 : max(0, total - advance) }

    private var nights: Int {
        let days = Cal.g.dateComponents([.day], from: Cal.g.startOfDay(for: checkIn), to: Cal.g.startOfDay(for: checkOut)).day ?? 1
        return max(1, days)
    }

    /// The saved customer this name / phone belongs to — their details and Aadhaar load from here.
    private var match: Customer? { store.customer(matching: booking.guest, phone: booking.phone) }

    private var suggestions: [Customer] {
        if match != nil { return [] }
        let text = booking.guest.trimmingCharacters(in: .whitespaces).lowercased()
        let digits = Customer.normalize(booking.phone)
        if text.count < 2 && digits.count < 3 { return [] }
        return Array(store.customers.filter {
            (text.count >= 2 && $0.name.lowercased().contains(text)) || (digits.count >= 3 && Customer.normalize($0.phone).contains(digits))
        }.prefix(4))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Guest") {
                    TextField("Name", text: $booking.guest).textContentType(.name)
                    TextField("Mobile number", text: $booking.phone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                }
                .onChange(of: booking.guest) { _, _ in fillFromMatch() }
                .onChange(of: booking.phone) { _, _ in fillFromMatch() }

                if !suggestions.isEmpty {
                    Section("Previous guests") {
                        ForEach(suggestions) { c in
                            Button { pick(c) } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(c.displayName).font(.body.weight(.semibold))
                                        if !c.phone.isEmpty { Text(c.phone).font(.footnote).foregroundStyle(.secondary) }
                                    }
                                    Spacer()
                                    if c.isVerified { Image(systemName: "checkmark.seal.fill").foregroundStyle(.green) }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                aadhaarSection

                Section("Stay") {
                    DatePicker("Check-in", selection: $checkIn, displayedComponents: [.date, .hourAndMinute])
                    DatePicker("Check-out", selection: $checkOut, displayedComponents: [.date, .hourAndMinute])
                    LabeledContent("Duration", value: "\(nights) night\(nights > 1 ? "s" : "")")
                    Stepper("Guests: \(booking.guests)", value: $booking.guests, in: 1...30)
                    Picker("Source", selection: $booking.source) {
                        ForEach(Choices.sources, id: \.self) { Text($0) }
                    }
                }
                .onChange(of: checkIn) { _, new in
                    if Cal.g.startOfDay(for: checkOut) <= Cal.g.startOfDay(for: new) {
                        checkOut = Clock.combine(day: DateKey.add(DateKey.string(new), 1), time: Clock.time(checkOut))
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
            .onChange(of: pickerItem) { _, item in
                Task {
                    if let raw = try? await item?.loadTransferable(type: Data.self), let jpeg = compressedJPEG(raw) {
                        newID = jpeg
                    }
                }
            }
        }
    }

    @ViewBuilder private var aadhaarSection: some View {
        Section("Aadhaar") {
            if let data = newID ?? match?.idImage, let ui = UIImage(data: data) {
                HStack(spacing: 12) {
                    Image(uiImage: ui).resizable().scaledToFill().frame(width: 64, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 2) {
                        Label(newID != nil ? "Aadhaar attached" : "Verified", systemImage: "checkmark.seal.fill")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.green)
                        Text(newID != nil ? "Saved with this booking" : "Already on file — no need to upload again")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                PhotosPicker("Replace photo", selection: $pickerItem, matching: .images)
            } else {
                PhotosPicker(selection: $pickerItem, matching: .images) {
                    Label("Upload Aadhaar photo", systemImage: "person.text.rectangle")
                }
            }
        }
    }

    /// A returning guest typed by name or number: fill in whatever is still blank.
    private func fillFromMatch() {
        guard let c = match else { return }
        if booking.guest.isEmpty { booking.guest = c.name }
        if booking.phone.isEmpty { booking.phone = c.phone }
    }

    private func pick(_ c: Customer) {
        booking.guest = c.name
        booking.phone = c.phone
    }

    private func save() {
        var b = booking
        b.start = DateKey.string(checkIn)
        b.nights = nights
        b.checkInTime = Clock.time(checkIn)
        b.checkOutTime = Clock.time(checkOut)
        b.total = total
        b.advance = advance
        b.guest = b.guest.trimmingCharacters(in: .whitespaces)
        b.phone = Customer.normalize(b.phone)
        store.save(b, idImage: newID)
        dismiss()
    }
}
