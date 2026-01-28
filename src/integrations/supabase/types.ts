export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      active_games: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_sub_check_time: number | null
          pitch_state: Json
          team_id: string | null
          timer_state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_sub_check_time?: number | null
          pitch_state?: Json
          team_id?: string | null
          timer_state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_sub_check_time?: number | null
          pitch_state?: Json
          team_id?: string | null
          timer_state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_games_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_alerts: {
        Row: {
          alert_type: string
          created_at: string
          details: Json | null
          id: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          details?: Json | null
          id?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          details?: Json | null
          id?: string
        }
        Relationships: []
      }
      app_ad_analytics: {
        Row: {
          ad_id: string
          context: string
          created_at: string
          event_type: string
          id: string
          user_id: string | null
        }
        Insert: {
          ad_id: string
          context: string
          created_at?: string
          event_type: string
          id?: string
          user_id?: string | null
        }
        Update: {
          ad_id?: string
          context?: string
          created_at?: string
          event_type?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_ad_analytics_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "app_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      app_ad_settings: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          location: string
          override_sponsors: boolean
          show_only_when_no_sponsors: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          location: string
          override_sponsors?: boolean
          show_only_when_no_sponsors?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          location?: string
          override_sponsors?: boolean
          show_only_when_no_sponsors?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      app_ads: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          image_url: string
          is_active: boolean
          link_url: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          image_url: string
          is_active?: boolean
          link_url?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          image_url?: string
          is_active?: boolean
          link_url?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_stripe_config: {
        Row: {
          created_at: string | null
          id: string
          is_enabled: boolean | null
          stripe_publishable_key: string
          stripe_secret_key: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          stripe_publishable_key: string
          stripe_secret_key: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          stripe_publishable_key?: string
          stripe_secret_key?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action_type: string
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
          target_user_id: string | null
          target_user_name: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_user_id?: string | null
          target_user_name?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_user_id?: string | null
          target_user_name?: string | null
        }
        Relationships: []
      }
      broadcast_messages: {
        Row: {
          author_id: string
          created_at: string
          deleted_at: string | null
          id: string
          image_url: string | null
          reply_to_id: string | null
          text: string
        }
        Insert: {
          author_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text: string
        }
        Update: {
          author_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "broadcast_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_groups: {
        Row: {
          allowed_roles: Database["public"]["Enums"]["app_role"][]
          club_id: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          team_id: string | null
          updated_at: string
        }
        Insert: {
          allowed_roles: Database["public"]["Enums"]["app_role"][]
          club_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          allowed_roles?: Database["public"]["Enums"]["app_role"][]
          club_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_groups_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_groups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_mute_preferences: {
        Row: {
          chat_id: string
          chat_type: string
          id: string
          muted_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          chat_type: string
          id?: string
          muted_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          chat_type?: string
          id?: string
          muted_at?: string
          user_id?: string
        }
        Relationships: []
      }
      child_guardians: {
        Row: {
          child_id: string
          created_at: string
          guardian_id: string
          id: string
          is_primary: boolean | null
          relationship_type: string | null
        }
        Insert: {
          child_id: string
          created_at?: string
          guardian_id: string
          id?: string
          is_primary?: boolean | null
          relationship_type?: string | null
        }
        Update: {
          child_id?: string
          created_at?: string
          guardian_id?: string
          id?: string
          is_primary?: boolean | null
          relationship_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_guardians_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_guardians_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      child_mini_league_assignments: {
        Row: {
          ability_rating: number
          child_id: string
          created_at: string
          id: string
          mini_league_id: string
          notes: string | null
        }
        Insert: {
          ability_rating?: number
          child_id: string
          created_at?: string
          id?: string
          mini_league_id: string
          notes?: string | null
        }
        Update: {
          ability_rating?: number
          child_id?: string
          created_at?: string
          id?: string
          mini_league_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "child_mini_league_assignments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_mini_league_assignments_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      child_team_assignments: {
        Row: {
          child_id: string
          created_at: string
          id: string
          team_id: string
        }
        Insert: {
          child_id: string
          created_at?: string
          id?: string
          team_id: string
        }
        Update: {
          child_id?: string
          created_at?: string
          id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "child_team_assignments_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "child_team_assignments_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      children: {
        Row: {
          created_at: string
          id: string
          ignite_points: number
          name: string
          parent_id: string
          year_of_birth: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          ignite_points?: number
          name: string
          parent_id: string
          year_of_birth?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          ignite_points?: number
          name?: string
          parent_id?: string
          year_of_birth?: number | null
        }
        Relationships: []
      }
      club_invites: {
        Row: {
          club_id: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
          uses_count: number
        }
        Insert: {
          club_id: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
          uses_count?: number
        }
        Update: {
          club_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "club_invites_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_messages: {
        Row: {
          author_id: string
          club_id: string
          created_at: string
          deleted_at: string | null
          id: string
          image_url: string | null
          reply_to_id: string | null
          text: string
        }
        Insert: {
          author_id: string
          club_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text: string
        }
        Update: {
          author_id?: string
          club_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_messages_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "club_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      club_rewards: {
        Row: {
          club_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          logo_url: string | null
          name: string
          points_required: number
          qr_code_url: string | null
          reward_type: string
          show_qr_code: boolean
          sponsor_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          logo_url?: string | null
          name: string
          points_required?: number
          qr_code_url?: string | null
          reward_type?: string
          show_qr_code?: boolean
          sponsor_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          logo_url?: string | null
          name?: string
          points_required?: number
          qr_code_url?: string | null
          reward_type?: string
          show_qr_code?: boolean
          sponsor_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_rewards_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_rewards_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_rewards_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      club_stripe_configs: {
        Row: {
          club_id: string
          created_at: string | null
          id: string
          is_enabled: boolean | null
          stripe_publishable_key: string
          stripe_publishable_key_encrypted: string | null
          stripe_secret_key: string
          stripe_secret_key_encrypted: string | null
          updated_at: string | null
        }
        Insert: {
          club_id: string
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          stripe_publishable_key: string
          stripe_publishable_key_encrypted?: string | null
          stripe_secret_key: string
          stripe_secret_key_encrypted?: string | null
          updated_at?: string | null
        }
        Update: {
          club_id?: string
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          stripe_publishable_key?: string
          stripe_publishable_key_encrypted?: string | null
          stripe_secret_key?: string
          stripe_secret_key_encrypted?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_stripe_configs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_subscriptions: {
        Row: {
          activated_at: string | null
          admin_pro_football_override: boolean
          admin_pro_override: boolean
          club_id: string
          created_at: string
          disable_team_pom_rewards: boolean
          expires_at: string | null
          id: string
          is_pro: boolean
          is_pro_football: boolean
          is_trial: boolean
          member_payments_enabled: boolean
          member_subscription_amount: number | null
          plan: Database["public"]["Enums"]["club_subscription_plan"]
          promo_code_id: string | null
          scheduled_storage_downgrade_gb: number | null
          storage_downgrade_at: string | null
          storage_purchased_gb: number
          stripe_subscription_id: string | null
          team_limit: number | null
          trial_ends_at: string | null
          trial_is_annual: boolean | null
          trial_plan: string | null
          trial_tier: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          admin_pro_football_override?: boolean
          admin_pro_override?: boolean
          club_id: string
          created_at?: string
          disable_team_pom_rewards?: boolean
          expires_at?: string | null
          id?: string
          is_pro?: boolean
          is_pro_football?: boolean
          is_trial?: boolean
          member_payments_enabled?: boolean
          member_subscription_amount?: number | null
          plan?: Database["public"]["Enums"]["club_subscription_plan"]
          promo_code_id?: string | null
          scheduled_storage_downgrade_gb?: number | null
          storage_downgrade_at?: string | null
          storage_purchased_gb?: number
          stripe_subscription_id?: string | null
          team_limit?: number | null
          trial_ends_at?: string | null
          trial_is_annual?: boolean | null
          trial_plan?: string | null
          trial_tier?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          admin_pro_football_override?: boolean
          admin_pro_override?: boolean
          club_id?: string
          created_at?: string
          disable_team_pom_rewards?: boolean
          expires_at?: string | null
          id?: string
          is_pro?: boolean
          is_pro_football?: boolean
          is_trial?: boolean
          member_payments_enabled?: boolean
          member_subscription_amount?: number | null
          plan?: Database["public"]["Enums"]["club_subscription_plan"]
          promo_code_id?: string | null
          scheduled_storage_downgrade_gb?: number | null
          storage_downgrade_at?: string | null
          storage_purchased_gb?: number
          stripe_subscription_id?: string | null
          team_limit?: number | null
          trial_ends_at?: string | null
          trial_is_annual?: boolean | null
          trial_plan?: string | null
          trial_tier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_subscriptions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: true
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      clubs: {
        Row: {
          auto_reward_threshold: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_pro: boolean
          logo_only_mode: boolean | null
          logo_url: string | null
          name: string
          primary_sponsor_id: string | null
          show_logo_in_header: boolean
          show_name_in_header: boolean | null
          sport: string | null
          storage_used_bytes: number
          theme_accent_h: number | null
          theme_accent_l: number | null
          theme_accent_s: number | null
          theme_dark_accent_h: number | null
          theme_dark_accent_l: number | null
          theme_dark_accent_s: number | null
          theme_dark_primary_h: number | null
          theme_dark_primary_l: number | null
          theme_dark_primary_s: number | null
          theme_dark_secondary_h: number | null
          theme_dark_secondary_l: number | null
          theme_dark_secondary_s: number | null
          theme_enabled: boolean
          theme_primary_h: number | null
          theme_primary_l: number | null
          theme_primary_s: number | null
          theme_secondary_h: number | null
          theme_secondary_l: number | null
          theme_secondary_s: number | null
          updated_at: string
        }
        Insert: {
          auto_reward_threshold?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_pro?: boolean
          logo_only_mode?: boolean | null
          logo_url?: string | null
          name: string
          primary_sponsor_id?: string | null
          show_logo_in_header?: boolean
          show_name_in_header?: boolean | null
          sport?: string | null
          storage_used_bytes?: number
          theme_accent_h?: number | null
          theme_accent_l?: number | null
          theme_accent_s?: number | null
          theme_dark_accent_h?: number | null
          theme_dark_accent_l?: number | null
          theme_dark_accent_s?: number | null
          theme_dark_primary_h?: number | null
          theme_dark_primary_l?: number | null
          theme_dark_primary_s?: number | null
          theme_dark_secondary_h?: number | null
          theme_dark_secondary_l?: number | null
          theme_dark_secondary_s?: number | null
          theme_enabled?: boolean
          theme_primary_h?: number | null
          theme_primary_l?: number | null
          theme_primary_s?: number | null
          theme_secondary_h?: number | null
          theme_secondary_l?: number | null
          theme_secondary_s?: number | null
          updated_at?: string
        }
        Update: {
          auto_reward_threshold?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_pro?: boolean
          logo_only_mode?: boolean | null
          logo_url?: string | null
          name?: string
          primary_sponsor_id?: string | null
          show_logo_in_header?: boolean
          show_name_in_header?: boolean | null
          sport?: string | null
          storage_used_bytes?: number
          theme_accent_h?: number | null
          theme_accent_l?: number | null
          theme_accent_s?: number | null
          theme_dark_accent_h?: number | null
          theme_dark_accent_l?: number | null
          theme_dark_accent_s?: number | null
          theme_dark_primary_h?: number | null
          theme_dark_primary_l?: number | null
          theme_dark_primary_s?: number | null
          theme_dark_secondary_h?: number | null
          theme_dark_secondary_l?: number | null
          theme_dark_secondary_s?: number | null
          theme_enabled?: boolean
          theme_primary_h?: number | null
          theme_primary_l?: number | null
          theme_primary_s?: number | null
          theme_secondary_h?: number | null
          theme_secondary_l?: number | null
          theme_secondary_s?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clubs_primary_sponsor_id_fkey"
            columns: ["primary_sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_conversations: {
        Row: {
          created_at: string
          id: string
          participant_1: string
          participant_2: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          participant_1: string
          participant_2: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          participant_1?: string
          participant_2?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_conversations_participant_1_fkey"
            columns: ["participant_1"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_conversations_participant_2_fkey"
            columns: ["participant_2"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      direct_messages: {
        Row: {
          author_id: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: string
          image_url: string | null
          reply_to_id: string | null
          text: string
        }
        Insert: {
          author_id: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text: string
        }
        Update: {
          author_id?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "direct_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      duties: {
        Row: {
          assigned_to: string | null
          created_at: string
          event_id: string
          id: string
          name: string
          points: number | null
          points_awarded: boolean
          status: Database["public"]["Enums"]["duty_status"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          event_id: string
          id?: string
          name: string
          points?: number | null
          points_awarded?: boolean
          status?: Database["public"]["Enums"]["duty_status"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          event_id?: string
          id?: string
          name?: string
          points?: number | null
          points_awarded?: boolean
          status?: Database["public"]["Enums"]["duty_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "duties_assigned_to_profiles_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duties_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_group_duties: {
        Row: {
          assigned_to: string | null
          created_at: string
          group_id: string
          id: string
          name: string
          points: number | null
          points_awarded: boolean | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          group_id: string
          id?: string
          name: string
          points?: number | null
          points_awarded?: boolean | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          group_id?: string
          id?: string
          name?: string
          points?: number | null
          points_awarded?: boolean | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_group_duties_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_group_duties_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "event_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      event_group_players: {
        Row: {
          created_at: string
          group_id: string
          id: string
          player_id: string
          team: string | null
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          player_id: string
          team?: string | null
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          player_id?: string
          team?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_group_players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "event_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_group_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mini_league_players"
            referencedColumns: ["id"]
          },
        ]
      }
      event_groups: {
        Row: {
          ability_band: string | null
          created_at: string
          display_order: number | null
          event_id: string
          id: string
          name: string
          pitch_name: string | null
          pitch_state: Json | null
          team_a_color: string | null
          team_b_color: string | null
          timer_state: Json | null
          updated_at: string
        }
        Insert: {
          ability_band?: string | null
          created_at?: string
          display_order?: number | null
          event_id: string
          id?: string
          name: string
          pitch_name?: string | null
          pitch_state?: Json | null
          team_a_color?: string | null
          team_b_color?: string | null
          timer_state?: Json | null
          updated_at?: string
        }
        Update: {
          ability_band?: string | null
          created_at?: string
          display_order?: number | null
          event_id?: string
          id?: string
          name?: string
          pitch_name?: string | null
          pitch_state?: Json | null
          team_a_color?: string | null
          team_b_color?: string | null
          timer_state?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_payments: {
        Row: {
          amount: number
          created_at: string
          event_id: string
          id: string
          paid_at: string | null
          payment_status: string
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          event_id: string
          id?: string
          paid_at?: string | null
          payment_status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          event_id?: string
          id?: string
          paid_at?: string | null
          payment_status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_payments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_sponsors: {
        Row: {
          created_at: string
          display_order: number
          event_id: string
          id: string
          sponsor_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          event_id: string
          id?: string
          sponsor_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          event_id?: string
          id?: string
          sponsor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_sponsors_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sponsors_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          address: string | null
          amount: number | null
          club_id: string
          created_at: string
          created_by: string
          description: string | null
          end_time: string | null
          event_date: string
          final_score_away: number | null
          final_score_home: number | null
          id: string
          is_cancelled: boolean
          is_home_game: boolean | null
          is_recurring: boolean | null
          location: string | null
          location_name: string | null
          meet_time: string | null
          mini_league_id: string | null
          opponent: string | null
          parent_event_id: string | null
          player_of_match: string | null
          postcode: string | null
          preview_image_url: string | null
          recurrence_end_date: string | null
          recurrence_rule: string | null
          reminder_hours_before: number | null
          reminder_sent: boolean | null
          requires_payment: boolean | null
          start_time: string | null
          state: string | null
          suburb: string | null
          team_id: string | null
          title: string
          type: Database["public"]["Enums"]["event_type"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          amount?: number | null
          club_id: string
          created_at?: string
          created_by: string
          description?: string | null
          end_time?: string | null
          event_date: string
          final_score_away?: number | null
          final_score_home?: number | null
          id?: string
          is_cancelled?: boolean
          is_home_game?: boolean | null
          is_recurring?: boolean | null
          location?: string | null
          location_name?: string | null
          meet_time?: string | null
          mini_league_id?: string | null
          opponent?: string | null
          parent_event_id?: string | null
          player_of_match?: string | null
          postcode?: string | null
          preview_image_url?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          reminder_hours_before?: number | null
          reminder_sent?: boolean | null
          requires_payment?: boolean | null
          start_time?: string | null
          state?: string | null
          suburb?: string | null
          team_id?: string | null
          title: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          amount?: number | null
          club_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          end_time?: string | null
          event_date?: string
          final_score_away?: number | null
          final_score_home?: number | null
          id?: string
          is_cancelled?: boolean
          is_home_game?: boolean | null
          is_recurring?: boolean | null
          location?: string | null
          location_name?: string | null
          meet_time?: string | null
          mini_league_id?: string | null
          opponent?: string | null
          parent_event_id?: string | null
          player_of_match?: string | null
          postcode?: string | null
          preview_image_url?: string | null
          recurrence_end_date?: string | null
          recurrence_rule?: string | null
          reminder_hours_before?: number | null
          reminder_sent?: boolean | null
          requires_payment?: boolean | null
          start_time?: string | null
          state?: string | null
          suburb?: string | null
          team_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["event_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      favorite_event_titles: {
        Row: {
          created_at: string
          event_type: string | null
          id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type?: string | null
          id?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string | null
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      favorite_opponents: {
        Row: {
          club_id: string | null
          created_at: string
          id: string
          opponent_name: string
          team_id: string | null
          user_id: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          id?: string
          opponent_name: string
          team_id?: string | null
          user_id: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          id?: string
          opponent_name?: string
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorite_opponents_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorite_opponents_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          admin_notes: string | null
          created_at: string
          description: string | null
          id: string
          message: string
          page_url: string | null
          status: Database["public"]["Enums"]["feedback_status"]
          title: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          description?: string | null
          id?: string
          message: string
          page_url?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          title?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          description?: string | null
          id?: string
          message?: string
          page_url?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          title?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_player_stats: {
        Row: {
          assists: number | null
          child_id: string | null
          created_at: string
          event_id: string | null
          fill_in_player_name: string | null
          goals_scored: number | null
          id: string
          jersey_number: number | null
          minutes_played: number | null
          player_name: string | null
          position: string | null
          position_minutes: Json | null
          positions_played: string[] | null
          started_on_pitch: boolean | null
          substitutions_count: number | null
          team_id: string | null
          total_game_time: number | null
          total_play_time_seconds: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assists?: number | null
          child_id?: string | null
          created_at?: string
          event_id?: string | null
          fill_in_player_name?: string | null
          goals_scored?: number | null
          id?: string
          jersey_number?: number | null
          minutes_played?: number | null
          player_name?: string | null
          position?: string | null
          position_minutes?: Json | null
          positions_played?: string[] | null
          started_on_pitch?: boolean | null
          substitutions_count?: number | null
          team_id?: string | null
          total_game_time?: number | null
          total_play_time_seconds?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assists?: number | null
          child_id?: string | null
          created_at?: string
          event_id?: string | null
          fill_in_player_name?: string | null
          goals_scored?: number | null
          id?: string
          jersey_number?: number | null
          minutes_played?: number | null
          player_name?: string | null
          position?: string | null
          position_minutes?: Json | null
          positions_played?: string[] | null
          started_on_pitch?: boolean | null
          substitutions_count?: number | null
          team_id?: string | null
          total_game_time?: number | null
          total_play_time_seconds?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_player_stats_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_player_stats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_player_stats_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_player_stats_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      game_summaries: {
        Row: {
          created_at: string
          event_id: string | null
          formation_used: string | null
          id: string
          is_active: boolean
          pitch_state: Json
          team_id: string | null
          timer_state: Json
          total_game_time: number | null
          total_substitutions: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          formation_used?: string | null
          id?: string
          is_active?: boolean
          pitch_state?: Json
          team_id?: string | null
          timer_state?: Json
          total_game_time?: number | null
          total_substitutions?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          formation_used?: string | null
          id?: string
          is_active?: boolean
          pitch_state?: Json
          team_id?: string | null
          timer_state?: Json
          total_game_time?: number | null
          total_substitutions?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_summaries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_summaries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          added_at: string
          added_by: string | null
          group_id: string
          id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          group_id: string
          id?: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          author_id: string
          created_at: string
          deleted_at: string | null
          group_id: string
          id: string
          image_url: string | null
          reply_to_id: string | null
          text: string
        }
        Insert: {
          author_id: string
          created_at?: string
          deleted_at?: string | null
          group_id: string
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text: string
        }
        Update: {
          author_id?: string
          created_at?: string
          deleted_at?: string | null
          group_id?: string
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      hidden_dm_conversations: {
        Row: {
          conversation_id: string
          hidden_at: string
          id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          hidden_at?: string
          id?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          hidden_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hidden_dm_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "direct_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_subscription_payments: {
        Row: {
          amount: number
          club_id: string
          created_at: string
          id: string
          notes: string | null
          paid_at: string | null
          payment_period: string
          payment_status: string
          payment_type: string
          stripe_payment_intent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          club_id: string
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_period: string
          payment_status?: string
          payment_type?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          club_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_period?: string
          payment_status?: string
          payment_type?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_subscription_payments_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          broadcast_message_id: string | null
          club_message_id: string | null
          created_at: string
          direct_message_id: string | null
          group_message_id: string | null
          id: string
          reaction_type: string
          team_message_id: string | null
          user_id: string
        }
        Insert: {
          broadcast_message_id?: string | null
          club_message_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          group_message_id?: string | null
          id?: string
          reaction_type: string
          team_message_id?: string | null
          user_id: string
        }
        Update: {
          broadcast_message_id?: string | null
          club_message_id?: string | null
          created_at?: string
          direct_message_id?: string | null
          group_message_id?: string | null
          id?: string
          reaction_type?: string
          team_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_broadcast_message_id_fkey"
            columns: ["broadcast_message_id"]
            isOneToOne: false
            referencedRelation: "broadcast_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_club_message_id_fkey"
            columns: ["club_message_id"]
            isOneToOne: false
            referencedRelation: "club_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_direct_message_id_fkey"
            columns: ["direct_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_group_message_id_fkey"
            columns: ["group_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_team_message_id_fkey"
            columns: ["team_message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reads: {
        Row: {
          broadcast_message_id: string | null
          club_message_id: string | null
          direct_message_id: string | null
          group_message_id: string | null
          id: string
          read_at: string
          team_message_id: string | null
          user_id: string
        }
        Insert: {
          broadcast_message_id?: string | null
          club_message_id?: string | null
          direct_message_id?: string | null
          group_message_id?: string | null
          id?: string
          read_at?: string
          team_message_id?: string | null
          user_id: string
        }
        Update: {
          broadcast_message_id?: string | null
          club_message_id?: string | null
          direct_message_id?: string | null
          group_message_id?: string | null
          id?: string
          read_at?: string
          team_message_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reads_broadcast_message_id_fkey"
            columns: ["broadcast_message_id"]
            isOneToOne: false
            referencedRelation: "broadcast_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_club_message_id_fkey"
            columns: ["club_message_id"]
            isOneToOne: false
            referencedRelation: "club_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_direct_message_id_fkey"
            columns: ["direct_message_id"]
            isOneToOne: false
            referencedRelation: "direct_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_group_message_id_fkey"
            columns: ["group_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reads_team_message_id_fkey"
            columns: ["team_message_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_group_duties: {
        Row: {
          assigned_to: string | null
          created_at: string
          group_id: string
          id: string
          name: string
          points: number | null
          points_awarded: boolean | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          group_id: string
          id?: string
          name: string
          points?: number | null
          points_awarded?: boolean | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          group_id?: string
          id?: string
          name?: string
          points?: number | null
          points_awarded?: boolean | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_group_duties_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_group_duties_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "mini_league_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_group_players: {
        Row: {
          created_at: string
          group_id: string
          id: string
          jersey_number: number | null
          player_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          jersey_number?: number | null
          player_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          jersey_number?: number | null
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_group_players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "mini_league_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_group_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mini_league_players"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_groups: {
        Row: {
          ability_band: string | null
          created_at: string
          display_order: number
          id: string
          linked_event_id: string | null
          name: string
          pitch_name: string | null
          pitch_state: Json | null
          session_id: string
          target_size: number
          timer_state: Json | null
          updated_at: string
        }
        Insert: {
          ability_band?: string | null
          created_at?: string
          display_order?: number
          id?: string
          linked_event_id?: string | null
          name: string
          pitch_name?: string | null
          pitch_state?: Json | null
          session_id: string
          target_size?: number
          timer_state?: Json | null
          updated_at?: string
        }
        Update: {
          ability_band?: string | null
          created_at?: string
          display_order?: number
          id?: string
          linked_event_id?: string | null
          name?: string
          pitch_name?: string | null
          pitch_state?: Json | null
          session_id?: string
          target_size?: number
          timer_state?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_groups_linked_event_id_fkey"
            columns: ["linked_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_groups_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "mini_league_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_players: {
        Row: {
          ability_rating: number
          child_id: string | null
          created_at: string
          id: string
          mini_league_id: string
          name: string
          notes: string | null
          parent_user_id: string | null
          updated_at: string
        }
        Insert: {
          ability_rating?: number
          child_id?: string | null
          created_at?: string
          id?: string
          mini_league_id: string
          name: string
          notes?: string | null
          parent_user_id?: string | null
          updated_at?: string
        }
        Update: {
          ability_rating?: number
          child_id?: string | null
          created_at?: string
          id?: string
          mini_league_id?: string
          name?: string
          notes?: string | null
          parent_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_players_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_players_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_session_availability: {
        Row: {
          created_at: string
          id: string
          marked_by: string | null
          player_id: string
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          marked_by?: string | null
          player_id: string
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          marked_by?: string | null
          player_id?: string
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_session_availability_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "mini_league_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_session_availability_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "mini_league_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_league_sessions: {
        Row: {
          address: string | null
          created_at: string
          created_by: string
          end_time: string | null
          id: string
          linked_event_id: string | null
          location_name: string | null
          mini_league_id: string
          postcode: string | null
          session_date: string
          start_time: string
          status: string
          team_size_override: number | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by: string
          end_time?: string | null
          id?: string
          linked_event_id?: string | null
          location_name?: string | null
          mini_league_id: string
          postcode?: string | null
          session_date: string
          start_time: string
          status?: string
          team_size_override?: number | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string
          end_time?: string | null
          id?: string
          linked_event_id?: string | null
          location_name?: string | null
          mini_league_id?: string
          postcode?: string | null
          session_date?: string
          start_time?: string
          status?: string
          team_size_override?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_league_sessions_linked_event_id_fkey"
            columns: ["linked_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mini_league_sessions_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      mini_leagues: {
        Row: {
          bib_colors: string[] | null
          club_id: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          logo_url: string | null
          min_players_per_side: number
          name: string
          team_size: number
          updated_at: string
        }
        Insert: {
          bib_colors?: string[] | null
          club_id: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          logo_url?: string | null
          min_players_per_side?: number
          name: string
          team_size?: number
          updated_at?: string
        }
        Update: {
          bib_colors?: string[] | null
          club_id?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          min_players_per_side?: number
          name?: string
          team_size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mini_leagues_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_admin_enabled: boolean
          email_events_enabled: boolean
          email_media_enabled: boolean
          email_membership_enabled: boolean
          email_messages_enabled: boolean
          email_pitch_board_enabled: boolean
          email_pom_enabled: boolean
          email_rewards_enabled: boolean
          events_enabled: boolean
          id: string
          media_enabled: boolean
          membership_enabled: boolean
          messages_enabled: boolean
          pitch_board_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_admin_enabled?: boolean
          email_events_enabled?: boolean
          email_media_enabled?: boolean
          email_membership_enabled?: boolean
          email_messages_enabled?: boolean
          email_pitch_board_enabled?: boolean
          email_pom_enabled?: boolean
          email_rewards_enabled?: boolean
          events_enabled?: boolean
          id?: string
          media_enabled?: boolean
          membership_enabled?: boolean
          messages_enabled?: boolean
          pitch_board_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_admin_enabled?: boolean
          email_events_enabled?: boolean
          email_media_enabled?: boolean
          email_membership_enabled?: boolean
          email_messages_enabled?: boolean
          email_pitch_board_enabled?: boolean
          email_pom_enabled?: boolean
          email_rewards_enabled?: boolean
          events_enabled?: boolean
          id?: string
          media_enabled?: boolean
          membership_enabled?: boolean
          messages_enabled?: boolean
          pitch_board_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          related_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          related_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          related_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_invites: {
        Row: {
          accepted_at: string | null
          club_id: string | null
          created_at: string
          email_error: string | null
          email_id: string | null
          email_sent_at: string | null
          id: string
          invite_token: string | null
          invited_by_user_id: string
          invited_email: string | null
          invited_label: string | null
          invited_user_id: string | null
          metadata: Json | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          team_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          club_id?: string | null
          created_at?: string
          email_error?: string | null
          email_id?: string | null
          email_sent_at?: string | null
          id?: string
          invite_token?: string | null
          invited_by_user_id: string
          invited_email?: string | null
          invited_label?: string | null
          invited_user_id?: string | null
          metadata?: Json | null
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          team_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          club_id?: string | null
          created_at?: string
          email_error?: string | null
          email_id?: string | null
          email_sent_at?: string | null
          id?: string
          invite_token?: string | null
          invited_by_user_id?: string
          invited_email?: string | null
          invited_label?: string | null
          invited_user_id?: string | null
          metadata?: Json | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_invites_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          reaction_type: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "photo_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_comments: {
        Row: {
          created_at: string
          id: string
          photo_id: string
          reply_to_id: string | null
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          photo_id: string
          reply_to_id?: string | null
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          photo_id?: string
          reply_to_id?: string | null
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_comments_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_comments_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "photo_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_comments_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_reactions: {
        Row: {
          created_at: string
          id: string
          photo_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          photo_id: string
          reaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          photo_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_reactions_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_reactions_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          caption: string | null
          club_id: string | null
          created_at: string
          deleted_at: string | null
          event_id: string | null
          file_size: number | null
          file_url: string | null
          folder_id: string | null
          id: string
          image_url: string
          show_in_feed: boolean | null
          team_id: string | null
          title: string | null
          uploader_id: string
        }
        Insert: {
          caption?: string | null
          club_id?: string | null
          created_at?: string
          deleted_at?: string | null
          event_id?: string | null
          file_size?: number | null
          file_url?: string | null
          folder_id?: string | null
          id?: string
          image_url: string
          show_in_feed?: boolean | null
          team_id?: string | null
          title?: string | null
          uploader_id: string
        }
        Update: {
          caption?: string | null
          club_id?: string | null
          created_at?: string
          deleted_at?: string | null
          event_id?: string | null
          file_size?: number | null
          file_url?: string | null
          folder_id?: string | null
          id?: string
          image_url?: string
          show_in_feed?: boolean | null
          team_id?: string | null
          title?: string | null
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photos_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      pitch_formations: {
        Row: {
          created_at: string
          formation_data: Json
          id: string
          is_default: boolean
          name: string
          team_id: string | null
          team_size: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          formation_data?: Json
          id?: string
          is_default?: boolean
          name: string
          team_id?: string | null
          team_size?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          formation_data?: Json
          id?: string
          is_default?: boolean
          name?: string
          team_id?: string | null
          team_size?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pitch_formations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      player_of_match: {
        Row: {
          child_id: string | null
          created_at: string
          event_id: string
          id: string
          points: number | null
          points_awarded: boolean
          updated_at: string
          user_id: string | null
        }
        Insert: {
          child_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          points?: number | null
          points_awarded?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          child_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          points?: number | null
          points_awarded?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_of_match_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_of_match_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_club_theme_id: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email_hash: string | null
          events_view_mode: string | null
          has_sausage_reward: boolean | null
          id: string
          ignite_points: number
          last_seen_at: string | null
          photo_consent: boolean | null
          photo_consent_given_at: string | null
          profile_visibility: string | null
          scheduled_deletion_at: string | null
          theme_preference: string | null
          updated_at: string
        }
        Insert: {
          active_club_theme_id?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email_hash?: string | null
          events_view_mode?: string | null
          has_sausage_reward?: boolean | null
          id: string
          ignite_points?: number
          last_seen_at?: string | null
          photo_consent?: boolean | null
          photo_consent_given_at?: string | null
          profile_visibility?: string | null
          scheduled_deletion_at?: string | null
          theme_preference?: string | null
          updated_at?: string
        }
        Update: {
          active_club_theme_id?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email_hash?: string | null
          events_view_mode?: string | null
          has_sausage_reward?: boolean | null
          id?: string
          ignite_points?: number
          last_seen_at?: string | null
          photo_consent?: boolean | null
          photo_consent_given_at?: string | null
          profile_visibility?: string | null
          scheduled_deletion_at?: string | null
          theme_preference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_club_theme_id_fkey"
            columns: ["active_club_theme_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          access_level: string | null
          club_id: string | null
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          scope_type: string | null
          storage_gb: number | null
          updated_at: string
          uses_count: number
        }
        Insert: {
          access_level?: string | null
          club_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          scope_type?: string | null
          storage_gb?: number | null
          updated_at?: string
          uses_count?: number
        }
        Update: {
          access_level?: string | null
          club_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          scope_type?: string | null
          storage_gb?: number | null
          updated_at?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      push_alert_settings: {
        Row: {
          alerts_enabled: boolean
          check_window_hours: number
          cooldown_hours: number
          failure_threshold_percent: number
          id: string
          min_notifications: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alerts_enabled?: boolean
          check_window_hours?: number
          cooldown_hours?: number
          failure_threshold_percent?: number
          id?: string
          min_notifications?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alerts_enabled?: boolean
          check_window_hours?: number
          cooldown_hours?: number
          failure_threshold_percent?: number
          id?: string
          min_notifications?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      push_notification_logs: {
        Row: {
          created_at: string
          endpoint: string
          error_message: string | null
          id: string
          notification_id: string | null
          status: string
          status_code: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          status: string
          status_code?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          error_message?: string | null
          id?: string
          notification_id?: string | null
          status?: string
          status_code?: number | null
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          platform: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          platform?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          platform?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          identifier: string
          request_count: number
          updated_at: string
          window_start: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          identifier: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          identifier?: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      reward_redemptions: {
        Row: {
          child_id: string | null
          club_id: string | null
          created_at: string
          id: string
          points_spent: number
          redeemed_at: string | null
          reward_id: string
          status: string
          user_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          child_id?: string | null
          club_id?: string | null
          created_at?: string
          id?: string
          points_spent: number
          redeemed_at?: string | null
          reward_id: string
          status?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          child_id?: string | null
          club_id?: string | null
          created_at?: string
          id?: string
          points_spent?: number
          redeemed_at?: string | null
          reward_id?: string
          status?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "club_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      role_requests: {
        Row: {
          club_id: string | null
          created_at: string
          id: string
          mini_league_id: string | null
          processed_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["role_request_status"]
          team_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          id?: string
          mini_league_id?: string | null
          processed_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["role_request_status"]
          team_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          id?: string
          mini_league_id?: string | null
          processed_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["role_request_status"]
          team_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_requests_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_requests_mini_league_id_fkey"
            columns: ["mini_league_id"]
            isOneToOne: false
            referencedRelation: "mini_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_requests_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_requests_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rsvps: {
        Row: {
          child_id: string | null
          created_at: string
          event_id: string
          has_paid: boolean | null
          id: string
          mini_league_player_id: string | null
          notes: string | null
          status: Database["public"]["Enums"]["rsvp_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          child_id?: string | null
          created_at?: string
          event_id: string
          has_paid?: boolean | null
          id?: string
          mini_league_player_id?: string | null
          notes?: string | null
          status: Database["public"]["Enums"]["rsvp_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          child_id?: string | null
          created_at?: string
          event_id?: string
          has_paid?: boolean | null
          id?: string
          mini_league_player_id?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["rsvp_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rsvps_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvps_mini_league_player_id_fkey"
            columns: ["mini_league_player_id"]
            isOneToOne: false
            referencedRelation: "mini_league_players"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_locations: {
        Row: {
          address: string
          created_at: string
          id: string
          is_favorite: boolean
          latitude: number | null
          longitude: number | null
          name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          is_favorite?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          is_favorite?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sponsor_analytics: {
        Row: {
          context: string
          created_at: string
          event_id: string | null
          event_type: string
          id: string
          sponsor_id: string
          user_id: string | null
        }
        Insert: {
          context: string
          created_at?: string
          event_id?: string | null
          event_type: string
          id?: string
          sponsor_id: string
          user_id?: string | null
        }
        Update: {
          context?: string
          created_at?: string
          event_id?: string | null
          event_type?: string
          id?: string
          sponsor_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_analytics_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_analytics_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsors: {
        Row: {
          club_id: string | null
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_team_only: boolean
          logo_url: string | null
          name: string
          team_id: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_team_only?: boolean
          logo_url?: string | null
          name: string
          team_id?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          club_id?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_team_only?: boolean
          logo_url?: string | null
          name?: string
          team_id?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sponsors_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsors_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_folders: {
        Row: {
          club_id: string | null
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          sort_order: number
          team_id: string | null
          updated_at: string
        }
        Insert: {
          club_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          club_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_folders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          max_uses: number | null
          role: Database["public"]["Enums"]["app_role"]
          team_id: string
          token: string
          uses_count: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role: Database["public"]["Enums"]["app_role"]
          team_id: string
          token: string
          uses_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role?: Database["public"]["Enums"]["app_role"]
          team_id?: string
          token?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "team_invites_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_messages: {
        Row: {
          author_id: string
          created_at: string
          deleted_at: string | null
          id: string
          image_url: string | null
          reply_to_id: string | null
          team_id: string
          text: string
        }
        Insert: {
          author_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          team_id: string
          text: string
        }
        Update: {
          author_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          reply_to_id?: string | null
          team_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "team_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_messages_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_player_positions: {
        Row: {
          child_id: string | null
          created_at: string
          id: string
          jersey_number: number | null
          position: string
          preferred_positions: string[] | null
          team_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          child_id?: string | null
          created_at?: string
          id?: string
          jersey_number?: number | null
          position: string
          preferred_positions?: string[] | null
          team_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          child_id?: string | null
          created_at?: string
          id?: string
          jersey_number?: number | null
          position?: string
          preferred_positions?: string[] | null
          team_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_player_positions_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_player_positions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_sponsor_allocations: {
        Row: {
          created_at: string
          display_order: number
          id: string
          sponsor_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          sponsor_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          sponsor_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_sponsor_allocations_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_sponsor_allocations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_sponsors: {
        Row: {
          created_at: string
          display_order: number
          id: string
          sponsor_id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          sponsor_id: string
          team_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          sponsor_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_sponsors_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_sponsors_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_subscriptions: {
        Row: {
          admin_pro_football_override: boolean
          admin_pro_override: boolean
          created_at: string
          disable_auto_subs: boolean | null
          disable_batch_subs: boolean | null
          disable_position_swaps: boolean | null
          expires_at: string | null
          formation: string | null
          id: string
          is_pro: boolean
          is_pro_football: boolean
          is_trial: boolean | null
          minutes_per_half: number | null
          rotation_speed: number | null
          show_match_header: boolean | null
          team_id: string
          team_size: number | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          admin_pro_football_override?: boolean
          admin_pro_override?: boolean
          created_at?: string
          disable_auto_subs?: boolean | null
          disable_batch_subs?: boolean | null
          disable_position_swaps?: boolean | null
          expires_at?: string | null
          formation?: string | null
          id?: string
          is_pro?: boolean
          is_pro_football?: boolean
          is_trial?: boolean | null
          minutes_per_half?: number | null
          rotation_speed?: number | null
          show_match_header?: boolean | null
          team_id: string
          team_size?: number | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          admin_pro_football_override?: boolean
          admin_pro_override?: boolean
          created_at?: string
          disable_auto_subs?: boolean | null
          disable_batch_subs?: boolean | null
          disable_position_swaps?: boolean | null
          expires_at?: string | null
          formation?: string | null
          id?: string
          is_pro?: boolean
          is_pro_football?: boolean
          is_trial?: boolean | null
          minutes_per_half?: number | null
          rotation_speed?: number | null
          show_match_header?: boolean | null
          team_id?: string
          team_size?: number | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_subscriptions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          club_id: string | null
          created_at: string
          created_by: string | null
          default_formation: string | null
          default_pitch_format: string | null
          default_pitch_orientation: string | null
          default_pitch_view: string | null
          description: string | null
          folder_id: string | null
          id: string
          level_age: string | null
          logo_url: string | null
          name: string
          sponsor_id: string | null
          team_type: string | null
          updated_at: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          default_formation?: string | null
          default_pitch_format?: string | null
          default_pitch_orientation?: string | null
          default_pitch_view?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          level_age?: string | null
          logo_url?: string | null
          name: string
          sponsor_id?: string | null
          team_type?: string | null
          updated_at?: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          default_formation?: string | null
          default_pitch_format?: string | null
          default_pitch_orientation?: string | null
          default_pitch_view?: string | null
          description?: string | null
          folder_id?: string | null
          id?: string
          level_age?: string | null
          logo_url?: string | null
          name?: string
          sponsor_id?: string | null
          team_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "team_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      user_passkeys: {
        Row: {
          counter: number
          created_at: string
          credential_id: string
          device_type: string | null
          id: string
          last_used_at: string | null
          public_key: string
          user_id: string
        }
        Insert: {
          counter?: number
          created_at?: string
          credential_id: string
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          public_key: string
          user_id: string
        }
        Update: {
          counter?: number
          created_at?: string
          credential_id?: string
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          club_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          team_id: string | null
          user_id: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          team_id?: string | null
          user_id: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_files: {
        Row: {
          club_id: string | null
          created_at: string
          deleted_at: string | null
          file_size: number | null
          file_type: string | null
          file_url: string
          folder_id: string | null
          id: string
          name: string
          team_id: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          deleted_at?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url: string
          folder_id?: string | null
          id?: string
          name: string
          team_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          club_id?: string | null
          created_at?: string
          deleted_at?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          folder_id?: string | null
          id?: string
          name?: string
          team_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_files_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_files_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_folders: {
        Row: {
          club_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          team_id: string | null
          updated_at: string
        }
        Insert: {
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          club_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_folders_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "vault_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_folders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_chat_group: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      can_admin_view_child: {
        Args: { _child_id: string; _user_id: string }
        Returns: boolean
      }
      can_dm_user: { Args: { other_user_id: string }; Returns: boolean }
      can_view_child_via_team: {
        Args: { _child_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_full_profile: {
        Args: { _profile_id: string; _viewer_id: string }
        Returns: boolean
      }
      check_password_reset_rate_limit: {
        Args: { p_email: string }
        Returns: boolean
      }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      decrypt_sensitive_data: {
        Args: { encrypted_data: string }
        Returns: string
      }
      encrypt_sensitive_data: { Args: { data: string }; Returns: string }
      extract_mentioned_user_ids: {
        Args: { message_text: string }
        Returns: string[]
      }
      generate_email_hash: { Args: { email: string }; Returns: string }
      get_club_invite_by_token: {
        Args: { _token: string }
        Returns: {
          club_description: string
          club_id: string
          club_logo_url: string
          club_name: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_uses: number
          role: Database["public"]["Enums"]["app_role"]
          token: string
          uses_count: number
        }[]
      }
      get_club_team_count: { Args: { _club_id: string }; Returns: number }
      get_or_create_dm_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      get_pending_invite_by_token: {
        Args: { _token: string }
        Returns: {
          club_id: string
          club_logo_url: string
          club_name: string
          id: string
          invited_email: string
          invited_label: string
          metadata: Json
          role: string
          status: string
          team_id: string
          team_logo_url: string
          team_name: string
        }[]
      }
      get_team_invite_by_token: {
        Args: { _token: string }
        Returns: {
          club_id: string
          club_name: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_uses: number
          role: Database["public"]["Enums"]["app_role"]
          team_id: string
          team_logo_url: string
          team_name: string
          token: string
          uses_count: number
        }[]
      }
      get_user_by_email_for_passkey: {
        Args: { lookup_email: string }
        Returns: {
          id: string
        }[]
      }
      get_user_emails_by_ids: {
        Args: { user_ids: string[] }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _club_id?: string
          _role: Database["public"]["Enums"]["app_role"]
          _team_id?: string
          _user_id: string
        }
        Returns: boolean
      }
      hash_email: { Args: { email: string }; Returns: string }
      is_child_guardian: {
        Args: { _child_id: string; _user_id: string }
        Returns: boolean
      }
      is_club_member: {
        Args: { _club_id: string; _user_id: string }
        Returns: boolean
      }
      is_league_admin: {
        Args: { p_mini_league_id: string; p_user_id: string }
        Returns: boolean
      }
      is_league_parent: {
        Args: { p_mini_league_id: string; p_user_id: string }
        Returns: boolean
      }
      is_team_member: {
        Args: { _team_id: string; _user_id: string }
        Returns: boolean
      }
      notify_all_users: {
        Args: {
          _exclude_user_id: string
          _message: string
          _related_id?: string
          _type: string
        }
        Returns: undefined
      }
      notify_club_members: {
        Args: {
          _club_id: string
          _exclude_user_id: string
          _message: string
          _related_id?: string
          _type: string
        }
        Returns: undefined
      }
      notify_team_members: {
        Args: {
          _exclude_user_id: string
          _message: string
          _related_id?: string
          _team_id: string
          _type: string
        }
        Returns: undefined
      }
      require_app_admin: { Args: never; Returns: boolean }
      require_club_admin: { Args: { p_club_id: string }; Returns: boolean }
      send_duty_notification_email: {
        Args: {
          p_club_logo_url: string
          p_club_name: string
          p_duty_name: string
          p_event_date: string
          p_event_id: string
          p_event_time: string
          p_event_title: string
          p_recipient_user_id: string
          p_team_name: string
        }
        Returns: undefined
      }
      send_message_notification_email: {
        Args: {
          p_context_id: string
          p_context_name: string
          p_has_image?: boolean
          p_message_id: string
          p_message_text: string
          p_message_type: string
          p_recipient_user_id: string
          p_sender_user_id: string
        }
        Returns: undefined
      }
      send_photo_notification_email: {
        Args: {
          p_context_id: string
          p_context_name: string
          p_context_type: string
          p_photo_id: string
          p_recipient_user_id: string
          p_uploader_user_id: string
        }
        Returns: undefined
      }
      shares_team_or_club_with: {
        Args: { _profile_id: string; _viewer_id: string }
        Returns: boolean
      }
      team_has_club_pro_access: { Args: { _team_id: string }; Returns: boolean }
      team_has_club_pro_football_access: {
        Args: { _team_id: string }
        Returns: boolean
      }
      user_email_matches_invite: {
        Args: { _invited_email: string; _user_id: string }
        Returns: boolean
      }
      validate_promo_code: {
        Args: { _club_id?: string; _code: string }
        Returns: {
          access_level: string
          club_id: string
          expires_at: string
          id: string
          is_valid: boolean
        }[]
      }
    }
    Enums: {
      app_role:
        | "basic_user"
        | "club_admin"
        | "team_admin"
        | "coach"
        | "player"
        | "parent"
        | "app_admin"
        | "league_admin"
      club_subscription_plan: "starter" | "standard" | "unlimited"
      duty_status: "open" | "completed"
      event_type: "game" | "training" | "social" | "mini_league"
      feedback_status: "open" | "in_progress" | "resolved"
      role_request_status: "pending" | "approved" | "denied"
      rsvp_status: "going" | "maybe" | "not_going"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "basic_user",
        "club_admin",
        "team_admin",
        "coach",
        "player",
        "parent",
        "app_admin",
        "league_admin",
      ],
      club_subscription_plan: ["starter", "standard", "unlimited"],
      duty_status: ["open", "completed"],
      event_type: ["game", "training", "social", "mini_league"],
      feedback_status: ["open", "in_progress", "resolved"],
      role_request_status: ["pending", "approved", "denied"],
      rsvp_status: ["going", "maybe", "not_going"],
    },
  },
} as const
