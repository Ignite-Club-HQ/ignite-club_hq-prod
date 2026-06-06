/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
  token?: string
}

export const RecoveryEmail = ({
  siteName,
  token,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your password for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Reset your password</Heading>
        <Text style={text}>
          We received a request to reset your password for {siteName}. Enter
          the verification code below in the app to continue.
        </Text>
        {token ? (
          <>
            <Text style={codeLabel}>Your verification code</Text>
            <Text style={code}>{token}</Text>
            <Text style={expiry}>This code expires in 1 hour.</Text>
          </>
        ) : null}
        <Text style={footer}>
          If you didn't request a password reset, you can safely ignore this
          email. Your password will not be changed.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 25px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
const codeLabel = { fontSize: '12px', color: '#55575d', margin: '20px 0 6px', textTransform: 'uppercase' as const, letterSpacing: '1px' }
const code = { fontSize: '32px', fontWeight: 'bold' as const, color: '#000000', letterSpacing: '6px', margin: '0 0 10px', fontFamily: 'monospace' }
const expiry = { fontSize: '13px', color: '#55575d', margin: '0 0 20px' }
