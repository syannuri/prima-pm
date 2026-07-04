import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Spinner } from './components/ui';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectPage from './pages/ProjectPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminResourcesPage from './pages/AdminResourcesPage';
import SettingsPage from './pages/SettingsPage';
import ManualPage from './pages/ManualPage';
import MyTimesheetPage from './pages/MyTimesheetPage';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects/:projectId/*" element={<ProjectPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/resources" element={<AdminResourcesPage />} />
        <Route path="/my-timesheet" element={<MyTimesheetPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/manual" element={<ManualPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
