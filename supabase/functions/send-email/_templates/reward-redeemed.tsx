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

interface RewardRedeemedEmailProps {
  recipientName?: string;
  rewardName: string;
  pointsSpent: number;
  remainingPoints: number;
  clubName: string;
  rewardDescription?: string;
  sponsorName?: string;
  showQrCode?: boolean;
  profileLink: string;
  clubLogoUrl?: string;
  rewardLogoUrl?: string;
  primaryColor?: string;
  redeemedForChildName?: string;
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

export const RewardRedeemedEmail = ({
  recipientName = "Team Member",
  rewardName = "Reward",
  pointsSpent = 0,
  remainingPoints = 0,
  clubName = "The Club",
  rewardDescription,
  sponsorName,
  showQrCode = false,
  profileLink = "/profile",
  clubLogoUrl,
  rewardLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  redeemedForChildName,
}: RewardRedeemedEmailProps) => {
  const previewText = `You redeemed "${rewardName}" for ${pointsSpent} points!`;
  const normalizedProfileLink = normalizeLink(profileLink);
  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;
  const validRewardLogoUrl = isValidExternalUrl(rewardLogoUrl) ? rewardLogoUrl : undefined;

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

          {/* Celebration Banner */}
          <Section style={celebrationBanner}>
            <Text style={celebrationEmoji}>🎁</Text>
            <Text style={{ ...celebrationText, color: primaryColor }}>Reward Redeemed!</Text>
          </Section>

          {/* Main Content */}
          <Section style={contentSection}>
            <Heading style={heading}>Congratulations!</Heading>
            
            <Text style={paragraph}>
              Hi {recipientName},
            </Text>
            
            <Text style={paragraph}>
              {redeemedForChildName 
                ? `You've successfully redeemed a reward for ${redeemedForChildName}!`
                : `You've successfully redeemed a reward!`
              }
            </Text>

            {/* Reward Card */}
            <Section style={rewardCard}>
              {validRewardLogoUrl && (
                <Img
                  src={validRewardLogoUrl}
                  width="60"
                  height="60"
                  alt={rewardName}
                  style={rewardLogoStyle}
                />
              )}
              <Text style={rewardNameText}>{rewardName}</Text>
              {rewardDescription && (
                <Text style={rewardDescriptionText}>{rewardDescription}</Text>
              )}
              {sponsorName && (
                <Text style={sponsorText}>Provided by {sponsorName}</Text>
              )}
            </Section>

            {/* Points Summary */}
            <Section style={pointsSummary}>
              <table cellPadding="0" cellSpacing="0" width="100%">
                <tr>
                  <td style={pointsItem}>
                    <Text style={pointsLabel}>Points Spent</Text>
                    <Text style={{ ...pointsValue, color: '#ef4444' }}>-{pointsSpent}</Text>
                  </td>
                  <td style={pointsItem}>
                    <Text style={pointsLabel}>Remaining Balance</Text>
                    <Text style={{ ...pointsValue, color: primaryColor }}>{remainingPoints}</Text>
                  </td>
                </tr>
              </table>
            </Section>

            {/* Instructions */}
            <Section style={instructionsBox}>
              <Text style={instructionsTitle}>How to claim your reward:</Text>
              {showQrCode ? (
                <>
                  <Text style={instructionItem}>1. Go to your profile in the app</Text>
                  <Text style={instructionItem}>2. Find your redeemed reward</Text>
                  <Text style={instructionItem}>3. Show the QR code to the partner location</Text>
                  <Text style={instructionItem}>4. Enjoy your reward!</Text>
                </>
              ) : (
                <>
                  <Text style={instructionItem}>1. Go to your profile in the app</Text>
                  <Text style={instructionItem}>2. Find your redeemed reward</Text>
                  <Text style={instructionItem}>3. Show it to a club admin or team manager</Text>
                  <Text style={instructionItem}>4. They'll mark it as fulfilled when you receive it</Text>
                </>
              )}
            </Section>

            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedProfileLink}>
                View My Rewards
              </Button>
            </Section>
          </Section>

          <Hr style={divider} />

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              This notification was sent by {clubName}. Keep earning points to unlock more rewards!
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

export default RewardRedeemedEmail;

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

const celebrationBanner = {
  backgroundColor: '#f0fdf4',
  padding: '20px',
  textAlign: 'center' as const,
};

const celebrationEmoji = {
  fontSize: '40px',
  margin: '0',
  lineHeight: '1',
};

const celebrationText = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  margin: '8px 0 0 0',
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

const rewardCard = {
  backgroundColor: '#fef3c7',
  borderRadius: '12px',
  padding: '24px',
  margin: '24px 0',
  textAlign: 'center' as const,
  border: '2px solid #f59e0b',
};

const rewardLogoStyle = {
  margin: '0 auto 12px auto',
  borderRadius: '8px',
  objectFit: 'contain' as const,
};

const rewardNameText = {
  fontSize: '20px',
  fontWeight: 'bold' as const,
  color: '#92400e',
  margin: '0',
};

const rewardDescriptionText = {
  fontSize: '14px',
  color: '#78350f',
  margin: '8px 0 0 0',
};

const sponsorText = {
  fontSize: '12px',
  color: '#a16207',
  margin: '8px 0 0 0',
  fontStyle: 'italic' as const,
};

const pointsSummary = {
  backgroundColor: '#f1f5f9',
  borderRadius: '8px',
  padding: '16px',
  margin: '16px 0',
};

const pointsItem = {
  textAlign: 'center' as const,
  width: '50%',
};

const pointsLabel = {
  fontSize: '12px',
  color: '#64748b',
  margin: '0 0 4px 0',
  textTransform: 'uppercase' as const,
};

const pointsValue = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  margin: '0',
};

const instructionsBox = {
  backgroundColor: '#f0f9ff',
  borderRadius: '8px',
  padding: '20px',
  margin: '24px 0',
  borderLeft: '4px solid #0ea5e9',
};

const instructionsTitle = {
  color: '#0c4a6e',
  fontSize: '15px',
  fontWeight: '600',
  margin: '0 0 12px 0',
};

const instructionItem = {
  color: '#0369a1',
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
