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

interface PointsAwardedEmailProps {
  recipientName?: string;
  pointsAwarded: number;
  reason?: string;
  totalPoints: number;
  clubName: string;
  profileLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  rewardUnlocked?: boolean;
  rewardName?: string;
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

// Normalize links to use production domain
const normalizeLink = (link: string): string => {
  try {
    const url = new URL(link);
    return `${PRODUCTION_DOMAIN}${url.pathname}${url.search}`;
  } catch {
    if (link.startsWith('/')) {
      return `${PRODUCTION_DOMAIN}${link}`;
    }
    return link;
  }
};

export const PointsAwardedEmail = ({
  recipientName = "Team Member",
  pointsAwarded = 10,
  reason = "",
  totalPoints = 0,
  clubName = "The Club",
  profileLink = "/profile",
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  rewardUnlocked = false,
  rewardName = "",
}: PointsAwardedEmailProps) => {
  const previewText = `You earned ${pointsAwarded} Reward points!${rewardUnlocked ? ' 🎉 New reward unlocked!' : ''}`;
  const normalizedProfileLink = normalizeLink(profileLink);
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;
  const isPositive = pointsAwarded > 0;

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
                alt={clubName}
                style={logoStyle}
              />
            ) : (
              <table cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
                <tr>
                  <td style={{ ...logoPlaceholder, backgroundColor: primaryColor }}>
                    <span style={logoPlaceholderText}>
                      {clubName.charAt(0).toUpperCase()}
                    </span>
                  </td>
                </tr>
              </table>
            )}
            <Text style={clubNameText}>{clubName}</Text>
          </Section>

          <Hr style={divider} />

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>
              {isPositive ? 'Points Earned! 🔥' : 'Points Update'}
            </Heading>
            
            <Text style={paragraph}>
              Hi {recipientName},
            </Text>
            
            <Text style={paragraph}>
              {isPositive 
                ? `Great news! You've earned Reward points for your contribution.`
                : `Your Reward points balance has been updated.`
              }
            </Text>

            {/* Points Card */}
            <Section style={pointsCard}>
              <Text style={pointsLabel}>
                {isPositive ? 'Points Earned' : 'Points Adjustment'}
              </Text>
              <Text style={{ ...pointsValue, color: isPositive ? '#22c55e' : '#ef4444' }}>
                {isPositive ? '+' : ''}{pointsAwarded}
              </Text>
              {reason && (
                <Text style={pointsReason}>
                  {reason}
                </Text>
              )}
            </Section>

            {/* Total Balance */}
            <Section style={balanceSection}>
              <Text style={balanceLabel}>Your Total Balance</Text>
              <Text style={balanceValue}>{totalPoints} points</Text>
            </Section>

            {/* Reward Unlocked Banner */}
            {rewardUnlocked && (
              <Section style={rewardBanner}>
                <Text style={rewardBannerText}>
                  🎉 Congratulations! You've unlocked a reward!
                </Text>
                {rewardName && (
                  <Text style={rewardNameText}>
                    <strong>{rewardName}</strong>
                  </Text>
                )}
              </Section>
            )}

            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedProfileLink}>
                View Your Rewards
              </Button>
            </Section>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This notification was sent by {clubName}. You received this because your Reward points were updated.
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

export default PointsAwardedEmail;

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
  textAlign: 'center' as const,
};

const logoPlaceholderText = {
  color: '#ffffff',
  fontSize: '36px',
  fontWeight: 'bold' as const,
  lineHeight: '80px',
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
  margin: '0 0 24px 0',
  textAlign: 'center' as const,
};

const paragraph = {
  color: '#4a4a4a',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 16px 0',
};

const pointsCard = {
  backgroundColor: '#fef3c7',
  borderRadius: '12px',
  padding: '24px',
  margin: '24px 0',
  textAlign: 'center' as const,
  border: '2px solid #f59e0b',
};

const pointsLabel = {
  color: '#92400e',
  fontSize: '14px',
  margin: '0 0 8px 0',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const pointsValue = {
  fontSize: '48px',
  fontWeight: 'bold' as const,
  margin: '0',
  lineHeight: '1',
};

const pointsReason = {
  color: '#78350f',
  fontSize: '14px',
  margin: '12px 0 0 0',
  fontStyle: 'italic' as const,
};

const balanceSection = {
  backgroundColor: '#f1f5f9',
  borderRadius: '8px',
  padding: '16px',
  margin: '16px 0',
  textAlign: 'center' as const,
};

const balanceLabel = {
  color: '#64748b',
  fontSize: '12px',
  margin: '0 0 4px 0',
  textTransform: 'uppercase' as const,
};

const balanceValue = {
  color: '#1e293b',
  fontSize: '24px',
  fontWeight: 'bold' as const,
  margin: '0',
};

const rewardBanner = {
  backgroundColor: '#dcfce7',
  borderRadius: '8px',
  padding: '16px',
  margin: '16px 0',
  textAlign: 'center' as const,
  borderLeft: '4px solid #22c55e',
};

const rewardBannerText = {
  color: '#166534',
  fontSize: '16px',
  fontWeight: 'bold' as const,
  margin: '0',
};

const rewardNameText = {
  color: '#15803d',
  fontSize: '14px',
  margin: '8px 0 0 0',
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
