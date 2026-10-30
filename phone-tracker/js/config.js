/* GRGC Phone Tracker — configuration
 * The publishable key below is safe to expose in a static site:
 * every row in the database is protected by Row Level Security and
 * only readable/writable by the signed-in owner.
 */
window.TRACKER_CONFIG = {
  supabaseUrl: "https://jzagkdxwpzayxcuowaao.supabase.co",
  supabaseKey: "sb_publishable_naRw9HLUeWIqHnWaJoj6FQ_rUYe7ZmM",
  // Default map centre: Kampala, Uganda
  map: { lat: 0.3476, lon: 32.5825, zoom: 12 },
  appVersion: "1.0.0",
};
