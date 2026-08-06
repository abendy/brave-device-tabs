import SwiftUI

/// Approximates Chrome's tab-group palette with system colors so the dots
/// track light/dark mode; nil for unknown names or iOS-created groups.
func chromeGroupColor(_ name: String?) -> Color? {
    switch name {
    case "grey": return Color(uiColor: .systemGray)
    case "blue": return .blue
    case "red": return .red
    case "yellow": return .yellow
    case "green": return .green
    case "pink": return .pink
    case "purple": return .purple
    case "cyan": return .cyan
    case "orange": return .orange
    default: return nil
    }
}

/// Chrome-style group color indicator: filled with the live group's color,
/// hollow for iOS-created groups that have no live tab group yet.
struct GroupColorDot: View {
    let colorName: String?

    var body: some View {
        if let color = chromeGroupColor(colorName) {
            Circle()
                .fill(color)
                .frame(width: 10, height: 10)
        } else {
            Circle()
                .strokeBorder(Color(uiColor: .separator), lineWidth: 1.5)
                .frame(width: 10, height: 10)
        }
    }
}
