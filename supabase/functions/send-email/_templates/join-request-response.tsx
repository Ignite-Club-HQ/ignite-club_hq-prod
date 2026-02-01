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

interface JoinRequestResponseEmailProps {
  recipientName: string;
  teamName?: string;
  clubName: string;
  roleName: string;
  approved: boolean;
  teamLink?: string;
  clubLogoUrl?: string;
  primaryColor?: string;
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

export const JoinRequestResponseEmail = ({
  recipientName = "Member",
  teamName,
  clubName = "The Club",
  roleName = "Player",
  approved = true,
  teamLink,
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
}: JoinRequestResponseEmailProps) => {
  const entityName = teamName || clubName;
  const previewText = approved 
    ? `Your request to join ${entityName} has been approved!`
    : `Update on your request to join ${entityName}`;
  
  // Only use club logo if it's a valid external URL (not base64)
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;

  const normalizedTeamLink = teamLink 
    ? (teamLink.startsWith('http') ? teamLink : `${PRODUCTION_DOMAIN}${teamLink}`)
    : PRODUCTION_DOMAIN;

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
            {approved ? (
              <>
                <Heading style={heading}>Welcome Aboard! 🎉</Heading>
                
                <Text style={paragraph}>
                  Hi {recipientName},
                </Text>
                
                <Text style={paragraph}>
                  Great news! Your request to join{" "}
                  <strong style={{ color: primaryColor }}>{entityName}</strong> as a{" "}
                  <strong>{roleName}</strong> has been approved.
                </Text>

                <Text style={paragraph}>
                  You now have full access to the team's events, messages, and media. We're excited to have you on board!
                </Text>

                <Section style={buttonSection}>
                  <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedTeamLink}>
                    View {teamName ? "Team" : "Club"}
                  </Button>
                </Section>
              </>
            ) : (
              <>
                <Heading style={heading}>Request Update</Heading>
                
                <Text style={paragraph}>
                  Hi {recipientName},
                </Text>
                
                <Text style={paragraph}>
                  We wanted to let you know that your request to join{" "}
                  <strong>{entityName}</strong> as a{" "}
                  <strong>{roleName}</strong> was not approved at this time.
                </Text>

                <Text style={paragraph}>
                  If you believe this was a mistake or have questions, please reach out to the team or club administrators directly.
                </Text>
              </>
            )}
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This email was sent by {clubName}. You can manage your notification preferences in the app settings.
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

export default JoinRequestResponseEmail;

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
