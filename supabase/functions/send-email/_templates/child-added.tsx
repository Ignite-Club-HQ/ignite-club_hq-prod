import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import * as React from 'npm:react@18.3.1'
import { sportEmoji } from './sport-meta.ts'

interface ChildAddedEmailProps {
  recipientName: string;
  teamName: string;
  clubName: string;
  inviteLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
  childrenNames?: string[];
  customMessage?: string;
  sport?: string | null;
}

const PRODUCTION_DOMAIN = "https://igniteclubhq.app";
const IGNITE_BRAND_COLOR = "#10b981";
const IGNITE_ICON_URL = `${PRODUCTION_DOMAIN}/ignite-icon.png`;

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub&pcampaignid=web_share";
const APP_STORE_URL = "https://apps.apple.com/au/app/ignite-club-hq/id6758928691";

const isValidExternalUrl = (url?: string): boolean => {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
};

export const ChildAddedEmail = ({
  recipientName = "there",
  teamName = "The Team",
  clubName = "The Club",
  inviteLink = "https://igniteclubhq.app",
  clubLogoUrl,
  primaryColor = IGNITE_BRAND_COLOR,
  childrenNames = [],
  customMessage,
  sport,
}: ChildAddedEmailProps) => {
  const hasMultipleChildren = childrenNames.length > 1;
  const childLabel = childrenNames.length === 1 ? childrenNames[0] : 'your children';
  const emoji = sportEmoji(sport);
  const previewText = childrenNames.length === 1
    ? `${childrenNames[0]} has been added to ${teamName} ${emoji}`
    : `Your children have been added to ${teamName} ${emoji}`;

  const validClubLogoUrl = isValidExternalUrl(clubLogoUrl) ? clubLogoUrl : undefined;
  const deepLinkPath = inviteLink.replace(/^https?:\/\/[^/]+/, '');
  const deepLinkUrl = `${PRODUCTION_DOMAIN}${deepLinkPath}`;

  const useCustomMessage = customMessage && customMessage.trim().length > 0;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
      </Head>
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>

          {/* Club Logo Header */}
          {validClubLogoUrl && (
            <Section style={logoSection}>
              <Img
                src={validClubLogoUrl}
                width="72"
                height="72"
                alt={clubName}
                style={logoStyle}
              />
            </Section>
          )}

          {/* Main Content */}
          <Section style={contentSection}>
            <Text style={greeting}>
              Hi {recipientName},
            </Text>

            {useCustomMessage ? (
              <Text style={bodyText}>
                {customMessage}
              </Text>
            ) : (
              <>
                <Text style={headingText}>
                  {childrenNames.length === 1
                    ? `${childrenNames[0]} has been added to ${teamName} ⚽`
                    : `Your children have been added to ${teamName} ⚽`}
                </Text>

                <Text style={bodyText}>
                  Tap the button below to open Ignite Club HQ and see their team, teammates, and any updates for the season.
                </Text>
              </>
            )}
          </Section>

          {/* CTA */}
          <Section style={ctaSection}>
            {/* View team button */}
            <Text style={stepLabel}>👇 Tap below to see their team</Text>
            <Section style={mainCtaSection}>
              <Button style={{ ...mainCtaButton, backgroundColor: primaryColor }} href={deepLinkUrl}>
                View Their Team
              </Button>
            </Section>

            <Text style={fallbackLinkText}>
              Or copy this link: <Link href={deepLinkUrl} style={fallbackLink}>{deepLinkUrl}</Link>
            </Text>
          </Section>

          {/* Closing */}
          <Section style={closingSection}>
            <Text style={bodyText}>
              If you have any issues, just reply to this email and we'll help you out.
            </Text>

            <Text style={clubSignature}>
              {clubName}
            </Text>
          </Section>

          <Hr style={footerDivider} />

          {/* Footer */}
          <Section style={footerSection}>
            <table cellPadding="0" cellSpacing="0" style={{ margin: '0 auto' }}>
              <tr>
                <td style={{ paddingRight: '8px', verticalAlign: 'middle' }}>
                  <Img
                    src={IGNITE_ICON_URL}
                    width="20"
                    height="20"
                    alt="Ignite Club HQ"
                    style={{ display: 'block', borderRadius: '4px' }}
                  />
                </td>
                <td style={{ verticalAlign: 'middle' }}>
                  <Link href={PRODUCTION_DOMAIN} style={footerBrandLink}>
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

export default ChildAddedEmail;

// ── Styles ──

const main = {
  backgroundColor: '#f4f4f5',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
  padding: '20px 0',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  maxWidth: '600px',
  borderRadius: '12px',
  overflow: 'hidden' as const,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
};

const logoSection = {
  textAlign: 'center' as const,
  padding: '32px 24px 8px 24px',
};

const logoStyle = {
  margin: '0 auto',
  borderRadius: '12px',
  objectFit: 'cover' as const,
};

const contentSection = {
  padding: '24px 32px 0 32px',
};

const greeting = {
  color: '#1a1a1a',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '0 0 16px 0',
};

const headingText = {
  color: '#1a1a1a',
  fontSize: '20px',
  fontWeight: 'bold' as const,
  lineHeight: '28px',
  margin: '0 0 20px 0',
};

const bodyText = {
  color: '#374151',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 12px 0',
};

const childrenSection = {
  backgroundColor: '#f0fdf4',
  borderRadius: '8px',
  padding: '12px 16px',
  margin: '16px 0 0 0',
};

const childrenText = {
  color: '#166534',
  fontSize: '14px',
  margin: '0',
  lineHeight: '22px',
};

const ctaSection = {
  padding: '24px 32px',
};

const mainCtaSection = {
  textAlign: 'center' as const,
  margin: '0 0 12px 0',
};

const mainCtaButton = {
  borderRadius: '10px',
  color: '#ffffff',
  fontSize: '18px',
  fontWeight: 'bold' as const,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  padding: '16px 24px',
  width: '100%',
  boxSizing: 'border-box' as const,
};

const fallbackLinkText = {
  color: '#9ca3af',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '4px 0 0 0',
  textAlign: 'center' as const,
  wordBreak: 'break-all' as const,
};

const fallbackLink = {
  color: '#10b981',
  textDecoration: 'underline',
};

const closingSection = {
  padding: '0 32px 24px 32px',
};

const clubSignature = {
  color: '#374151',
  fontSize: '15px',
  lineHeight: '22px',
  margin: '0',
};

const stepLabel = {
  color: '#1a1a1a',
  fontSize: '14px',
  fontWeight: '600' as const,
  lineHeight: '20px',
  margin: '0 0 8px 0',
  textAlign: 'center' as const,
};

const storeButtonsRow = {
  textAlign: 'center' as const,
  margin: '0 0 20px 0',
};

const playStoreBtn = {
  backgroundColor: '#1a1a1a',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: '600' as const,
  textDecoration: 'none',
  padding: '10px 16px',
  display: 'inline-block',
};

const appStoreBtn = {
  backgroundColor: '#1a1a1a',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: '600' as const,
  textDecoration: 'none',
  padding: '10px 16px',
  display: 'inline-block',
};

const footerDivider = {
  borderColor: '#e5e7eb',
  margin: '0',
};

const footerSection = {
  padding: '20px 32px',
  backgroundColor: '#fafafa',
};

const footerBrandLink = {
  color: IGNITE_BRAND_COLOR,
  fontSize: '12px',
  textDecoration: 'none',
};
