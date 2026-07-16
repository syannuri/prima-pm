import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import AppShellSkeleton from './components/AppShellSkeleton';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectPage from './pages/ProjectPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminResourcesPage from './pages/AdminResourcesPage';
import AdminAuditPage from './pages/AdminAuditPage';
import SettingsPage from './pages/SettingsPage';
import ManualPage from './pages/ManualPage';
import MyTimesheetPage from './pages/MyTimesheetPage';
import ReportsPage from './pages/ReportsPage';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <AppShellSkeleton />;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/projects/:projectId/*" element={<ProjectPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/resources" element={<AdminResourcesPage />} />
        <Route path="/admin/audit" element={<AdminAuditPage />} />
        <Route path="/my-timesheet" element={<MyTimesheetPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/manual" element={<ManualPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
