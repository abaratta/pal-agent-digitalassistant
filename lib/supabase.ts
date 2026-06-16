import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Provide a WebSocket implementation for environments running Node < 22
// (Trigger.dev cloud currently runs Node 21 which lacks native WebSocket).
export const supabaseClient = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: ws as any },
});

export type UserSession = {
  telegram_chat_id: number;
  onboarding_completed: boolean;
  current_step: string;
  user_name: string | null;
  email: string | null;
  company: string | null;
  website: string | null;
  encrypted_anthropic_key: string | null;
  anthropic_agent_id: string | null;
  anthropic_environment_id: string | null;
  anthropic_vault_id: string | null;
  anthropic_memory_store_id: string | null;
  anthropic_file_ids: string[];
  mcp_connectors: string[];
  created_at: string;
  updated_at: string;
};

export type AgentConversation = {
  id: number;
  telegram_chat_id: number;
  anthropic_session_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
