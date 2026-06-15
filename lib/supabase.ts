import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseClient = createClient(supabaseUrl, supabaseKey);

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
