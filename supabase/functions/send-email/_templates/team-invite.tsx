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
  teamName: string;
  clubName: string;
  roleName: string;
  inviteLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  childrenNames?: string[];
}

// Production domain for all links
const PRODUCTION_DOMAIN = "https://igniteclubhq.app";

// Ignite brand color - emerald green
const IGNITE_BRAND_COLOR = "#10b981";

// Ignite logo URL (hosted on production domain) - use the existing ignite-logo.png
const IGNITE_LOGO_URL = `${PRODUCTION_DOMAIN}/ignite-logo.png`;

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

export const TeamInviteEmail = ({
  recipientName = "Member",
  teamName = "The Team",
  clubName = "The Club",
  roleName = "Player",
  inviteLink = "https://igniteclubhq.app/join",
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  childrenNames = [],
}: TeamInviteEmailProps) => {
  const previewText = `You're invited to join ${teamName}!`;
  const normalizedInviteLink = normalizeInviteLink(inviteLink);
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
              You've been invited to join <strong style={{ color: primaryColor }}>{teamName}</strong> as a <strong>{roleName}</strong>.
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

            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedInviteLink}>
                Accept Invitation
              </Button>
            </Section>

            <Text style={orText}>
              Or copy and paste this link into your browser:
            </Text>
            <Text style={linkText}>
              <Link href={normalizedInviteLink} style={{ color: primaryColor }}>
                {normalizedInviteLink}
              </Link>
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This invitation was sent by {clubName}. If you didn't expect this email, you can safely ignore it.
            </Text>
            <table cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
              <tr>
                <td style={{ paddingRight: '8px', verticalAlign: 'middle' }}>
                  <Img
                    src={IGNITE_LOGO_URL}
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

const buttonSection = {
  textAlign: 'center' as const,
  margin: '32px 0',
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

const orText = {
  color: '#8898aa',
  fontSize: '13px',
  textAlign: 'center' as const,
  margin: '24px 0 8px 0',
};

const linkText = {
  fontSize: '13px',
  textAlign: 'center' as const,
  margin: '0',
  wordBreak: 'break-all' as const,
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
