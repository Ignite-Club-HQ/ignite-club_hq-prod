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

interface PaymentFailedEmailProps {
  recipientName?: string;
  entityName: string;
  entityType: 'team' | 'club';
  tierName: string;
  failureDate: string;
  updatePaymentLink: string;
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

export const PaymentFailedEmail = ({
  recipientName,
  entityName,
  entityType,
  tierName,
  failureDate,
  updatePaymentLink,
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
}: PaymentFailedEmailProps) => {
  const previewText = `Action required: Your ${entityType} subscription payment failed`;
  const normalizedUpdatePaymentLink = normalizeLink(updatePaymentLink);
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
                alt={entityName}
                style={logoStyle}
              />
            ) : (
              <div style={{ ...logoPlaceholder, backgroundColor: '#dc2626' }}>
                <Text style={logoPlaceholderText}>
                  {entityName.charAt(0).toUpperCase()}
                </Text>
              </div>
            )}
            <Text style={clubNameText}>{entityName}</Text>
          </Section>

          <Hr style={divider} />

          {/* Warning Banner */}
          <Section style={warningBanner}>
            <Text style={warningEmoji}>⚠️</Text>
            <Text style={warningText}>Action Required</Text>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>Payment Failed</Heading>
            
            <Text style={paragraph}>
              {recipientName ? `Dear ${recipientName},` : 'Hi there,'}
            </Text>
            
            <Text style={paragraph}>
              We were unable to process your payment for the <strong>{tierName}</strong> subscription 
              for <strong style={{ color: primaryColor }}>{entityName}</strong>.
            </Text>

            {/* Alert box */}
            <Section style={alertBox}>
              <Text style={alertText}>
                <strong>⚠️ Action Required:</strong> Please update your payment method to avoid 
                interruption to your subscription benefits.
              </Text>
            </Section>

            {/* Failure details card */}
            <Section style={detailsCard}>
              <table width="100%" cellPadding="0" cellSpacing="0">
                <tr>
                  <td style={detailLabel}>Subscription</td>
                  <td style={detailValue}>{tierName}</td>
                </tr>
                <tr>
                  <td style={detailLabel}>{entityType === 'club' ? 'Club' : 'Team'}</td>
                  <td style={detailValue}>{entityName}</td>
                </tr>
                <tr>
                  <td style={detailLabel}>Failed On</td>
                  <td style={detailValue}>{failureDate}</td>
                </tr>
              </table>
            </Section>

            <Text style={paragraph}>
              Common reasons for payment failure include:
            </Text>
            <Section style={reasonsList}>
              <Text style={reasonItem}>• Expired card</Text>
              <Text style={reasonItem}>• Insufficient funds</Text>
              <Text style={reasonItem}>• Card declined by bank</Text>
            </Section>

            {/* CTA Button */}
            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: '#dc2626' }} href={normalizedUpdatePaymentLink}>
                Update Payment Method
              </Button>
            </Section>

            <Text style={orText}>
              Or copy and paste this link into your browser:
            </Text>
            <Text style={linkText}>
              <Link href={normalizedUpdatePaymentLink} style={{ color: primaryColor }}>
                {normalizedUpdatePaymentLink}
              </Link>
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              You're receiving this email because you're an admin of {entityName}.
            </Text>
            <Text style={footerText}>
              Need help? Contact us at{' '}
              <Link href="mailto:support@igniteclubhq.app" style={{ color: primaryColor }}>
                support@igniteclubhq.app
              </Link>
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

export default PaymentFailedEmail;

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

const warningBanner = {
  backgroundColor: '#fef2f2',
  padding: '20px',
  textAlign: 'center' as const,
};

const warningEmoji = {
  fontSize: '40px',
  margin: '0',
  lineHeight: '1',
};

const warningText = {
  color: '#dc2626',
  fontSize: '20px',
  fontWeight: 'bold',
  margin: '8px 0 0 0',
};

const contentSection = {
  padding: '32px 40px',
};

const heading = {
  color: '#dc2626',
  fontSize: '26px',
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

const alertBox = {
  backgroundColor: '#fef2f2',
  borderRadius: '12px',
  padding: '20px 24px',
  margin: '24px 0',
  border: '1px solid #fecaca',
};

const alertText = {
  color: '#991b1b',
  fontSize: '14px',
  lineHeight: '22px',
  margin: '0',
};

const detailsCard = {
  backgroundColor: '#fef2f2',
  borderRadius: '12px',
  padding: '24px',
  margin: '24px 0',
  border: '1px solid #fecaca',
};

const detailLabel = {
  color: '#6b7280',
  fontSize: '14px',
  padding: '8px 0',
  width: '50%',
};

const detailValue = {
  color: '#1f2937',
  fontSize: '14px',
  fontWeight: '600',
  padding: '8px 0',
  textAlign: 'right' as const,
};

const reasonsList = {
  backgroundColor: '#f8fafc',
  borderRadius: '12px',
  padding: '16px 24px',
  margin: '0 0 24px 0',
};

const reasonItem = {
  color: '#475569',
  fontSize: '14px',
  margin: '0 0 8px 0',
  lineHeight: '20px',
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
