import SwiftUI

struct ContentView: View {
    @State private var selection: AppRoute? = .playground

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $selection)
        } detail: {
            switch selection {
            case .playground, nil:
                PlaygroundView()
            case .library:
                SavedAudioView()
            }
        }
    }
}
