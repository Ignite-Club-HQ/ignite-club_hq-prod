import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import * as React from 'npm:react@18.3.1'

interface TeamInviteEmailProps {
  recipientName: string;
  invitedEmail?: string;
  teamName: string;
  clubName: string;
  roleName: string;
  inviteLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  childrenNames?: string[];
  customMessage?: string;
  isExistingUser?: boolean;
  isMiniLeague?: boolean;
}

const PRODUCTION_DOMAIN = "https://igniteclubhq.app";
const IGNITE_BRAND_COLOR = "#10b981";
const IGNITE_ICON_URL = `${PRODUCTION_DOMAIN}/ignite-icon.png`;

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub&pcampaignid=web_share";
const APP_STORE_URL = "https://apps.apple.com/au/app/ignite-club-hq/id6758928691";

const isValidExternalUrl = (url?: string): boolean => {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
};

const normalizeInviteLink = (link: string): string => {
  try {
    const url = new URL(link);
    return `${PRODUCTION_DOMAIN}${url.pathname}`;
  } catch {
    if (link.startsWith('/')) {
      return `${PRODUCTION_DOMAIN}${link}`;
    }
    return link;
  }
};

export const TeamInviteEmail = ({
  recipientName = "everyone",
  invitedEmail,
  teamName = "The Team",
  clubName = "The Club",
  roleName = "Player",
  inviteLink = "https://igniteclubhq.app/join",
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  childrenNames = [],
  customMessage,
  isExistingUser = false,
  isMiniLeague = false,
}: TeamInviteEmailProps) => {
  const hasChildren = childrenNames.length > 0;
  const childLabel = childrenNames.length === 1 ? childrenNames[0] : 'your kids';
  const isAdminRole = ['Club Admin', 'Committee Member', 'Coach', 'Team Admin'].includes(roleName);
  const previewText = isAdminRole
    ? `You've been invited to join the ${clubName} app as ${roleName}`
    : hasChildren
      ? `${childLabel} has been added to their team for this season ⚽`
      : `Your child has been added to their team for this season ⚽`;
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;
  const deepLinkPath = inviteLink.replace(/^https?:\/\/[^/]+/, '');
  const deepLinkUrl = `https://igniteclubhq.app${deepLinkPath}`;

  // Use custom message if provided, otherwise use default copy
  const useCustomMessage = customMessage && customMessage.trim().length > 0;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>

          {/* Club Logo Header */}
          {validClubLogoUrl && (
            <Section style={logoSection}>
              <Img
                src={validClubLogoUrl}
                width="72"
                height="72"
                alt={clubName}
                style={logoStyle}
              />
            </Section>
          )}

          {/* Main Content */}
          <Section style={contentSection}>

            <Text style={greeting}>
              Hi {recipientName === "Member" ? "everyone" : recipientName},
            </Text>

            {useCustomMessage ? (
              /* Custom message override — split on double-newlines for paragraphs */
              <>
                {customMessage!.split(/\n\n+/).map((paragraph, i) => {
                  const lines = paragraph.split(/\n/);
                  if (lines.length === 1) {
                    return <Text key={i} style={bodyText}>{paragraph}</Text>;
                  }
                  return lines.map((line, j) => (
                    <Text key={`${i}-${j}`} style={line.trim().startsWith('•') ? bulletItem : bodyText}>
                      {line}
                    </Text>
                  ));
                })}
              </>
            ) : isAdminRole ? (
              /* Role-specific admin invite copy */
              <>
                <Text style={headingText}>
                  You've been invited to join the {clubName} app as {roleName} 🎉
                </Text>

                <Text style={bodyText}>
                  {clubName} is using <strong>Ignite Club HQ</strong> to manage teams, events, and communication — all in one place.
                </Text>

                <Text style={sectionLabel}>👀 As {roleName}, you'll be able to:</Text>

                {roleName === 'Club Admin' ? (
                  <>
                    <Text style={bulletItem}>• Manage all club teams, members, and roles</Text>
                    <Text style={bulletItem}>• Oversee club chat and communication channels</Text>
                    <Text style={bulletItem}>• Manage the file vault and media gallery</Text>
                    <Text style={bulletItem}>• Configure club settings and branding</Text>
                  </>
                ) : roleName === 'Committee Member' ? (
                  <>
                    <Text style={bulletItem}>• Access and participate in committee chat</Text>
                    <Text style={bulletItem}>• Store and manage club documents in the vault</Text>
                    <Text style={bulletItem}>• Stay across club updates and announcements</Text>
                  </>
                ) : roleName === 'Coach' ? (
                  <>
                    <Text style={bulletItem}>• Set up and manage training sessions and fixtures</Text>
                    <Text style={bulletItem}>• Track attendance and manage team rosters</Text>
                    <Text style={bulletItem}>• Use the pitch board for lineups, formations, and automated substitutions</Text>
                    <Text style={bulletItem}>• Communicate with your team via team chat</Text>
                  </>
                ) : roleName === 'Team Admin' ? (
                  <>
                    <Text style={bulletItem}>• Create and manage team events, fixtures, and training</Text>
                    <Text style={bulletItem}>• Track attendance and manage team members</Text>
                    <Text style={bulletItem}>• Use the pitch board for lineups, formations, and automated substitutions</Text>
                    <Text style={bulletItem}>• Manage team chat and communication</Text>
                  </>
                ) : (
                  <>
                    <Text style={bulletItem}>• View and manage teams and members</Text>
                    <Text style={bulletItem}>• Coordinate events and fixtures</Text>
                    <Text style={bulletItem}>• Communicate with your club</Text>
                  </>
                )}

              </>
            ) : clubName === 'Bridgewater Soccer Club' ? (
              /* Bridgewater-specific default copy */
              <>
                <Text style={headingText}>
                  {hasChildren
                    ? `${childLabel} has been added to ${teamName} ⚽`
                    : `Your child has been added to ${teamName} ⚽`}
                </Text>

                <Text style={bodyText}>
                  {hasChildren
                    ? `You can now view ${childLabel}'s team in Ignite Club HQ.`
                    : `You can now view your child's team in Ignite Club HQ.`}
                </Text>
                <Text style={bodyText}>
                  It's our club app — built by a Bridgewater parent — where you'll find team details, updates and other important club information all in one place.
                </Text>

                <Text style={sectionLabel}>👀 Here's what you can do:</Text>

                {!isMiniLeague && (
                  <Text style={bulletItem}>• See which team they're in and who their teammates are</Text>
                )}
                <Text style={bulletItem}>• Get notified about games, training and other events</Text>
                <Text style={bulletItem}>• Message coaches and other parents in team chat</Text>
                <Text style={bulletItem}>• View photos from games and club events</Text>
                <Text style={bulletItem}>• Stay up to date with club news and announcements</Text>
              </>
            ) : (
              /* Generic default copy for all other clubs */
              <>
                <Text style={headingText}>
                  {hasChildren
                    ? `${childLabel} has been added to ${teamName} 🎉`
                    : `You've been invited to join ${teamName} 🎉`}
                </Text>

                <Text style={bodyText}>
                  {clubName} is using <strong>Ignite Club HQ</strong> to manage teams, events, and communication — all in one place.
                </Text>

                <Text style={sectionLabel}>👀 Once you join, you'll be able to:</Text>

                {!isMiniLeague && (
                  <Text style={bulletItem}>• See which team they're in and who their teammates are</Text>
                )}
                <Text style={bulletItem}>• Get notified about games, training and other events</Text>
                <Text style={bulletItem}>• Message coaches and other parents in team chat</Text>
                <Text style={bulletItem}>• View photos from games and club events</Text>
                <Text style={bulletItem}>• Stay up to date with club news and announcements</Text>



              </>
            )}

          </Section>

          {/* Get Started Section */}
          <Section style={ctaSection}>
            {isExistingUser ? (
              <>
                <Text style={sectionLabel}>👇 Open the app</Text>
                <Text style={bodyText}>
                  You're already on Ignite Club HQ — just tap below to jump straight to {teamName}.
                </Text>

                <Section style={mainCtaSection}>
                  <Button style={{ ...mainCtaButton, backgroundColor: primaryColor }} href={deepLinkUrl}>
                    {isAdminRole ? 'Open in App' : isMiniLeague ? 'Join Now' : 'View Their Team'}
                  </Button>
                </Section>

                <Text style={fallbackLinkText}>
                  Or copy this link: <Link href={deepLinkUrl} style={fallbackLink}>{deepLinkUrl}</Link>
                </Text>
              </>
            ) : (
              <>
                <Text style={sectionLabel}>👇 Get started</Text>
                <Text style={bodyText}>
                  It only takes about 30 seconds to get set up — once you're in, you're all ready to go.
                </Text>

                {/* Step 1: Download */}
                <Text style={stepLabel}>1. Download the app</Text>
                <Section style={storeButtonsRow}>
                  <table cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
                    <tr>
                      <td style={{ paddingRight: '6px' }}>
                        <Button style={playStoreBtn} href={PLAY_STORE_URL}>
                          ▶️ Google Play
                        </Button>
                      </td>
                      <td style={{ paddingLeft: '6px' }}>
                        <Button style={appStoreBtn} href={APP_STORE_URL}>
                          🍎 App Store
                        </Button>
                      </td>
                    </tr>
                  </table>
                </Section>

                {/* Step 2: View */}
                <Text style={stepLabel}>{isAdminRole ? '2. Tap below to get started' : isMiniLeague ? '2. Tap below to join' : '2. Tap below to see their team'}</Text>

                <Section style={mainCtaSection}>
                  <Button style={{ ...mainCtaButton, backgroundColor: primaryColor }} href={deepLinkUrl}>
                    {isAdminRole ? 'Get Started' : isMiniLeague ? 'Join Now' : 'View Their Team'}
                  </Button>
                </Section>

                <Text style={fallbackLinkText}>
                  Or copy this link: <Link href={deepLinkUrl} style={fallbackLink}>{deepLinkUrl}</Link>
                </Text>

                {invitedEmail && (
                  <Text style={emailHint}>
                    Sign up using <strong>{invitedEmail}</strong> to link your invitation.
                  </Text>
                )}
              </>
            )}
          </Section>

          {/* Closing */}
          <Section style={closingSection}>
            <Text style={bodyText}>
              If you have any issues, just reply to this email and we'll help you out.
            </Text>

            <Text style={clubSignature}>
              {clubName}
            </Text>
          </Section>

          <Hr style={footerDivider} />

          {/* Footer */}
          <Section style={footerSection}>
            <table cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
              <tr>
                <td style={{ paddingRight: '8px', verticalAlign: 'middle' }}>
                  <Img
                    src={IGNITE_ICON_URL}
                    width="20"
                    height="20"
                    alt="Ignite Club HQ"
                    style={{ display: 'block', borderRadius: '4px' }}
                  />
                </td>
                <td style={{ verticalAlign: 'middle' }}>
                  <Link href={PRODUCTION_DOMAIN} style={footerBrandLink}>
                    Powered by Ignite Club HQ
                  </Link>
                </td>
              </tr>
            </table>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default TeamInviteEmail;

// ── Styles ──

const main = {
  backgroundColor: '#f4f4f5',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
  padding: '20px 0',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  maxWidth: '600px',
  borderRadius: '12px',
  overflow: 'hidden' as const,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
};

const logoSection = {
  textAlign: 'center' as const,
  padding: '32px 24px 8px 24px',
};

const logoStyle = {
  margin: '0 auto',
  borderRadius: '12px',
  objectFit: 'cover' as const,
};

const contentSection = {
  padding: '24px 32px 0 32px',
};

const greeting = {
  color: '#1a1a1a',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 16px 0',
};

const headingText = {
  color: '#1a1a1a',
  fontSize: '20px',
  fontWeight: 'bold' as const,
  lineHeight: '28px',
  margin: '0 0 20px 0',
};

const bodyText = {
  color: '#374151',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 12px 0',
};

const sectionLabel = {
  color: '#1a1a1a',
  fontSize: '16px',
  fontWeight: '600' as const,
  lineHeight: '24px',
  margin: '20px 0 8px 0',
};

const bulletItem = {
  color: '#374151',
  fontSize: '15px',
  lineHeight: '26px',
  margin: '0',
  paddingLeft: '8px',
};

const subtleNote = {
  color: '#6b7280',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '8px 0 0 0',
  fontStyle: 'italic' as const,
};

const childrenSection = {
  backgroundColor: '#f0fdf4',
  borderRadius: '8px',
  padding: '12px 16px',
  margin: '16px 0 0 0',
};

const childrenText = {
  color: '#166534',
  fontSize: '14px',
  margin: '0',
  lineHeight: '22px',
};

const ctaSection = {
  padding: '8px 32px 24px 32px',
};

const stepLabel = {
  color: '#374151',
  fontSize: '15px',
  fontWeight: '600' as const,
  lineHeight: '24px',
  margin: '16px 0 10px 0',
};

const storeButtonsRow = {
  textAlign: 'center' as const,
  margin: '0 0 4px 0',
};

const playStoreBtn = {
  borderRadius: '8px',
  backgroundColor: '#10b981',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 'bold' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '10px 20px',
};

const appStoreBtn = {
  borderRadius: '8px',
  backgroundColor: '#18181b',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 'bold' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '10px 20px',
};

const mainCtaSection = {
  textAlign: 'center' as const,
  margin: '12px 0',
};

const mainCtaButton = {
  borderRadius: '10px',
  color: '#ffffff',
  fontSize: '18px',
  fontWeight: 'bold' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  padding: '16px 24px',
  width: '100%',
  boxSizing: 'border-box' as const,
};

const fallbackLinkText = {
  color: '#9ca3af',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '4px 0 0 0',
  textAlign: 'center' as const,
  wordBreak: 'break-all' as const,
};

const fallbackLink = {
  color: '#10b981',
  textDecoration: 'underline',
};

const emailHint = {
  color: '#6b7280',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '12px 0 0 0',
  textAlign: 'center' as const,
};

const closingSection = {
  padding: '0 32px 24px 32px',
};

const clubSignature = {
  color: '#374151',
  fontSize: '15px',
  lineHeight: '22px',
  margin: '0',
};

const footerDivider = {
  borderColor: '#e5e7eb',
  margin: '0',
};

const footerSection = {
  padding: '20px 32px',
  backgroundColor: '#fafafa',
};


const footerBrandLink = {
  color: IGNITE_BRAND_COLOR,
  fontSize: '12px',
  textDecoration: 'none',
};
