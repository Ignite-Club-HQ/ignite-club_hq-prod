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

interface PhotoUploadedEmailProps {
  recipientName?: string;
  uploaderName: string;
  contextType: 'team' | 'club';
  contextName: string;
  photoLink: string;
  clubLogoUrl?: string;
  primaryColor?: string;
}

export const PhotoUploadedEmail = ({
  recipientName,
  uploaderName,
  contextType,
  contextName,
  photoLink,
  clubLogoUrl,
  primaryColor = '#10b981',
}: PhotoUploadedEmailProps) => {
  const previewText = `${uploaderName} uploaded a new photo to ${contextName}`;
  
  const normalizedPhotoLink = photoLink.startsWith('http') 
    ? photoLink 
    : `https://igniteclubhq.app${photoLink}`;

  const contextLabel = contextType === 'team' ? `Team: ${contextName}` : `Club: ${contextName}`;

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
            <Heading style={heading}>📷 New Photo</Heading>
            
            <Text style={contextLabelStyle}>{contextLabel}</Text>

            {/* Photo Card */}
            <Section style={photoCard}>
              <Text style={uploaderText}>
                <strong>{uploaderName}</strong> uploaded a new photo
              </Text>
              <Text style={descriptionText}>
                Check out the latest photo added to your {contextType}!
              </Text>
            </Section>

            {/* CTA Button */}
            <Section style={buttonSection}>
              <Button style={{ ...button, backgroundColor: primaryColor }} href={normalizedPhotoLink}>
                View Photo
              </Button>
            </Section>

            <Text style={promptText}>
              Tap the button above to see the photo and react!
            </Text>
            
            <Text style={linkFallback}>
              Or copy this link: <Link href={normalizedPhotoLink} style={{ color: primaryColor }}>{normalizedPhotoLink}</Link>
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footerSection}>
            <Text style={footerText}>
              You're receiving this because you have media notifications enabled.
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

export default PhotoUploadedEmail;

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

const contextLabelStyle = {
  color: '#64748b',
  fontSize: '14px',
  textAlign: 'center' as const,
  margin: '0 0 24px 0',
  fontWeight: '500',
};

const photoCard = {
  backgroundColor: '#f1f5f9',
  borderRadius: '12px',
  padding: '16px 20px',
  margin: '0 0 24px 0',
};

const uploaderText = {
  color: '#334155',
  fontSize: '14px',
  margin: '0 0 8px 0',
};

const descriptionText = {
  color: '#475569',
  fontSize: '15px',
  lineHeight: '22px',
  margin: '0',
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
