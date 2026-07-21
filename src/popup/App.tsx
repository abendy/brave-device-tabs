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

export function App({ closePopup = closeBrowserPopup, services = popupServices }: AppProps) {
  const controller = usePopupController(services, closePopup);
  const totalTabs = controller.devices.reduce((sum, device) => sum + device.tabs.length, 0);
  const busy = controller.loading || controller.openingMode !== null;

  return (
    <main aria-labelledby="app-title" className="app">
      <Header
        busy={busy}
        onOpenSettings={services.openOptionsPage}
        onRefresh={() => void controller.refresh()}
      />
      <ViewSwitcher activeView={controller.activeView} onChange={controller.setActiveView} />
      {controller.activeView === "tabs" ? (
        <TabsView
          allVisibleSelected={controller.allVisibleSelected}
          devices={controller.devices}
          filter={controller.filter}
          loading={controller.loading}
          onDelete={(tabId) => void controller.deleteTab(tabId)}
          onFilter={controller.setFilter}
          onToggleDevice={controller.toggleDevice}
          onToggleTab={controller.toggleTab}
          onToggleVisible={controller.toggleVisibleSelection}
          selected={controller.selected}
          status={controller.status}
          visibleDevices={controller.visibleDevices}
          visibleTabCount={controller.visibleTabIds.length}
        />
      ) : (
        <OpenedView history={controller.history} />
      )}
      {controller.activeView === "tabs" ? (
        <Footer
          loading={controller.loading}
          onOpenAll={() => void controller.openAll()}
          onOpenSelected={() => void controller.openSelected()}
          openingMode={controller.openingMode}
          selectedCount={controller.selected.size}
          totalTabs={totalTabs}
        />
      ) : null}
    </main>
  );
}
