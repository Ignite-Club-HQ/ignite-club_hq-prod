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

interface MagicLinkEmailProps {
  recipientName?: string;
  magicLink: string;
  otp?: string;
  expiresInMinutes?: number;
  actionType: 'login' | 'signup' | 'reset-password' | 'verify-email';
  appName?: string;
  logoUrl?: string;
  primaryColor?: string;
  /** Optional personal note from the club/competition, shown above the button. */
  customMessage?: string;
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

export const MagicLinkEmail = ({
  recipientName,
  magicLink = "https://igniteclubhq.app/auth/verify",
  otp,
  expiresInMinutes = 60,
  actionType = 'login',
  appName = "Ignite",
  logoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  customMessage,
}: MagicLinkEmailProps) => {
  const actionTitles = {
    'login': 'Sign in to your account',
    'signup': 'Complete your registration',
    'reset-password': 'Reset your password',
    'verify-email': 'Verify your email address',
  };

  const actionDescriptions = {
    'login': 'Click the button below to sign in to your account. No password needed!',
    'signup': 'Welcome! Click the button below to complete your account setup.',
    'reset-password': 'We received a request to reset your password. Click below to create a new one.',
    'verify-email': 'Please verify your email address by clicking the button below.',
  };

  const actionButtons = {
    'login': 'Sign In Now',
    'signup': 'Complete Setup',
    'reset-password': 'Reset Password',
    'verify-email': 'Verify Email',
  };

  const previewText = actionTitles[actionType];
  const validLogoUrl = isValidExternalUrl(logoUrl) ? logoUrl : undefined;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={headerSection}>
            {validLogoUrl ? (
              <Img
                src={validLogoUrl}
                width="120"
                height="40"
                alt={appName}
                style={logoStyle}
              />
            ) : (
              <Text style={appNameText}>{appName}</Text>
            )}
          </Section>

          <Hr style={divider} />

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>{actionTitles[actionType]}</Heading>
            
            {recipientName && (
              <Text style={paragraph}>
                Dear {recipientName},
              </Text>
            )}
            
            <Text style={paragraph}>
              {actionDescriptions[actionType]}
            </Text>

            {customMessage && customMessage.trim().length > 0 && (
              <Section style={{ ...noteSection, borderLeftColor: primaryColor }}>
                {customMessage.trim().split(/\n\n+/).map((para, i) => (
                  <Text key={i} style={noteText}>{para}</Text>
                ))}
              </Section>
            )}

            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={magicLink}>
                {actionButtons[actionType]}
              </Button>
            </Section>

            {otp && (
              <Section style={otpSection}>
                <Text style={otpLabel}>Or enter this code:</Text>
                <Text style={otpCode}>{otp}</Text>
              </Section>
            )}

            <Text style={linkFallback}>
              If the button doesn't work, copy and paste this link into your browser:
            </Text>
            <Text style={linkText}>
              <Link href={magicLink} style={{ color: primaryColor }}>
                {magicLink}
              </Link>
            </Text>

            {/* Security Notice */}
            <Section style={securityNotice}>
              <Text style={securityIcon}>🔒</Text>
              <Text style={securityText}>
                This link expires in <strong>{expiresInMinutes} minutes</strong> and can only be used once.
              </Text>
            </Section>
          </Section>

          <Hr style={divider} />

          {/* Security Warning */}
          <Section style={warningSection}>
            <Text style={warningText}>
              ⚠️ If you didn't request this {actionType === 'reset-password' ? 'password reset' : 'link'}, 
              you can safely ignore this email. Your account is still secure.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This is an automated security email from {appName}.
              Please do not reply to this email.
            </Text>
            <table cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
              <tr>
                <td style={{ paddingRight: '8px', verticalAlign: 'middle' }}>
                  <Img
                    src={IGNITE_ICON_URL}
                    width="24"
                    height="24"
                    alt="Ignite"
                    style={igniteLogoStyle}
                  />
                </td>
                <td style={{ verticalAlign: 'middle' }}>
                  <Link href={PRODUCTION_DOMAIN} style={footerBrandTextLink}>
                    Powered by Ignite
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

export default MagicLinkEmail;

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
  backgroundColor: '#1a1a1a',
  padding: '24px 40px',
  textAlign: 'center' as const,
};

const logoStyle = {
  margin: '0 auto',
};

const appNameText = {
  color: '#ffffff',
  fontSize: '24px',
  fontWeight: 'bold',
  margin: '0',
  letterSpacing: '-0.5px',
};

const divider = {
  borderColor: '#e6e6e6',
  margin: '0',
};

const contentSection = {
  padding: '40px',
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
  margin: '0 0 20px 0',
  textAlign: 'center' as const,
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button = {
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '18px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '16px 40px',
};

const otpSection = {
  textAlign: 'center' as const,
  margin: '24px 0',
};

const otpLabel = {
  color: '#64748b',
  fontSize: '14px',
  margin: '0 0 12px 0',
};

const otpCode = {
  backgroundColor: '#f1f5f9',
  borderRadius: '8px',
  color: '#0f172a',
  fontSize: '32px',
  fontWeight: 'bold',
  fontFamily: 'monospace',
  letterSpacing: '8px',
  margin: '0 auto',
  padding: '16px 24px',
  display: 'inline-block',
};

const linkFallback = {
  color: '#8898aa',
  fontSize: '13px',
  textAlign: 'center' as const,
  margin: '32px 0 8px 0',
};

const linkText = {
  fontSize: '12px',
  textAlign: 'center' as const,
  margin: '0',
  wordBreak: 'break-all' as const,
};

const securityNotice = {
  backgroundColor: '#f0fdf4',
  borderRadius: '8px',
  padding: '16px',
  margin: '32px 0 0 0',
  textAlign: 'center' as const,
};

const securityIcon = {
  fontSize: '20px',
  margin: '0 0 4px 0',
};

const securityText = {
  color: '#166534',
  fontSize: '13px',
  margin: '0',
  lineHeight: '20px',
};

const warningSection = {
  padding: '20px 40px',
  backgroundColor: '#fffbeb',
};

const warningText = {
  color: '#92400e',
  fontSize: '13px',
  margin: '0',
  textAlign: 'center' as const,
  lineHeight: '20px',
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
