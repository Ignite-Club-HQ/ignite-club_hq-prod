import {
  Body,
  Button,
  Container,
  Head,
  Heading,
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
}

// Production domain for all links
const PRODUCTION_DOMAIN = "https://igniteclubhq.app";

// Ignite brand color - emerald green
const IGNITE_BRAND_COLOR = "#10b981";

// Ignite icon URL for footer (hosted on production domain)
const IGNITE_ICON_URL = `${PRODUCTION_DOMAIN}/ignite-email-icon.png`;

// Check if a URL is a valid external URL (not base64)
const isValidExternalUrl = (url?: string): boolean => {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
};

// Ensure invite link uses production domain
const normalizeInviteLink = (link: string): string => {
  // Extract the path from the invite link
  try {
    const url = new URL(link);
    return `${PRODUCTION_DOMAIN}${url.pathname}`;
  } catch {
    // If it's already just a path or malformed, prepend production domain
    if (link.startsWith('/')) {
      return `${PRODUCTION_DOMAIN}${link}`;
    }
    return link;
  }
};

// Store links
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub&pcampaignid=web_share";
const APP_STORE_URL = "https://apps.apple.com/au/app/ignite-club-hq/id6758928691";

export const TeamInviteEmail = ({
  recipientName = "Member",
  invitedEmail,
  teamName = "The Team",
  clubName = "The Club",
  roleName = "Player",
  inviteLink = "https://igniteclubhq.app/join",
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  childrenNames = [],
  customMessage,
}: TeamInviteEmailProps) => {
  const previewText = `You've been invited to join ${teamName} on Ignite Club HQ!`;
  // Only use club logo if it's a valid external URL (not base64)
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;

  // Build deep link URL for native app (igniteclubhq:// scheme)
  const deepLinkPath = inviteLink.replace(/^https?:\/\/[^/]+/, '');
  const deepLinkUrl = `https://igniteclubhq.app${deepLinkPath}`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with Club Logo */}
          <Section style={headerSection}>
            {validClubLogoUrl ? (
              <Img
                src={validClubLogoUrl}
                width="80"
                height="80"
                alt={clubName}
                style={logoStyle}
              />
            ) : (
              <div style={{ ...logoPlaceholder, backgroundColor: primaryColor }}>
                <Text style={logoPlaceholderText}>
                  {clubName.charAt(0).toUpperCase()}
                </Text>
              </div>
            )}
            <Text style={clubNameText}>{clubName}</Text>
          </Section>

          <Hr style={divider} />

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>You're Invited! 🎉</Heading>
            
            <Text style={paragraph}>
              Hi {recipientName},
            </Text>
            
            <Text style={paragraph}>
              <strong style={{ color: primaryColor }}>{clubName}</strong> has invited you to join <strong>{teamName}</strong> as a <strong>{roleName}</strong>.
            </Text>

            {customMessage && (
              <Section style={customMessageSection}>
                <Text style={customMessageText}>
                  {customMessage}
                </Text>
              </Section>
            )}

            {childrenNames.length > 0 && (
              <Section style={childrenSection}>
                <Text style={childrenText}>
                  Your {childrenNames.length === 1 ? 'child' : 'children'} will also be registered:
                </Text>
                <Text style={childrenText}>
                  <strong>{childrenNames.join(', ')}</strong>
                </Text>
              </Section>
            )}

            {/* Step 1: Download the App */}
            <Section style={stepsSection}>
              <Section style={stepRow}>
                <Text style={stepNumber}>1</Text>
                <Text style={stepText}>
                  <strong>Download Ignite Club HQ</strong>
                </Text>
              </Section>

              <Text style={stepSubText}>
                Get the app on your phone — it's free!
              </Text>

              <Section style={storeButtonsSection}>
                <table cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
                  <tr>
                    <td style={{ paddingRight: '8px' }}>
                      <Button style={playStoreButton} href={PLAY_STORE_URL}>
                        ▶️ Google Play
                      </Button>
                    </td>
                    <td style={{ paddingLeft: '8px' }}>
                      <Button style={appStoreButton} href={APP_STORE_URL}>
                        🍎 App Store
                      </Button>
                    </td>
                  </tr>
                </table>
              </Section>

              <Hr style={stepDivider} />

              {/* Step 2: Accept Invite */}
              <Section style={stepRow}>
                <Text style={stepNumber}>2</Text>
                <Text style={stepText}>
                  <strong>Accept your invitation</strong>
                </Text>
              </Section>

              <Text style={stepSubText}>
                Tap the button below to open the app, create your profile, and you'll automatically have access to <strong>{teamName}</strong>. It's that simple!
              </Text>

              <Section style={acceptButtonSection}>
                <Button style={{ ...acceptButton, backgroundColor: primaryColor }} href={deepLinkUrl}>
                  ✅ Accept Invite & Join {teamName}
                </Button>
              </Section>

              {invitedEmail && (
                <Text style={emailHintText}>
                  Sign up using <strong>{invitedEmail}</strong> to ensure your invitation is linked correctly.
                </Text>
              )}
            </Section>

            <Text style={noteText}>
              That's it — just 2 steps! Your team access is applied automatically. No codes or extra setup needed.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This invitation was sent by {clubName}. You can manage your notification preferences in the app settings.
            </Text>
            <Text style={photoConsentText}>
              📷 Photos may be shared within the app by team members. Photo consent is managed by your club, not Ignite Club HQ. 
              Please contact your club or team admin if you have concerns or wish to opt out.
            </Text>
            <table cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
              <tr>
                <td style={{ paddingRight: '8px', verticalAlign: 'middle' }}>
                  <Img
                    src={IGNITE_ICON_URL}
                    width="24"
                    height="24"
                    alt="Ignite Club HQ"
                    style={igniteLogoStyle}
                  />
                </td>
                <td style={{ verticalAlign: 'middle' }}>
                  <Link href={PRODUCTION_DOMAIN} style={footerBrandTextLink}>
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

// Styles
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '0',
  marginBottom: '40px',
  borderRadius: '12px',
  overflow: 'hidden',
  maxWidth: '560px',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.07)',
};

const headerSection = {
  backgroundColor: '#fafafa',
  padding: '32px 40px',
  textAlign: 'center' as const,
};

const logoStyle = {
  margin: '0 auto',
  borderRadius: '12px',
  objectFit: 'cover' as const,
};

const logoPlaceholder = {
  width: '80px',
  height: '80px',
  borderRadius: '12px',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const logoPlaceholderText = {
  color: '#ffffff',
  fontSize: '36px',
  fontWeight: 'bold',
  margin: '0',
  lineHeight: '80px',
  textAlign: 'center' as const,
};

const clubNameText = {
  color: '#1a1a1a',
  fontSize: '18px',
  fontWeight: '600',
  margin: '16px 0 0 0',
};

const divider = {
  borderColor: '#e6e6e6',
  margin: '0',
};

const contentSection = {
  padding: '32px 40px',
};

const heading = {
  color: '#1a1a1a',
  fontSize: '28px',
  fontWeight: 'bold',
  margin: '0 0 24px 0',
  textAlign: 'center' as const,
};

const paragraph = {
  color: '#4a4a4a',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 16px 0',
};

const childrenSection = {
  backgroundColor: '#f0fdf4',
  borderRadius: '8px',
  padding: '16px',
  margin: '16px 0',
  borderLeft: '4px solid #22c55e',
};

const childrenText = {
  color: '#166534',
  fontSize: '14px',
  margin: '0 0 4px 0',
};

const stepsSection = {
  backgroundColor: '#f8fafc',
  borderRadius: '10px',
  padding: '24px',
  margin: '24px 0',
};

const stepRow = {
  display: 'flex',
  alignItems: 'flex-start',
  margin: '0 0 8px 0',
};

const stepNumber = {
  backgroundColor: '#10b981',
  color: '#ffffff',
  borderRadius: '50%',
  width: '28px',
  height: '28px',
  fontSize: '14px',
  fontWeight: 'bold',
  textAlign: 'center' as const,
  lineHeight: '28px',
  margin: '0 12px 0 0',
  flexShrink: 0,
  display: 'inline-block',
};

const stepText = {
  color: '#1a1a1a',
  fontSize: '16px',
  lineHeight: '28px',
  margin: '0',
  fontWeight: '600',
};

const stepSubText = {
  color: '#64748b',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0 0 16px 0',
  paddingLeft: '40px',
};

const stepDivider = {
  borderColor: '#e2e8f0',
  margin: '20px 0',
};

const storeButtonsSection = {
  textAlign: 'center' as const,
  margin: '0 0 8px 0',
};

const playStoreButton = {
  borderRadius: '8px',
  backgroundColor: '#10b981',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '10px 20px',
};

const appStoreButton = {
  borderRadius: '8px',
  backgroundColor: '#1a1a1a',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '10px 20px',
};

const acceptButtonSection = {
  textAlign: 'center' as const,
  margin: '16px 0 12px 0',
};

const acceptButton = {
  borderRadius: '10px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
};

const emailHintText = {
  color: '#64748b',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0',
  textAlign: 'center' as const,
};

const noteText = {
  color: '#64748b',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '16px 0 0 0',
  textAlign: 'center' as const,
  fontStyle: 'italic' as const,
};

const footerSection = {
  backgroundColor: '#fafafa',
  padding: '24px 40px',
};

const footerText = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '20px',
  margin: '0 0 12px 0',
  textAlign: 'center' as const,
};

const photoConsentText = {
  color: '#94a3b8',
  fontSize: '11px',
  lineHeight: '18px',
  margin: '0 0 16px 0',
  textAlign: 'center' as const,
  fontStyle: 'italic' as const,
};

const igniteLogoStyle = {
  display: 'block',
  borderRadius: '4px',
};

const footerBrandTextLink = {
  color: IGNITE_BRAND_COLOR,
  fontSize: '12px',
  textDecoration: 'none',
};

const customMessageSection = {
  backgroundColor: '#f0f9ff',
  borderRadius: '8px',
  padding: '16px',
  margin: '16px 0',
  borderLeft: '4px solid #10b981',
};

const customMessageText = {
  color: '#334155',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0',
  whiteSpace: 'pre-wrap' as const,
};
