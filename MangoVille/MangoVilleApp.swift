import SwiftUI

@main
struct MangoVilleApp: App {
    @State private var store = Store()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .tint(Theme.green)
        }
    }
}

struct RootView: View {
    @Environment(Store.self) private var store
    @State private var month = Cal.monthStart(Date())

    var body: some View {
        TabView {
            NavigationStack { CalendarScreen(month: $month) }
                .tabItem { Label("Calendar", systemImage: "calendar") }
            NavigationStack { CustomersScreen() }
                .tabItem { Label("Customers", systemImage: "person.2.fill") }
            NavigationStack { ExpensesScreen(month: $month) }
                .tabItem { Label("Expenses", systemImage: "list.bullet.rectangle") }
            NavigationStack { SummaryScreen(month: $month) }
                .tabItem { Label("Summary", systemImage: "chart.bar.fill") }
        }
        .alert("Something went wrong", isPresented: Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.errorMessage ?? "")
        }
    }
}
