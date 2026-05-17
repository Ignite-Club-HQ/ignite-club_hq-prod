import { Suspense, lazy, useEffect } from "react";
import NativeOnlyGate from "@/components/NativeOnlyGate";
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
import GlobalSubMonitorGate from "@/components/pitch/GlobalSubMonitorGate";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { IOSInstallPrompt } from "@/components/IOSInstallPrompt";
import { PushNotificationManager } from "@/components/PushNotificationManager";
import { PWAPendingInviteHandler } from "@/components/PWAPendingInviteHandler";
import { NativeAppUpdatePrompt } from "@/components/NativeAppUpdatePrompt";

import { StatusBarManager } from "@/components/StatusBarManager";
import { IcsPreviewFallbackDialog } from "@/components/IcsPreviewFallbackDialog";
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
const StartPage = lazy(() => import("./pages/StartPage"));
const StartTeamPage = lazy(() => import("./pages/StartTeamPage"));
const EditClubPage = lazy(() => import("./pages/EditClubPage"));
const CreateTeamPage = lazy(() => import("./pages/CreateTeamPage"));
const EditTeamPage = lazy(() => import("./pages/EditTeamPage"));
const TeamDetailPage = lazy(() => import("./pages/TeamDetailPage"));
const MessagesPage = lazy(() => import("./pages/MessagesPage"));
const ScheduledMessagesPage = lazy(() => import("./pages/ScheduledMessagesPage"));
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
const AdminTempPasswordPage = lazy(() => import("./pages/AdminTempPasswordPage"));
const OnlineUsersPage = lazy(() => import("./pages/OnlineUsersPage"));
const AdminActiveGamesPage = lazy(() => import("./pages/AdminActiveGamesPage"));
const AdminEngagementPage = lazy(() => import("./pages/AdminEngagementPage"));
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
const CompetitionsPage = lazy(() => import("./pages/CompetitionsPage"));
const CreateCompetitionPage = lazy(() => import("./pages/CreateCompetitionPage"));
const CompetitionDetailPage = lazy(() => import("./pages/CompetitionDetailPage"));
const CompetitionSettingsPage = lazy(() => import("./pages/CompetitionSettingsPage"));
const AssociationsPage = lazy(() => import("./pages/AssociationsPage"));
const CreateAssociationPage = lazy(() => import("./pages/CreateAssociationPage"));
const AssociationDetailPage = lazy(() => import("./pages/AssociationDetailPage"));
const PublicCompetitionPage = lazy(() => import("./pages/PublicCompetitionPage"));
const MiniLeagueDetailPage = lazy(() => import("./pages/MiniLeagueDetailPage"));
const EventGroupPitchPage = lazy(() => import("./pages/EventGroupPitchPage"));
const AppSettingsPage = lazy(() => import("./pages/AppSettingsPage"));
const AdMobSettingsPage = lazy(() => import("./pages/AdMobSettingsPage"));
const ClassEnrolmentPage = lazy(() => import("./pages/ClassEnrolmentPage"));
const PayFeesPage = lazy(() => import("./pages/PayFeesPage"));
const SendUpdateReminderPage = lazy(() => import("./pages/SendUpdateReminderPage"));
const AdminDrillsPage = lazy(() => import("./pages/AdminDrillsPage"));
const AdminDmAttachmentsPage = lazy(() => import("./pages/AdminDmAttachmentsPage"));
const AdminChatPhotoRemindersPage = lazy(() => import("./pages/AdminChatPhotoRemindersPage"));
const AdminChatVirtDebugPage = lazy(() => import("./pages/AdminChatVirtDebugPage"));
const PublishChatPhotosPage = lazy(() => import("./pages/PublishChatPhotosPage"));
const SeasonsPage = lazy(() => import("./pages/SeasonsPage"));
const SeasonDetailPage = lazy(() => import("./pages/SeasonDetailPage"));
const SeasonComparePage = lazy(() => import("./pages/SeasonComparePage"));
const ShortInviteRedirect = lazy(() => import("./pages/ShortInviteRedirect"));
const EoiAdminPage = lazy(() => import("./pages/EoiAdminPage"));
const PublicEoiFormPage = lazy(() => import("./pages/PublicEoiFormPage"));
const EoiCompletePage = lazy(() => import("./pages/EoiCompletePage"));
const EmbeddedEoiFormPage = lazy(() => import("./pages/EmbeddedEoiFormPage"));
const WatchLiveTeamPage = lazy(() => import("./pages/WatchLiveTeamPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

import { setupReactQueryNativeAdapter } from "@/lib/reactQueryNativeAdapter";

// `offlineFirst` lets queryFn run even when the device is offline, so our
// cache-fallback branches (chat messages, schedule events, etc.) can return
// cached data instead of React Query pausing the query indefinitely (which
// would leave Schedule stuck on "loading" and chat threads blank).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "offlineFirst" },
    mutations: { networkMode: "offlineFirst" },
  },
});

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
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  // Handle Android hardware back button
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let listener: { remove: () => void } | undefined;

    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back();
        } else {
          CapApp.minimizeApp();
        }
      }).then(l => { listener = l; });
    });

    return () => { listener?.remove(); };
  }, []);

  return (
  <ThemeProvider attribute="class" defaultTheme={INITIAL_THEME} enableSystem={false} storageKey="app-theme">
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ClubThemeProvider>
          <TooltipProvider>
          <Toaster />
          <Sonner />
          <IcsPreviewFallbackDialog />
          <BrowserRouter>
            <ScrollToTop />
            <PWAPendingInviteHandler />
            <GlobalSubMonitorGate />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Public routes */}
                <Route path="/auth" element={<AuthPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/complete-profile" element={<CompleteProfilePage />} />
                <Route path="/join/:token" element={<NativeOnlyGate><WithDeepLinkGate><JoinTeamPage /></WithDeepLinkGate></NativeOnlyGate>} />
                <Route path="/join/p/:token" element={<NativeOnlyGate><WithDeepLinkGate><JoinTeamPage /></WithDeepLinkGate></NativeOnlyGate>} />
                <Route path="/j/:code" element={<NativeOnlyGate><WithDeepLinkGate><ShortInviteRedirect /></WithDeepLinkGate></NativeOnlyGate>} />
                <Route path="/join-club/:token" element={<NativeOnlyGate><WithDeepLinkGate><JoinClubPage /></WithDeepLinkGate></NativeOnlyGate>} />
                <Route path="/signup-pro" element={<SignupProPage />} />
                <Route path="/terms" element={<TermsOfServicePage />} />
                <Route path="/privacy" element={<PrivacyPolicyPage />} />
                <Route path="/cancellation" element={<CancellationPolicyPage />} />
                <Route path="/video-guide" element={<VideoGuideDownloadPage />} />
                <Route path="/share" element={<ShareLinkRedirect />} />
<Route path="/eoi/:clubSlug/:seasonSlug" element={<PublicEoiFormPage />} />
<Route path="/eoi-embed/:clubSlug/:seasonSlug" element={<EmbeddedEoiFormPage />} />
<Route path="/eoi-complete/:token" element={<EoiCompletePage />} />


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
                  <Route path="/start" element={<StartPage />} />
                  <Route path="/teams/new" element={<StartTeamPage />} />
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
                  <Route path="/watch/team/:teamId" element={<WatchLiveTeamPage />} />
                  <Route path="/teams/:id/edit" element={<EditTeamPage />} />
                  <Route path="/teams/:teamId/roles" element={<ManageTeamRolesPage />} />
                  <Route path="/teams/:teamId/upgrade" element={<UpgradeProPage />} />
                  <Route path="/teams/:teamId/attendance" element={<AttendanceStatsPage />} />
                  <Route path="/teams/:teamId/publish-chat-photos" element={<PublishChatPhotosPage />} />
                  <Route path="/messages" element={<MessagesPage />} />
                  <Route path="/scheduled-messages" element={<ScheduledMessagesPage />} />
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
                  <Route path="/admin/online-users" element={<OnlineUsersPage />} />
                  <Route path="/admin/active-games" element={<AdminActiveGamesPage />} />
                  <Route path="/admin/engagement" element={<AdminEngagementPage />} />
                  <Route path="/edit-profile" element={<EditProfilePage />} />
                  <Route path="/leaderboard" element={<LeaderboardPage />} />
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
                  <Route path="/admin/temp-password" element={<AdminTempPasswordPage />} />
                  <Route path="/admin/backups" element={<ManageBackupsPage />} />
                  <Route path="/admin/sponsor-analytics" element={<SponsorAnalyticsPage />} />
                  <Route path="/admin/ads" element={<ManageAdsPage />} />
                  <Route path="/admin/push-analytics" element={<PushAnalyticsPage />} />
                  <Route path="/admin/notification-preferences" element={<NotificationPreferencesPage />} />
                  <Route path="/admin/settings" element={<AppSettingsPage />} />
                  <Route path="/admin/admob" element={<AdMobSettingsPage />} />
                 <Route path="/admin/send-update-reminder" element={<SendUpdateReminderPage />} />
                 <Route path="/admin/drills" element={<AdminDrillsPage />} />
                <Route path="/admin/dm-attachments" element={<AdminDmAttachmentsPage />} />
                <Route path="/admin/chat-photo-reminders" element={<AdminChatPhotoRemindersPage />} />
                <Route path="/admin/chat-virt-debug" element={<AdminChatVirtDebugPage />} />
                  <Route path="/clubs/:clubId/seasons" element={<SeasonsPage />} />
                  <Route path="/clubs/:clubId/seasons/compare" element={<SeasonComparePage />} />
                  <Route path="/clubs/:clubId/seasons/:seasonId" element={<SeasonDetailPage />} />
                  <Route path="/clubs/:clubId/eois" element={<EoiAdminPage />} />
                  <Route path="/mini-leagues" element={<MiniLeaguesPage />} />
                  <Route path="/mini-leagues/:id" element={<MiniLeagueDetailPage />} />
                  <Route path="/competitions" element={<CompetitionsPage />} />
                  <Route path="/competitions/new" element={<CreateCompetitionPage />} />
                  <Route path="/competitions/:id" element={<CompetitionDetailPage />} />
                  <Route path="/associations" element={<AssociationsPage />} />
                  <Route path="/associations/new" element={<CreateAssociationPage />} />
                  <Route path="/associations/:id" element={<AssociationDetailPage />} />
                </Route>

                <Route path="/c/:id" element={<PublicCompetitionPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            <CookieConsentBanner />
            <IOSInstallPrompt />
            <PushNotificationManager />
            <StatusBarManager />
            <NativeAppUpdatePrompt />
            
          </BrowserRouter>
          </TooltipProvider>
        </ClubThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
  );
};

export default App;
