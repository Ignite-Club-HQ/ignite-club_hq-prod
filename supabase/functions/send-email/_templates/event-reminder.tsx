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
  Row,
  Column,
} from 'npm:@react-email/components@0.0.22'
import * as React from 'npm:react@18.3.1'

interface EventReminderEmailProps {
  recipientName: string;
  eventTitle: string;
  teamName: string;
  clubName: string;
  eventDate: string;
  eventTime: string;
  eventLocation?: string;
  eventType: string;
  eventLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  hoursUntilEvent?: number;
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

export const EventReminderEmail = ({
  recipientName = "Member",
  eventTitle = "Team Event",
  teamName = "The Team",
  clubName = "The Club",
  eventDate = "Saturday, January 25, 2025",
  eventTime = "2:00 PM",
  eventLocation,
  eventType = "Event",
  eventLink = "https://igniteclubhq.app/event",
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  hoursUntilEvent,
}: EventReminderEmailProps) => {
  const previewText = `Reminder: ${eventTitle} - ${eventDate} at ${eventTime}`;
  const urgencyText = hoursUntilEvent && hoursUntilEvent <= 24 
    ? `Starting in ${hoursUntilEvent} hour${hoursUntilEvent === 1 ? '' : 's'}!` 
    : null;
  const normalizedEventLink = normalizeLink(eventLink);
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
                width="60"
                height="60"
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

          {/* Urgency Banner */}
          {urgencyText && (
            <Section style={{ ...urgencyBanner, backgroundColor: primaryColor }}>
              <Text style={urgencyBannerText}>⏰ {urgencyText}</Text>
            </Section>
          )}

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>📅 Event Reminder</Heading>
            
            <Text style={paragraph}>
              Dear {recipientName},
            </Text>
            
            <Text style={paragraph}>
              This is a reminder about an upcoming <strong>{eventType.toLowerCase()}</strong> for <strong style={{ color: primaryColor }}>{teamName}</strong>.
            </Text>

            {/* Event Details Card */}
            <Section style={eventCard}>
              <Text style={eventTitleStyle}>{eventTitle}</Text>
              
              <Section style={detailsGrid}>
                <Row>
                  <Column style={detailColumn}>
                    <Text style={detailLabel}>📆 Date</Text>
                    <Text style={detailValue}>{eventDate}</Text>
                  </Column>
                  <Column style={detailColumn}>
                    <Text style={detailLabel}>🕐 Time</Text>
                    <Text style={detailValue}>{eventTime}</Text>
                  </Column>
                </Row>
                {eventLocation && (
                  <Row>
                    <Column>
                      <Text style={detailLabel}>📍 Location</Text>
                      <Text style={detailValue}>{eventLocation}</Text>
                    </Column>
                  </Row>
                )}
              </Section>
            </Section>

            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedEventLink}>
                View Event Details
              </Button>
            </Section>

            <Text style={reminderNote}>
              Please update your attendance if you haven't already!
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This reminder was sent by {clubName}. 
              <Link href={normalizedEventLink} style={{ color: primaryColor }}> Manage your notification preferences</Link>
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

export default EventReminderEmail;

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
  padding: '24px 40px',
  textAlign: 'center' as const,
};

const logoStyle = {
  margin: '0 auto',
  borderRadius: '10px',
  objectFit: 'cover' as const,
};

const logoPlaceholder = {
  width: '60px',
  height: '60px',
  borderRadius: '10px',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const logoPlaceholderText = {
  color: '#ffffff',
  fontSize: '28px',
  fontWeight: 'bold',
  margin: '0',
  lineHeight: '60px',
  textAlign: 'center' as const,
};

const clubNameText = {
  color: '#1a1a1a',
  fontSize: '16px',
  fontWeight: '600',
  margin: '12px 0 0 0',
};

const divider = {
  borderColor: '#e6e6e6',
  margin: '0',
};

const urgencyBanner = {
  padding: '12px 20px',
  textAlign: 'center' as const,
};

const urgencyBannerText = {
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 'bold',
  margin: '0',
};

const contentSection = {
  padding: '32px 40px',
};

const heading = {
  color: '#1a1a1a',
  fontSize: '24px',
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

const eventCard = {
  backgroundColor: '#f8fafc',
  borderRadius: '12px',
  padding: '24px',
  margin: '24px 0',
  border: '1px solid #e2e8f0',
};

const eventTitleStyle = {
  color: '#1e293b',
  fontSize: '20px',
  fontWeight: 'bold',
  margin: '0 0 16px 0',
  textAlign: 'center' as const,
};

const detailsGrid = {
  marginTop: '16px',
};

const detailColumn = {
  width: '50%',
};

const detailLabel = {
  color: '#64748b',
  fontSize: '12px',
  fontWeight: '600',
  textTransform: 'uppercase' as const,
  margin: '0 0 4px 0',
  letterSpacing: '0.5px',
};

const detailValue = {
  color: '#1e293b',
  fontSize: '15px',
  fontWeight: '500',
  margin: '0 0 12px 0',
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '28px 0',
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

const reminderNote = {
  color: '#64748b',
  fontSize: '14px',
  textAlign: 'center' as const,
  margin: '0',
  fontStyle: 'italic',
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
