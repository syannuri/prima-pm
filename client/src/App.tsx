import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import CookieConsent from './components/CookieConsent';
import LegalPage from './pages/LegalPage';
import Layout from './components/Layout';
import AppShellSkeleton from './components/AppShellSkeleton';
import { PanelLoading } from './components/ui';
import { OnboardingProvider } from './context/OnboardingContext';
import { GuidedSetupProvider } from './context/GuidedSetupContext';
import GuidedSetup from './components/GuidedSetup';
import GuidedCoachmark from './components/GuidedCoachmark';
import OnboardingTour from './components/OnboardingTour';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import { isWorkspaceHost } from './lib/workspaceHost';

// The authenticated pages are code-split: each lands in its own chunk that's fetched only when its
// route is first visited, so the initial bundle stays small (big win on mobile / first paint). The
// anonymous entry (HomePage + LoginPage) stays eagerly imported — HomePage is build-time prerendered
// for SEO, and lazy-loading it would flash a spinner over that markup on hydration.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ProjectPage = lazy(() => import('./pages/ProjectPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const AdminMembersPage = lazy(() => import('./pages/AdminMembersPage'));
const AdminTenantsPage = lazy(() => import('./pages/AdminTenantsPage'));
const AdminGuestsPage = lazy(() => import('./pages/AdminGuestsPage'));
const AdminProjectDatabasePage = lazy(() => import('./pages/AdminProjectDatabasePage'));
const AdminResourcesPage = lazy(() => import('./pages/AdminResourcesPage'));
const AdminAuditPage = lazy(() => import('./pages/AdminAuditPage'));
const AdminFeedbackPage = lazy(() => import('./pages/AdminFeedbackPage'));
const AdminBillingPage = lazy(() => import('./pages/AdminBillingPage'));
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const ManualPage = lazy(() => import('./pages/ManualPage'));
const MyTimesheetPage = lazy(() => import('./pages/MyTimesheetPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));

export default function App() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  // Legal documents are public and must resolve identically whether or not someone is signed in (they're
  // linked from the marketing footer, the login page, the cookie banner, and emails). Short-circuit here,
  // before the loading / auth branches, so they render standalone (no app shell, no sign-in redirect).
  if (pathname.startsWith('/legal/')) {
    return (
      <Routes>
        <Route path="/legal/:doc" element={<LegalPage />} />
        <Route path="*" element={<Navigate to="/legal/terms" replace />} />
      </Routes>
    );
  }

  if (loading) {
    return <AppShellSkeleton />;
  }

  if (!user) {
    return (
      <>
      <Routes>
        {/* On a tenant's own subdomain (acme.prismatix.tech) or custom domain (pm.acme.com) the root
            is the branded sign-in, not the public marketing homepage — that only fronts the bare base
            domain / LAN-by-IP. */}
        <Route path="/" element={isWorkspaceHost() ? <Navigate to="/login" replace /> : <HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* Public activation landing for the emailed link — must resolve while signed out. */}
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        {/* Public self-service password reset — request a link, then set a new password. */}
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <CookieConsent />
      </>
    );
  }

  return (
    <OnboardingProvider>
     <GuidedSetupProvider>
      <Layout>
        <Suspense fallback={<PanelLoading className="py-24" />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/projects/:projectId/*" element={<ProjectPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/members" element={<AdminMembersPage />} />
          <Route path="/admin/tenants" element={<AdminTenantsPage />} />
          <Route path="/admin/guests" element={<AdminGuestsPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/projects" element={<AdminProjectDatabasePage />} />
          <Route path="/admin/resources" element={<AdminResourcesPage />} />
          {/* Guests reach the same resource pool under a non-admin URL (their sidebar links here). */}
          <Route path="/my-resources" element={<AdminResourcesPage />} />
          <Route path="/admin/audit" element={<AdminAuditPage />} />
          <Route path="/admin/feedback" element={<AdminFeedbackPage />} />
          <Route path="/admin/billing" element={<AdminBillingPage />} />
          <Route path="/my-timesheet" element={<MyTimesheetPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/manual" element={<ManualPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </Layout>
      <OnboardingTour />
      <GuidedSetup />
      <GuidedCoachmark />
      <CookieConsent />
     </GuidedSetupProvider>
    </OnboardingProvider>
  );
}
