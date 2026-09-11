export interface AccountConfig {
  supabaseUrl: string;
  publishableKey: string;
}

export function getAccountConfig(): AccountConfig | undefined {
  const supabaseUrl = import.meta.env.WXT_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !publishableKey) return undefined;

  const url = new URL(supabaseUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('La URL de Supabase debe usar HTTPS.');
  }
  return { supabaseUrl: url.origin, publishableKey };
}
