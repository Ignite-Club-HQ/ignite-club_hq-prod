import { Suspense, lazy, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
// Force publish - Firebase upgraded to v12.7.0 for Capacitor 8 compatibility
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ScrollToTop } from "@/components/ScrollToTop";
import { AuthProvider } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { ThemeProvider } from "next-themes";
import { ClubThemeProvider } from "@/hooks/useClubTheme";
import GlobalSubMonitor from "@/components/pitch/GlobalSubMonitor";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { IOSInstallPrompt } from "@/components/IOSInstallPrompt";
import { PushNotificationManager } from "@/components/PushNotificationManager";
import { PWAPendingInviteHandler } from "@/components/PWAPendingInviteHandler";

import { StatusBarManager } from "@/components/StatusBarManager";
import { Loader2 } from "lucide-react";

// OAuth callback capture is now handled in main.tsx (runs earlier)

// Eagerly loaded pages (initial load)
import AuthPage from "./pages/AuthPage";
import CompleteProfilePage from "./pages/CompleteProfilePage";
import HomePage from "./pages/HomePage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SignupProPage from "./pages/SignupProPage";

// Lazy loaded pages (code splitting)
const EventsPage = lazy(() => import("./pages/EventsPage"));
const EventDetailPage = lazy(() => import("./pages/EventDetailPage"));
const CreateEventPage = lazy(() => import("./pages/CreateEventPage"));
const EditEventPage = lazy(() => import("./pages/EditEventPage"));
const ImportFixturesPage = lazy(() => import("./pages/ImportFixturesPage"));
const ClubsPage = lazy(() => import("./pages/ClubsPage"));
const ClubDetailPage = lazy(() => import("./pages/ClubDetailPage"));
const CreateClubPage = lazy(() => import("./pages/CreateClubPage"));
const EditClubPage = lazy(() => import("./pages/EditClubPage"));
const CreateTeamPage = lazy(() => import("./pages/CreateTeamPage"));
const EditTeamPage = lazy(() => import("./pages/EditTeamPage"));
const TeamDetailPage = lazy(() => import("./pages/TeamDetailPage"));
const MessagesPage = lazy(() => import("./pages/MessagesPage"));
const TeamChatPage = lazy(() => import("./pages/TeamChatPage"));
const BroadcastChatPage = lazy(() => import("./pages/BroadcastChatPage"));
const ClubChatPage = lazy(() => import("./pages/ClubChatPage"));
const GroupChatPage = lazy(() => import("./pages/GroupChatPage"));
const DirectMessagePage = lazy(() => import("./pages/DirectMessagePage"));
const ClubAdminChatPage = lazy(() => import("./pages/ClubAdminChatPage"));
const WelcomeMessagePage = lazy(() => import("./pages/WelcomeMessagePage"));
const MediaPage = lazy(() => import("./pages/MediaPage"));
const VaultPage = lazy(() => import("./pages/VaultPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const EditProfilePage = lazy(() => import("./pages/EditProfilePage"));
const MyRolesPage = lazy(() => import("./pages/MyRolesPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const ManageRolesPage = lazy(() => import("./pages/ManageRolesPage"));
const ManageTeamRolesPage = lazy(() => import("./pages/ManageTeamRolesPage"));
const ChildrenPage = lazy(() => import("./pages/ChildrenPage"));
const UpgradeProPage = lazy(() => import("./pages/UpgradeProPage"));
const ClubUpgradePage = lazy(() => import("./pages/ClubUpgradePage"));
const ManagePromoCodesPage = lazy(() => import("./pages/ManagePromoCodesPage"));
const StripeSettingsPage = lazy(() => import("./pages/StripeSettingsPage"));
const AppStripeSettingsPage = lazy(() => import("./pages/AppStripeSettingsPage"));
const ManageFeedbackPage = lazy(() => import("./pages/ManageFeedbackPage"));
const ManageUsersPage = lazy(() => import("./pages/ManageUsersPage"));
const ManageBackupsPage = lazy(() => import("./pages/ManageBackupsPage"));
const JoinTeamPage = lazy(() => import("./pages/JoinTeamPage"));
const JoinClubPage = lazy(() => import("./pages/JoinClubPage"));
const TermsOfServicePage = lazy(() => import("./pages/TermsOfServicePage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const CancellationPolicyPage = lazy(() => import("./pages/CancellationPolicyPage"));
const PlayerStatsReportPage = lazy(() => import("./pages/PlayerStatsReportPage"));
const ClubRewardsPage = lazy(() => import("./pages/ClubRewardsPage"));
const ClubRewardsReportPage = lazy(() => import("./pages/ClubRewardsReportPage"));
const SponsorAnalyticsPage = lazy(() => import("./pages/SponsorAnalyticsPage"));
const ManageAdsPage = lazy(() => import("./pages/ManageAdsPage"));
const VideoGuideDownloadPage = lazy(() => import("./pages/VideoGuideDownloadPage"));
const AttendanceStatsPage = lazy(() => import("./pages/AttendanceStatsPage"));
const PushAnalyticsPage = lazy(() => import("./pages/PushAnalyticsPage"));
const NotificationPreferencesPage = lazy(() => import("./pages/NotificationPreferencesPage"));
const MiniLeaguesPage = lazy(() => import("./pages/MiniLeaguesPage"));
const MiniLeagueDetailPage = lazy(() => import("./pages/MiniLeagueDetailPage"));
const EventGroupPitchPage = lazy(() => import("./pages/EventGroupPitchPage"));
const AppSettingsPage = lazy(() => import("./pages/AppSettingsPage"));
const AdMobSettingsPage = lazy(() => import("./pages/AdMobSettingsPage"));
const ClassEnrolmentPage = lazy(() => import("./pages/ClassEnrolmentPage"));
const PayFeesPage = lazy(() => import("./pages/PayFeesPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

import { setupReactQueryNativeAdapter } from "@/lib/reactQueryNativeAdapter";

const queryClient = new QueryClient();

// Configure React Query to refetch on reconnect/resume in native apps
setupReactQueryNativeAdapter();

// Loading fallback component - uses CSS variables to respect current theme
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const MediaPhotoRedirect = () => {
  const { photoId } = useParams();
  return <Navigate to={`/media?photo=${photoId}`} replace />;
};

const ShareLinkRedirect = () => {
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!type || !id) return <Navigate to="/" replace />;

  switch (type) {
    case "photo":
      return <Navigate to={`/media?photo=${id}`} replace />;
    case "event":
      return <Navigate to={`/events/${id}`} replace />;
    case "folder":
      return <Navigate to={`/vault/folder/${id}`} replace />;
    default:
      return <Navigate to="/" replace />;
  }
};

const DeepLinkGate = lazy(() => import("@/components/DeepLinkGate"));

/**
 * Wrapper that shows a deep-link interstitial for in-app browsers (Messenger,
 * WhatsApp, etc.) and otherwise renders the normal child component.
 */
const WithDeepLinkGate = ({ children }: { children: React.ReactNode }) => {
  // Quick sync check — avoid lazy-loading DeepLinkGate when not needed
  const isNative = Capacitor.isNativePlatform();
  const ua = navigator.userAgent || "";
  const inApp = !isNative && /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|WhatsApp|LinkedInApp|Messenger/i.test(ua);
  if (!inApp) return <>{children}</>;
  return (
    <Suspense fallback={<PageLoader />}>
      <DeepLinkGate />
    </Suspense>
  );
};


// Read stored theme synchronously to match index.html bootstrap
const getInitialTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('app-theme');
    if (stored === 'dark') return 'dark';
    if (stored === 'light') return 'light';
    // Check DOM class set by index.html script
    if (document.documentElement.classList.contains('dark')) return 'dark';
  }
  return 'light'; // Default to light to match index.html
};

const INITIAL_THEME = getInitialTheme();

const App = () => {
  // Global safety net: catch any unhandled promise rejections
  // This prevents iOS WebView crashes from uncaught async errors
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      console.error("[App] Unhandled promise rejection:", event.reason);
      event.preventDefault(); // Prevent the error from crashing iOS WebView
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  return (
  <ThemeProvider attribute="class" defaultTheme={INITIAL_THEME} enableSystem={false} storageKey="app-theme">
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ClubThemeProvider>
          <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ScrollToTop />
            <PWAPendingInviteHandler />
            <GlobalSubMonitor />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Public routes */}
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/complete-profile" element={<CompleteProfilePage />} />
                <Route path="/join/:token" element={<JoinTeamPage />} />
                <Route path="/join/p/:token" element={<JoinTeamPage />} />
                <Route path="/join-club/:token" element={<JoinClubPage />} />
                <Route path="/signup-pro" element={<SignupProPage />} />
                <Route path="/terms" element={<TermsOfServicePage />} />
                <Route path="/privacy" element={<PrivacyPolicyPage />} />
                <Route path="/cancellation" element={<CancellationPolicyPage />} />
                <Route path="/video-guide" element={<VideoGuideDownloadPage />} />
                <Route path="/share" element={<ShareLinkRedirect />} />


                {/* Protected routes */}
                <Route element={<AppLayout />}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/events" element={<EventsPage />} />
                  <Route path="/events/new" element={<CreateEventPage />} />
                  <Route path="/events/:id" element={<EventDetailPage />} />
                  <Route path="/events/import" element={<ImportFixturesPage />} />
                  <Route path="/events/:id/edit" element={<EditEventPage />} />
                  <Route path="/events/:id/groups/:groupId/pitch" element={<EventGroupPitchPage />} />
                  <Route path="/events/:id/groups/:groupId/duties" element={<EventGroupPitchPage />} />
                  <Route path="/clubs" element={<ClubsPage />} />
                  <Route path="/clubs/new" element={<CreateClubPage />} />
                  <Route path="/clubs/:id" element={<ClubDetailPage />} />
                  <Route path="/clubs/:id/edit" element={<EditClubPage />} />
                  <Route path="/clubs/:clubId/teams/new" element={<CreateTeamPage />} />
                  <Route path="/clubs/:clubId/roles" element={<ManageRolesPage />} />
                  <Route path="/clubs/:clubId/rewards" element={<ClubRewardsPage />} />
                  <Route path="/clubs/:clubId/rewards/report" element={<ClubRewardsReportPage />} />
                  <Route path="/clubs/:clubId/upgrade" element={<ClubUpgradePage />} />
                  <Route path="/clubs/:clubId/stripe" element={<StripeSettingsPage />} />
                  <Route path="/clubs/:clubId/enrol" element={<ClassEnrolmentPage />} />
                  <Route path="/teams/:id" element={<TeamDetailPage />} />
                  <Route path="/teams/:id/edit" element={<EditTeamPage />} />
                  <Route path="/teams/:teamId/roles" element={<ManageTeamRolesPage />} />
                  <Route path="/teams/:teamId/upgrade" element={<UpgradeProPage />} />
                  <Route path="/teams/:teamId/attendance" element={<AttendanceStatsPage />} />
                  <Route path="/messages" element={<MessagesPage />} />
                  <Route path="/messages/broadcast" element={<BroadcastChatPage />} />
                  <Route path="/messages/club/:clubId" element={<ClubChatPage />} />
                   <Route path="/messages/dm/:conversationId" element={<DirectMessagePage />} />
                   <Route path="/messages/club-admin/:conversationId" element={<ClubAdminChatPage />} />
                  <Route path="/messages/welcome" element={<WelcomeMessagePage />} />
                  <Route path="/messages/:teamId" element={<TeamChatPage />} />
                  <Route path="/groups/:groupId" element={<GroupChatPage />} />
                  <Route path="/media" element={<MediaPage />} />
                  <Route path="/media/:photoId" element={<MediaPhotoRedirect />} />
                  <Route path="/vault" element={<VaultPage />} />
                  <Route path="/vault/folder/:folderId" element={<VaultPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/account" element={<AccountPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/edit-profile" element={<EditProfilePage />} />
                  <Route path="/roles" element={<MyRolesPage />} />
                  <Route path="/children" element={<ChildrenPage />} />
                  <Route path="/children" element={<ChildrenPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/pay-fees/:clubId" element={<PayFeesPage />} />
                  <Route path="/reports/player-stats" element={<PlayerStatsReportPage />} />
                  <Route path="/admin/promo-codes" element={<ManagePromoCodesPage />} />
                  <Route path="/admin/stripe" element={<AppStripeSettingsPage />} />
                  <Route path="/admin/feedback" element={<ManageFeedbackPage />} />
                  <Route path="/admin/users" element={<ManageUsersPage />} />
                  <Route path="/admin/backups" element={<ManageBackupsPage />} />
                  <Route path="/admin/sponsor-analytics" element={<SponsorAnalyticsPage />} />
                  <Route path="/admin/ads" element={<ManageAdsPage />} />
                  <Route path="/admin/push-analytics" element={<PushAnalyticsPage />} />
                  <Route path="/admin/notification-preferences" element={<NotificationPreferencesPage />} />
                  <Route path="/admin/settings" element={<AppSettingsPage />} />
                  <Route path="/admin/admob" element={<AdMobSettingsPage />} />
                  <Route path="/mini-leagues" element={<MiniLeaguesPage />} />
                  <Route path="/mini-leagues/:id" element={<MiniLeagueDetailPage />} />
                </Route>
                
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            <CookieConsentBanner />
            <IOSInstallPrompt />
            <PushNotificationManager />
            <StatusBarManager />
            
          </BrowserRouter>
          </TooltipProvider>
        </ClubThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
  );
};

export default App;
