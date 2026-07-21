const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('Checking table user_voices...');
  const { data, error } = await supabase.from('user_voices').select('*').limit(1);
  if (error) {
    console.error('Table error:', error.message);
  } else {
    console.log('Table user_voices exists.');
  }

  console.log('Checking bucket user_voices...');
  const { data: bData, error: bError } = await supabase.storage.getBucket('user_voices');
  if (bError) {
    console.error('Bucket error:', bError.message);
  } else {
    console.log('Bucket user_voices exists.');
  }
}

main();
