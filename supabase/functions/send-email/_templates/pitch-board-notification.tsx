import {
  Body,
  Container,
  Head,
  Heading,
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
}

const PRODUCTION_DOMAIN = 'https://igniteclubhq.app';
const IGNITE_BRAND_COLOR = '#10b981';
const IGNITE_ICON_URL = `${PRODUCTION_DOMAIN}/ignite-email-icon.png`;

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

const getNotificationEmoji = (type: string): string => {
  switch (type) {
    case 'pending_sub':
      return '🔄';
    case 'half_time':
      return '⏸️';
    case 'full_time':
      return '🏆';
    case 'game_linked':
      return '🔗';
    default:
      return '🏟️';
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
}: PitchBoardNotificationEmailProps) => {
  const title = getNotificationTitle(notificationType);
  const emoji = getNotificationEmoji(notificationType);
  const previewText = `${title} - ${teamName}`;
  
  const displayName = recipientName || 'Coach';
  const safeEventLink = eventLink?.startsWith('http') ? eventLink : `${PRODUCTION_DOMAIN}${eventLink || '/'}`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={header}>
            <table width="100%" cellPadding="0" cellSpacing="0" style={{ margin: 0 }}>
              <tr>
                <td align="center">
                  <Text style={headerTitle}>
                    {emoji} Pitch Board
                  </Text>
                </td>
              </tr>
            </table>
          </Section>

          {/* Main Content */}
          <Section style={content}>
            <Heading style={h1}>{title}</Heading>
            
            <Text style={teamNameStyle}>
              {teamName}
            </Text>

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
                        <Text style={arrowText}>→</Text>
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

            {/* CTA Button - Show different text for pending subs */}
            {eventLink && (
              <Section style={buttonContainer}>
                <Link href={safeEventLink} style={button}>
                  {notificationType === 'pending_sub' ? 'Open Pitch Board to Accept' : 'Open Pitch Board'}
                </Link>
                <Text style={linkFallback}>
                  Or copy this link: {safeEventLink}
                </Text>
              </Section>
            )}

            <Text style={footerText}>
              You're receiving this because you have pitch board notifications enabled.
              You can manage your notification preferences in the app settings.
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <table width="100%" cellPadding="0" cellSpacing="0">
              <tr>
                <td align="center">
                  <Img
                    src={IGNITE_ICON_URL}
                    width="24"
                    height="24"
                    alt="Ignite"
                    style={{ display: 'inline-block', marginBottom: '8px' }}
                  />
                </td>
              </tr>
              <tr>
                <td align="center">
                  <Text style={footerBrand}>
                    Powered by Ignite Club HQ
                  </Text>
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
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '0',
  marginBottom: '32px',
  borderRadius: '8px',
  overflow: 'hidden' as const,
  maxWidth: '600px',
};

const header = {
  backgroundColor: IGNITE_BRAND_COLOR,
  padding: '24px 32px',
};

const headerTitle = {
  color: '#ffffff',
  fontSize: '18px',
  fontWeight: 'bold' as const,
  margin: '0',
  textAlign: 'center' as const,
};

const content = {
  padding: '32px',
};

const h1 = {
  color: '#1f2937',
  fontSize: '24px',
  fontWeight: 'bold' as const,
  margin: '0 0 8px 0',
  textAlign: 'center' as const,
};

const teamNameStyle = {
  color: IGNITE_BRAND_COLOR,
  fontSize: '16px',
  fontWeight: '600' as const,
  margin: '0 0 24px 0',
  textAlign: 'center' as const,
};

const detailsCard = {
  backgroundColor: '#f8fafc',
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '24px',
  border: '1px solid #e2e8f0',
};

const subLabel = {
  color: '#64748b',
  fontSize: '12px',
  fontWeight: '600' as const,
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
  fontWeight: '500' as const,
  textTransform: 'uppercase' as const,
  margin: '0 0 4px 0',
};

const playerName = {
  color: '#1f2937',
  fontSize: '16px',
  fontWeight: '600' as const,
  margin: '0',
};

const arrowText = {
  color: IGNITE_BRAND_COLOR,
  fontSize: '24px',
  fontWeight: 'bold' as const,
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

const buttonContainer = {
  textAlign: 'center' as const,
  marginBottom: '24px',
};

const button = {
  backgroundColor: IGNITE_BRAND_COLOR,
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '16px',
  fontWeight: '600' as const,
  padding: '14px 32px',
  textDecoration: 'none',
};

const acceptSubButton = {
  backgroundColor: '#059669',
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: '600' as const,
  padding: '10px 24px',
  textDecoration: 'none',
};

const linkFallback = {
  color: '#9ca3af',
  fontSize: '12px',
  marginTop: '12px',
  wordBreak: 'break-all' as const,
};

const footerText = {
  color: '#9ca3af',
  fontSize: '12px',
  lineHeight: '1.5',
  textAlign: 'center' as const,
  margin: '0',
};

const footer = {
  backgroundColor: '#f8fafc',
  padding: '20px 32px',
  borderTop: '1px solid #e2e8f0',
};

const footerBrand = {
  color: '#9ca3af',
  fontSize: '12px',
  margin: '0',
  textAlign: 'center' as const,
};
