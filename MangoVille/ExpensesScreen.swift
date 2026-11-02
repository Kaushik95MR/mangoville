import SwiftUI

struct ExpensesScreen: View {
    @Environment(Store.self) private var store
    @Binding var month: Date
    @State private var editing: Expense?

    var body: some View {
        let list = store.monthExpenses(month)
        let total = list.reduce(0) { $0 + $1.amount }

        List {
            Section {
                MonthHeader(month: $month)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            Section {
                LabeledContent("Spent this month") {
                    Text(Fmt.inr(total)).font(.title3.bold())
                }
            }
            Section {
                if list.isEmpty {
                    Text("No expenses this month").foregroundStyle(.secondary)
                }
                ForEach(list) { e in
                    Button { editing = e } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.desc.isEmpty ? e.category : e.desc).font(.body.weight(.semibold))
                                Text("\(Fmt.short(e.date)) · \(e.category)")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Fmt.inr(e.amount)).fontWeight(.semibold)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .onDelete { offsets in
                    for i in offsets { store.delete(list[i]) }
                }
            }
        }
        .navigationTitle("Expenses")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            TodayButton(month: $month)
            ToolbarItem(placement: .topBarTrailing) {
                Button { editing = Expense(date: defaultDate) } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New expense")
            }
        }
        .sheet(item: $editing) { ExpenseForm(expense: $0) }
    }

    private var defaultDate: String {
        let today = DateKey.today
        return today.hasPrefix(String(DateKey.string(month).prefix(7))) ? today : DateKey.string(month)
    }
}

struct ExpenseForm: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var expense: Expense
    @State private var date: Date
    @State private var amountText: String
    @State private var confirmDelete = false
    @State private var addingCategory = false
    @State private var newCategory = ""

    init(expense: Expense) {
        _expense = State(initialValue: expense)
        _date = State(initialValue: DateKey.date(expense.date) ?? Date())
        _amountText = State(initialValue: expense.amount == 0 ? "" : String(expense.amount))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("Amount ₹")
                        TextField("0", text: $amountText).keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    TextField("What was it for?", text: $expense.desc)
                    Picker("Category", selection: $expense.category) {
                        ForEach(store.allCategories(including: expense.category), id: \.self) { Text($0) }
                    }
                    Button { addingCategory = true } label: { Label("New category", systemImage: "plus.circle") }
                }
                if expense.id != 0 {
                    Section {
                        Button("Delete expense", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(expense.id == 0 ? "New expense" : "Edit expense")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).fontWeight(.semibold) }
            }
            .alert("New category", isPresented: $addingCategory) {
                TextField("Name", text: $newCategory)
                Button("Add") {
                    store.addCategory(newCategory)
                    let clean = newCategory.trimmingCharacters(in: .whitespacesAndNewlines)
                    if let match = store.allCategories().first(where: { $0.caseInsensitiveCompare(clean) == .orderedSame }) {
                        expense.category = match
                    }
                    newCategory = ""
                }
                Button("Cancel", role: .cancel) { newCategory = "" }
            }
            .confirmationDialog("Delete this expense?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    store.delete(expense)
                    dismiss()
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        var e = expense
        e.date = DateKey.string(date)
        e.amount = Int(amountText) ?? 0
        e.desc = e.desc.trimmingCharacters(in: .whitespaces)
        store.save(e)
        dismiss()
    }
}
