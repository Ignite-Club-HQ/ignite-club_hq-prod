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

interface DutyAssignedEmailProps {
  recipientName?: string;
  dutyName: string;
  eventTitle: string;
  eventDate: string;
  eventTime?: string;
  teamName?: string;
  clubName: string;
  eventLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

// Production domain for all links
const PRODUCTION_DOMAIN = "https://igniteclubhq.app";

// Ignite brand color - emerald green
const IGNITE_BRAND_COLOR = "#10b981";

// Ignite icon URL for footer (hosted on production domain)
const IGNITE_ICON_URL = `${PRODUCTION_DOMAIN}/ignite-icon.png`;

// Check if a URL is a valid external URL (not base64)
const isValidExternalUrl = (url?: string): boolean => {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
};

// Normalize links to use production domain
const normalizeLink = (link: string): string => {
  try {
    const url = new URL(link);
    return `${PRODUCTION_DOMAIN}${url.pathname}${url.search}`;
  } catch {
    if (link.startsWith('/')) {
      return `${PRODUCTION_DOMAIN}${link}`;
    }
    return link;
  }
};

export const DutyAssignedEmail = ({
  recipientName = "Team Member",
  dutyName = "Game Duty",
  eventTitle = "Upcoming Event",
  eventDate = "",
  eventTime = "",
  teamName = "",
  clubName = "The Club",
  eventLink = "/events",
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
}: DutyAssignedEmailProps) => {
  const previewText = `You've been assigned to ${dutyName} for ${eventTitle}`;
  const normalizedEventLink = normalizeLink(eventLink);
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;
  const displayName = teamName || clubName;

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
              <table cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
                <tr>
                  <td style={{ ...logoPlaceholder, backgroundColor: primaryColor }}>
                    <span style={logoPlaceholderText}>
                      {clubName.charAt(0).toUpperCase()}
                    </span>
                  </td>
                </tr>
              </table>
            )}
            <Text style={clubNameText}>{displayName}</Text>
          </Section>

          <Hr style={divider} />

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>Duty Assigned 📋</Heading>
            
            <Text style={paragraph}>
              Hi {recipientName},
            </Text>
            
            <Text style={paragraph}>
              You've been assigned to a duty for an upcoming event. Here are the details:
            </Text>

            {/* Duty Details Card */}
            <Section style={dutyCard}>
              <table cellPadding="0" cellSpacing="0" style={{ width: '100%' }}>
                <tr>
                  <td style={dutyLabelCell}>Duty:</td>
                  <td style={dutyValueCell}><strong>{dutyName}</strong></td>
                </tr>
                <tr>
                  <td style={dutyLabelCell}>Event:</td>
                  <td style={dutyValueCell}>{eventTitle}</td>
                </tr>
                {eventDate && (
                  <tr>
                    <td style={dutyLabelCell}>Date:</td>
                    <td style={dutyValueCell}>{eventDate}</td>
                  </tr>
                )}
                {eventTime && (
                  <tr>
                    <td style={dutyLabelCell}>Time:</td>
                    <td style={dutyValueCell}>{eventTime}</td>
                  </tr>
                )}
              </table>
            </Section>

            <Text style={paragraph}>
              Please make sure you're available and prepared for this duty. If you have any questions or need to make changes, please contact your team admin.
            </Text>

            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedEventLink}>
                View Event Details
              </Button>
            </Section>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This notification was sent by {clubName}. You received this because you were assigned to a duty.
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

export default DutyAssignedEmail;

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
  textAlign: 'center' as const,
};

const logoPlaceholderText = {
  color: '#ffffff',
  fontSize: '36px',
  fontWeight: 'bold' as const,
  lineHeight: '80px',
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

const dutyCard = {
  backgroundColor: '#f0f9ff',
  borderRadius: '8px',
  padding: '20px',
  margin: '24px 0',
  borderLeft: '4px solid #0ea5e9',
};

const dutyLabelCell = {
  color: '#64748b',
  fontSize: '14px',
  padding: '4px 12px 4px 0',
  verticalAlign: 'top' as const,
  width: '80px',
};

const dutyValueCell = {
  color: '#1a1a1a',
  fontSize: '14px',
  padding: '4px 0',
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
