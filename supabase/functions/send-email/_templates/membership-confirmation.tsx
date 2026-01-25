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

interface MembershipConfirmationEmailProps {
  recipientName: string;
  teamName: string;
  clubName: string;
  roleName: string;
  teamLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  welcomeMessage?: string;
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

// Ensure link uses production domain
const normalizeLink = (link: string): string => {
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

export const MembershipConfirmationEmail = ({
  recipientName = "Member",
  teamName = "The Team",
  clubName = "Your Club",
  roleName = "Player",
  teamLink = "https://igniteclubhq.app/team",
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  welcomeMessage,
}: MembershipConfirmationEmailProps) => {
  const previewText = `Welcome to ${teamName}! You're now a ${roleName}.`;
  const normalizedTeamLink = normalizeLink(teamLink);
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

          {/* Celebration Banner */}
          <Section style={{ ...celebrationBanner, backgroundColor: `${primaryColor}15` }}>
            <Text style={celebrationEmoji}>🎉</Text>
            <Text style={{ ...celebrationText, color: primaryColor }}>You're In!</Text>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>Welcome to the Team!</Heading>
            
            <Text style={paragraph}>
              Dear {recipientName},
            </Text>
            
            <Text style={paragraph}>
              Great news! You've successfully joined <strong style={{ color: primaryColor }}>{teamName}</strong> as a <strong>{roleName}</strong>.
            </Text>

            {welcomeMessage && (
              <Section style={messageBox}>
                <Text style={messageText}>"{welcomeMessage}"</Text>
                <Text style={messageAuthor}>— The {teamName} Team</Text>
              </Section>
            )}

            {/* What's Next Section */}
            <Section style={whatNextSection}>
              <Text style={whatNextHeading}>What's Next?</Text>
              <Section style={bulletPoint}>
                <Text style={bulletEmoji}>📅</Text>
                <Text style={bulletText}>Check out upcoming events and training sessions</Text>
              </Section>
              <Section style={bulletPoint}>
                <Text style={bulletEmoji}>💬</Text>
                <Text style={bulletText}>Join the team chat to connect with everyone</Text>
              </Section>
              <Section style={bulletPoint}>
                <Text style={bulletEmoji}>📱</Text>
                <Text style={bulletText}>Download the app for instant notifications</Text>
              </Section>
            </Section>

            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedTeamLink}>
                Go to Your Team
              </Button>
            </Section>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              You're receiving this because you joined {teamName} on {clubName}.
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

export default MembershipConfirmationEmail;

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

const celebrationBanner = {
  padding: '20px',
  textAlign: 'center' as const,
};

const celebrationEmoji = {
  fontSize: '40px',
  margin: '0',
  lineHeight: '1',
};

const celebrationText = {
  fontSize: '20px',
  fontWeight: 'bold',
  margin: '8px 0 0 0',
};

const contentSection = {
  padding: '32px 40px',
};

const heading = {
  color: '#1a1a1a',
  fontSize: '26px',
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

const messageBox = {
  backgroundColor: '#f0fdf4',
  borderRadius: '8px',
  padding: '20px',
  margin: '20px 0',
  borderLeft: `4px solid ${IGNITE_BRAND_COLOR}`,
};

const messageText = {
  color: '#166534',
  fontSize: '15px',
  fontStyle: 'italic',
  margin: '0 0 8px 0',
  lineHeight: '24px',
};

const messageAuthor = {
  color: '#15803d',
  fontSize: '13px',
  margin: '0',
  fontWeight: '500',
};

const whatNextSection = {
  backgroundColor: '#f8fafc',
  borderRadius: '12px',
  padding: '24px',
  margin: '24px 0',
};

const whatNextHeading = {
  color: '#1e293b',
  fontSize: '16px',
  fontWeight: '600',
  margin: '0 0 16px 0',
};

const bulletPoint = {
  marginBottom: '12px',
};

const bulletEmoji = {
  fontSize: '16px',
  margin: '0 0 4px 0',
};

const bulletText = {
  color: '#475569',
  fontSize: '14px',
  margin: '0',
  lineHeight: '20px',
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '28px 0 0 0',
};

const button = {
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
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

const igniteLogoStyle = {
  display: 'block',
  borderRadius: '4px',
};

const footerBrandTextLink = {
  color: IGNITE_BRAND_COLOR,
  fontSize: '12px',
  textDecoration: 'none',
};
