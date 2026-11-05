export type ProfileSaveFields = {
  display_name: string;
  avatar_url: string | null;
  leaderboard_opt_out: boolean;
};

type SaveError = { code?: string; message?: string };
type SaveResult = { error: SaveError | null };

/** Retry only a schema rejection of the optional country column, never an auth or transport failure. */
export async function saveProfileCompatible(
  fields: ProfileSaveFields,
  country: string | null,
  countrySupported: boolean,
  update: (values: ProfileSaveFields & { country?: string | null }) => PromiseLike<SaveResult>,
): Promise<SaveResult & { countrySaved: boolean }> {
  const result = await update(countrySupported ? { ...fields, country } : fields);
  const missingCountry = countrySupported && result.error
    && ((result.error.code === 'PGRST204' && /'country' column of 'profiles'/.test(result.error.message ?? ''))
      || (result.error.code === '42703' && /column (?:profiles\.)?["']?country["']? (?:of relation ["']profiles["'] )?does not exist/i.test(result.error.message ?? '')));
  if (!missingCountry) return { ...result, countrySaved: countrySupported && !result.error };
  const fallback = await update(fields);
  return { ...fallback, countrySaved: false };
}