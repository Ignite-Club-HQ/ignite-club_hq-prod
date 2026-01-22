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

interface RenewalReminderEmailProps {
  recipientName?: string;
  entityName: string;
  entityType: 'team' | 'club';
  tierName: string;
  expiryDate: string;
  daysUntilExpiry: number;
  manageLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

export const RenewalReminderEmail = ({
  recipientName,
  entityName = "Your Organization",
  entityType = "team",
  tierName = "Pro",
  expiryDate = "January 30, 2025",
  daysUntilExpiry = 7,
  manageLink = "https://example.com/settings",
  clubLogoUrl,
  primaryColor = "#10b981",
}: RenewalReminderEmailProps) => {
  const previewText = `${entityName}'s ${tierName} subscription renews on ${expiryDate}`;
  const entityLabel = entityType === 'club' ? 'club' : 'team';

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={{ ...headerSection, background: `linear-gradient(135deg, ${primaryColor}, ${adjustColor(primaryColor, -20)})` }}>
            {clubLogoUrl ? (
              <Img
                src={clubLogoUrl}
                width="60"
                height="60"
                alt={entityName}
                style={logoStyle}
              />
            ) : (
              <Text style={headerEmoji}>🔄</Text>
            )}
            <Heading style={headerTitle}>Subscription Renewal</Heading>
          </Section>

          {/* Countdown Banner */}
          <Section style={countdownBanner}>
            <Text style={countdownNumber}>{daysUntilExpiry}</Text>
            <Text style={countdownLabel}>days until renewal</Text>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            {recipientName && (
              <Text style={greeting}>Hi {recipientName},</Text>
            )}
            
            <Text style={paragraph}>
              Just a quick heads up! Your <strong style={{ color: primaryColor }}>{entityName}</strong> {entityLabel}'s <strong>{tierName}</strong> subscription will automatically renew on:
            </Text>

            {/* Date Card */}
            <Section style={dateCard}>
              <Text style={dateText}>📅 {expiryDate}</Text>
            </Section>

            {/* Info Section */}
            <Section style={{ ...infoBox, borderLeftColor: primaryColor }}>
              <Text style={infoTitle}>What happens next?</Text>
              <Text style={infoText}>
                Your subscription will automatically renew to keep your {entityLabel}'s premium features active. No action is needed if you want to continue.
              </Text>
            </Section>

            {/* Action Options */}
            <Section style={actionSection}>
              <Text style={actionTitle}>Need to make changes?</Text>
              <Text style={paragraph}>
                If you'd like to cancel or modify your subscription, please visit your {entityLabel} settings before the renewal date.
              </Text>
              
              <Section style={buttonSection}>
                <Button style={{ ...button, backgroundColor: primaryColor }} href={manageLink}>
                  Manage Subscription
                </Button>
              </Section>
            </Section>

            {/* Benefits Reminder */}
            <Section style={benefitsSection}>
              <Text style={benefitsTitle}>Your {tierName} benefits include:</Text>
              <Section style={benefitItem}>
                <Text style={benefitEmoji}>✨</Text>
                <Text style={benefitText}>Premium features for your {entityLabel}</Text>
              </Section>
              <Section style={benefitItem}>
                <Text style={benefitEmoji}>📊</Text>
                <Text style={benefitText}>Advanced reporting and analytics</Text>
              </Section>
              <Section style={benefitItem}>
                <Text style={benefitEmoji}>💾</Text>
                <Text style={benefitText}>Increased storage and media limits</Text>
              </Section>
              <Section style={benefitItem}>
                <Text style={benefitEmoji}>🎯</Text>
                <Text style={benefitText}>Priority support</Text>
              </Section>
            </Section>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              You're receiving this because you're an admin of {entityName}. 
              If you have questions about your subscription, reply to this email.
            </Text>
            <Text style={footerBrand}>
              Powered by{' '}
              <Link href="https://ignite-club-launchpad.lovable.app" style={footerLink}>
                Ignite Club HQ
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

// Helper to darken/lighten hex color
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export default RenewalReminderEmail;

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
  padding: '32px 40px',
  textAlign: 'center' as const,
};

const logoStyle = {
  margin: '0 auto',
  borderRadius: '12px',
  objectFit: 'cover' as const,
  border: '3px solid rgba(255,255,255,0.3)',
};

const headerEmoji = {
  fontSize: '48px',
  margin: '0',
  lineHeight: '1',
};

const headerTitle = {
  color: '#ffffff',
  fontSize: '24px',
  fontWeight: 'bold',
  margin: '16px 0 0 0',
};

const countdownBanner = {
  backgroundColor: '#fef3c7',
  padding: '20px',
  textAlign: 'center' as const,
  borderBottom: '2px solid #fcd34d',
};

const countdownNumber = {
  fontSize: '48px',
  fontWeight: 'bold',
  color: '#b45309',
  margin: '0',
  lineHeight: '1',
};

const countdownLabel = {
  fontSize: '14px',
  color: '#92400e',
  margin: '4px 0 0 0',
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
};

const contentSection = {
  padding: '32px 40px',
};

const greeting = {
  color: '#1a1a1a',
  fontSize: '16px',
  margin: '0 0 16px 0',
};

const paragraph = {
  color: '#4a4a4a',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 16px 0',
};

const dateCard = {
  backgroundColor: '#f0f9ff',
  borderRadius: '12px',
  padding: '20px',
  margin: '24px 0',
  textAlign: 'center' as const,
  border: '2px solid #bae6fd',
};

const dateText = {
  color: '#0369a1',
  fontSize: '20px',
  fontWeight: 'bold',
  margin: '0',
};

const infoBox = {
  backgroundColor: '#f0fdf4',
  borderRadius: '8px',
  padding: '20px',
  margin: '24px 0',
  borderLeft: '4px solid #10b981',
};

const infoTitle = {
  color: '#166534',
  fontSize: '15px',
  fontWeight: '600',
  margin: '0 0 8px 0',
};

const infoText = {
  color: '#15803d',
  fontSize: '14px',
  margin: '0',
  lineHeight: '22px',
};

const actionSection = {
  margin: '28px 0',
};

const actionTitle = {
  color: '#1a1a1a',
  fontSize: '16px',
  fontWeight: '600',
  margin: '0 0 8px 0',
};

const buttonSection = {
  textAlign: 'center' as const,
  margin: '24px 0',
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

const benefitsSection = {
  backgroundColor: '#fafafa',
  borderRadius: '12px',
  padding: '24px',
  margin: '24px 0',
};

const benefitsTitle = {
  color: '#1e293b',
  fontSize: '15px',
  fontWeight: '600',
  margin: '0 0 16px 0',
};

const benefitItem = {
  marginBottom: '12px',
};

const benefitEmoji = {
  fontSize: '16px',
  margin: '0 0 4px 0',
};

const benefitText = {
  color: '#475569',
  fontSize: '14px',
  margin: '0',
  lineHeight: '20px',
};

const divider = {
  borderColor: '#e6e6e6',
  margin: '0',
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

const footerBrand = {
  color: '#8898aa',
  fontSize: '12px',
  textAlign: 'center' as const,
  margin: '0',
};

const footerLink = {
  color: '#10b981',
  textDecoration: 'none',
};
