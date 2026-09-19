import { App as AntApp, ConfigProvider } from "antd";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Route, Routes } from "react-router-dom";
import { antdTheme } from "./theme/antdTheme";
import { queryClient } from "./lib/queryClient";
import MainLayout from "./layouts/MainLayout";
import DashboardPage from "./pages/dashboard/DashboardPage";
import ContainerListPage from "./pages/containers/ContainerListPage";
import ImageListPage from "./pages/images/ImageListPage";
import VolumeListPage from "./pages/volumes/VolumeListPage";
import SettingsPage from "./pages/settings/SettingsPage";

export default function App() {
  return (
    <ConfigProvider theme={antdTheme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <Routes>
              <Route element={<MainLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="containers" element={<ContainerListPage />} />
                <Route path="images" element={<ImageListPage />} />
                <Route path="volumes" element={<VolumeListPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </HashRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
