import {
  Body,
  Button,
  Container,
  Head,
  Heading,
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
  contextName?: string; // team name, club name, group name, etc.
  messageLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  hasImage?: boolean;
}

export const MessageNotificationEmail = ({
  recipientName,
  senderName,
  messagePreview,
  messageType,
  contextName,
  messageLink,
  clubLogoUrl,
  primaryColor = '#10b981',
  hasImage = false,
}: MessageNotificationEmailProps) => {
  const previewText = `New message from ${senderName}${contextName ? ` in ${contextName}` : ''}`;
  
  // Ensure the link is absolute
  const normalizedMessageLink = messageLink.startsWith('http') 
    ? messageLink 
    : `https://igniteclubhq.app${messageLink}`;

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

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with Logo */}
          <Section style={headerSection}>
            <table width="100%" cellPadding="0" cellSpacing="0" style={{ margin: 0 }}>
              <tr>
                <td align="center">
                  {clubLogoUrl ? (
                    <Img
                      src={clubLogoUrl}
                      width="60"
                      height="60"
                      alt="Club Logo"
                      style={logoImage}
                    />
                  ) : (
                    <Img
                      src="https://igniteclubhq.app/ignite-email-icon.png"
                      width="60"
                      height="60"
                      alt="Ignite Club HQ"
                      style={logoImage}
                    />
                  )}
                </td>
              </tr>
            </table>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>New Message</Heading>
            
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

            <Text style={promptText}>
              Tap the button above to read the full message and reply!
            </Text>
            
            <Text style={linkFallback}>
              Or copy this link: <Link href={normalizedMessageLink} style={{ color: primaryColor }}>{normalizedMessageLink}</Link>
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              You're receiving this because you have message notifications enabled.
            </Text>
            <Text style={footerText}>
              <Link href="https://igniteclubhq.app/profile" style={footerLink}>
                Manage notification preferences
              </Link>
            </Text>
            <Text style={footerBrand}>
              Powered by{' '}
              <Link href="https://igniteclubhq.app" style={{ ...footerLink, color: primaryColor }}>
                Ignite Club HQ
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default MessageNotificationEmail;

// Styles
const main = {
  backgroundColor: '#f8fafc',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', sans-serif",
};

const container = {
  margin: '0 auto',
  padding: '20px 0 48px',
  maxWidth: '600px',
};

const headerSection = {
  padding: '32px 24px 24px',
  textAlign: 'center' as const,
};

const logoImage = {
  borderRadius: '12px',
};

const contentSection = {
  backgroundColor: '#ffffff',
  borderRadius: '16px',
  padding: '32px 24px',
  margin: '0 16px',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
};

const heading = {
  color: '#1e293b',
  fontSize: '24px',
  fontWeight: '700',
  textAlign: 'center' as const,
  margin: '0 0 8px 0',
};

const contextLabel = {
  color: '#64748b',
  fontSize: '14px',
  textAlign: 'center' as const,
  margin: '0 0 24px 0',
  fontWeight: '500',
};

const messageCard = {
  backgroundColor: '#f1f5f9',
  borderRadius: '12px',
  padding: '16px 20px',
  margin: '0 0 24px 0',
};

const senderText = {
  color: '#334155',
  fontSize: '14px',
  margin: '0 0 8px 0',
};

const messageText = {
  color: '#475569',
  fontSize: '15px',
  lineHeight: '22px',
  margin: '0',
  fontStyle: 'italic' as const,
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '24px 0 16px 0',
};

const button = {
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 32px',
};

const promptText = {
  color: '#64748b',
  fontSize: '14px',
  textAlign: 'center' as const,
  margin: '0 0 8px 0',
};

const linkFallback = {
  color: '#94a3b8',
  fontSize: '11px',
  textAlign: 'center' as const,
  margin: '12px 0 0 0',
  wordBreak: 'break-all' as const,
};

const footerSection = {
  padding: '32px 24px',
  textAlign: 'center' as const,
};

const footerText = {
  color: '#94a3b8',
  fontSize: '12px',
  margin: '0 0 8px 0',
};

const footerLink = {
  color: '#64748b',
  textDecoration: 'underline',
};

const footerBrand = {
  color: '#cbd5e1',
  fontSize: '11px',
  margin: '16px 0 0 0',
};
