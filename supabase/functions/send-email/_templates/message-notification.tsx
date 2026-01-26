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
} from 'npm:@react-email/components@0.0.22';
import * as React from 'npm:react@18.3.1';

interface MessageNotificationEmailProps {
  recipientName?: string;
  senderName: string;
  messagePreview: string;
  messageType: 'team' | 'club' | 'group' | 'direct' | 'broadcast';
  contextName?: string;
  messageLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  hasImage?: boolean;
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

export const MessageNotificationEmail = ({
  recipientName,
  senderName,
  messagePreview,
  messageType,
  contextName,
  messageLink,
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  hasImage = false,
}: MessageNotificationEmailProps) => {
  const previewText = `New message from ${senderName}${contextName ? ` in ${contextName}` : ''}`;
  const normalizedMessageLink = normalizeLink(messageLink);
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;

  const getMessageTypeLabel = () => {
    switch (messageType) {
      case 'team':
        return `Team Chat: ${contextName}`;
      case 'club':
        return `Club Chat: ${contextName}`;
      case 'group':
        return `Group: ${contextName}`;
      case 'direct':
        return 'Direct Message';
      case 'broadcast':
        return 'Ignite Support';
      default:
        return 'Message';
    }
  };

  const truncatedPreview = messagePreview.length > 150 
    ? messagePreview.substring(0, 150) + '...' 
    : messagePreview;

  // Use contextName for display, never fall back to generic defaults
  const displayContextName = contextName || (messageType === 'direct' ? senderName : 'Your Team');

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
                alt={displayContextName}
                style={logoStyle}
              />
            ) : (
              <div style={{ ...logoPlaceholder, backgroundColor: primaryColor }}>
                <Text style={logoPlaceholderText}>
                  {displayContextName.charAt(0).toUpperCase()}
                </Text>
              </div>
            )}
            <Text style={clubNameText}>{displayContextName}</Text>
          </Section>

          <Hr style={divider} />

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>💬 New Message</Heading>
            
            <Text style={contextLabel}>{getMessageTypeLabel()}</Text>

            {/* Message Card */}
            <Section style={messageCard}>
              <Text style={senderText}>
                <strong>{senderName}</strong> says:
              </Text>
              <Text style={messageText}>
                {hasImage && !messagePreview ? '📷 Sent an image' : truncatedPreview}
              </Text>
            </Section>

            {/* CTA Button */}
            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedMessageLink}>
                View Message & Reply
              </Button>
            </Section>

            <Text style={orText}>
              Or copy and paste this link into your browser:
            </Text>
            <Text style={linkText}>
              <Link href={normalizedMessageLink} style={{ color: primaryColor }}>
                {normalizedMessageLink}
              </Link>
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              You're receiving this because you have message notifications enabled.
              <Link href={`${PRODUCTION_DOMAIN}/profile`} style={{ color: primaryColor }}> Manage notification preferences</Link>
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

export default MessageNotificationEmail;

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

const messageCard = {
  backgroundColor: '#f8fafc',
  borderRadius: '12px',
  padding: '20px 24px',
  margin: '0 0 24px 0',
  border: '1px solid #e2e8f0',
};

const senderText = {
  color: '#1e293b',
  fontSize: '15px',
  margin: '0 0 8px 0',
};

const messageText = {
  color: '#475569',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0',
  fontStyle: 'italic' as const,
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
