// Configuración de la galería MUNDIAL (Supabase de Prohibido No Jugar).
// La clave "publishable" está pensada para ir en la página: lo que protege la galería
// son las reglas de la base (backend/freezer-gallery.sql).
// Si se dejan vacíos, la galería guarda las fotos solo en este dispositivo.
window.FREEZER_CONFIG = {
  supabaseUrl: 'https://fzmuhwrwupofvrmtsawt.supabase.co',
  supabaseAnonKey: 'sb_publishable_wTc2hxiXymgBmynOf7vKYQ_7ygccIke',
  bucket: 'freezer',
};
