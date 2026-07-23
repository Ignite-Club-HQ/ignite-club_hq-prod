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

interface EventViewReminderEmailProps {
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

// Determine if this event type needs RSVP-style language
const isRsvpEvent = (eventType: string): boolean => {
  const lower = eventType.toLowerCase();
  return lower === 'game' || lower === 'training' || lower === 'match';
};

export const EventViewReminderEmail = ({
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
}: EventViewReminderEmailProps) => {
  const normalizedEventLink = normalizeLink(eventLink);
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;
  const rsvpStyle = isRsvpEvent(eventType);
  // Only allow a simple hex color for inline style; fall back to brand color otherwise.
  const safePrimaryColor = /^#[0-9a-fA-F]{3,8}$/.test(primaryColor) ? primaryColor : IGNITE_BRAND_COLOR;

  // Smart copy based on event type
  const bannerText = rsvpStyle ? "📋 RSVP Needed!" : "🎉 Don't Miss This!";
  const bannerColor = rsvpStyle ? '#f59e0b' : '#6366f1';
  const headingText = "📅 Event Reminder";
  const previewText = rsvpStyle
    ? `RSVP needed: ${eventTitle} - ${eventDate} at ${eventTime}`
    : `Don't miss: ${eventTitle} - ${eventDate} at ${eventTime}`;
  const ctaText = "View Event & RSVP Now";

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
              <div style={{ ...logoPlaceholder, backgroundColor: safePrimaryColor }}>
                <Text style={logoPlaceholderText}>
                  {clubName.charAt(0).toUpperCase()}
                </Text>
              </div>
            )}
            <Text style={clubNameText}>{clubName}</Text>
          </Section>

          <Hr style={divider} />

          {/* Attention Banner */}
          <Section style={{ ...attentionBanner, backgroundColor: bannerColor }}>
            <Text style={attentionBannerText}>{bannerText}</Text>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>{headingText}</Heading>

            <Text style={paragraph}>
              Dear {recipientName},
            </Text>

            <Text style={paragraph}>
              {rsvpStyle ? (
                <>
                  Your team admin has noticed you haven't RSVP'd to{' '}
                  <strong>"{eventTitle}"</strong> for{' '}
                  <strong style={{ color: safePrimaryColor }}>{teamName}</strong>. Please take a moment to view the details and let them know if you can make it.
                </>
              ) : (
                <>
                  You haven't checked out{' '}
                  <strong>"{eventTitle}"</strong> for{' '}
                  <strong style={{ color: safePrimaryColor }}>{clubName}</strong> yet! Take a look at the details below and let us know if you can make it.
                </>
              )}
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
              <Button style={{ ...button, backgroundColor: safePrimaryColor }} href={normalizedEventLink}>
                {ctaText}
              </Button>
            </Section>

            <Text style={rsvpPrompt}>
              <strong>Your response is needed!</strong>{' '}
              {rsvpStyle
                ? 'Tap the button above to view all the details and let your team know if you can make it.'
                : 'Tap the button above to view all the details and let us know if you can make it.'}
            </Text>

            <Text style={linkFallback}>
              Or copy this link: <Link href={normalizedEventLink} style={{ color: safePrimaryColor }}>{normalizedEventLink}</Link>
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This reminder was sent by {clubName}. 
              <Link href={normalizedEventLink} style={{ color: safePrimaryColor }}> Manage your notification preferences</Link>
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

export default EventViewReminderEmail;

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

const attentionBanner = {
  padding: '12px 20px',
  textAlign: 'center' as const,
};

const attentionBannerText = {
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

const rsvpPrompt = {
  color: '#1e293b',
  fontSize: '15px',
  textAlign: 'center' as const,
  margin: '16px 0 0 0',
  lineHeight: '22px',
};

const linkFallback = {
  color: '#64748b',
  fontSize: '12px',
  textAlign: 'center' as const,
  margin: '12px 0 0 0',
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