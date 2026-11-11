// Pure, release-gated Internet Identity derivation policy.
// The production website is allowed to derive the production app principal,
// not an identity derived from the DEV frontend canister.
export const PROD_MEMBER_II_ORIGIN = "https://igniteclubhq.app";
export const DEV_FRONTEND_II_CANISTER = "proe7-kqaaa-aaaas-qg6gq-cai";
export const PRODUCTION_WEBSITE_ORIGINS = Object.freeze([
  "https://igniteclubhq.com",
  "https://www.igniteclubhq.com",
  "https://ignite-club-heart.lovable.app",
  "https://pjx2u-tiaaa-aaaac-qhj3a-cai.icp0.io",
  "https://id-preview--4b755d42-e84b-4c9c-a8c7-5afa433410a4.lovable.app",
]);
export const DEV_APP_ORIGINS = Object.freeze([
  "https://ignite-club-launchpad.lovable.app",
  "https://id-preview--07e3017a-fabc-4c96-a9eb-f9d29146ffa6.lovable.app",
  "https://project--07e3017a-fabc-4c96-a9eb-f9d29146ffa6.lovable.app",
  "https://project--07e3017a-fabc-4c96-a9eb-f9d29146ffa6-dev.lovable.app",
]);
export function derivationOriginForBuild({ isProdBuild, frontendCanisterId }) {
  if (!frontendCanisterId) throw new Error("frontendCanisterId required");
  return isProdBuild ? PROD_MEMBER_II_ORIGIN : `https://${frontendCanisterId}.icp0.io`;
}
export function alternativeOriginsForBuild({ isProdBuild, frontendCanisterId }) {
  if (!frontendCanisterId) throw new Error("frontendCanisterId required");
  const aliases = [
    `https://${frontendCanisterId}.icp.net`,
    `https://${frontendCanisterId}.raw.icp0.io`,
    `https://${frontendCanisterId}.raw.icp.net`,
    `https://${frontendCanisterId}.ic0.app`,
    `https://${frontendCanisterId}.raw.ic0.app`,
  ];
  if (isProdBuild) aliases.push(
    ...PRODUCTION_WEBSITE_ORIGINS,
    `https://${frontendCanisterId}.icp0.io`,
    PROD_MEMBER_II_ORIGIN,
  );
  if (!isProdBuild && frontendCanisterId === DEV_FRONTEND_II_CANISTER) {
    aliases.push(...DEV_APP_ORIGINS);
  }
  return aliases;
}
