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

interface StorageWarningEmailProps {
  recipientName?: string;
  entityName: string;
  entityType: 'team' | 'club';
  storageUsedGB: number;
  storageLimitGB: number;
  usagePercentage: number;
  upgradeLink: string;
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

// Helper to darken/lighten hex color
function adjustColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// Get warning color based on usage percentage
function getWarningColor(percentage: number): string {
  if (percentage >= 95) return '#dc2626'; // red
  if (percentage >= 85) return '#ea580c'; // orange
  return '#ca8a04'; // yellow
}

export const StorageWarningEmail = ({
  recipientName,
  entityName = "Your Organization",
  entityType = "club",
  storageUsedGB = 4.5,
  storageLimitGB = 5,
  usagePercentage = 90,
  upgradeLink = "https://igniteclubhq.app/settings",
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
}: StorageWarningEmailProps) => {
  const warningColor = getWarningColor(usagePercentage);
  const previewText = `⚠️ ${entityName}'s storage is ${usagePercentage}% full - Upgrade now`;
  const entityLabel = entityType === 'club' ? 'club' : 'team';
  const normalizedUpgradeLink = normalizeLink(upgradeLink);
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;
  const remainingGB = Math.max(0, storageLimitGB - storageUsedGB).toFixed(2);

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header */}
          <Section style={{ ...headerSection, background: `linear-gradient(135deg, ${warningColor}, ${adjustColor(warningColor, -30)})` }}>
            {validClubLogoUrl ? (
              <Img
                src={validClubLogoUrl}
                width="60"
                height="60"
                alt={entityName}
                style={logoStyle}
              />
            ) : (
              <Text style={headerEmoji}>💾</Text>
            )}
            <Heading style={headerTitle}>Storage Warning</Heading>
          </Section>

          {/* Usage Banner */}
          <Section style={{ ...usageBanner, backgroundColor: usagePercentage >= 95 ? '#fef2f2' : '#fef9c3', borderBottomColor: warningColor }}>
            <Text style={{ ...usagePercentageText, color: warningColor }}>{usagePercentage}%</Text>
            <Text style={usageLabel}>storage used</Text>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            {recipientName && (
              <Text style={greeting}>Dear {recipientName},</Text>
            )}
            
            <Text style={paragraph}>
              Your <strong style={{ color: primaryColor }}>{entityName}</strong> {entityLabel}'s storage is almost full! You're currently using:
            </Text>

            {/* Storage Stats Card */}
            <Section style={statsCard}>
              <table cellPadding="0" cellSpacing="0" width="100%">
                <tr>
                  <td style={statItem}>
                    <Text style={statValue}>{storageUsedGB.toFixed(2)} GB</Text>
                    <Text style={statLabel}>Used</Text>
                  </td>
                  <td style={statItem}>
                    <Text style={statValue}>{storageLimitGB} GB</Text>
                    <Text style={statLabel}>Total</Text>
                  </td>
                  <td style={statItem}>
                    <Text style={{ ...statValue, color: parseFloat(remainingGB) < 0.5 ? '#dc2626' : '#059669' }}>{remainingGB} GB</Text>
                    <Text style={statLabel}>Remaining</Text>
                  </td>
                </tr>
              </table>
              
              {/* Progress Bar */}
              <Section style={progressBarContainer}>
                <Section style={progressBarBg}>
                  <Section style={{ ...progressBarFill, width: `${Math.min(usagePercentage, 100)}%`, backgroundColor: warningColor }} />
                </Section>
              </Section>
            </Section>

            {/* Warning Message */}
            <Section style={{ ...warningBox, borderLeftColor: warningColor }}>
              <Text style={{ ...warningTitle, color: adjustColor(warningColor, -40) }}>
                {usagePercentage >= 95 ? '🚨 Critical Storage Alert' : '⚠️ Storage Running Low'}
              </Text>
              <Text style={warningText}>
                {usagePercentage >= 95 
                  ? 'You may not be able to upload new photos or files soon. Upgrade your storage now to avoid interruptions.'
                  : 'Consider upgrading your storage to ensure you can continue uploading photos and files.'}
              </Text>
            </Section>

            {/* Upgrade CTA */}
            <Section style={upgradeSection}>
              <Text style={upgradeTitle}>Upgrade Your Storage</Text>
              <Text style={paragraph}>
                Add more storage to your {entityLabel} instantly. Choose from our flexible storage packs:
              </Text>
              
              {/* Storage Pack Options */}
              <table cellPadding="0" cellSpacing="0" width="100%" style={{ marginBottom: '24px' }}>
                <tr>
                  <td style={packCard}>
                    <Text style={packSize}>+10 GB</Text>
                    <Text style={packPrice}>$4.99/mo</Text>
                  </td>
                  <td style={{ width: '16px' }} />
                  <td style={{ ...packCard, ...packCardHighlighted }}>
                    <Text style={{ ...packSize, color: primaryColor }}>+50 GB</Text>
                    <Text style={packPrice}>$14.99/mo</Text>
                    <Text style={packBadge}>Best Value</Text>
                  </td>
                </tr>
              </table>
              
              <Section style={buttonSection}>
                <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedUpgradeLink}>
                  Upgrade Storage Now
                </Button>
              </Section>
            </Section>

            {/* Tips Section */}
            <Section style={tipsSection}>
              <Text style={tipsTitle}>💡 Storage Tips</Text>
              <Text style={tipItem}>• Delete unused files and old photos</Text>
              <Text style={tipItem}>• Use the Vault to manage and organize files</Text>
              <Text style={tipItem}>• Export and archive old content</Text>
            </Section>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              You're receiving this because you're an admin of {entityName}. 
              Reply to this email if you have any questions.
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

export default StorageWarningEmail;

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

const usageBanner = {
  padding: '20px',
  textAlign: 'center' as const,
  borderBottom: '2px solid',
};

const usagePercentageText = {
  fontSize: '48px',
  fontWeight: 'bold',
  margin: '0',
  lineHeight: '1',
};

const usageLabel = {
  fontSize: '14px',
  color: '#78350f',
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

const statsCard = {
  backgroundColor: '#f8fafc',
  borderRadius: '12px',
  padding: '24px',
  margin: '24px 0',
  border: '1px solid #e2e8f0',
};

const statItem = {
  textAlign: 'center' as const,
  width: '33.33%',
};

const statValue = {
  fontSize: '20px',
  fontWeight: 'bold',
  color: '#1e293b',
  margin: '0',
};

const statLabel = {
  fontSize: '12px',
  color: '#64748b',
  margin: '4px 0 0 0',
  textTransform: 'uppercase' as const,
};

const progressBarContainer = {
  marginTop: '20px',
};

const progressBarBg = {
  backgroundColor: '#e2e8f0',
  borderRadius: '8px',
  height: '12px',
  overflow: 'hidden',
};

const progressBarFill = {
  height: '12px',
  borderRadius: '8px',
  transition: 'width 0.3s ease',
};

const warningBox = {
  backgroundColor: '#fffbeb',
  borderRadius: '8px',
  padding: '20px',
  margin: '24px 0',
  borderLeft: '4px solid',
};

const warningTitle = {
  fontSize: '15px',
  fontWeight: '600',
  margin: '0 0 8px 0',
};

const warningText = {
  color: '#92400e',
  fontSize: '14px',
  margin: '0',
  lineHeight: '22px',
};

const upgradeSection = {
  margin: '28px 0',
};

const upgradeTitle = {
  color: '#1a1a1a',
  fontSize: '18px',
  fontWeight: '600',
  margin: '0 0 12px 0',
};

const packCard = {
  backgroundColor: '#f8fafc',
  borderRadius: '8px',
  padding: '16px',
  textAlign: 'center' as const,
  border: '1px solid #e2e8f0',
  width: '48%',
};

const packCardHighlighted = {
  border: '2px solid #10b981',
  backgroundColor: '#f0fdf4',
};

const packSize = {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#1e293b',
  margin: '0',
};

const packPrice = {
  fontSize: '14px',
  color: '#64748b',
  margin: '4px 0 0 0',
};

const packBadge = {
  fontSize: '10px',
  color: '#10b981',
  fontWeight: '600',
  textTransform: 'uppercase' as const,
  margin: '8px 0 0 0',
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

const tipsSection = {
  backgroundColor: '#f0f9ff',
  borderRadius: '12px',
  padding: '20px',
  margin: '24px 0',
};

const tipsTitle = {
  color: '#0369a1',
  fontSize: '15px',
  fontWeight: '600',
  margin: '0 0 12px 0',
};

const tipItem = {
  color: '#0c4a6e',
  fontSize: '14px',
  margin: '0 0 8px 0',
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

const igniteLogoStyle = {
  display: 'block',
  borderRadius: '4px',
};

const footerBrandTextLink = {
  color: IGNITE_BRAND_COLOR,
  fontSize: '12px',
  textDecoration: 'none',
};
