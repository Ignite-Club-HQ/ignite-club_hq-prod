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

// Store links — update APP_STORE_URL when iOS listing is live
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub&pcampaignid=web_share";
// TODO: replace with real App Store URL when published, e.g. "https://apps.apple.com/app/ignite-club-hq/idXXXXXXXXX"
const APP_STORE_URL = "";

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
}: TeamInviteEmailProps) => {
  const previewText = `You've been invited to join ${teamName} on Ignite Club HQ!`;
  // Only use club logo if it's a valid external URL (not base64)
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with Logo */}
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
              <strong style={{ color: primaryColor }}>{clubName}</strong> has invited you to join <strong>{teamName}</strong> as a <strong>{roleName}</strong> on Ignite Club HQ.
            </Text>

            {childrenNames.length > 0 && (
              <Section style={childrenSection}>
                <Text style={childrenText}>
                  Your {childrenNames.length === 1 ? 'child' : 'children'} will also be registered:
                </Text>
                <Text style={childrenNames as any}>
                  <strong>{childrenNames.join(', ')}</strong>
                </Text>
              </Section>
            )}

            {/* How to join */}
            <Section style={stepsSection}>
              <Text style={stepsHeading}>Here's how to get started:</Text>

              <Section style={stepRow}>
                <Text style={stepNumber}>1</Text>
                <Text style={stepText}>
                  <strong>Download Ignite Club HQ</strong> from the Google Play Store
                </Text>
              </Section>

              <Section style={buttonSection}>
                <Button style={{ ...button, backgroundColor: primaryColor }} href={PLAY_STORE_URL}>
                  📱 Download on Google Play
                </Button>
              </Section>

              {/* App Store placeholder — remove condition when APP_STORE_URL is set */}
              {APP_STORE_URL ? (
                <Section style={{ ...buttonSection, marginTop: '-8px' }}>
                  <Button style={{ ...button, backgroundColor: '#555555' }} href={APP_STORE_URL}>
                    🍎 Download on the App Store
                  </Button>
                </Section>
              ) : (
                <Section style={{ ...buttonSection, marginTop: '-8px' }}>
                  <Text style={comingSoonText}>🍎 App Store — coming soon</Text>
                </Section>
              )}

              <Section style={stepRow}>
                <Text style={stepNumber}>2</Text>
                <Text style={stepText}>
                  <strong>Create your account</strong> — tap <strong>"Sign up here"</strong> on the sign-in screen. Enter{invitedEmail ? <> <strong>{invitedEmail}</strong> as your email</> : ' this email address'}, set a password, then complete your profile when prompted.
                </Text>
              </Section>

              <Section style={stepRow}>
                <Text style={stepNumber}>3</Text>
                <Text style={stepText}>
                  <strong>You're in! 🎉</strong> — your invitation to join <strong>{teamName}</strong> is applied automatically the moment you log in. No extra steps needed.
                </Text>
              </Section>
            </Section>

            <Text style={noteText}>
              ✅ Your invite is applied automatically when you log in — no need to come back to this email or tap anything extra.
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
  padding: '20px 24px',
  margin: '24px 0',
};

const stepsHeading = {
  color: '#1a1a1a',
  fontSize: '15px',
  fontWeight: '600',
  margin: '0 0 16px 0',
};

const stepRow = {
  display: 'flex',
  alignItems: 'flex-start',
  margin: '0 0 14px 0',
};

const stepNumber = {
  backgroundColor: '#10b981',
  color: '#ffffff',
  borderRadius: '50%',
  width: '24px',
  height: '24px',
  fontSize: '13px',
  fontWeight: 'bold',
  textAlign: 'center' as const,
  lineHeight: '24px',
  margin: '0 12px 0 0',
  flexShrink: 0,
  display: 'inline-block',
};

const stepText = {
  color: '#4a4a4a',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0',
};

const noteText = {
  color: '#64748b',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '16px 0 0 0',
  textAlign: 'center' as const,
  fontStyle: 'italic' as const,
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '16px 0 20px 0',
};

const button = {
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 28px',
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

const comingSoonText = {
  color: '#94a3b8',
  fontSize: '13px',
  textAlign: 'center' as const,
  margin: '0',
  fontStyle: 'italic' as const,
};
