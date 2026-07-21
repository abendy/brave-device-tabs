import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { OpenedView } from "./components/OpenedView";
import { TabsView } from "./components/TabsView";
import { ViewSwitcher } from "./components/ViewSwitcher";
import { type PopupServices, popupServices } from "./popup-services";
import { usePopupController } from "./use-popup-controller";

interface AppProps {
  closePopup?: () => void;
  services?: PopupServices;
}

const closeBrowserPopup = () => window.close();

const VIEW_COPY = {
  devices: {
    emptyCopy:
      "In Brave Sync, enable Open Tabs on your iPhone and Mac, open a few pages on the iPhone, then refresh.",
    emptyTitle: "No synced device tabs found",
    filterPlaceholder: "Filter by title, URL, or device",
    groupNoun: "device",
    loadingCopy: "Loading synced tabs…",
  },
  links: {
    emptyCopy: "Share a link to a tab group from your phone to see it here.",
    emptyTitle: "No shared links yet",
    filterPlaceholder: "Filter by title, URL, or tab group",
    groupNoun: "group",
    loadingCopy: "Loading shared links…",
  },
} as const;

export function App({ closePopup = closeBrowserPopup, services = popupServices }: AppProps) {
  const controller = usePopupController(services, closePopup);
  const busy = controller.loading || controller.openingMode !== null;

  return (
    <main aria-labelledby="app-title" className="app">
      <Header
        busy={busy}
        onOpenSettings={services.openOptionsPage}
        onRefresh={() => void controller.refresh()}
      />
      <ViewSwitcher activeView={controller.activeView} onChange={controller.setActiveView} />
      {controller.activeView === "opened" ? (
        <OpenedView history={controller.history} />
      ) : (
        <TabsView
          allVisibleSelected={controller.allVisibleSelected}
          devices={controller.viewDevices}
          filter={controller.filter}
          loading={controller.loading}
          onDelete={(tabId) => void controller.deleteTab(tabId)}
          onFilter={controller.setFilter}
          onToggleDevice={controller.toggleDevice}
          onToggleTab={controller.toggleTab}
          onToggleVisible={controller.toggleVisibleSelection}
          panelId={`${controller.activeView}-view`}
          panelLabelledBy={`${controller.activeView}-view-button`}
          selected={controller.selected}
          status={controller.status}
          visibleDevices={controller.visibleDevices}
          visibleTabCount={controller.visibleTabIds.length}
          {...VIEW_COPY[controller.activeView]}
        />
      )}
      {controller.activeView === "opened" ? null : (
        <Footer
          loading={controller.loading}
          onOpenAll={() => void controller.openAll()}
          onOpenSelected={() => void controller.openSelected()}
          openingMode={controller.openingMode}
          selectedCount={controller.selectedCount}
          totalTabs={controller.totalTabs}
        />
      )}
    </main>
  );
}
