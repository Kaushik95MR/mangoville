import SwiftUI
import PhotosUI

struct CustomersScreen: View {
    @Environment(Store.self) private var store
    @State private var query = ""
    @State private var editing: Customer?

    private struct Entry: Identifiable {
        let customer: Customer
        let stays: [Booking]
        var id: Int { customer.id }
        var spent: Int { stays.reduce(0) { $0 + $1.total } }
        var owed: Int { stays.reduce(0) { $0 + $1.due } }
        var last: String { stays.first?.start ?? "" }
    }

    private var entries: [Entry] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return store.customers
            .map { Entry(customer: $0, stays: store.bookings(for: $0)) }
            .filter { e in
                q.isEmpty || [e.customer.name, e.customer.phone, e.customer.city].contains { $0.lowercased().contains(q) }
            }
            .sorted { $0.last == $1.last ? $0.customer.displayName < $1.customer.displayName : $0.last > $1.last }
    }

    var body: some View {
        List {
            if entries.isEmpty {
                Text("No customers found").foregroundStyle(.secondary)
            }
            ForEach(entries) { e in
                Button { editing = e.customer } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(e.customer.displayName).font(.body.weight(.semibold))
                            Text(subtitle(e)).font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(Fmt.inr(e.spent)).fontWeight(.semibold)
                            if e.owed > 0 {
                                Text("Due \(Fmt.inr(e.owed))").font(.caption.weight(.bold)).foregroundStyle(Theme.due)
                            }
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .searchable(text: $query, prompt: "Search name, phone or city")
        .navigationTitle("Customers")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { editing = Customer() } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New customer")
            }
        }
        .sheet(item: $editing) { CustomerForm(customer: $0) }
    }

    private func subtitle(_ e: Entry) -> String {
        var parts: [String] = []
        if e.customer.isVerified { parts.append("✓ ID") }
        if !e.customer.phone.isEmpty { parts.append(e.customer.phone) }
        if !e.customer.city.isEmpty { parts.append(e.customer.city) }
        parts.append("\(e.stays.count) stay\(e.stays.count == 1 ? "" : "s")")
        if !e.last.isEmpty { parts.append("last \(Fmt.short(e.last))") }
        return parts.joined(separator: " · ")
    }
}

struct CustomerForm: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var customer: Customer
    @State private var confirmDelete = false
    @State private var editingBooking: Booking?
    @State private var pickerItem: PhotosPickerItem?

    init(customer: Customer) { _customer = State(initialValue: customer) }

    var body: some View {
        let stays = customer.id == 0 ? [] : store.bookings(for: customer)
        NavigationStack {
            Form {
                Section("Contact") {
                    TextField("Name", text: $customer.name).textContentType(.name)
                    TextField("Phone", text: $customer.phone)
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                    TextField("City / address", text: $customer.city)
                }
                Section("Aadhaar") {
                    TextField("Aadhaar number (optional)", text: $customer.idProof)
                        .keyboardType(.numberPad)
                    if let data = customer.idImage, let ui = UIImage(data: data) {
                        HStack(spacing: 12) {
                            Image(uiImage: ui).resizable().scaledToFill().frame(width: 64, height: 44)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            Label("Verified — Aadhaar on file", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                        }
                        PhotosPicker("Replace photo", selection: $pickerItem, matching: .images)
                    } else {
                        PhotosPicker(selection: $pickerItem, matching: .images) {
                            Label("Upload Aadhaar photo", systemImage: "person.text.rectangle")
                        }
                    }
                }
                Section("Details") {
                    TextField("Notes — preferences, group size, vehicle…", text: $customer.notes, axis: .vertical)
                        .lineLimit(2...5)
                }
                if !stays.isEmpty {
                    Section("Stays · \(stays.count) · \(Fmt.inr(stays.reduce(0) { $0 + $1.total }))") {
                        ForEach(stays) { b in
                            Button { editingBooking = b } label: { BookingRow(booking: b, showDate: true) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                if customer.id != 0 {
                    Section {
                        if let url = URL(string: "tel:\(Customer.normalize(customer.phone))"), !customer.phone.isEmpty {
                            Link(destination: url) { Label("Call", systemImage: "phone.fill") }
                        }
                        Button("Delete contact (bookings stay)", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(customer.id == 0 ? "New customer" : "Customer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        store.save(customer)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(customer.name.trimmingCharacters(in: .whitespaces).isEmpty && customer.phone.isEmpty)
                }
            }
            .confirmationDialog("Delete this contact?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    store.delete(customer)
                    dismiss()
                }
            }
            .sheet(item: $editingBooking) { BookingForm(booking: $0) }
            .onChange(of: pickerItem) { _, item in
                Task {
                    if let raw = try? await item?.loadTransferable(type: Data.self), let jpeg = compressedJPEG(raw) {
                        customer.idImage = jpeg
                    }
                }
            }
        }
    }
}
