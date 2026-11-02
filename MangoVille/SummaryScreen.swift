import SwiftUI
import UniformTypeIdentifiers

struct SummaryScreen: View {
    @Environment(Store.self) private var store
    @Binding var month: Date

    @State private var editing: Booking?
    @State private var fixedText = ""
    @State private var backupURL: URL?
    @State private var showImporter = false
    @State private var pendingRestore: URL?

    var body: some View {
        let s = store.stats(for: month)
        let dues = store.pendingDues

        ScrollView {
            VStack(spacing: 14) {
                MonthHeader(month: $month)

                VStack(alignment: .leading, spacing: 4) {
                    Text("NET PROFIT").font(.caption.weight(.bold)).opacity(0.8)
                    Text(Fmt.inr(s.net)).font(.system(size: 36, weight: .bold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(Theme.green, in: RoundedRectangle(cornerRadius: 20))

                Card {
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 14) {
                        GridRow {
                            StatCell(title: "Revenue", value: Fmt.inr(s.revenue))
                            StatCell(title: "Collected", value: Fmt.inr(s.collected))
                        }
                        GridRow {
                            StatCell(title: "Balance due", value: Fmt.inr(s.pending), tint: s.pending > 0 ? .red : .primary)
                            StatCell(title: "Occupancy", value: "\(s.occupancy)%")
                        }
                        GridRow {
                            StatCell(title: "Expenses", value: Fmt.inr(s.expenses))
                            StatCell(title: "Fixed cost", value: Fmt.inr(s.fixed))
                        }
                    }
                }

                if !s.bySource.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("BY SOURCE").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                            ForEach(s.bySource) { item in
                                HStack { Text(item.name); Spacer(); Text(Fmt.inr(item.amount)).fontWeight(.semibold) }
                            }
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("PENDING DUES · \(Fmt.inr(dues.reduce(0) { $0 + $1.due }))")
                            .font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        if dues.isEmpty { Text("All settled").foregroundStyle(.secondary) }
                        ForEach(dues) { b in
                            Button { editing = b } label: { BookingRow(booking: b, showDate: true) }
                                .buttonStyle(.plain)
                            if b.id != dues.last?.id { Divider() }
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("SETTINGS & BACKUP").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        HStack {
                            Text("Fixed monthly cost ₹")
                            TextField("0", text: $fixedText)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .onChange(of: fixedText) { _, new in store.setFixedCost(Int(new) ?? 0) }
                        }
                        if let backupURL {
                            ShareLink(item: backupURL) { Label("Back up data", systemImage: "square.and.arrow.up") }
                        }
                        Button { showImporter = true } label: { Label("Restore from file", systemImage: "arrow.down.doc") }
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 16)
        }
        .navigationTitle("Summary")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { TodayButton(month: $month) }
        .sheet(item: $editing) { BookingForm(booking: $0) }
        .onAppear {
            fixedText = String(store.fixedCost)
            backupURL = store.makeBackup()
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.data]) { result in
            if case .success(let url) = result { pendingRestore = url }
        }
        .alert("Replace all data?", isPresented: Binding(
            get: { pendingRestore != nil },
            set: { if !$0 { pendingRestore = nil } }
        )) {
            Button("Replace", role: .destructive) {
                if let url = pendingRestore, store.restore(from: url) {
                    fixedText = String(store.fixedCost)
                    backupURL = store.makeBackup()
                }
                pendingRestore = nil
            }
            Button("Cancel", role: .cancel) { pendingRestore = nil }
        } message: {
            Text("Everything in the app will be replaced by the contents of this file.")
        }
    }
}
