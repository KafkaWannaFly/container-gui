import { QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider } from "antd";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "./layouts/MainLayout";
import { queryClient } from "./lib/queryClient";
import ContainerListPage from "./pages/containers/ContainerListPage";
import ContainerDetailPage from "./pages/containers/detail/ContainerDetailPage";
import ImageListPage from "./pages/images/ImageListPage";
import SettingsPage from "./pages/settings/SettingsPage";
import VolumeListPage from "./pages/volumes/VolumeListPage";
import { antdTheme } from "./theme/antdTheme";

export default function App() {
  return (
    <ConfigProvider theme={antdTheme}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <Routes>
              <Route element={<MainLayout />}>
                <Route index element={<Navigate to="containers" replace />} />
                <Route path="containers" element={<ContainerListPage />} />
                <Route path="containers/:id" element={<ContainerDetailPage />} />
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
