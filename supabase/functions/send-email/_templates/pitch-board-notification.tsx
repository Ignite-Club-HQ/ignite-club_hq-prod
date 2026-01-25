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

interface PitchBoardNotificationEmailProps {
  recipientName: string;
  teamName: string;
  notificationType: 'pending_sub' | 'half_time' | 'full_time' | 'game_linked';
  notificationMessage: string;
  eventLink?: string;
  playerOutName?: string;
  playerInName?: string;
  position?: string;
  elapsedMinutes?: number;
  currentHalf?: number;
  clubLogoUrl?: string;
  primaryColor?: string;
}

// Production domain for all links
const PRODUCTION_DOMAIN = 'https://igniteclubhq.app';

// Ignite brand color - emerald green
const IGNITE_BRAND_COLOR = '#10b981';

// Ignite icon URL for footer (hosted on production domain)
const IGNITE_ICON_URL = `${PRODUCTION_DOMAIN}/ignite-email-icon.png`;

// Check if a URL is a valid external URL (not base64)
const isValidExternalUrl = (url?: string): boolean => {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
};

const getNotificationTitle = (type: string): string => {
  switch (type) {
    case 'pending_sub':
      return '⚡ Substitution Due';
    case 'half_time':
      return '⏸️ Half Time';
    case 'full_time':
      return '🏆 Full Time';
    case 'game_linked':
      return '🔗 Game Linked';
    default:
      return '🏟️ Pitch Board Update';
  }
};

export const PitchBoardNotificationEmail = ({
  recipientName,
  teamName,
  notificationType,
  notificationMessage,
  eventLink,
  playerOutName,
  playerInName,
  position,
  elapsedMinutes,
  currentHalf,
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
}: PitchBoardNotificationEmailProps) => {
  const title = getNotificationTitle(notificationType);
  const previewText = `${title} - ${teamName}`;
  const displayName = recipientName || 'Coach';
  const safeEventLink = eventLink?.startsWith('http') ? eventLink : `${PRODUCTION_DOMAIN}${eventLink || '/'}`;
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
                alt={teamName}
                style={logoStyle}
              />
            ) : (
              <div style={{ ...logoPlaceholder, backgroundColor: primaryColor }}>
                <Text style={logoPlaceholderText}>
                  {teamName.charAt(0).toUpperCase()}
                </Text>
              </div>
            )}
            <Text style={clubNameText}>{teamName}</Text>
          </Section>

          <Hr style={divider} />

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>{title}</Heading>
            
            <Text style={contextLabel}>🏟️ Pitch Board</Text>

            {/* Notification Details Card */}
            <Section style={detailsCard}>
              {notificationType === 'pending_sub' && playerOutName && playerInName && (
                <>
                  <Text style={subLabel}>Substitution Required</Text>
                  <table width="100%" cellPadding="0" cellSpacing="0" style={{ marginTop: '12px' }}>
                    <tr>
                      <td style={playerCell}>
                        <Text style={playerLabel}>Off</Text>
                        <Text style={playerName}>{playerOutName}</Text>
                      </td>
                      <td style={arrowCell}>
                        <Text style={{ ...arrowText, color: primaryColor }}>→</Text>
                      </td>
                      <td style={playerCell}>
                        <Text style={playerLabel}>On</Text>
                        <Text style={playerName}>{playerInName}</Text>
                      </td>
                    </tr>
                  </table>
                  {position && (
                    <Text style={positionText}>Position: {position}</Text>
                  )}
                  {/* Direct action button for pending subs */}
                  {eventLink && (
                    <Section style={{ textAlign: 'center' as const, marginTop: '16px' }}>
                      <Link href={safeEventLink} style={acceptSubButton}>
                        ✓ Accept Substitution
                      </Link>
                    </Section>
                  )}
                </>
              )}

              {notificationType === 'half_time' && (
                <>
                  <Text style={subLabel}>Break Time</Text>
                  <Text style={messageText}>
                    First half complete. Time to regroup and strategize for the second half!
                  </Text>
                </>
              )}

              {notificationType === 'full_time' && (
                <>
                  <Text style={subLabel}>Game Complete</Text>
                  <Text style={messageText}>
                    The game has finished. Great job managing the team!
                  </Text>
                </>
              )}

              {notificationType === 'game_linked' && (
                <>
                  <Text style={subLabel}>Event Connected</Text>
                  <Text style={messageText}>
                    {notificationMessage}
                  </Text>
                </>
              )}

              {elapsedMinutes !== undefined && currentHalf !== undefined && (
                <Text style={timeText}>
                  ⏱️ {Math.floor(elapsedMinutes)}' (Half {currentHalf})
                </Text>
              )}
            </Section>

            {/* CTA Button */}
            {eventLink && (
              <Section style={buttonSection}>
                <Button style={{ ...button, backgroundColor: primaryColor }} href={safeEventLink}>
                  {notificationType === 'pending_sub' ? 'Open Pitch Board to Accept' : 'Open Pitch Board'}
                </Button>
              </Section>
            )}

            <Text style={orText}>
              Or copy and paste this link into your browser:
            </Text>
            <Text style={linkText}>
              <Link href={safeEventLink} style={{ color: primaryColor }}>
                {safeEventLink}
              </Link>
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              You're receiving this because you have pitch board notifications enabled.
              <Link href={`${PRODUCTION_DOMAIN}/profile`} style={{ color: primaryColor }}> Manage notification preferences</Link>
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

export default PitchBoardNotificationEmail;

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
  fontSize: '26px',
  fontWeight: 'bold',
  margin: '0 0 8px 0',
  textAlign: 'center' as const,
};

const contextLabel = {
  color: '#64748b',
  fontSize: '14px',
  textAlign: 'center' as const,
  margin: '0 0 24px 0',
  fontWeight: '500',
};

const detailsCard = {
  backgroundColor: '#f8fafc',
  borderRadius: '12px',
  padding: '20px 24px',
  marginBottom: '24px',
  border: '1px solid #e2e8f0',
};

const subLabel = {
  color: '#64748b',
  fontSize: '12px',
  fontWeight: '600',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  margin: '0 0 8px 0',
};

const playerCell = {
  textAlign: 'center' as const,
  width: '40%',
};

const arrowCell = {
  textAlign: 'center' as const,
  width: '20%',
};

const playerLabel = {
  color: '#94a3b8',
  fontSize: '11px',
  fontWeight: '500',
  textTransform: 'uppercase' as const,
  margin: '0 0 4px 0',
};

const playerName = {
  color: '#1f2937',
  fontSize: '16px',
  fontWeight: '600',
  margin: '0',
};

const arrowText = {
  fontSize: '24px',
  fontWeight: 'bold',
  margin: '0',
};

const positionText = {
  color: '#64748b',
  fontSize: '14px',
  margin: '12px 0 0 0',
  textAlign: 'center' as const,
};

const messageText = {
  color: '#374151',
  fontSize: '15px',
  lineHeight: '1.6',
  margin: '8px 0 0 0',
};

const timeText = {
  color: '#6b7280',
  fontSize: '14px',
  margin: '16px 0 0 0',
  textAlign: 'center' as const,
  backgroundColor: '#ffffff',
  padding: '8px 12px',
  borderRadius: '4px',
  display: 'inline-block' as const,
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

const acceptSubButton = {
  backgroundColor: '#059669',
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: '600',
  padding: '10px 24px',
  textDecoration: 'none',
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
