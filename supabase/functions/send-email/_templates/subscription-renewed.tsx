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

export const SubscriptionRenewedEmail = ({
  recipientName,
  entityName,
  entityType,
  tierName,
  renewalDate,
  nextBillingDate,
  manageLink,
  clubLogoUrl,
  primaryColor = '#10b981',
}: SubscriptionRenewedEmailProps) => {
  const previewText = `Your ${entityType} subscription has been renewed`;
  
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with logo */}
          <Section style={headerSection}>
            <table width="100%" cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
              <tr>
                <td align="center">
                  <Img
                    src="https://igniteclubhq.app/ignite-email-icon.png"
                    width="48"
                    height="48"
                    alt="Ignite"
                    style={logo}
                  />
                </td>
              </tr>
            </table>
          </Section>

          {/* Success icon */}
          <Section style={{ textAlign: 'center', padding: '20px 0' }}>
            <table width="100%" cellPadding="0" cellSpacing="0">
              <tr>
                <td align="center">
                  <div style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    backgroundColor: '#d1fae5',
                    display: 'inline-block',
                    lineHeight: '64px',
                    textAlign: 'center',
                  }}>
                    <span style={{ fontSize: '32px' }}>✓</span>
                  </div>
                </td>
              </tr>
            </table>
          </Section>

          {/* Main content */}
          <Heading style={h1}>Subscription Renewed!</Heading>
          
          <Text style={text}>
            {recipientName ? `Hi ${recipientName},` : 'Hi there,'}
          </Text>
          
          <Text style={text}>
            Great news! Your <strong>{tierName}</strong> subscription for{' '}
            <strong>{entityName}</strong> has been successfully renewed.
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

          <Text style={text}>
            Your subscription benefits will continue uninterrupted. Thank you for your continued support!
          </Text>

          {/* CTA Button */}
          <Section style={{ textAlign: 'center', marginTop: '32px' }}>
            <table width="100%" cellPadding="0" cellSpacing="0">
              <tr>
                <td align="center">
                  <Link
                    href={manageLink}
                    style={{
                      ...button,
                      backgroundColor: primaryColor,
                    }}
                  >
                    Manage Subscription
                  </Link>
                </td>
              </tr>
            </table>
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerText}>
              You're receiving this email because you're an admin of {entityName}.
            </Text>
            <Text style={footerText}>
              <Link href="https://igniteclubhq.app" style={footerLink}>
                Ignite Club HQ
              </Link>
              {' | '}
              <Link href="https://igniteclubhq.app/profile" style={footerLink}>
                Email Preferences
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export default SubscriptionRenewedEmail;

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
  maxWidth: '600px',
};

const headerSection = {
  padding: '32px 20px 0',
};

const logo = {
  margin: '0 auto',
};

const h1 = {
  color: '#1f2937',
  fontSize: '24px',
  fontWeight: '600',
  lineHeight: '1.25',
  padding: '0 48px',
  textAlign: 'center' as const,
  margin: '16px 0',
};

const text = {
  color: '#4b5563',
  fontSize: '16px',
  lineHeight: '1.5',
  padding: '0 48px',
  margin: '16px 0',
};

const detailsCard = {
  backgroundColor: '#f0fdf4',
  borderRadius: '8px',
  padding: '24px',
  margin: '24px 48px',
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

const button = {
  borderRadius: '8px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '16px',
  fontWeight: '600',
  padding: '14px 32px',
  textDecoration: 'none',
  textAlign: 'center' as const,
};

const footer = {
  marginTop: '40px',
  padding: '20px 48px',
  borderTop: '1px solid #e5e7eb',
};

const footerText = {
  color: '#9ca3af',
  fontSize: '12px',
  lineHeight: '1.5',
  margin: '8px 0',
  textAlign: 'center' as const,
};

const footerLink = {
  color: '#6b7280',
  textDecoration: 'underline',
};
