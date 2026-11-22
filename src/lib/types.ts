export type Role = 'super_admin' | 'system_admin' | 'supervisor' | 'analyst' | 'operator' | 'support_officer' | 'auditor' | 'gateway';
export type SignalState = 'RED' | 'CAUTION' | 'GREEN' | 'UNKNOWN';

export interface Profile {
  id: string; email: string; full_name: string; role: Role; command: string; active: boolean;
  theme: 'dark' | 'light'; prefs: Record<string, unknown>; last_seen_at: string | null; created_at: string;
}
export interface Intersection { id: string; name: string; city: string; lat: number; lon: number; map_x: number; map_y: number; current_state: SignalState }
export interface Camera {
  id: string; name: string; intersection_id: string; gateway_ref: string; status: 'Online' | 'Offline' | 'Obstructed';
  retention_days: number; events_count: number; obstruction_count: number; created_at: string;
  gateway_id: string | null; stream_enabled: boolean; ai_enabled: boolean; last_frame_at: string | null; stream_info: Record<string, unknown>;
}
export interface Gateway { id: string; name: string; public_url: string; account_id: string | null; status: 'online' | 'offline' | 'unknown'; version: string | null; info: Record<string, unknown>; last_seen_at: string | null; created_at: string }
export interface CctvSession { id: number; user_id: string | null; user_name: string; camera_id: string | null; gateway_id: string | null; client: string | null; started_at: string; last_activity_at: string }
export interface DetectionEvent {
  id: number; intersection_id: string | null; camera_id: string | null; state: SignalState; detail: string | null;
  confidence: number | null; verified: boolean; source: string; user_id: string | null; created_at: string;
}
export interface Alert { id: number; kind: string; severity: 'r' | 'a' | 'g'; body: string; acknowledged_by: string | null; acknowledged_at: string | null; created_at: string }
export interface Evidence { id: number; ref: string; intersection_id: string | null; state: SignalState; notes: string | null; sha256: string; retention_until: string; created_at: string }
export interface AiModel { id: number; version: string; dataset_ref: string; evaluation: string; status: string }
export interface AuditLog { id: number; actor_name: string; category: string; action: string; target: string | null; created_at: string }
export interface Notification { id: number; type: string; priority: 'Low' | 'Medium' | 'High' | 'Critical'; title: string; body: string; target_type: string; target: string | null; created_at: string }
export interface ChatMessage { id: number; thread_key: string; sender_id: string; body: string; file_path: string | null; file_name: string | null; file_size: number | null; read_at: string | null; created_at: string }
export interface CommMessage { id: number; channel: string; sender_id: string | null; sender_name: string; body: string; priority: 'Normal' | 'Priority' | 'Emergency'; file_path: string | null; file_name: string | null; file_size: number | null; created_at: string }
export interface CommReceipt { message_id: number; user_id: string; read_at: string; acked_at: string | null }
export interface Ticket {
  id: number; ref: string; title: string; category: string; priority: 'Low' | 'Medium' | 'High' | 'Critical'; status: string;
  department: string; requester_id: string | null; requester_name: string; assignee: string; resolved_at: string | null; created_at: string; updated_at: string;
}
export interface TicketEvent { id: number; ticket_id: number; author_name: string; body: string; internal: boolean; file_path: string | null; file_name: string | null; file_size: number | null; created_at: string }
export interface Branding {
  sysName: string; org: string; tagline: string; welcome: string; footer: string;
  accent: string; accent2: string; primary: string; themeDefault: 'dark' | 'light'; logo: string | null;
}
export interface Stats {
  total_24h: number; mean_conf_verified_24h: number | null;
  by_state_24h: Record<string, number>; by_hour_24h: Record<string, number>; by_state_7d: Record<string, number>;
  conf_bands_7d: Record<string, number>; by_intersection_7d: Record<string, number>; review_flagged_7d: number; by_source_7d: Record<string, number>;
}
