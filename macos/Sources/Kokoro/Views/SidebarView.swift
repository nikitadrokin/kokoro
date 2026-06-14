import SwiftUI

enum AppRoute: String, CaseIterable, Identifiable {
    case playground = "Playground"
    case library    = "Library"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .playground: "waveform"
        case .library:    "folder.badge.waveform"
        }
    }
}

struct SidebarView: View {
    @Binding var selection: AppRoute?

    var body: some View {
        List(AppRoute.allCases, selection: $selection) { route in
            Label(route.rawValue, systemImage: route.icon)
                .tag(route)
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 160, ideal: 180, max: 220)
    }
}
