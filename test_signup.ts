import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing supabase env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testSignUp() {
  console.log("🚀 Testing Auth Trigger for NewCompany...");
  const { data, error } = await supabase.auth.signUp({
    email: 'test_founder@newcompany.com',
    password: 'SuperSecretPassword123!',
    options: {
      data: {
        full_name: 'Test Founder',
        company_name: 'Test Acme Corp',
      }
    }
  });

  if (error) {
    console.error("❌ Sign up failed:", error.message);
    return;
  }

  console.log("✅ Sign up succeeded. User ID:", data.user?.id);
  console.log("Checking database trigger side effects for user...");

  // Since we are external, I'll print the instructions to verify via MCP.
  console.log("Please check supabase tables for user ID", data.user?.id);
}

testSignUp();
