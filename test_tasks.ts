import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing supabase env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testTaskSystem() {
  console.log("🚀 Authenticating as Test Founder...");
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'test_founder@newcompany.com',
    password: 'SuperSecretPassword123!',
  });

  if (authErr) {
    console.error("❌ Sign in failed:", authErr.message);
    return;
  }
  console.log("✅ Authenticated. User ID:", authData.user?.id);

  console.log("🚀 Testing Task Creation RPC...");
  const { data: taskId, error: rpcErr } = await supabase.rpc('rpc_create_task', {
    p_title: 'My First Test Task',
    p_description: 'Validating the ledger logging',
    p_priority: 'high'
  });

  if (rpcErr) {
    console.error("❌ RPC failed:", rpcErr.message, rpcErr.details, rpcErr.hint);
    return;
  }
  
  console.log("✅ Task created. ID:", taskId);

  console.log("🚀 Testing Task Status Update RPC...");
  const { error: updateErr } = await supabase.rpc('rpc_update_task_status', {
    p_task_id: taskId,
    p_new_status: 'in_progress'
  });

  if (updateErr) {
    console.error("❌ Status Update RPC failed:", updateErr.message);
    return;
  }
  console.log("✅ Task Status updated to 'in_progress'");

  console.log("🚀 Analyzing Activity Events ledger...");
  const { data: events, error: eventErr } = await supabase
    .from('activity_events')
    .select('*')
    .eq('entity_type', 'task')
    .or(`entity_id.eq.${taskId}`)
    .order('created_at', { ascending: true });

  if (eventErr) {
    console.error("❌ Event query failed:", eventErr.message);
    return;
  }
  
  if (events) {
    console.log(`✅ Found ${events.length} event(s) in the ledger.`);
    events.forEach((e, idx) => {
      console.log(`   [${idx+1}] Type: ${e.event_type} | Metadata:`, e.metadata);
    });
  }
  
}

testTaskSystem();
