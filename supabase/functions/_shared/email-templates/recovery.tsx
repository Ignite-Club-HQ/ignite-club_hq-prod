/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
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
  confirmationUrl,
  token,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Ignite password reset code{token ? ` is ${token}` : ''}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>Ignite Club HQ</Text>
        <Heading style={h1}>Reset your password</Heading>
        <Text style={text}>
          We received a request to reset your password for {siteName}. Enter this code in the app to continue.
        </Text>
        {token && <Text style={code}>{token}</Text>}
        <Button style={button} href={confirmationUrl}>
          Open reset screen
        </Button>
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
const container = { padding: '28px 24px', maxWidth: '480px' }
const brand = {
  fontSize: '13px',
  fontWeight: 'bold' as const,
  color: '#0d7d58',
  margin: '0 0 14px',
}
const h1 = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#12221d',
  margin: '0 0 16px',
}
const text = {
  fontSize: '15px',
  color: '#53605c',
  lineHeight: '1.5',
  margin: '0 0 20px',
}
const code = {
  fontSize: '32px',
  fontWeight: 'bold' as const,
  letterSpacing: '8px',
  color: '#12221d',
  backgroundColor: '#eef8f4',
  border: '1px solid #cfe9df',
  borderRadius: '12px',
  padding: '16px 18px',
  textAlign: 'center' as const,
  margin: '0 0 22px',
}
const button = {
  backgroundColor: '#0d7d58',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '12px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#7b8581', margin: '28px 0 0', lineHeight: '1.5' }
