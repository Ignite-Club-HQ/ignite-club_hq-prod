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

interface SubscriptionRenewedEmailProps {
  recipientName?: string;
  entityName: string;
  entityType: 'team' | 'club';
  tierName: string;
  renewalDate: string;
  nextBillingDate: string;
  manageLink: string;
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

export const SubscriptionRenewedEmail = ({
  recipientName,
  entityName,
  entityType,
  tierName,
  renewalDate,
  nextBillingDate,
  manageLink,
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
}: SubscriptionRenewedEmailProps) => {
  const previewText = `Your ${entityType} subscription has been renewed`;
  const normalizedManageLink = normalizeLink(manageLink);
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
              <div style={{ ...logoPlaceholder, backgroundColor: primaryColor }}>
                <Text style={logoPlaceholderText}>
                  {entityName.charAt(0).toUpperCase()}
                </Text>
              </div>
            )}
            <Text style={clubNameText}>{entityName}</Text>
          </Section>

          <Hr style={divider} />

          {/* Success Banner */}
          <Section style={{ ...successBanner, backgroundColor: `${primaryColor}15` }}>
            <Text style={successEmoji}>✓</Text>
            <Text style={{ ...successText, color: primaryColor }}>Renewed!</Text>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>Subscription Renewed!</Heading>
            
            <Text style={paragraph}>
              {recipientName ? `Dear ${recipientName},` : 'Hi there,'}
            </Text>
            
            <Text style={paragraph}>
              Great news! Your <strong>{tierName}</strong> subscription for{' '}
              <strong style={{ color: primaryColor }}>{entityName}</strong> has been successfully renewed.
            </Text>

            {/* Renewal details card */}
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
                  <td style={detailLabel}>Renewed On</td>
                  <td style={detailValue}>{renewalDate}</td>
                </tr>
                <tr>
                  <td style={detailLabel}>Next Billing Date</td>
                  <td style={detailValue}>{nextBillingDate}</td>
                </tr>
              </table>
            </Section>

            <Text style={paragraph}>
              Your subscription benefits will continue uninterrupted. Thank you for your continued support!
            </Text>

            {/* CTA Button */}
            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedManageLink}>
                Manage Subscription
              </Button>
            </Section>

            <Text style={orText}>
              Or copy and paste this link into your browser:
            </Text>
            <Text style={linkText}>
              <Link href={normalizedManageLink} style={{ color: primaryColor }}>
                {normalizedManageLink}
              </Link>
            </Text>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              You're receiving this email because you're an admin of {entityName}.
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

export default SubscriptionRenewedEmail;

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

const successBanner = {
  padding: '20px',
  textAlign: 'center' as const,
};

const successEmoji = {
  fontSize: '40px',
  margin: '0',
  lineHeight: '1',
  color: '#10b981',
};

const successText = {
  fontSize: '20px',
  fontWeight: 'bold',
  margin: '8px 0 0 0',
};

const contentSection = {
  padding: '32px 40px',
};

const heading = {
  color: '#1a1a1a',
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

const detailsCard = {
  backgroundColor: '#f0fdf4',
  borderRadius: '12px',
  padding: '24px',
  margin: '24px 0',
  border: '1px solid #bbf7d0',
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
