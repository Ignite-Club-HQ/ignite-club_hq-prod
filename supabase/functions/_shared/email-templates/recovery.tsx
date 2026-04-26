/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

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

import { LOGO_URL, styles } from './_brand.ts'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
  token?: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
  token,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {token
        ? `Your ${siteName} password reset code: ${token}`
        : `Reset your password for ${siteName}`}
    </Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.logoWrap}>
          <Img src={LOGO_URL} alt={siteName} style={styles.logo} />
        </Section>
        <Section style={styles.card}>
          <Heading style={styles.h1}>Reset your password</Heading>
          <Text style={styles.text}>
            We received a request to reset the password for your {siteName} account.
            {token ? ' Enter this code in the app to continue:' : ''}
          </Text>

          {token ? (
            <Section style={styles.codeBox}>
              <Text style={styles.code}>{token}</Text>
            </Section>
          ) : null}

          <Text style={styles.text}>
            Or tap the button below to reset your password directly:
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Reset password
            </Button>
          </Section>
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            This code expires shortly. If you didn't request a password reset,
            you can safely ignore this email — your password won't change.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
