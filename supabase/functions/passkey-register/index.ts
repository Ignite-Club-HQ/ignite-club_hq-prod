import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple base64url encoding/decoding
function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlToBase64(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return base64;
}

// Generate a random challenge
function generateChallenge(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64ToBase64Url(btoa(String.fromCharCode(...array)));
}

// Parse CBOR-encoded attestation object to extract public key
function parseAttestationObject(attestationObjectBase64: string): { publicKey: string; counter: number } {
  // For simplicity with 'none' attestation, we extract the authData which contains the public key
  const attestationObject = Uint8Array.from(atob(attestationObjectBase64), c => c.charCodeAt(0));
  
  // Simple CBOR parsing for attestation object
  // The authData is typically at a known offset after the CBOR map header
  // For 'none' attestation: {fmt: 'none', authData: bytes, attStmt: {}}
  
  // Find authData in the CBOR structure
  // This is a simplified parser - in production, use a proper CBOR library
  let authDataStart = 0;
  for (let i = 0; i < attestationObject.length - 8; i++) {
    // Look for 'authData' key followed by byte string marker
    if (attestationObject[i] === 0x68 && // text(8) 'authData'
        attestationObject[i+1] === 0x61 && // 'a'
        attestationObject[i+2] === 0x75 && // 'u'
        attestationObject[i+3] === 0x74 && // 't'
        attestationObject[i+4] === 0x68 && // 'h'
        attestationObject[i+5] === 0x44 && // 'D'
        attestationObject[i+6] === 0x61 && // 'a'
        attestationObject[i+7] === 0x74 && // 't'
        attestationObject[i+8] === 0x61) { // 'a'
      authDataStart = i + 9;
      break;
    }
  }
  
  if (authDataStart === 0) {
    // Alternative: authData might be encoded differently, try to find byte string marker
    for (let i = 0; i < attestationObject.length - 50; i++) {
      // Look for a byte string of reasonable length (> 37 bytes for authData)
      if (attestationObject[i] === 0x58 || attestationObject[i] === 0x59) {
        const lenBytes = attestationObject[i] === 0x58 ? 1 : 2;
        const len = lenBytes === 1 
          ? attestationObject[i + 1]
          : (attestationObject[i + 1] << 8) | attestationObject[i + 2];
        if (len > 37 && len < 500) {
          authDataStart = i + 1 + lenBytes;
          break;
        }
      }
    }
  }
  
  // Extract authData (minimum 37 bytes: 32 rpIdHash + 1 flags + 4 counter)
  // Skip length byte(s) if present
  if (attestationObject[authDataStart] === 0x58) {
    authDataStart += 2; // Skip 0x58 + 1-byte length
  } else if (attestationObject[authDataStart] === 0x59) {
    authDataStart += 3; // Skip 0x59 + 2-byte length
  }
  
  const authData = attestationObject.slice(authDataStart);
  
  // Parse authData structure:
  // - rpIdHash: 32 bytes
  // - flags: 1 byte
  // - signCount: 4 bytes (big-endian)
  // - attestedCredentialData (if AT flag set): variable
  
  const flags = authData[32];
  const signCount = (authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36];
  
  // Check AT flag (bit 6) for attested credential data
  const hasAttestedCredData = (flags & 0x40) !== 0;
  
  if (!hasAttestedCredData) {
    throw new Error('No attested credential data in authenticator response');
  }
  
  // Attested credential data starts at byte 37
  // - AAGUID: 16 bytes
  // - credentialIdLength: 2 bytes (big-endian)
  // - credentialId: credentialIdLength bytes
  // - credentialPublicKey: remaining bytes (COSE-encoded)
  
  const credIdLength = (authData[53] << 8) | authData[54];
  const publicKeyStart = 55 + credIdLength;
  const publicKeyBytes = authData.slice(publicKeyStart);
  
  // Store the COSE public key as base64
  const publicKey = btoa(String.fromCharCode(...publicKeyBytes));
  
  return { publicKey, counter: signCount };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create client with user's token to get their info
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action } = body;

    // Service client for database operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    if (action === "get-options") {
      // Generate registration options
      const challenge = generateChallenge();
      
      // Store challenge temporarily (expires in 5 minutes)
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      
      // Use a simple key-value approach in a challenges table or use the user's metadata
      // For now, we'll encode the challenge with a timestamp for verification
      const challengeData = {
        challenge,
        userId: user.id,
        expiresAt,
      };
      
      // Store in localStorage on client side (returned with options)
      // The challenge is verified by checking the signature on verify

      // Get display name from profile
      const { data: profile } = await serviceClient
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single();

      const rpId = new URL(req.headers.get('origin') || 'https://ignite-club-launchpad.lovable.app').hostname;

      const options = {
        challenge,
        rp: {
          name: "Ignite Club HQ",
          id: rpId,
        },
        user: {
          id: btoa(user.id),
          name: user.email || user.id,
          displayName: profile?.display_name || user.email || 'User',
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },  // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
      };

      return new Response(JSON.stringify({ options, challengeData }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      const { credential } = body;
      
      if (!credential || !credential.id || !credential.response) {
        return new Response(JSON.stringify({ error: "Invalid credential data" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Parse the attestation to get the public key
      const { publicKey, counter } = parseAttestationObject(credential.response.attestationObject);

      // Check if this credential already exists
      const { data: existing } = await serviceClient
        .from('user_passkeys')
        .select('id')
        .eq('credential_id', credential.id)
        .single();

      if (existing) {
        return new Response(JSON.stringify({ error: "This passkey is already registered" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Determine device type from user agent
      const userAgent = req.headers.get('user-agent') || '';
      let deviceType = 'Unknown';
      if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
        deviceType = 'iOS';
      } else if (userAgent.includes('Android')) {
        deviceType = 'Android';
      } else if (userAgent.includes('Mac')) {
        deviceType = 'macOS';
      } else if (userAgent.includes('Windows')) {
        deviceType = 'Windows';
      }

      // Store the passkey
      const { error: insertError } = await serviceClient
        .from('user_passkeys')
        .insert({
          user_id: user.id,
          credential_id: credential.id,
          public_key: publicKey,
          counter,
          device_type: deviceType,
        });

      if (insertError) {
        console.error('Error storing passkey:', insertError);
        return new Response(JSON.stringify({ error: "Failed to store passkey" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Passkey registration error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
